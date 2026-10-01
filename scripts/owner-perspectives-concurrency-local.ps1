# Two actual local connections: entry holds Owner UPDATE, command waits for SHARE,
# then observes the committed preview and denies. Called only by scratch runner.
param([string]$Psql,[int]$Port,[string]$Scratch)
$ErrorActionPreference='Stop'
function Invoke-PreviewLocalSql([string]$Sql) {
  $taskValue = & $Psql --no-psqlrc -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d postgres -c $Sql
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic preview concurrency observer failed' }
  return ($taskValue -join '').Trim()
}
function Start-PreviewLocalConnection([string]$Name,[string]$Source) {
  $taskFile=Join-Path $Scratch ($Name+'.sql')
  [IO.File]::WriteAllText($taskFile,$Source,[Text.UTF8Encoding]::new($false))
  $taskInfo=[Diagnostics.ProcessStartInfo]::new($Psql)
  foreach ($taskArgument in @('--no-psqlrc','-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$Port",'-U','postgres','-d','postgres','-f',$taskFile)) {
    [void]$taskInfo.ArgumentList.Add($taskArgument)
  }
  $taskInfo.UseShellExecute=$false; $taskInfo.CreateNoWindow=$true
  $taskInfo.RedirectStandardOutput=$true; $taskInfo.RedirectStandardError=$true
  return [Diagnostics.Process]::Start($taskInfo)
}
$taskUid=Invoke-PreviewLocalSql 'select owner_uid from rehearsal.preview_fixture'
$taskSession=Invoke-PreviewLocalSql 'select owner_session from rehearsal.preview_fixture'
$taskWorkspace=Invoke-PreviewLocalSql 'select workspace_id from rehearsal.preview_fixture'
$taskBranch=Invoke-PreviewLocalSql 'select branch_a from rehearsal.preview_fixture'
$taskCustomer=Invoke-PreviewLocalSql 'select customer_a from rehearsal.preview_fixture'
# Each identifier was produced by this disposable fixture. Reject shell/SQL text.
foreach ($taskId in @($taskUid,$taskSession,$taskWorkspace,$taskBranch,$taskCustomer)) {
  if ($taskId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid synthetic concurrency fixture UUID' }
}
$taskClaims="select set_config('request.jwt.claims',jsonb_build_object('sub','$taskUid','session_id','$taskSession','is_anonymous',false)::text,false);"
$taskEntry=$null; $taskCommand=$null
try {
  $taskEntry=Start-PreviewLocalConnection 'preview_entry' @"
set application_name='staff_preview_entry';
begin;
$taskClaims
set role authenticated;
select public.owner_preview_set('$taskWorkspace','ADMIN',null);
select pg_sleep(3);
commit;
"@
  $taskObserved=$false
  for ($taskAttempt=0; $taskAttempt -lt 60; $taskAttempt++) {
    if ((Invoke-PreviewLocalSql "select count(*) from pg_stat_activity where application_name='staff_preview_entry' and wait_event='PgSleep'") -eq '1') { $taskObserved=$true; break }
    Start-Sleep -Milliseconds 30
  }
  if (-not $taskObserved) { throw 'Preview transition did not reach held-lock point' }
  $taskCommand=Start-PreviewLocalConnection 'preview_command' @"
set application_name='staff_preview_command';
$taskClaims
set role authenticated;
do `$`$ begin
  begin
    perform public.workspace_order_create('$taskWorkspace',1,'CONCURRENT-PREVIEW-DENIED','$taskBranch','$taskCustomer','Synthetic','Inspection',null,null);
    raise exception 'FAIL: command succeeded after preview entry';
  exception when insufficient_privilege then null; end;
end; `$`$;
"@
  $taskWaited=$false
  for ($taskAttempt=0; $taskAttempt -lt 60; $taskAttempt++) {
    if ((Invoke-PreviewLocalSql "select count(*) from pg_stat_activity where application_name='staff_preview_command' and wait_event_type='Lock'") -eq '1') { $taskWaited=$true; break }
    Start-Sleep -Milliseconds 30
  }
  if (-not $taskWaited) { throw 'Command did not demonstrably wait on the preview transition lock' }
  foreach ($taskProcess in @($taskEntry,$taskCommand)) {
    if (-not $taskProcess.WaitForExit(10000)) { throw 'Synthetic preview concurrency connection timed out' }
    if ($taskProcess.ExitCode -ne 0) { throw ('Synthetic preview concurrency SQL failed: '+$taskProcess.StandardError.ReadToEnd()) }
  }
  if ((Invoke-PreviewLocalSql "select count(*) from public.workspace_orders where order_no='CONCURRENT-PREVIEW-DENIED'") -ne '0') { throw 'Concurrent preview denial had a write side effect' }
  Write-Output 'PASS: two localhost connections overlapped; command waited on entry profile lock and denied after commit, with no order created.'
} finally {
  foreach ($taskProcess in @($taskEntry,$taskCommand)) {
    if ($null -ne $taskProcess -and -not $taskProcess.HasExited) { $taskProcess.Kill(); [void]$taskProcess.WaitForExit(5000) }
  }
}
