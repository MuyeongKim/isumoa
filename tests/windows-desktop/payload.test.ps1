param([string]$Program)
$ErrorActionPreference = 'Stop'
. (Join-Path $Program 'maintenance.ps1')
Assert-ProgramPayload $Program
$files = Get-ChildItem -LiteralPath $Program -Filter '*.ps1'
foreach ($file in $files) {
  $tokens=$null; $errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
  if ($errors.Count) { throw ($errors -join "`n") }
}
$manifest = Get-Content -LiteralPath (Join-Path $Program 'program-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
[pscustomobject]@{ version=$manifest.version; files=@($manifest.files).Count; manifestValid=$true; powerShellScriptsParsed=@($files).Count; runtime=$PSVersionTable.PSVersion.ToString() } | ConvertTo-Json
