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

# 새 설치가 성공한 뒤 기동 검증에서 실패해도 안내 바로가기만 이전 바이트/미존재 상태로 되돌린다.
$guideRoot = Join-Path ([IO.Path]::GetTempPath()) ('isumoa-guide-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $guideRoot | Out-Null
try {
  foreach ($existed in @($false, $true)) {
    $shortcut = Join-Path $guideRoot ("guide-$existed.lnk")
    [byte[]]$oldBytes = @(0xEF, 0xBB, 0xBF) + [Text.Encoding]::UTF8.GetBytes('기존 안내 바로가기')
    if ($existed) { [IO.File]::WriteAllBytes($shortcut, $oldBytes) }
    $script:guideState = $null; $script:guideFailure = $false
    Invoke-SafeDesktopUpdateFlow -Prepare {
      $script:guideState = Save-InstallGuideShortcut $shortcut
    } -Install {
      [IO.File]::WriteAllText($shortcut, '업데이트가 추가한 안내 바로가기')
    } -Start {} -Verify { throw '새 버전 기동 확인 실패' } -Rollback {
      Restore-InstallGuideShortcut $script:guideState
    } -Complete { throw '실패를 완료로 표시함' } -Failure { param($Message) $script:guideFailure = $true }
    Assert $script:guideFailure '업데이트 기동 검증 실패가 전달되지 않음'
    if ($existed) {
      Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcut)) -ceq [Convert]::ToBase64String($oldBytes)) '기존 안내 바로가기 바이트 복원 실패'
    } else { Assert (-not (Test-Path -LiteralPath $shortcut)) '업데이트가 추가한 안내 바로가기 잔류' }
    Write-Output "PASS update guide shortcut rollback: existed=$existed"
  }
} finally { Remove-Item -LiteralPath $guideRoot -Recurse -Force }
