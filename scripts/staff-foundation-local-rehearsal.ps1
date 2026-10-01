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
$taskMigration = Join-Path $taskRoot 'supabase/migrations/20261001062950_staff_auth_foundation.sql'
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
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $taskRoot 'supabase/fresh/baseline.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Fresh baseline failed on synthetic local PostgreSQL' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $taskMigration
  if ($LASTEXITCODE -ne 0) { throw 'Staff foundation migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $taskRoot 'supabase/migrations/20261001063952_staff_account_management.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff management migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $taskRoot 'supabase/migrations/20261001065703_staff_password_proof.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff password proof migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-foundation-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff synthetic SQL checks failed' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $taskPreviewMigration
  if ($LASTEXITCODE -ne 0) { throw 'Owner perspectives migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'owner-perspectives-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Owner perspectives synthetic SQL checks failed' }
  & (Join-Path $PSScriptRoot 'owner-perspectives-concurrency-local.ps1') -Psql $taskPsql -Port $taskPort -Scratch $taskScratch
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $taskRoot 'supabase/migrations/20261001071721_staff_import_batches.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff import migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-import-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff import synthetic SQL checks failed' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $taskRoot 'supabase/migrations/20261001071831_staff_password_reset.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff reset migration failed locally' }
  & $taskPsql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path $PSScriptRoot 'staff-reset-local-rehearsal.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Staff reset synthetic SQL checks failed' }
  Write-Output 'PASS: baseline + staff migrations + Owner perspectives applied only to disposable localhost PostgreSQL; synthetic SQL assertions completed.'
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
