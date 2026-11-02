param([string]$Root)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Root) { throw '가상 검증 폴더를 -Root로 지정해 주세요.' }
$Root = [IO.Path]::GetFullPath($Root)
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$results = New-Object System.Collections.Generic.List[string]
function Assert([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Pass([string]$Name) { $results.Add($Name); Write-Host "PASS $Name" }
function Write-Text([string]$Path, [string]$Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [IO.File]::WriteAllText($Path, $Text)
}
function Quote-Path([string]$Path) { return "'" + $Path.Replace("'", "''") + "'" }

# 실제 설치·제거 스크립트를 실행한다. Windows OS·특수 폴더·COM·레지스트리·robocopy·서버 종료·대화상자만 대체한다.
# 파일 준비·manifest 해시 검사·교체·Register-Program·UndoRegistration·바로가기 목록·제거 흐름은 제품 코드를 쓴다.
$mockFile = Join-Path $Root 'windows-boundaries.ps1'
Write-Text $mockFile @'
function Test-RegistryPath($Path) { return $Path -like 'HKCU:*' }
function Test-Path {
  param($LiteralPath, $Path, $PathType)
  $selected = if ($PSBoundParameters.ContainsKey('LiteralPath')) { $LiteralPath } else { $Path }
  if (Test-RegistryPath $selected) { return $global:GuideTest.Registry.ContainsKey($selected) }
  Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Get-ItemProperty {
  param($Path, $ErrorAction)
  if (Test-RegistryPath $Path) {
    if ($global:GuideTest.Registry.ContainsKey($Path)) { return [pscustomobject]$global:GuideTest.Registry[$Path] }
    return $null
  }
  Microsoft.PowerShell.Management\Get-ItemProperty @PSBoundParameters
}
function Get-Item {
  param($LiteralPath, $Path, [switch]$Force, $ErrorAction)
  if (Test-RegistryPath $Path) {
    $key = [pscustomobject]@{ Values = $global:GuideTest.Registry[$Path] }
    $key | Add-Member ScriptMethod GetValueNames { return @($this.Values.Keys) }
    $key | Add-Member ScriptMethod GetValue { param($Name) return $this.Values[$Name] }
    $key | Add-Member ScriptMethod GetValueKind { param($Name) return 'String' }
    return $key
  }
  Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}
function New-Item {
  param($Path, $ItemType, [switch]$Force)
  if (Test-RegistryPath $Path) {
    if (-not $global:GuideTest.Registry.ContainsKey($Path)) { $global:GuideTest.Registry[$Path] = @{} }
    return
  }
  Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function New-ItemProperty {
  param($Path, $Name, $Value, $PropertyType, [switch]$Force)
  if (Test-RegistryPath $Path) {
    if ($global:GuideTest.FailRegistration) { $global:GuideTest.FailRegistration = $false; throw '주입한 등록 실패' }
    $global:GuideTest.Registry[$Path][$Name] = $Value
    return
  }
  Microsoft.PowerShell.Management\New-ItemProperty @PSBoundParameters
}
function Remove-Item {
  param($Path, $LiteralPath, [switch]$Force, [switch]$Recurse, $ErrorAction)
  if (Test-RegistryPath $Path) { $global:GuideTest.Registry.Remove($Path); return }
  Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
function Copy-ProgramPayload([string]$Source, [string]$Destination) {
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function robocopy.exe { $global:LASTEXITCODE = 0 }
function Stop-Server {}
function Show-Message {
  param($Message, $Icon, $Buttons, $DefaultButton)
  if ($Message -like '*자료(DB*') { return 'No' }
  return 'Yes'
}
$shell = [pscustomobject]@{}
$shell | Add-Member ScriptMethod CreateShortcut {
  param($Path)
  $link = [pscustomobject]@{ Path = $Path; TargetPath = ''; Arguments = ''; WorkingDirectory = ''; IconLocation = ''; WindowStyle = 1; Description = '' }
  $link | Add-Member ScriptMethod Save {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $this.Path) | Out-Null
    [IO.File]::WriteAllText($this.Path, ($this | Select-Object TargetPath, Arguments, WorkingDirectory, IconLocation, WindowStyle, Description | ConvertTo-Json))
  }
  return $link
}
$global:GuideTest.Shell = $shell
'@

function Prepare-Script([string]$Name, [string]$Destination, [string]$CaseRoot) {
  $text = Get-Content -LiteralPath (Join-Path $repo "deploy/windows-desktop/$Name") -Raw -Encoding UTF8
  foreach ($folder in @('Programs', 'Desktop', 'MyDocuments')) {
    $text = $text.Replace("[Environment]::GetFolderPath('$folder')", (Quote-Path (Join-Path $CaseRoot $folder)))
  }
  if ($Name -eq 'install.ps1') {
    $guard = '-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10'
    Assert ($text.Contains($guard)) 'Windows OS 검사 위치를 찾지 못함'
    $text = $text.Replace($guard, '$false')
    $text = $text.Replace('New-Object -ComObject WScript.Shell', '$global:GuideTest.Shell')
    $anchor = ". (Join-Path `$Package 'common.ps1')"
  } else { $anchor = ". (Join-Path `$PSScriptRoot 'common.ps1')" }
  Assert ($text.Contains($anchor)) '제품 공통 함수 로드 위치를 찾지 못함'
  $text = $text.Replace($anchor, ($anchor + "`n. " + (Quote-Path $mockFile)))
  Write-Text $Destination $text
}
function Make-Case([string]$Name, [bool]$OldInstall = $false) {
  $caseRoot = Join-Path $Root $Name
  $env:LOCALAPPDATA = Join-Path $caseRoot 'local'
  $env:SystemRoot = Join-Path $caseRoot 'Windows'
  $env:TEMP = Join-Path $caseRoot 'Temp'
  $env:ISUMOA_UPDATING = ''
  foreach ($dir in @($env:LOCALAPPDATA, $env:TEMP)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $global:GuideTest = @{ Registry = @{}; FailRegistration = $false }
  $program = Join-Path $caseRoot 'package/program'
  New-Item -ItemType Directory -Force -Path $program | Out-Null
  foreach ($name in @('common.ps1', 'maintenance.ps1', 'launch.ps1', 'uninstall.ps1', 'apply-update.ps1')) {
    Copy-Item -LiteralPath (Join-Path $repo "deploy/windows-desktop/$name") -Destination $program
  }
  Write-Text (Join-Path $program 'VERSION') '0.5.11'
  Write-Text (Join-Path $program 'app.ico') '가상 아이콘'
  Write-Text (Join-Path $program 'PC설치안내.txt') '설치 안내와 7. 문제가 생겼을 때'
  $files = @(Get-ChildItem -LiteralPath $program -Recurse -File -Force | ForEach-Object {
    @{ path = $_.FullName.Substring($program.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  Write-Text (Join-Path $program 'program-manifest.json') (@{ version = '0.5.11'; files = $files } | ConvertTo-Json -Depth 5)
  $installer = Join-Path $caseRoot 'package/setup/install.ps1'
  Prepare-Script 'install.ps1' $installer $caseRoot
  $target = Join-Path $env:LOCALAPPDATA 'Programs/isumoa'
  $menu = Join-Path $caseRoot 'Programs/이수모아'
  if ($OldInstall) {
    Write-Text (Join-Path $target 'VERSION') '0.5.10'
    Write-Text (Join-Path $target 'old-only.txt') '이전 버전'
    Write-Text (Join-Path $menu '이수모아.lnk') '기존 실행 바로가기'
    $global:GuideTest.Registry['HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\isumoa'] = @{ DisplayVersion = '0.5.10' }
  }
  return @{ Root = $caseRoot; Installer = $installer; Program = $program; Target = $target; Menu = $menu; GuideLink = (Join-Path $menu '이수모아 설치 안내.lnk') }
}
function Verify-Guide($Case) {
  $guide = Join-Path $Case.Target 'PC설치안내.txt'
  Assert (Test-Path -LiteralPath $guide) '설치 폴더의 안내 파일 누락'
  Assert ((Get-Content -LiteralPath $guide -Raw) -eq (Get-Content -LiteralPath (Join-Path $Case.Program 'PC설치안내.txt') -Raw)) '안내 파일 내용 변경'
  Assert (Test-Path -LiteralPath $Case.GuideLink) '시작 메뉴 안내 바로가기 누락'
  $link = Get-Content -LiteralPath $Case.GuideLink -Raw | ConvertFrom-Json
  Assert ($link.TargetPath -eq $guide) '안내 바로가기 대상 오류'
  Assert ([string]::IsNullOrEmpty($link.Arguments)) '안내 파일에 PowerShell 인수가 붙음'
  . (Join-Path $Case.Target 'maintenance.ps1')
  Assert-ProgramPayload $Case.Target
}

$case = Make-Case 'fresh'
& $case.Installer -FromExe
Assert ($LASTEXITCODE -ne 1) '새 설치 실패'
Verify-Guide $case
Pass '설치 스크립트 -FromExe 경로: 설치 안내 파일·manifest와 시작 메뉴 텍스트 바로가기'

$case = Make-Case 'upgrade' $true
$env:ISUMOA_UPDATING = '1'
& $case.Installer -FromExe
Assert ($LASTEXITCODE -ne 1) '이전 버전 업데이트 실패'
Verify-Guide $case
Assert (-not (Test-Path -LiteralPath (Join-Path $case.Target 'old-only.txt'))) '이전 파일 잔류'
Pass '기존 안내가 없는 이전 버전 업데이트에도 안내 파일·바로가기 추가'

$uninstaller = Join-Path $case.Target 'uninstall-test.ps1'
Prepare-Script 'uninstall.ps1' $uninstaller $case.Root
& $uninstaller
Assert (-not (Test-Path -LiteralPath $case.GuideLink)) '제거 후 안내 바로가기 잔류'
Assert (-not (Test-Path -LiteralPath $case.Menu)) '제거 후 시작 메뉴 폴더 잔류'
Assert (-not (Test-Path -LiteralPath $case.Target)) '제거 후 프로그램 폴더 잔류'
Pass '실제 제거 흐름: 시작 메뉴 폴더 전체 삭제로 안내 바로가기 제거'

foreach ($oldLink in @($false, $true)) {
  $case = Make-Case ("rollback-$oldLink") $oldLink
  if ($oldLink) { Write-Text $case.GuideLink '기존 설치 안내 바로가기 바이트' }
  $global:GuideTest.FailRegistration = $true
  & $case.Installer -FromExe
  Assert ($LASTEXITCODE -eq 1) '등록 실패가 감지되지 않음'
  if ($oldLink) {
    Assert ((Get-Content -LiteralPath $case.GuideLink -Raw) -eq '기존 설치 안내 바로가기 바이트') '기존 안내 바로가기 복원 실패'
    Assert ((Get-Content -LiteralPath (Join-Path $case.Target 'VERSION') -Raw) -eq '0.5.10') '이전 프로그램 복원 실패'
    Pass '설치 실패 시 기존 안내 바로가기 바이트와 이전 프로그램 복원'
  } else {
    Assert (-not (Test-Path -LiteralPath $case.GuideLink)) '실패한 새 안내 바로가기 잔류'
    Assert (-not (Test-Path -LiteralPath $case.Target)) '실패한 첫 설치 프로그램 잔류'
    Pass '첫 설치 실패 시 새 안내 바로가기와 불완전한 프로그램 제거'
  }
}
Write-Text (Join-Path $Root 'install-guide-results.json') (@{ passed = $results.Count; cases = @($results); runtime = $PSVersionTable.PSVersion.ToString(); windowsActualRun = $false; replacedBoundaries = @('Windows OS/folders', 'WScript COM', 'HKCU registry', 'robocopy', 'desktop messages/server stop') } | ConvertTo-Json -Depth 5)
