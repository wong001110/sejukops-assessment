# Rehearse one protected Test backup in a disposable local PostgreSQL 17 cluster.
# This script never connects to or writes to hosted Supabase.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^test-backup-[0-9A-Za-zT-]+\.json$')]
  [string] $ManifestName
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backupDir = Join-Path $root 'supabase\.temp\backups'
$manifest = Get-Content -LiteralPath (Join-Path $backupDir $ManifestName) -Raw | ConvertFrom-Json
if ($manifest.projectRef -ne 'qobhjvrrpajoyvlgrkbx' -or
    $manifest.sourceHost -ne 'db.qobhjvrrpajoyvlgrkbx.supabase.co' -or
    $manifest.archives.Count -ne 2) {
  throw 'Expected exact Test backup manifest with two archives'
}
$application = @($manifest.archives | Where-Object { $_.file -match '^test-application-[0-9A-Za-zT-]+\.dump$' })
$full = @($manifest.archives | Where-Object { $_.file -match '^test-full-[0-9A-Za-zT-]+\.dump$' })
if ($application.Count -ne 1 -or $full.Count -ne 1) { throw 'Expected full and application Test archives' }
$archive = Join-Path $backupDir $application[0].file
$fullArchive = Join-Path $backupDir $full[0].file
foreach ($entry in @(@{ path = $archive; record = $application[0] },
    @{ path = $fullArchive; record = $full[0] })) {
  if ((Get-Item -LiteralPath $entry.path).Length -ne $entry.record.bytes -or
      (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ne $entry.record.sha256) {
    throw 'Backup archive hash or length mismatch'
  }
}

$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$restore = Join-Path $pgBin 'pg_restore.exe'
$initdb = Join-Path $pgBin 'initdb.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$psql = Join-Path $pgBin 'psql.exe'
foreach ($tool in @($restore, $initdb, $pgCtl, $pgIsReady, $psql)) {
  if (-not (Test-Path -LiteralPath $tool)) { throw "PostgreSQL 17 tool missing: $tool" }
}

# Profile Auth IDs validate the relationship to the full archive. Never print
# archived profile rows, user fields, or credential hashes.
$profileSql = & $restore --data-only --schema=public --table=profiles --file=- $archive
if ($LASTEXITCODE -ne 0) { throw 'Could not read archived profile rows' }
$copyHeader = @($profileSql | Where-Object { $_ -match '^COPY public\.profiles \(' })
if ($copyHeader.Count -ne 1) { throw 'Archived profile COPY header missing' }
$columns = [regex]::Match($copyHeader[0], '^COPY public\.profiles \(([^)]+)\)').Groups[1].Value.Split(',').Trim()
$authIndex = [Array]::IndexOf($columns, 'auth_user_id')
if ($authIndex -lt 0) { throw 'Archived profile Auth column missing' }
$copyStart = [Array]::IndexOf($profileSql, $copyHeader[0]) + 1
$authIds = [System.Collections.Generic.HashSet[string]]::new()
for ($i = $copyStart; $i -lt $profileSql.Count -and $profileSql[$i] -ne '\.'; $i++) {
  $fields = $profileSql[$i].Split("`t")
  $value = $fields[$authIndex]
  if ($value -ne '\N') {
    if ($value -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
      throw 'Archived profile has an invalid Auth ID'
    }
    [void] $authIds.Add($value)
  }
}
if ($authIds.Count -ne 4) { throw 'Expected four archived Test Auth identities' }

# Restore only identity fields needed by the application digest and foreign key.
# The full archive remains in memory here; do not print its rows or hashes.
$authSql = & $restore --data-only --schema=auth --table=users --file=- $fullArchive
if ($LASTEXITCODE -ne 0) { throw 'Could not read archived Auth users' }
$authHeader = @($authSql | Where-Object { $_ -match '^COPY auth\.users \(' })
if ($authHeader.Count -ne 1) { throw 'Archived Auth COPY header missing' }
$authColumns = [regex]::Match($authHeader[0], '^COPY auth\.users \(([^)]+)\)').Groups[1].Value.Split(',').Trim()
$selected = @('id', 'email', 'encrypted_password', 'email_confirmed_at', 'is_anonymous')
$indices = @($selected | ForEach-Object { [Array]::IndexOf($authColumns, $_) })
if ($indices -contains -1) { throw 'Archived Auth identity field missing' }
$authStart = [Array]::IndexOf($authSql, $authHeader[0]) + 1
$copyRows = [System.Collections.Generic.List[string]]::new()
$restoredIds = [System.Collections.Generic.HashSet[string]]::new()
for ($i = $authStart; $i -lt $authSql.Count -and $authSql[$i] -ne '\.'; $i++) {
  $fields = $authSql[$i].Split("`t")
  $copyRows.Add(($indices | ForEach-Object { $fields[$_] }) -join "`t")
  [void] $restoredIds.Add($fields[$indices[0]])
}
if ($copyRows.Count -ne 4 -or $restoredIds.Count -ne 4 -or
    @($authIds | Where-Object { -not $restoredIds.Contains($_) }).Count -ne 0) {
  throw 'Archived Auth IDs do not match application profiles'
}

$tempRoot = Join-Path $root 'supabase\.temp'
$scratch = Join-Path $tempRoot ('backup-restore-' + [guid]::NewGuid().ToString('N'))
$cluster = Join-Path $scratch 'pg'
New-Item -ItemType Directory -Path $scratch -ErrorAction Stop | Out-Null
$previousPgPassword = $env:PGPASSWORD
$previousPgOptions = $env:PGOPTIONS
$startProcess = $null
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
try {
  $ownerSid = [regex]::Match((& whoami.exe /user /fo csv /nh) -join '', 'S-1-5-\d+(?:-\d+)+').Value
  if (-not $ownerSid) { throw 'Could not identify the local restore owner' }
  & icacls.exe $scratch '/inheritance:r' '/grant:r' "*${ownerSid}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local restore directory' }
  $scratchAcl = (& icacls.exe $scratch) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $scratchAcl -match 'Everyone|Authenticated Users|BUILTIN\\Users') {
    throw 'Local restore directory has broad access'
  }
  $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $passwordFile = Join-Path $scratch 'local-password'
  [IO.File]::WriteAllText($passwordFile, "$password`n", [Text.UTF8Encoding]::new($false))
  $env:PGPASSWORD = $password
  & $initdb -D $cluster --username=postgres --auth=scram-sha-256 `
    --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL initdb failed' }
  # Start through a process handle: on Windows, piping pg_ctl's output makes
  # PowerShell wait for the long-running postgres child as well.
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($pgCtl)
  foreach ($argument in @('-D', $cluster, '-l', (Join-Path $scratch 'postgres.log'),
      '-o', "-c listen_addresses=127.0.0.1 -p $port", '-W', 'start')) {
    [void] $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startProcess = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $startProcess.WaitForExit(15000) -or $startProcess.ExitCode -ne 0) {
    throw 'Local PostgreSQL start failed'
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & $pgIsReady -h 127.0.0.1 -p $port -U postgres | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'Local PostgreSQL did not become ready' }

  $setup = @'
drop schema public cascade;
create schema auth;
create schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_admin nologin;
create table auth.users (
  id uuid primary key, email text, encrypted_password text,
  email_confirmed_at timestamptz, is_anonymous boolean not null default false
);
create table auth.sessions (id uuid primary key, user_id uuid, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
create extension pgcrypto with schema extensions;
'@
  & $psql --no-psqlrc -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -q -c $setup
  if ($LASTEXITCODE -ne 0) { throw 'Local managed-schema stubs failed' }
  $copyInput = "COPY auth.users ($($selected -join ', ')) FROM stdin;`n" +
    ($copyRows -join "`n") + "`n\.`n"
  $copyInput | & $psql --no-psqlrc -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -q -f -
  if ($LASTEXITCODE -ne 0) { throw 'Local archived Auth identity subset failed' }

  & $restore --no-owner --single-transaction --exit-on-error `
    -h 127.0.0.1 -p $port -U postgres -d postgres $archive
  if ($LASTEXITCODE -ne 0) { throw 'Local application archive restore failed' }

  $digestSql = (& node --input-type=module -e @'
import { readFileSync } from 'node:fs';
import { testDataDigestSql, testAuthDigestSql } from './scripts/p1-test-data-digest.mjs';
process.stdout.write(JSON.stringify({
  data: testDataDigestSql(readFileSync('supabase/fresh/baseline.sql', 'utf8')),
  auth: testAuthDigestSql(),
}));
'@) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $digestSql) { throw 'Could not build backup data digest query' }
  $digestQueries = $digestSql | ConvertFrom-Json
  # The live backup runner computes its digest with an explicit UTC session.
  $env:PGOPTIONS = '-c TimeZone=UTC'
  $actualDigest = (& $psql --no-psqlrc -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -c $digestQueries.data) -join ''
  $actualDigest = $actualDigest.Trim()
  $actualAuthDigest = (& $psql --no-psqlrc -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -c $digestQueries.auth) -join ''
  $actualAuthDigest = $actualAuthDigest.Trim()
  if ($LASTEXITCODE -ne 0 -or $actualDigest -ne $manifest.dataDigest -or
      $actualAuthDigest -ne $manifest.authDigest) {
    throw 'Local restored application digest differs from backup manifest'
  }
  $constraints = (& $psql --no-psqlrc -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -c "select count(*) from pg_constraint where contype='f' and connamespace in ('public'::regnamespace,'private'::regnamespace) and convalidated") -join ''
  $constraints = $constraints.Trim()
  if ($LASTEXITCODE -ne 0 -or [int]$constraints -lt 30) { throw 'Local restored foreign keys not validated' }
  $grantCheck = (& $psql --no-psqlrc -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -c "select not has_table_privilege('anon','public.workspace_orders','SELECT') and not has_table_privilege('authenticated','public.workspace_orders','INSERT') and has_table_privilege('authenticated','public.workspace_orders','SELECT')") -join ''
  if ($LASTEXITCODE -ne 0 -or $grantCheck.Trim() -ne 't') { throw 'Local restored order grants differ from reviewed boundary' }
  Write-Output ("LOCAL_RESTORE_PASS manifest={0} auth_stubs={1} validated_foreign_keys={2} digest_match=true selected_grants=true" -f $ManifestName, $authIds.Count, $constraints)
} finally {
  try {
    if ($startProcess -and -not $startProcess.HasExited) {
      $startProcess.Kill()
      if (-not $startProcess.WaitForExit(5000)) {
        throw 'Local PostgreSQL launcher did not stop; keeping scratch files'
      }
    }
    if (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')) {
      & $pgCtl -D $cluster status | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Local restore cluster state is uncertain; keeping scratch files' }
      & $pgCtl -D $cluster -m immediate -w stop | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Could not stop local restore cluster safely' }
    }
    & $pgIsReady -h 127.0.0.1 -p $port -U postgres | Out-Null
    if ($LASTEXITCODE -eq 0) { throw 'Local restore port is still active; keeping scratch files' }
    $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot).TrimEnd('\')
    $resolvedScratch = [System.IO.Path]::GetFullPath($scratch)
    if (-not $resolvedScratch.StartsWith($resolvedTemp + '\backup-restore-', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'Scratch cleanup target escaped expected directory'
    }
    Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
  } finally {
    $env:PGPASSWORD = $previousPgPassword
    $env:PGOPTIONS = $previousPgOptions
  }
}
