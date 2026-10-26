# Registers the platform as a Windows scheduled task that starts at boot (runs as SYSTEM)
# and restarts automatically if the server stops. Run install-service.bat as Administrator.
# (Messages are in English so they display correctly in any Windows console code page.)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot
$node = Join-Path $dir 'node\node.exe'
$entry = Join-Path $dir 'app\server\src\index.ts'
$name = 'isumoa'
$oldName = 'EduCertPlatform'   # the name used before the product was renamed
if (-not (Test-Path $node)) { throw "node.exe not found: $node" }

# Remove the task registered under the old name (data and settings are not touched)
if (Get-ScheduledTask -TaskName $oldName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $oldName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $oldName -Confirm:$false
  Write-Host "Removed the old task '$oldName'."
}

$action = New-ScheduledTaskAction -Execute $node -Argument "--disable-warning=ExperimentalWarning `"$entry`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Isumoa - statutory training certificate platform' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Registered and started '$name'. It starts automatically at boot."
Write-Host "Logs: $(Join-Path $dir 'logs')"
