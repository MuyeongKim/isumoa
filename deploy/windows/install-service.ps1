# Registers the platform as a Windows scheduled task that starts at boot (runs as SYSTEM)
# and restarts automatically if the server stops. Run install-service.bat as Administrator.
# (Messages are in English so they display correctly in any Windows console code page.)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$node = Join-Path $dir 'node\node.exe'
$entry = Join-Path $dir 'app\server\src\index.ts'
$name = 'EduCertPlatform'
if (-not (Test-Path $node)) { throw "node.exe not found: $node" }

$action = New-ScheduledTaskAction -Execute $node -Argument "--disable-warning=ExperimentalWarning `"$entry`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Statutory training certificate platform (edu-cert)' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Registered and started '$name'. It starts automatically at boot."
Write-Host "Logs: $(Join-Path $dir 'logs')"
