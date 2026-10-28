param([string]$Program)
$ErrorActionPreference = 'Stop'
if (-not $Program) { $Program = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'deploy/windows-desktop' }
. (Join-Path $Program 'apply-update.ps1') -DefinitionsOnly
$script:events = New-Object System.Collections.Generic.List[string]
function Assert($Value, $Message) { if (-not $Value) { throw $Message } }
foreach ($scenario in @('', 'prepare', 'install', 'verify', 'rollback')) {
  $script:events.Clear()
  Invoke-SafeDesktopUpdateFlow -Prepare { $script:events.Add('prepare'); if ($scenario -eq 'prepare') { throw 'prepare' } } -Install { $script:events.Add('install'); if ($scenario -in @('install', 'rollback')) { throw 'install' } } -Start { $script:events.Add('start') } -Verify { $script:events.Add('verify'); if ($scenario -eq 'verify') { throw 'verify' } } -Rollback { $script:events.Add('rollback'); if ($scenario -eq 'rollback') { throw 'rollback' } } -Complete { $script:events.Add('complete') } -Failure { param($message) $script:events.Add('error'); if ($scenario -eq 'rollback') { Assert ($message -like '*자동 복구*') '복구 실패 안내 누락' } }
  if (-not $scenario) { Assert (($script:events -join ',') -eq 'prepare,install,start,verify,complete') '정상 순서 오류' }
  elseif ($scenario -eq 'prepare') { Assert (($script:events -join ',') -eq 'prepare,error') '준비 실패에 교체·복구 실행' }
  else { Assert ($script:events.Contains('rollback')) '실패 후 복구 누락'; Assert (-not $script:events.Contains('complete')) '실패를 완료로 표시'; Assert ($script:events[-1] -eq 'error') '실패 안내 누락' }
  Write-Output "PASS update flow: $scenario"
}
