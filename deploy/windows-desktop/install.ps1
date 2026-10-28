# 이수모아 PC판 설치 (관리자 권한 필요 없음). 압축을 푼 폴더의 설치.bat이 실행한다.
#  - 프로그램: %LOCALAPPDATA%\Programs\isumoa
#  - 자료·설정·기록: %LOCALAPPDATA%\isumoa (다시 설치·업그레이드해도 그대로 둔다. 이전 이름 EduCert 폴더가 있으면 여기로 옮긴다)
#  - 백업: 문서\이수모아 백업
param([switch]$FromExe)
$ErrorActionPreference = 'Stop'
$Package = Join-Path (Split-Path -Parent $PSScriptRoot) 'program'

# 압축 파일 안에서 바로 실행하면 나머지 파일이 없다
if (-not (Test-Path -LiteralPath (Join-Path $Package 'common.ps1'))) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show(
    "설치 파일이 모두 있지 않습니다.`n압축 파일을 먼저 풀고(오른쪽 클릭 → 모두 압축 풀기), 푼 폴더의 설치.bat을 실행해 주세요.",
    '이수모아', 'OK', 'Error')
  exit 1
}
. (Join-Path $Package 'common.ps1')

function Register-Program {
  $version = (Get-Content -LiteralPath (Join-Path $AppHome 'VERSION') -Raw).Trim()
  # 바로가기: 바탕화면, 시작 메뉴(실행·제거)
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $icon = Join-Path $AppHome 'app.ico'
  $shell = New-Object -ComObject WScript.Shell
  function New-Shortcut([string]$Path, [string]$Script, [string]$Description) {
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $powershell
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppHome $Script)`""
    if ($Script -eq 'launch.ps1' -and (Test-Path -LiteralPath (Join-Path $AppHome '이수모아.exe'))) {
      $link.TargetPath = Join-Path $AppHome '이수모아.exe'
      $link.Arguments = ''
    }
    $link.WorkingDirectory = $DataHome
    $link.IconLocation = "$icon,0"
    $link.WindowStyle = 7
    $link.Description = $Description
    $link.Save()
  }
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) $AppName
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") 'launch.ps1' '이수모아 열기 (법정교육 이수증 종합 플랫폼)'
  New-Shortcut (Join-Path $menu "$AppName.lnk") 'launch.ps1' '이수모아 열기 (법정교육 이수증 종합 플랫폼)'
  New-Shortcut (Join-Path $menu "$AppName 제거.lnk") 'uninstall.ps1' '이수모아 프로그램 제거'

  # Windows 설정 > 앱 목록에 보이도록 (내 사용자 계정에만)
  New-Item -Path $UninstallKey -Force | Out-Null
  $strings = @{
    DisplayName     = $AppName
    DisplayVersion  = $version
    Publisher       = '이수모아'
    InstallLocation = $AppHome
    DisplayIcon     = $icon
    UninstallString = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppHome 'uninstall.ps1')`""
  }
  foreach ($key in $strings.Keys) { New-ItemProperty -Path $UninstallKey -Name $key -Value $strings[$key] -PropertyType String -Force | Out-Null }
  $sizeKb = [int]((Get-ChildItem -LiteralPath $AppHome -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
  foreach ($pair in @(@('NoModify', 1), @('NoRepair', 1), @('EstimatedSize', $sizeKb))) {
    New-ItemProperty -Path $UninstallKey -Name $pair[0] -Value $pair[1] -PropertyType DWord -Force | Out-Null
  }

}

$gate = $null
try {
  $gate = Enter-DesktopOperation
  if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10) {
    throw 'Windows 10 이상, 64비트 PC에서만 설치할 수 있습니다.'
  }
  $version = (Get-Content -LiteralPath (Join-Path $Package 'VERSION') -Raw).Trim()
  $installed = (Get-ItemProperty -Path $UninstallKey -ErrorAction SilentlyContinue).DisplayVersion
  if (-not $installed) { $installed = (Get-ItemProperty -Path $OldUninstallKey -ErrorAction SilentlyContinue).DisplayVersion }
  $question = if ($installed) {
    "설치된 $installed 판을 $version 판으로 바꿉니다.`n이수증 자료와 설정은 그대로 둡니다. 계속할까요?"
  } else {
    "$AppName $version 판을 이 PC에 설치합니다.`n관리자 권한 없이 내 사용자 폴더에 설치됩니다. 계속할까요?"
  }
  if (-not $FromExe -and (Show-Message $question 'Question' 'OKCancel') -ne 'OK') { exit 0 }

  Assert-PreservedDataPaths @($ConfigFile, (Join-Path $OldDataHome 'config.json')) @($AppHome, $OldAppHome)

  # 프로그램 교체 뒤 바로가기·앱 등록에서 실패해도 원래 등록으로 되돌릴 수 있게 보관한다.
  $registration = @{ Existed = (Test-Path -Path $UninstallKey); Values = @(); Shortcuts = @{}; Migrated = $false }
  if ($registration.Existed) {
    $key = Get-Item -Path $UninstallKey
    $registration.Values = @($key.GetValueNames() | ForEach-Object {
      @{ Name = $_; Value = $key.GetValue($_); Kind = $key.GetValueKind($_).ToString() }
    })
  }
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) $AppName
  foreach ($path in @((Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
      (Join-Path $menu "$AppName.lnk"), (Join-Path $menu "$AppName 제거.lnk"))) {
    $registration.Shortcuts[$path] = if (Test-Path -LiteralPath $path) { [System.IO.File]::ReadAllBytes($path) } else { $null }
  }

  Invoke-ProgramUpdate -Source $Package -Target $AppHome -BeforeSwitch {
    Assert-PreservedDataPaths @($ConfigFile, (Join-Path $OldDataHome 'config.json')) @($AppHome, $OldAppHome)
    # 복사·해시 검증이 끝날 때까지 기존 버전은 계속 쓸 수 있다. 교체 직전에 안전하게 종료한다.
    Stop-Server
    if (Test-Path -LiteralPath $OldAppHome) { Stop-Server $OldDataHome $OldAppHome }
  } -AfterSwitch {
    param($RecoveryDirectory)
    if ((Test-Path -LiteralPath $OldDataHome) -and -not (Test-Path -LiteralPath $DataHome)) {
      Move-LegacyDataHome $OldDataHome $DataHome $registration $RecoveryDirectory
    }
    New-Item -ItemType Directory -Force -Path $DataHome | Out-Null
    if (-not (Test-Path -LiteralPath $ConfigFile)) {
      $config = [ordered]@{
        host = '127.0.0.1'; port = $DefaultPort; dataDir = 'data'
        backupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) '이수모아 백업'
        backupHour = 0; logDir = 'logs'; sessionIdleMinutes = 60; sessionMaxHours = 12; desktop = $true
      }
      [System.IO.File]::WriteAllText($ConfigFile, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
    }
    Register-Program
    if ($env:ISUMOA_UPDATING -ne '1') {
      $cfg = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $dataPart = if ([string]::IsNullOrWhiteSpace($cfg.dataDir)) { 'data' } else { [string]$cfg.dataDir }
      $data = if ([IO.Path]::IsPathRooted($dataPart)) { $dataPart } else { Join-Path (Split-Path -Parent $ConfigFile) $dataPart }
      Remove-Item -LiteralPath (Join-Path $data 'updates/install.lock') -Force -ErrorAction SilentlyContinue
    }
  } -UndoRegistration {
    $undoErrors = New-Object System.Collections.Generic.List[string]
    foreach ($path in $registration.Shortcuts.Keys) {
      try {
        if ($null -eq $registration.Shortcuts[$path]) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
        else { [System.IO.File]::WriteAllBytes($path, $registration.Shortcuts[$path]) }
      } catch { $undoErrors.Add($_.Exception.Message) }
    }
    try {
      if (Test-Path -Path $UninstallKey) { Remove-Item -Path $UninstallKey -Recurse -Force }
      if ($registration.Existed) {
        New-Item -Path $UninstallKey -Force | Out-Null
        foreach ($value in $registration.Values) {
          New-ItemProperty -Path $UninstallKey -Name $value.Name -Value $value.Value -PropertyType $value.Kind -Force | Out-Null
        }
      }
    } catch { $undoErrors.Add($_.Exception.Message) }
    try { Restore-LegacyDataHome $OldDataHome $DataHome $registration }
    catch { $undoErrors.Add($_.Exception.Message) }
    if ($undoErrors.Count -gt 0) { throw ($undoErrors -join "`n") }
  }

  # 이전 제품은 새 설치가 성공한 뒤 정리한다. 옛 자료가 따로 남아 있으면 옛 프로그램도 보존한다.
  if (-not (Test-Path -LiteralPath $OldDataHome)) {
    try {
      Remove-Tree $OldAppHome
      Remove-Item -Path $OldUninstallKey -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) "$OldAppName.lnk") -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) $OldAppName) -Recurse -Force -ErrorAction SilentlyContinue
    } catch { Show-Message "설치는 완료했습니다. 이전 제품의 일부 프로그램 파일이 남았습니다.`n$($_.Exception.Message)" 'Warning' | Out-Null }
  }

  $done = "설치를 마쳤습니다.`n바탕화면의 '$AppName' 아이콘으로 실행합니다.`n`n지금 실행할까요?"
  if (-not $FromExe -and (Show-Message $done 'Information' 'YesNo') -eq 'Yes') {
    $gate.ReleaseMutex(); $gate.Dispose(); $gate = $null
    if (Test-Path -LiteralPath (Join-Path $AppHome '이수모아.exe')) { Start-Process (Join-Path $AppHome '이수모아.exe') }
    else { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $AppHome 'launch.ps1')`"") }
  }
} catch {
  Show-Message "설치하지 못했습니다.`n`n$($_.Exception.Message)" 'Error' | Out-Null
  exit 1
} finally {
  if ($null -ne $gate) { $gate.ReleaseMutex(); $gate.Dispose() }
}
