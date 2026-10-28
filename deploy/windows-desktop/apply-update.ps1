param([string]$Request, [switch]$DefinitionsOnly)
$ErrorActionPreference = 'Stop'

# 파일 교체 실패와 새 버전 기동 실패를 같은 복구 흐름으로 처리한다.
function Invoke-SafeDesktopUpdateFlow([scriptblock]$Prepare, [scriptblock]$Install, [scriptblock]$Start, [scriptblock]$Verify, [scriptblock]$Rollback, [scriptblock]$Complete, [scriptblock]$Failure) {
  $prepared = $false
  try {
    & $Prepare
    $prepared = $true
    & $Install
    & $Start
    & $Verify
    & $Complete
  } catch {
    $message = $_.Exception.Message
    if ($prepared) {
      try { & $Rollback }
      catch { & $Failure ("업데이트와 자동 복구를 마치지 못했습니다. $message / 복구 오류: $($_.Exception.Message)"); return }
    }
    & $Failure $message
  }
}
if ($DefinitionsOnly) { return }
. (Join-Path $PSScriptRoot 'common.ps1')
$req = Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json
if ($req.application -cne 'isumoa-update-v1' -or $req.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $req.version -cnotmatch '^\d+\.\d+\.\d+$') { throw '업데이트 요청 정보가 올바르지 않습니다.' }
if ([IO.Path]::GetFullPath($req.config) -ine [IO.Path]::GetFullPath($ConfigFile)) { throw '다른 설치본의 설정으로 업데이트할 수 없습니다.' }
$updateRoot = [IO.Path]::GetFullPath((Join-Path $req.dataDir 'updates')).TrimEnd('\') + '\'
foreach ($file in @($Request, $req.installer, $req.statusFile, $req.lockFile)) {
  if (-not ([IO.Path]::GetFullPath($file).StartsWith($updateRoot, [StringComparison]::OrdinalIgnoreCase))) { throw '업데이트 자료가 지정 폴더 밖에 있습니다.' }
}
function Save-UpdateStatus([string]$Phase, [string]$Message = '') {
  $state = Get-Content -LiteralPath $req.statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $state.phase = $Phase; $state.error = if ($Message) { $Message } else { $null }
  [IO.File]::WriteAllText(($req.statusFile + '.tmp'), ($state | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath ($req.statusFile + '.tmp') -Destination $req.statusFile -Force
}
$recovery = Join-Path (Split-Path -Parent $Request) 'recovery'
$oldProgram = Join-Path $recovery 'program'
$script:backup = $null
Start-Sleep -Seconds 2
Invoke-SafeDesktopUpdateFlow -Prepare {
  $preparationGate = Enter-DesktopOperation
  try {
  if ((Get-FileHash -LiteralPath $req.installer -Algorithm SHA256).Hash -ine $req.sha256) { throw '설치 파일이 변경되었습니다.' }
  Stop-Server
  # 원래 앱을 종료한 뒤 자료를 보관하므로 종료 직전 저장값까지 포함한다.
  $env:ECP_CONFIG = $ConfigFile
  $backupResult = & (Join-Path $AppHome 'node/node.exe') --disable-warning=ExperimentalWarning (Join-Path $AppHome 'app/scripts/desktop-update-backup.ts')
  if ($LASTEXITCODE -ne 0) { Start-Process (Join-Path $AppHome '이수모아.exe'); throw '업데이트 직전 백업에 실패했습니다. 기존 버전을 다시 실행합니다.' }
  $script:backup = ($backupResult -join "`n") | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path $oldProgram | Out-Null
  try { Copy-ProgramPayload $AppHome $oldProgram; Assert-ProgramPayload $oldProgram }
  catch { Start-Process (Join-Path $AppHome '이수모아.exe'); throw }
  } finally { if ($null -ne $preparationGate) { $preparationGate.ReleaseMutex(); $preparationGate.Dispose() } }
} -Install {
  $env:ISUMOA_UPDATING = '1'
  $p = Start-Process -FilePath $req.installer -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "업데이트 설치가 실패했습니다 (코드 $($p.ExitCode))." }
} -Start {
  Start-Process (Join-Path $AppHome '이수모아.exe')
} -Verify {
  $end = (Get-Date).AddSeconds(100); $verified = $false
  while ((Get-Date) -lt $end) {
    if (Test-Server) {
      try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/api/health" -TimeoutSec 3; if ($health.version -ceq $req.version) { $verified = $true; break } } catch {}
    }
    Start-Sleep -Milliseconds 700
  }
  if (-not $verified) { throw '설치 후 새 버전의 실행을 확인하지 못했습니다.' }
} -Rollback {
  Stop-Server
  Remove-Tree $AppHome
  Copy-ProgramPayload $oldProgram $AppHome
  Assert-ProgramPayload $AppHome
  $env:ECP_CONFIG = $ConfigFile
  & (Join-Path $AppHome 'node/node.exe') --disable-warning=ExperimentalWarning (Join-Path $AppHome 'app/scripts/restore.ts') --apply $script:backup.file --yes
  if ($LASTEXITCODE -ne 0) { throw "자료 복원 실패. 복구 폴더: $recovery" }
  Remove-Item -LiteralPath $req.lockFile -Force -ErrorAction SilentlyContinue
  Start-Process (Join-Path $AppHome '이수모아.exe')
} -Complete {
  Save-UpdateStatus 'completed'
  Remove-Item -LiteralPath $req.lockFile -Force -ErrorAction SilentlyContinue
  try { Remove-Item -LiteralPath $recovery -Recurse -Force } catch {}
} -Failure {
  param($Message)
  Save-UpdateStatus 'error' ("$Message 복구 자료: $recovery")
  if ($Message -notlike '업데이트와 자동 복구를 마치지 못했습니다.*') { Remove-Item -LiteralPath $req.lockFile -Force -ErrorAction SilentlyContinue }
  Show-Message "업데이트를 마치지 못했습니다.`n$Message`n복구 자료: $recovery" 'Error' | Out-Null
}
