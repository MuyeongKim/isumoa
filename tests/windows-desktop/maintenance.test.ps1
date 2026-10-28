param([string]$Root, [string]$HealthyUrl, [string]$ForeignUrl, [int]$FreePort, [string]$Program)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:LOCALAPPDATA = Join-Path $Root 'local'
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
if (-not $Program) { $Program = Join-Path $repo 'deploy/windows-desktop' }
. (Join-Path $Program 'common.ps1')
$results = New-Object System.Collections.Generic.List[string]
function Assert([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Pass([string]$Name) { $results.Add($Name); Write-Host "PASS $Name" }
function Write-Text([string]$Path, [string]$Text) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null; [IO.File]::WriteAllText($Path, $Text) }
function Expect-Failure([scriptblock]$Action, [string]$Label) { $failed = $false; try { & $Action } catch { $failed = $true }; Assert $failed $Label }

# 실제 HTTP 왕복: 건강한 제품 응답뿐 아니라 이 데이터 폴더의 열쇠로 새 난수에 답했는지 확인한다.
$tokenFile = Join-Path $Root 'identity/run/shutdown.token'
Write-Text $tokenFile ('a' * 48)
Assert (Test-IsumoaIdentity $HealthyUrl $tokenFile) '자기 실행본 확인 실패'
Assert (Test-IsumoaIdentity $HealthyUrl $tokenFile) '두 번째 난수 확인 실패'
Pass '실제 앱에서 매번 새 난수와 실행 열쇠로 확인'
$wrongToken = Join-Path $Root 'wrong.token'; Write-Text $wrongToken ('b' * 48)
Assert (-not (Test-IsumoaIdentity $HealthyUrl $wrongToken)) '다른 데이터 폴더의 실행본을 승인함'
Pass '다른 실행 열쇠 거절'
foreach ($kind in @('generic', 'spoof', 'badproof', 'html', 'redirect', 'oversize', 'stringok')) {
  Assert (-not (Test-IsumoaIdentity "$ForeignUrl/$kind" $tokenFile)) "다른 서버 거절 실패: $kind"
  Pass "다른 서버/잘못된 응답 거절: $kind"
}
Assert (-not (Test-IsumoaIdentity $HealthyUrl (Join-Path $Root 'missing.token'))) '열쇠 없는 실행 승인'
Pass '열쇠 없는 실행 거절'
Assert (-not (Test-LocalPortAvailable ([Uri]$HealthyUrl).Port)) '다른 실행본이 쓰는 포트를 빈 것으로 판단'
Assert (Test-LocalPortAvailable $FreePort) '빈 포트 확인 실패'
Pass '사용 중인 포트와 빈 포트 구분'

# 실제 파일 복사·SHA-256·디렉터리 교체·복구 함수를 실행한다. robocopy는 Mac에 없어 복사 수단만 대체한다.
$script:fault = ''
function Copy-ProgramPayload([string]$Source, [string]$Destination) {
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
  if ($script:fault -eq 'copy') { throw '주입한 복사 중단' }
  if ($script:fault -eq 'corrupt') { Write-Text (Join-Path $Destination 'app/한국어 파일.txt') '손상' }
  if ($script:fault -eq 'extra') { Write-Text (Join-Path $Destination 'unlisted.txt') '목록에 없음' }
  if ($script:fault -eq 'missing') { Remove-Item -LiteralPath (Join-Path $Destination 'app/한국어 파일.txt') }
}
function Make-Payload([string]$Directory, [string]$Version) {
  Write-Text (Join-Path $Directory 'VERSION') $Version
  Write-Text (Join-Path $Directory 'app/한국어 파일.txt') "new-$Version"
  Write-Text (Join-Path $Directory 'app/.hidden.json') '{"included":true}'
  $files = @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force | ForEach-Object {
    @{ path = $_.FullName.Substring($Directory.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  Write-Text (Join-Path $Directory 'program-manifest.json') (@{ version = $Version; files = $files } | ConvertTo-Json -Depth 5)
}
function Old-Target([string]$Target) {
  Write-Text (Join-Path $Target 'VERSION') '0.4.0'
  Write-Text (Join-Path $Target 'old-only.txt') 'keep old'
}
$source = Join-Path $Root '설치 원본 program'; Make-Payload $source '0.4.1'
$data = Join-Path $Root 'user-data'
Write-Text (Join-Path $data 'app.db') '가상 업무 데이터'
Write-Text (Join-Path $data 'files/original.pdf') '가상 원본 수료증'
Write-Text (Join-Path $data 'config.json') '{"port":47210}'
$dataBefore = @(Get-ChildItem -LiteralPath $data -Recurse -File | Get-FileHash -Algorithm SHA256 | ForEach-Object { $_.Hash }) -join ','
foreach ($fault in @('copy', 'corrupt', 'extra', 'missing')) {
  $target = Join-Path $Root "case-$fault/isumoa"; Old-Target $target
  $script:fault = $fault; $script:stopped = $false
  Expect-Failure { Invoke-ProgramUpdate $source $target -BeforeSwitch { $script:stopped = $true } } '실패가 감지되지 않음'
  Assert ((Get-Content -LiteralPath (Join-Path $target 'VERSION') -Raw) -eq '0.4.0') '기존 버전 손상'
  Assert (-not $script:stopped) '검증 전에 기존 프로그램을 종료함'
  Pass "교체 전 실패 시 기존 버전 보존: $fault"
}
$script:fault = ''
$target = Join-Path $Root 'case-stop/isumoa'; Old-Target $target
Expect-Failure { Invoke-ProgramUpdate $source $target -BeforeSwitch { throw '종료 실패' } } '종료 실패 무시'
Assert ((Get-Content -LiteralPath (Join-Path $target 'VERSION') -Raw) -eq '0.4.0') '종료 실패 시 기존 버전 손상'
Pass '기존 서버 종료 실패 시 설치 중단·보존'

# 기존 폴더를 옮긴 뒤 새 폴더로 교체하지 못하는 경계에서 실패시킨다.
function Move-ProgramDirectory { param([string]$Source, [string]$Destination)
  if ($Source.EndsWith('prepared')) { throw '교체 실패' }
  [System.IO.Directory]::Move($Source, $Destination)
}
$target = Join-Path $Root 'case-switch/isumoa'; Old-Target $target
Expect-Failure { Invoke-ProgramUpdate $source $target } '교체 실패 무시'
Assert ((Get-Content -LiteralPath (Join-Path $target 'VERSION') -Raw) -eq '0.4.0') '이전 폴더 자동 복구 실패'
Remove-Item Function:\Move-ProgramDirectory
function Move-ProgramDirectory { param([string]$Source, [string]$Destination) [System.IO.Directory]::Move($Source, $Destination) }
Pass '기존 폴더 이동 후 교체 실패 시 자동 복구'

$target = Join-Path $Root 'case-registration/isumoa'; Old-Target $target
$registration = Join-Path $Root 'registration.txt'; Write-Text $registration 'old registration'
Expect-Failure { Invoke-ProgramUpdate $source $target -AfterSwitch { Write-Text $registration 'new registration'; throw '등록 실패' } -UndoRegistration { Write-Text $registration 'old registration' } } '등록 실패 무시'
Assert ((Get-Content -LiteralPath (Join-Path $target 'VERSION') -Raw) -eq '0.4.0') '등록 실패 후 이전 버전 복구 실패'
Assert ((Get-Content -LiteralPath $registration -Raw) -eq 'old registration') '등록 상태 복구 실패'
Pass '교체 후 등록 실패 시 프로그램·등록 상태 복구'

$target = Join-Path $Root 'case-fresh-failure/isumoa'
Expect-Failure { Invoke-ProgramUpdate $source $target -AfterSwitch { throw '첫 설치 실패' } } '첫 설치 실패 무시'
Assert (-not (Test-Path -LiteralPath $target)) '실패한 첫 설치 프로그램을 남김'
Pass '첫 설치 실패 시 불완전한 프로그램 제거'

$target = Join-Path $Root 'case-success/isumoa'; Old-Target $target
Invoke-ProgramUpdate $source $target
Assert ((Get-Content -LiteralPath (Join-Path $target 'VERSION') -Raw) -eq '0.4.1') '정상 업데이트 버전 오류'
Assert (-not (Test-Path -LiteralPath (Join-Path $target 'old-only.txt'))) '옛 불필요 파일 남음'
Invoke-ProgramUpdate $source $target
Assert-ProgramPayload $target
Pass '정상 업데이트·같은 버전 재설치·전체 해시 확인'

# 복구 자체가 막히면 이전 버전 보관 폴더를 지우지 않고 위치를 안내한다.
$target = Join-Path $Root 'case-recovery-failure/isumoa'; Old-Target $target
function Move-ProgramDirectory { param([string]$Source, [string]$Destination)
  if ($Destination.EndsWith('failed')) { throw '복구 시 파일 잠금' }
  [System.IO.Directory]::Move($Source, $Destination)
}
Expect-Failure { Invoke-ProgramUpdate $source $target -AfterSwitch { throw '새 등록 실패' } } '복구 실패 무시'
Remove-Item Function:\Move-ProgramDirectory
function Move-ProgramDirectory { param([string]$Source, [string]$Destination) [System.IO.Directory]::Move($Source, $Destination) }
$backup = @(Get-ChildItem -LiteralPath (Split-Path -Parent $target) -Directory -Force | Where-Object { $_.Name -like '.isumoa-update-*' })
Assert ($backup.Count -eq 1) '이전 버전 복구 자료를 삭제함'
Assert ((Get-Content -LiteralPath (Join-Path $backup[0].FullName 'previous/VERSION') -Raw) -eq '0.4.0') '이전 버전 보관 실패'
Pass '복구도 막힌 경우 이전 버전 파일 별도 보존'
$dataAfter = @(Get-ChildItem -LiteralPath $data -Recurse -File | Get-FileHash -Algorithm SHA256 | ForEach-Object { $_.Hash }) -join ','
Assert ($dataBefore -eq $dataAfter) '업무 DB·원본·설정 변경됨'
Pass '성공·실패 시나리오 전체에서 업무 자료 해시 유지'

# 설치가 교체할 프로그램 안에 사용자 자료가 있으면 정상 업데이트로 지워지지 않게 중단한다.
foreach ($field in @('dataDir', 'backupDir', 'logDir')) {
  $program = Join-Path $Root ("unsafe-$field/program"); Old-Target $program
  $preservedFile = Join-Path $program 'saved/app.db'; Write-Text $preservedFile '보존할 가상 자료'
  $configFile = Join-Path $Root ("unsafe-$field/settings/config.json")
  $settings = @{ dataDir = $data; backupDir = (Join-Path $Root 'backups'); logDir = 'logs' }
  $settings[$field] = Join-Path $program 'saved'
  Write-Text $configFile ($settings | ConvertTo-Json)
  Expect-Failure { Assert-PreservedDataPaths @($configFile) @($program); Invoke-ProgramUpdate $source $program } '프로그램 안의 사용자 자료를 교체함'
  Assert ((Get-Content -LiteralPath $preservedFile -Raw) -eq '보존할 가상 자료') '보존 경로의 파일이 지워짐'
  Assert ((Get-Content -LiteralPath (Join-Path $program 'VERSION') -Raw) -eq '0.4.0') '위험한 경로에서 프로그램을 변경함'
  Pass "프로그램 내부 보존 경로를 교체 전에 차단: $field"
}
$program = Join-Path $Root 'relative-protected/program'; Old-Target $program
$configFile = Join-Path $Root 'relative-protected/settings/config.json'
Write-Text $configFile '{"dataDir":"../program/saved"}'
Expect-Failure { Assert-PreservedDataPaths @($configFile) @($program) } '상대경로 우회 허용'
Write-Text $configFile (@{ dataDir = $program } | ConvertTo-Json)
Expect-Failure { Assert-PreservedDataPaths @($configFile) @($program) } '프로그램 폴더 자체를 자료 위치로 허용'
Pass '상대경로와 프로그램 폴더 자체도 보호'
Write-Text $configFile (@{ dataDir = $program + '-other' } | ConvertTo-Json)
Assert-PreservedDataPaths @($configFile) @($program)
Pass '프로그램과 이름 앞부분만 같은 외부 경로는 유지'
$oldConfig = Join-Path $Root 'old-protected/settings/config.json'
$oldProgram = Join-Path $Root 'old-protected/EduCert'
Write-Text $oldConfig (@{ backupDir = (Join-Path $oldProgram 'saved') } | ConvertTo-Json)
Expect-Failure { Assert-PreservedDataPaths @($configFile, $oldConfig) @($program, $oldProgram) } '이전 제품의 보존 경로 검사 누락'
Pass '현재·이전 설정을 모두 검사'

# 이전 데이터 이동은 내부 절대경로만 바꾸며, 상대경로·외부 경로를 유지한다.
$oldData = Join-Path $Root 'migration-success/EduCert'
$newData = Join-Path $Root 'migration-success/isumoa'
$oldProgram = Join-Path $Root 'migration-success/program'; Old-Target $oldProgram
$settings = @{ dataDir = (Join-Path $oldData 'data'); backupDir = (Join-Path $Root 'external-backups'); logDir = 'logs';
  tls = @{ certFile = (Join-Path $oldData 'certs/cert.pem'); keyFile = (Join-Path $Root 'external-key.pem') } }
Write-Text (Join-Path $oldData 'config.json') ($settings | ConvertTo-Json -Depth 5)
Write-Text (Join-Path $oldData 'data/app.db') '실제 데이터 이동 확인'
$state = @{ Migrated = $false }
Invoke-ProgramUpdate $source $oldProgram -AfterSwitch { param($RecoveryDirectory)
  Move-LegacyDataHome $oldData $newData $state $RecoveryDirectory
} -UndoRegistration { Restore-LegacyDataHome $oldData $newData $state }
$next = Get-Content -LiteralPath (Join-Path $newData 'config.json') -Raw | ConvertFrom-Json
Assert ($next.dataDir -eq (Join-Path $newData 'data')) '내부 dataDir 절대경로가 이전 위치에 남음'
Assert ($next.backupDir -eq $settings.backupDir -and $next.logDir -eq 'logs' -and $next.tls.keyFile -eq $settings.tls.keyFile) '외부/상대경로를 변경함'
Assert ($next.tls.certFile -eq (Join-Path $newData 'certs/cert.pem')) '이동한 내부 인증서 경로 누락'
Assert ((Get-Content -LiteralPath (Join-Path $next.dataDir 'app.db') -Raw) -eq '실제 데이터 이동 확인') '설정 경로에서 기존 자료를 찾지 못함'
Pass '이전 데이터 이동 후 내부 절대경로만 변경·외부 및 상대경로 유지'

foreach ($readOnly in @($false, $true)) {
  $label = if ($readOnly) { 'read-only' } else { 'registration' }
  $oldData = Join-Path $Root ("migration-rollback-$label/EduCert")
  $newData = Join-Path $Root ("migration-rollback-$label/isumoa")
  $oldProgram = Join-Path $Root ("migration-rollback-$label/program"); Old-Target $oldProgram
  $configFile = Join-Path $oldData 'config.json'
  $json = (@{ dataDir = (Join-Path $oldData 'data'); backupDir = (Join-Path $oldData 'backup'); logDir = (Join-Path $oldData 'logs') } | ConvertTo-Json).Replace("`n", "`r`n")
  Write-Text $configFile ''
  [byte[]]$originalBytes = @(0xEF, 0xBB, 0xBF) + [Text.Encoding]::UTF8.GetBytes($json)
  [IO.File]::WriteAllBytes($configFile, $originalBytes)
  Write-Text (Join-Path $oldData 'data/app.db') '실패에도 유지할 원본'
  if ($readOnly) { (Get-Item -LiteralPath $configFile).IsReadOnly = $true }
  $state = @{ Migrated = $false; MigrationWriteFinished = $false }
  Expect-Failure { Invoke-ProgramUpdate $source $oldProgram -AfterSwitch { param($RecoveryDirectory)
    Move-LegacyDataHome $oldData $newData $state $RecoveryDirectory
    $state.MigrationWriteFinished = $true
    throw '뒤따르는 등록 실패'
  } -UndoRegistration { Restore-LegacyDataHome $oldData $newData $state } } '데이터 이동 후 실패 누락'
  Assert (Test-Path -LiteralPath $configFile) '실패 후 이전 데이터 폴더가 복구되지 않음'
  Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($configFile)) -ceq [Convert]::ToBase64String($originalBytes)) '원래 설정 바이트(BOM·줄바꿈 포함) 복원 실패'
  Assert ((Get-Content -LiteralPath (Join-Path $oldData 'data/app.db') -Raw) -eq '실패에도 유지할 원본') '이전 데이터 복원 실패'
  Assert (-not (Test-Path -LiteralPath $newData)) '실패한 새 데이터 위치를 남김'
  Assert ((Get-Content -LiteralPath (Join-Path $oldProgram 'VERSION') -Raw) -eq '0.4.0') '이전 프로그램 복구 실패'
  if ($readOnly) {
    Assert (-not $state.MigrationWriteFinished) '읽기 전용 설정 쓰기 실패가 재현되지 않음'
    (Get-Item -LiteralPath $configFile).IsReadOnly = $false
  }
  Pass "데이터 이동 후 실패 시 폴더·설정 원문·프로그램 복원: $label"
}
$oldData = Join-Path $Root 'relative-migration/EduCert'; $newData = Join-Path $Root 'relative-migration/isumoa'
Write-Text (Join-Path $oldData 'config.json') "{`r`n  `"dataDir`": `"data`", `"logDir`": `"logs`"`r`n}"
$original = [IO.File]::ReadAllBytes((Join-Path $oldData 'config.json'))
$recovery = Join-Path $Root 'relative-migration/recovery'; New-Item -ItemType Directory -Path $recovery -Force | Out-Null
$state = @{ Migrated = $false }; Move-LegacyDataHome $oldData $newData $state $recovery
Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $newData 'config.json'))) -ceq [Convert]::ToBase64String($original)) '상대경로만 있는 설정을 불필요하게 다시 씀'
Pass '기본 상대경로 설정은 원문 그대로 이동'

# 이전 버전의 종료는 제품 폴더와 포트 소유 프로세스가 둘 다 맞을 때만 허용한다.
$script:ownerPort = 0
function Get-CimInstance { @([pscustomobject]@{ ProcessId = 101; ExecutablePath = (Join-Path $AppHome 'node/node.exe') }) }
function Get-NetTCPConnection { param($State, $LocalPort, $ErrorAction)
  $script:ownerPort = $LocalPort
  @([pscustomobject]@{ OwningProcess = $script:listenerPid; LocalAddress = '127.0.0.1' })
}
New-Item -ItemType Directory -Force -Path $DataHome | Out-Null
Write-Text (Join-Path $DataHome 'config.json') '{"port":47499}'
$script:listenerPid = 999
Assert (-not (Test-OwnedListener $DataHome $AppHome)) '다른 프로세스의 포트를 승인'
$script:listenerPid = 101
Assert (Test-OwnedListener $DataHome $AppHome) '이전 제품 실행 경로·PID 일치 확인 실패'
Assert ($script:ownerPort -eq 47499) '실제 설정의 포트를 사용하지 않음'
Pass '이전 판의 종료 대상은 실행 경로·포트 소유 PID로 확인'
$script:processRunning = $true
$script:quitCalls = 0
function Get-OwnedServers { param($App) if ($script:processRunning) { @([pscustomobject]@{ ProcessId = 101 }) } }
function Test-Server { param($Data) return $false }
function Invoke-Local { param($Method, $Path, $Headers, $Data) $script:quitCalls++; $script:processRunning = $false; return 200 }
Write-Text (Join-Path $DataHome 'run/shutdown.token') ('a' * 48)
$script:listenerPid = 999
Expect-Failure { Stop-Server } '확인되지 않은 서버 종료'
Assert ($script:quitCalls -eq 0) '다른 프로그램에 실행 열쇠를 전송'
$script:listenerPid = 101
Stop-Server
Assert ($script:quitCalls -eq 1) '확인된 이전 판 종료 실패'
Pass '확인되지 않은 서버에는 종료 열쇠를 보내지 않음'
# 종료 중인 Node가 포트를 이미 닫았더라도 새 Node를 시작하지 않는다.
$script:processRunning = $true
$script:portChecks = 0
function Test-LocalPortAvailable { param($Port) $script:portChecks++; return $true }
Expect-Failure { Assert-DesktopStartAvailable } '종료 중인 Node와 중복 실행 허용'
Assert ($script:portChecks -eq 0) '소유 Node가 있는데 포트만 보고 실행 판단'
$script:processRunning = $false
Assert-DesktopStartAvailable
Assert ($script:portChecks -eq 1) '이전 프로세스 종료 후 실행 허용 실패'
Pass '포트를 닫았지만 종료 중인 소유 Node가 있으면 재실행 차단'


Write-Text (Join-Path $Root 'powershell-results.json') (@{ passed = $results.Count; cases = @($results); runtime = $PSVersionTable.PSVersion.ToString(); platform = [Environment]::OSVersion.Platform.ToString(); windowsActualRun = $false } | ConvertTo-Json -Depth 5)
