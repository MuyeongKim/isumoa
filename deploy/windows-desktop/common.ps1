# 이수모아 PC판 — 설치·실행·제거 스크립트가 함께 쓰는 값과 함수.
# 설치본을 만들 때(scripts/release.ts --desktop) UTF-8 BOM을 붙인다 — Windows PowerShell 5.1이 한글을 바르게 읽도록.

$AppName = '이수모아'
# 0.2 이전 판의 이름 (그때 만든 바로가기를 업그레이드할 때 지운다)
$OldAppName = '법정교육 이수증'
# 프로그램 (업그레이드하면 통째로 바뀜)
$AppHome = Join-Path $env:LOCALAPPDATA 'Programs\isumoa'
# 자료·설정·기록 (업그레이드해도 그대로)
$DataHome = Join-Path $env:LOCALAPPDATA 'isumoa'
$ConfigFile = Join-Path $DataHome 'config.json'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\isumoa'
# 제품 이름을 바꾸기 전(EduCert)의 폴더·등록 이름. 그 이름으로 설치되어 있으면 설치할 때 자료를 새 폴더로 옮기고 지운다
$OldAppHome = Join-Path $env:LOCALAPPDATA 'Programs\EduCert'
$OldDataHome = Join-Path $env:LOCALAPPDATA 'EduCert'
$OldUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EduCert'
$DefaultPort = 47210

. (Join-Path $PSScriptRoot 'maintenance.ps1')

# 설치·실행·제거가 동시에 프로그램 폴더를 바꾸거나 켜지 못하게 같은 잠금을 쓴다.
function Enter-DesktopOperation {
  $gate = New-Object System.Threading.Mutex($false, 'Local\IsumoaMaintenance')
  try { $owned = $gate.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) { $gate.Dispose(); throw '이수모아 설치·실행·제거가 이미 진행 중입니다. 먼저 열린 작업을 마친 뒤 다시 실행해 주세요.' }
  return $gate
}

# 창 없이 실행돼도 안내 창이 다른 창 뒤에 숨지 않게 맨 위에 띄운다
function Show-Message([string]$Text, [string]$Icon = 'Information', [string]$Buttons = 'OK', [string]$Default = 'Button1') {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  try {
    return [System.Windows.Forms.MessageBox]::Show($owner, $Text, $AppName,
      [System.Windows.Forms.MessageBoxButtons]$Buttons, [System.Windows.Forms.MessageBoxIcon]$Icon,
      [System.Windows.Forms.MessageBoxDefaultButton]$Default).ToString()
  } finally {
    $owner.Dispose()
  }
}

function Get-Port([string]$Data = $DataHome) {
  try {
    $port = (Get-Content -LiteralPath (Join-Path $Data 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).port
    if ($port -and [int]$port -ge 1 -and [int]$port -le 65535) { return [int]$port }
  } catch {}
  return $DefaultPort
}

# 이 PC 안의 서버에 요청한다 (프록시 설정을 거치지 않게)
function Invoke-Local([string]$Method, [string]$Path, [hashtable]$Headers = @{}, [string]$Data = $DataHome) {
  $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$(Get-Port $Data)$Path")
  $req.Method = $Method
  $req.Proxy = $null
  $req.AllowAutoRedirect = $false
  $req.Timeout = 3000
  foreach ($key in $Headers.Keys) { $req.Headers.Add($key, $Headers[$key]) }
  if ($Method -eq 'POST') {
    $body = [System.Text.Encoding]::UTF8.GetBytes('{}')
    $req.ContentType = 'application/json'
    $req.ContentLength = $body.Length
    $stream = $req.GetRequestStream()
    $stream.Write($body, 0, $body.Length)
    $stream.Close()
  }
  $res = $req.GetResponse()
  try { return [int]$res.StatusCode } finally { $res.Close() }
}

function Test-Server([string]$Data = $DataHome) {
  return Test-IsumoaIdentity "http://127.0.0.1:$(Get-Port $Data)" (Join-Path $Data 'run\shutdown.token')
}

function Get-OwnedServers([string]$App = $AppHome) {
  $node = Join-Path $App 'node\node.exe'
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
    Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $node) }
}

function Assert-DesktopStartAvailable {
  # 화면의 '프로그램 끄기'는 HTTP 포트를 먼저 닫고 진행 중인 OCR을 마친다.
  # 포트가 비어도 이 프로세스가 남아 있으면 같은 DB의 새 일꾼을 켜지 않는다.
  if (@(Get-OwnedServers).Count -gt 0) {
    throw '이수모아가 아직 시작 중이거나 종료 처리를 마치는 중입니다. 수료증 처리가 끝날 수 있도록 잠시 기다린 뒤 다시 실행해 주세요.'
  }
  if (-not (Test-LocalPortAvailable (Get-Port))) {
    throw "이수모아 실행 확인이 되지 않는 프로그램이 포트 $(Get-Port)를 사용 중입니다.`n다른 프로그램 화면은 열지 않았습니다. 기존 이수모아가 켜져 있으면 종료한 뒤 다시 실행하거나, $ConfigFile 의 port 값을 바꿔 주세요."
  }
}

function Test-OwnedListener([string]$Data, [string]$App) {
  # 0.4.0 이하의 실행본에는 확인 프로토콜이 없으므로, 포트 소유 PID·실행 경로로 확인한다.
  try {
    $owners = @(Get-OwnedServers $App | ForEach-Object { [int]$_.ProcessId })
    return @(Get-NetTCPConnection -State Listen -LocalPort (Get-Port $Data) -ErrorAction Stop |
      Where-Object { $_.OwningProcess -in $owners -and $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') }).Count -gt 0
  } catch { return $false }
}

# 켜져 있는 서버는 자료 폴더의 run\shutdown.token에 열쇠를 만들어 둔다. 설치·제거 프로그램은 그 열쇠로 서버를 끈다
function Stop-Server([string]$Data = $DataHome, [string]$App = $AppHome) {
  if (@(Get-OwnedServers $App).Count -eq 0) { return }
  # 1) 열쇠로 서버에 끄기를 부탁한다 (처리 중인 쪽을 마치고 꺼진다)
  $tokenFile = Join-Path $Data 'run\shutdown.token'
  if (((Test-Server $Data) -or (Test-OwnedListener $Data $App)) -and (Test-Path -LiteralPath $tokenFile)) {
      $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
      [void](Invoke-Local 'POST' '/api/system/quit' @{ 'x-shutdown-token' = $token; 'x-requested-with' = 'fetch' } $Data)
      for ($i = 0; $i -lt 180 -and @(Get-OwnedServers $App).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  }
  # 읽는 중인 자료를 강제 종료하지 않는다. 종료/식별 실패 시 설치를 중단하고 기존 프로그램을 보존한다.
  if (@(Get-OwnedServers $App).Count -gt 0) { throw '실행 중인 이수모아를 안전하게 종료하지 못했습니다. 화면에서 프로그램을 끈 뒤 다시 설치해 주세요.' }
}

# 폴더를 지운다. node_modules 안의 긴 경로도 지우도록 빈 폴더를 robocopy /MIR로 덮은 뒤 지운다
function Remove-Tree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $empty = Join-Path $env:TEMP ('isumoa-empty-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $empty | Out-Null
  & robocopy.exe $empty $Path /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item -LiteralPath $empty -Force
  Remove-Item -LiteralPath $Path -Recurse -Force
}
