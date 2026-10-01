# Synthetic, disposable localhost-only PostgreSQL 17 rehearsal. No .env or backups.
param([string]$PreviewMigrationPath)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskScratchRoot = Join-Path $taskRoot 'supabase/.temp'
$taskPreviewMigration = Join-Path $taskRoot 'supabase/migrations/20261001071230_owner_perspectives.sql'
if ($PreviewMigrationPath) {
  $taskOverride = (Resolve-Path -LiteralPath $PreviewMigrationPath).Path
  $taskMutationPrefix = [IO.Path]::GetFullPath((Join-Path $taskScratchRoot 'readonly-mutations')).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  if (-not $taskOverride.StartsWith($taskMutationPrefix,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($taskOverride) -ne '.sql') { throw 'Preview mutation must be a local .sql under .temp/readonly-mutations' }
  $taskPreviewMigration = $taskOverride
}
$taskScratch = Join-Path $taskScratchRoot ('staff-foundation-' + [guid]::NewGuid().ToString('N'))
$taskCluster = Join-Path $taskScratch 'cluster'
$taskPgBin = 'C:/Program Files/PostgreSQL/17/bin'
$taskPgCtl = Join-Path $taskPgBin 'pg_ctl.exe'
$taskPsql = Join-Path $taskPgBin 'psql.exe'
$taskOldPgPassword = $env:PGPASSWORD
New-Item -ItemType Directory -Path $taskScratch -Force | Out-Null
$taskListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$taskListener.Start()
$taskPort = $taskListener.LocalEndpoint.Port
$taskListener.Stop()
$taskStarted = $false
try {
  $taskPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $taskPasswordFile = Join-Path $taskScratch 'local-password'
  [IO.File]::WriteAllText($taskPasswordFile, "$taskPassword`n", [Text.UTF8Encoding]::new($false))
  $env:PGPASSWORD = $taskPassword
  & (Join-Path $taskPgBin 'initdb.exe') -D $taskCluster --username=postgres --auth=scram-sha-256 --pwfile=$taskPasswordFile --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic local initdb failed' }
  $taskStartInfo = [Diagnostics.ProcessStartInfo]::new($taskPgCtl)
  foreach ($taskArg in @('-D', $taskCluster, '-l', (Join-Path $taskScratch 'postgres.log'), '-o', "-c listen_addresses=127.0.0.1 -p $taskPort", '-w', 'start')) {
    [void]$taskStartInfo.ArgumentList.Add($taskArg)
  }
  $taskStartInfo.UseShellExecute = $false
  $taskStartInfo.CreateNoWindow = $true
  $taskStartInfo.RedirectStandardOutput = $true
  $taskStartInfo.RedirectStandardError = $true
  $taskProcess = [Diagnostics.Process]::Start($taskStartInfo)
  if (-not $taskProcess.WaitForExit(15000) -or $taskProcess.ExitCode -ne 0) { throw 'Synthetic localhost PostgreSQL start failed' }
  $taskStarted = $true
  $taskSetup = @'
create schema auth;
create schema extensions;
create schema storage;
create table storage.objects(id uuid primary key);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false,
  email_confirmed_at timestamptz default now(), raw_app_meta_data jsonb not null default '{}'::jsonb,
  encrypted_password text default 'synthetic');
create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id), created_at timestamptz not null default now(), not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.jwt(),auth.uid() to authenticated,service_role;
create extension pgcrypto with schema extensions;
'@
  $taskSetup | & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f -
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic Auth/role setup failed' }
  # The current baseline already includes all six staff migrations. Exercise the
  # pinned installer transaction/catalog once, never apply those migrations twice.
  $taskReplayFile = Join-Path $taskScratch 'fresh-replay.sql'
  $taskReplayBuild = @'
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFreshReplaySql } from './scripts/p1-apply-fresh-baseline.mjs';
writeFileSync(process.argv[1], buildFreshReplaySql(readFileSync('supabase/fresh/baseline.sql','utf8'),
  readFileSync('supabase/fresh/catalog-seed.sql','utf8')));
'@
  & node --input-type=module -e $taskReplayBuild $taskReplayFile
  if ($LASTEXITCODE -ne 0) { throw 'Pinned fresh installer SQL build failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $taskReplayFile
  if ($LASTEXITCODE -ne 0) { throw 'Guarded fresh baseline/catalog failed on synthetic local PostgreSQL' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-fresh-empty-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Fresh empty application/grant checks failed' }
  if ($PreviewMigrationPath) {
    # A mutation replaces only the existing readiness function; reapplying its
    # whole historical migration would collide with the fresh baseline tables.
    $taskMutantSource = Get-Content -LiteralPath $taskPreviewMigration -Raw
    $taskReadinessMatch = [regex]::Match($taskMutantSource,'(?s)create or replace function private\.staff_actor_ready\(.*?\n\$\$;')
    if (-not $taskReadinessMatch.Success) { throw 'Preview mutation readiness definition missing' }
    $taskMutationSql = Join-Path $taskScratch 'preview-readiness-mutation.sql'
    [IO.File]::WriteAllText($taskMutationSql,$taskReadinessMatch.Value,[Text.UTF8Encoding]::new($false))
    & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $taskMutationSql
    if ($LASTEXITCODE -ne 0) { throw 'Preview readiness mutation failed locally' }
  }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-foundation-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff synthetic SQL checks failed' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'owner-perspectives-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Owner perspectives synthetic SQL checks failed' }
  & (Join-Path $PSScriptRoot 'owner-perspectives-concurrency-local.ps1') -Psql $taskPsql -Port $taskPort -Scratch $taskScratch
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-import-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff import synthetic SQL checks failed' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-reset-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff reset synthetic SQL checks failed' }
  Write-Output 'PASS: pinned current fresh baseline/catalog installed once in disposable localhost PostgreSQL; empty application, staff, preview, import, reset and overlap assertions completed.'
} finally {
  if ($taskStarted) {
    & $taskPgCtl -D $taskCluster -m immediate -w stop | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic PostgreSQL cleanup stop failed; inspect scratch path' }
  }
  $env:PGPASSWORD = $taskOldPgPassword
  # Verify the absolute deletion target is the exact generated directory under .temp.
  $taskResolved = [IO.Path]::GetFullPath($taskScratch)
  $taskAllowedPrefix = [IO.Path]::GetFullPath($taskScratchRoot).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  if (-not $taskResolved.StartsWith($taskAllowedPrefix,[StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($taskResolved) -notmatch '^staff-foundation-[0-9a-f]{32}$') { throw 'Refusing unsafe local scratch cleanup path' }
  Remove-Item -LiteralPath $taskResolved -Recurse -Force
}
