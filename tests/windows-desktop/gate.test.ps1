param([string]$Mode, [string]$Root, [string]$Program)
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = Join-Path $Root 'local'
if (-not $Program) { $Program = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'deploy/windows-desktop' }
. (Join-Path $Program 'common.ps1')
$gate = $null
try {
  $gate = Enter-DesktopOperation
  if ($Mode -eq 'hold') {
    [IO.File]::WriteAllText((Join-Path $Root 'gate-held'), 'ready')
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath (Join-Path $Root 'gate-release'))) {
      if ((Get-Date) -gt $deadline) { throw '검증 잠금 시간 초과' }
      Start-Sleep -Milliseconds 50
    }
  }
  Write-Output 'gate-acquired'
} catch {
  Write-Output $_.Exception.Message
  exit 7
} finally {
  if ($null -ne $gate) { $gate.ReleaseMutex(); $gate.Dispose() }
}
