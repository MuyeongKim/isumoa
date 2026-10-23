# 법정교육 이수증 PC판 — 설치·실행·제거 스크립트가 함께 쓰는 값과 함수.
# 설치본을 만들 때(scripts/release.ts --desktop) UTF-8 BOM을 붙인다 — Windows PowerShell 5.1이 한글을 바르게 읽도록.

$AppName = '법정교육 이수증'
# 프로그램 (업그레이드하면 통째로 바뀜)
$AppHome = Join-Path $env:LOCALAPPDATA 'Programs\EduCert'
# 자료·설정·기록 (업그레이드해도 그대로)
$DataHome = Join-Path $env:LOCALAPPDATA 'EduCert'
$ConfigFile = Join-Path $DataHome 'config.json'
# 켜져 있는 서버가 만들어 두는 열쇠. 설치·제거 프로그램이 서버를 끌 때 쓴다
$TokenFile = Join-Path $DataHome 'run\shutdown.token'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EduCert'
$DefaultPort = 47210

Add-Type -AssemblyName System.Windows.Forms

# 창 없이 실행돼도 안내 창이 다른 창 뒤에 숨지 않게 맨 위에 띄운다
function Show-Message([string]$Text, [string]$Icon = 'Information', [string]$Buttons = 'OK', [string]$Default = 'Button1') {
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  try {
    return [System.Windows.Forms.MessageBox]::Show($owner, $Text, $AppName,
      [System.Windows.Forms.MessageBoxButtons]$Buttons, [System.Windows.Forms.MessageBoxIcon]$Icon,
      [System.Windows.Forms.MessageBoxDefaultButton]$Default).ToString()
  } finally {
    $owner.Dispose()
  }
}

function Get-Port {
  try {
    $port = (Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json).port
    if ($port) { return [int]$port }
  } catch {}
  return $DefaultPort
}

# 이 PC 안의 서버에 요청한다 (프록시 설정을 거치지 않게)
function Invoke-Local([string]$Method, [string]$Path, [hashtable]$Headers = @{}) {
  $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$(Get-Port)$Path")
  $req.Method = $Method
  $req.Proxy = $null
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

function Test-Server {
  try { return (Invoke-Local 'GET' '/api/health') -eq 200 } catch { return $false }
}

function Stop-Server {
  # 1) 열쇠로 서버에 끄기를 부탁한다 (처리 중인 쪽을 마치고 꺼진다)
  if ((Test-Server) -and (Test-Path -LiteralPath $TokenFile)) {
    try {
      $token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
      [void](Invoke-Local 'POST' '/api/system/quit' @{ 'x-shutdown-token' = $token; 'x-requested-with' = 'fetch' })
      for ($i = 0; $i -lt 60 -and (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
    } catch {}
  }
  # 2) 그래도 남아 있으면 이 프로그램 폴더의 node.exe만 끈다
  $node = Join-Path $AppHome 'node\node.exe'
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $node) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

# 폴더를 지운다. node_modules 안의 긴 경로도 지우도록 빈 폴더를 robocopy /MIR로 덮은 뒤 지운다
function Remove-Tree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $empty = Join-Path $env:TEMP ('educert-empty-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $empty | Out-Null
  & robocopy.exe $empty $Path /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item -LiteralPath $empty -Force
  Remove-Item -LiteralPath $Path -Recurse -Force
}
