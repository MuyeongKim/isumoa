# Stops and removes the scheduled task created by install-service.ps1. Data is not touched.
$ErrorActionPreference = 'Stop'
$name = 'EduCertPlatform'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Removed '$name'."
} else {
  Write-Host "'$name' is not registered."
}
