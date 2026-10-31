param([ValidateSet('Start', 'Restore')][string]$Mode = 'Start')
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows PC에서만 실행하는 검증 도구입니다.' }
$program = Join-Path $env:LOCALAPPDATA 'Programs\isumoa'
$node = Join-Path $program 'node\node.exe'
$app = Join-Path $program 'app'
if (!(Test-Path $node) -or !(Test-Path (Join-Path $app 'server\src\index.ts'))) { throw '먼저 이수모아 EXE를 기본 위치에 설치하세요.' }
$qaRoot = Join-Path $env:LOCALAPPDATA 'isumoa-session1-qa'
$instance = if ($Mode -eq 'Restore') { 'restored' } else { 'primary' }
$instanceDir = Join-Path $qaRoot $instance
$dataDir = Join-Path $instanceDir 'data'
$backupDir = Join-Path $qaRoot 'backups'
$port = if ($Mode -eq 'Restore') { 47926 } else { 47925 }
# 전용 포트가 사용 중이면 어떤 프로세스도 종료하거나 재사용하지 않는다.
$probe = New-Object System.Net.Sockets.TcpClient
try { $probe.Connect('::1', $port); throw '전용 검증 포트가 사용 중입니다. 기존 검증 창을 먼저 종료하세요.' }
catch [System.Net.Sockets.SocketException] { }
finally { $probe.Dispose() }
New-Item -ItemType Directory -Force -Path $instanceDir, $backupDir | Out-Null
$config = Join-Path $instanceDir 'config.json'
@{ host='::1'; port=$port; dataDir=$dataDir; backupDir=$backupDir; logDir=(Join-Path $instanceDir 'logs'); desktop=$true; singleUser=$true } | ConvertTo-Json | Set-Content -Encoding UTF8 $config
$previousConfig = $env:ECP_CONFIG
$previousHost = $env:HOST
$previousPort = $env:PORT
try {
  $env:ECP_CONFIG = $config
  $env:HOST = '::1'
  $env:PORT = [string]$port
  if ($Mode -eq 'Restore') {
    if (Test-Path (Join-Path $dataDir 'app.db')) { throw '분리 복원 폴더에 이미 자료가 있습니다. 덮어쓰지 않습니다.' }
    # primary의 백업만 사용하고 업무용 기본 백업은 읽지 않는다.
    & $node '--disable-warning=ExperimentalWarning' (Join-Path $app 'scripts\restore.ts') '--apply' '--yes'
    if ($LASTEXITCODE -ne 0) { throw '분리 복원 검사가 실패했습니다. 서버를 시작하지 않습니다.' }
  }
  $pkg = Get-Content -Raw (Join-Path $app 'package.json') | ConvertFrom-Json
  @{ collectedAt=[DateTime]::UtcNow.ToString('o'); osVersion=[Environment]::OSVersion.Version.ToString(); os64Bit=[Environment]::Is64BitOperatingSystem; applicationVersion=$pkg.version; windowsManualTests='미확인'; excelOrHancell='사용자가 제품 및 버전을 기록'; scope='가상 자료 전용' } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $instanceDir 'environment-result.json')
  $process = Start-Process -FilePath $node -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + (Join-Path $app 'server\src\index.ts') + '"')) -WorkingDirectory $app -RedirectStandardOutput (Join-Path $instanceDir 'server.out.log') -RedirectStandardError (Join-Path $instanceDir 'server.err.log') -PassThru
} finally {
  $env:ECP_CONFIG=$previousConfig; $env:HOST=$previousHost; $env:PORT=$previousPort
}
$url = 'http://[::1]:' + $port
$healthy = $false
for ($i=0; $i -lt 30; $i++) {
  if ($process.HasExited) { throw '시험 서버가 종료됐습니다. 검증 폴더의 로그를 확인하세요.' }
  try { $health=Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 2; if ($health.application -eq 'isumoa') { $healthy=$true; break } } catch { }
  Start-Sleep -Milliseconds 500
}
if (!$healthy) { throw '시험 서버 응답을 확인하지 못했습니다. 운영 앱은 그대로 유지했습니다.' }
Write-Host ('가상 자료 전용 검증 ' + $pkg.version + ' - ' + $url)
Write-Host '검증 종료는 화면 왼쪽 아래의 프로그램 끄기를 사용하세요.'
Start-Process $url
Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
