# 바탕화면의 '이수모아' 아이콘이 (창 없이) 실행한다.
# 서버가 켜져 있으면 브라우저만 열고, 아니면 서버를 켠 뒤 브라우저를 연다.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$gate = $null
try {
  $gate = Enter-DesktopOperation
  if (-not (Test-Server)) {
    if (-not (Test-Path -LiteralPath $ConfigFile)) {
      Show-Message "설정 파일이 없습니다: $ConfigFile`n이수모아 설치 EXE 또는 설치.bat을 다시 실행해 주세요." 'Error' | Out-Null
      exit 1
    }
    Assert-DesktopStartAvailable
    $logDir = Join-Path $DataHome 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    # 평소 기록은 logs\server-날짜.log에 남고, 켜지다 실패한 이유만 start-error.log에 남는다
    $errorLog = Join-Path $logDir 'start-error.log'
    $node = Join-Path $AppHome 'node\node.exe'
    $entry = Join-Path $AppHome 'app\server\src\index.ts'

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $psi.Arguments = "/d /s /c `"`"$node`" --disable-warning=ExperimentalWarning `"$entry`" >nul 2>`"$errorLog`"`""
    $psi.WorkingDirectory = $DataHome
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['ECP_CONFIG'] = $ConfigFile
    $proc = [System.Diagnostics.Process]::Start($psi)

    # 처음 켤 때는 DB 준비와 OCR 엔진 점검에 시간이 걸린다
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Server)) {
      if ($proc.HasExited -or (Get-Date) -gt $deadline) {
        $detail = ''
        if (Test-Path -LiteralPath $errorLog) { $detail = (Get-Content -LiteralPath $errorLog -Tail 6 -Encoding UTF8) -join "`n" }
        Show-Message ("프로그램을 켜지 못했습니다.`n`n$detail`n`n기록 폴더: $logDir`n" +
          "포트 $(Get-Port)를 다른 프로그램이 쓰고 있다면 $ConfigFile 의 port 값을 바꿔 주세요.") 'Error' | Out-Null
        exit 1
      }
      Start-Sleep -Milliseconds 500
    }
  }
  Start-Process "http://127.0.0.1:$(Get-Port)/"
} catch {
  Show-Message $_.Exception.Message 'Error' | Out-Null
  exit 1
} finally {
  if ($null -ne $gate) { $gate.ReleaseMutex(); $gate.Dispose() }
}
