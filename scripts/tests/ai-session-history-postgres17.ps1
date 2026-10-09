$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$initdb = Join-Path $pgBin "initdb.exe"
$pgCtl = Join-Path $pgBin "pg_ctl.exe"
$psql = Join-Path $pgBin "psql.exe"
foreach ($exe in @($initdb, $pgCtl, $psql)) {
  if (-not (Test-Path -LiteralPath $exe)) { throw "PostgreSQL 17 executable is missing: $exe" }
}

$clusterRoot = Join-Path $repoRoot "supabase\.temp\dsh-reference-pg"
$clusterParent = Split-Path -Parent $clusterRoot
New-Item -ItemType Directory -Force -Path $clusterParent | Out-Null
$clusterRootResolved = [System.IO.Path]::GetFullPath($clusterRoot)
$repoRootResolved = [System.IO.Path]::GetFullPath($repoRoot)
if (-not $clusterRootResolved.StartsWith((Join-Path $repoRootResolved "supabase\.temp"), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Disposable PostgreSQL path escaped the ignored Supabase temp directory."
}
New-Item -ItemType Directory -Force -Path $clusterRootResolved | Out-Null
$runId = "run-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$PID"
$dataDir = Join-Path $clusterRootResolved $runId
New-Item -ItemType Directory -Path $dataDir | Out-Null

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$started = $false

function Invoke-Psql([string[]]$Arguments) {
  & $psql @Arguments
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
}

function Start-PsqlQuery([string]$Query, [string]$Name) {
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $psql
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in @("-X", "-A", "-t", "-q", "-h", "127.0.0.1", "-p", "$port", "-U", "postgres", "-d", "postgres", "-c", $Query)) {
    [void]$info.ArgumentList.Add($argument)
  }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Could not start concurrent psql client $Name" }
  [pscustomobject]@{ Name = $Name; Process = $process; Stdout = $process.StandardOutput.ReadToEndAsync(); Stderr = $process.StandardError.ReadToEndAsync() }
}

try {
  Write-Host "Initializing disposable PostgreSQL 17 cluster at $dataDir"
  & $initdb -D $dataDir -U postgres --no-locale -E UTF8 --auth-local=trust --auth-host=trust
  if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }

  # Bind only to loopback and use trust inside this one-time disposable cluster.
  Set-Content -LiteralPath (Join-Path $dataDir "pg_hba.conf") -Encoding ascii -Value @(
    "host all all 127.0.0.1/32 trust",
    "host all all ::1/128 trust"
  )
  & $pgCtl -D $dataDir -l (Join-Path $dataDir "server.log") -o "-h 127.0.0.1 -p $port" -w -t 30 start
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl start failed with exit code $LASTEXITCODE" }
  $started = $true

  $sqlFile = Join-Path $PSScriptRoot "ai-session-history-postgres17.sql"
  Invoke-Psql @("-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "$port", "-U", "postgres", "-d", "postgres", "-f", $sqlFile)

  Write-Host "Checking same-session concurrent starts"
  $queries = @(
    "SET ROLE service_role; SELECT public.ai_session_turn_begin('30000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000060','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',8,'parallel A');",
    "SET ROLE service_role; SELECT public.ai_session_turn_begin('30000000-0000-4000-8000-000000000060','40000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',8,'parallel B');"
  )
  $jobA = Start-PsqlQuery $queries[0] "start-A"
  $jobB = Start-PsqlQuery $queries[1] "start-B"
  $jobs = @($jobA, $jobB)
  $results = foreach ($job in $jobs) {
    $job.Process.WaitForExit()
    $stdout = $job.Stdout.GetAwaiter().GetResult().Trim()
    $stderr = $job.Stderr.GetAwaiter().GetResult().Trim()
    if ($job.Process.ExitCode -ne 0) { throw "Concurrent psql $($job.Name) failed: $stderr" }
    $stdout
  }
  $sorted = @($results | Sort-Object)
  if (($sorted -join ",") -ne "BUSY,RECORDED") { throw "Expected exactly one RECORDED and one BUSY; got $($results -join ',')" }
  Write-Host "Concurrent results: $($results -join ', ')"

  Invoke-Psql @("-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "$port", "-U", "postgres", "-d", "postgres", "-c",
    "DO `$`$ BEGIN IF (SELECT count(*) FROM public.ai_chat_turns WHERE session_id='30000000-0000-4000-8000-000000000060') <> 1 THEN RAISE EXCEPTION 'Concurrent starts recorded other than one turn'; END IF; IF (SELECT turn_count FROM public.ai_chat_sessions WHERE id='30000000-0000-4000-8000-000000000060') <> 1 THEN RAISE EXCEPTION 'Concurrent starts corrupted the session count'; END IF; END `$`$; SELECT 'Concurrent session assertions passed';")

  Write-Host "PostgreSQL 17 migration verification passed. Stopping the disposable server."
}
finally {
  if ($started) {
    & $pgCtl -D $dataDir -m fast -w -t 30 stop
    if ($LASTEXITCODE -ne 0) { Write-Warning "pg_ctl stop returned $LASTEXITCODE; inspect $dataDir\server.log" }
  }
}
