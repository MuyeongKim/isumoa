# 법정교육 이수증 PC판 설치 (관리자 권한 필요 없음). 압축을 푼 폴더의 설치.bat이 실행한다.
#  - 프로그램: %LOCALAPPDATA%\Programs\EduCert
#  - 자료·설정·기록: %LOCALAPPDATA%\EduCert (다시 설치·업그레이드해도 그대로 둔다)
#  - 백업: 문서\법정교육이수증 백업
$ErrorActionPreference = 'Stop'
$Package = Join-Path (Split-Path -Parent $PSScriptRoot) 'program'

# 압축 파일 안에서 바로 실행하면 나머지 파일이 없다
if (-not (Test-Path -LiteralPath (Join-Path $Package 'common.ps1'))) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show(
    "설치 파일이 모두 있지 않습니다.`n압축 파일을 먼저 풀고(오른쪽 클릭 → 모두 압축 풀기), 푼 폴더의 설치.bat을 실행해 주세요.",
    '법정교육 이수증', 'OK', 'Error')
  exit 1
}
. (Join-Path $Package 'common.ps1')

try {
  if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10) {
    throw 'Windows 10 이상, 64비트 PC에서만 설치할 수 있습니다.'
  }
  $version = (Get-Content -LiteralPath (Join-Path $Package 'VERSION') -Raw).Trim()
  $installed = (Get-ItemProperty -Path $UninstallKey -ErrorAction SilentlyContinue).DisplayVersion
  $question = if ($installed) {
    "설치된 $installed 판을 $version 판으로 바꿉니다.`n이수증 자료와 설정은 그대로 둡니다. 계속할까요?"
  } else {
    "$AppName $version 판을 이 PC에 설치합니다.`n관리자 권한 없이 내 사용자 폴더에 설치됩니다. 계속할까요?"
  }
  if ((Show-Message $question 'Question' 'OKCancel') -ne 'OK') { exit 0 }

  # 켜져 있으면 끈다 (업그레이드)
  Stop-Server

  # 프로그램 파일 복사. robocopy는 긴 경로도 복사하고, 옛 판에만 있던 파일은 지운다
  New-Item -ItemType Directory -Force -Path $AppHome | Out-Null
  & robocopy.exe $Package $AppHome /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "프로그램 파일을 복사하지 못했습니다 (robocopy 코드 $LASTEXITCODE). 백신 프로그램이 막았는지 확인해 주세요." }
  # 인터넷에서 받은 파일 표시를 지워 실행 파일·라이브러리가 막히지 않게
  Get-ChildItem -LiteralPath $AppHome -Recurse -File -Include *.exe, *.dll, *.node -ErrorAction SilentlyContinue |
    Unblock-File -ErrorAction SilentlyContinue

  # 설정 파일은 처음 설치할 때만 만든다 (고친 설정을 업그레이드가 덮어쓰지 않게)
  New-Item -ItemType Directory -Force -Path $DataHome | Out-Null
  if (-not (Test-Path -LiteralPath $ConfigFile)) {
    $config = [ordered]@{
      host               = '127.0.0.1'
      port               = $DefaultPort
      dataDir            = 'data'
      backupDir          = Join-Path ([Environment]::GetFolderPath('MyDocuments')) '법정교육이수증 백업'
      # 0시: 하루 중 처음 켰을 때 백업한다 (PC는 밤에 꺼져 있으므로)
      backupHour         = 0
      logDir             = 'logs'
      sessionIdleMinutes = 60
      sessionMaxHours    = 12
      desktop            = $true
    }
    [System.IO.File]::WriteAllText($ConfigFile, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
  }

  # 바로가기: 바탕화면, 시작 메뉴(실행·제거)
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $icon = Join-Path $AppHome 'app.ico'
  $shell = New-Object -ComObject WScript.Shell
  function New-Shortcut([string]$Path, [string]$Script, [string]$Description) {
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $powershell
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppHome $Script)`""
    $link.WorkingDirectory = $DataHome
    $link.IconLocation = "$icon,0"
    $link.WindowStyle = 7
    $link.Description = $Description
    $link.Save()
  }
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) $AppName
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") 'launch.ps1' '법정교육 이수증 종합 플랫폼 열기'
  New-Shortcut (Join-Path $menu "$AppName.lnk") 'launch.ps1' '법정교육 이수증 종합 플랫폼 열기'
  New-Shortcut (Join-Path $menu "$AppName 제거.lnk") 'uninstall.ps1' '법정교육 이수증 프로그램 제거'

  # Windows 설정 > 앱 목록에 보이도록 (내 사용자 계정에만)
  New-Item -Path $UninstallKey -Force | Out-Null
  $strings = @{
    DisplayName     = $AppName
    DisplayVersion  = $version
    Publisher       = '법정교육 이수증 종합 플랫폼'
    InstallLocation = $AppHome
    DisplayIcon     = $icon
    UninstallString = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppHome 'uninstall.ps1')`""
  }
  foreach ($key in $strings.Keys) { New-ItemProperty -Path $UninstallKey -Name $key -Value $strings[$key] -PropertyType String -Force | Out-Null }
  $sizeKb = [int]((Get-ChildItem -LiteralPath $AppHome -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
  foreach ($pair in @(@('NoModify', 1), @('NoRepair', 1), @('EstimatedSize', $sizeKb))) {
    New-ItemProperty -Path $UninstallKey -Name $pair[0] -Value $pair[1] -PropertyType DWord -Force | Out-Null
  }

  $done = "설치를 마쳤습니다.`n바탕화면의 '$AppName' 아이콘으로 실행합니다.`n`n지금 실행할까요?"
  if ((Show-Message $done 'Information' 'YesNo') -eq 'Yes') {
    Start-Process $powershell -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $AppHome 'launch.ps1')`"")
  }
} catch {
  Show-Message "설치하지 못했습니다.`n`n$($_.Exception.Message)" 'Error' | Out-Null
  exit 1
}
