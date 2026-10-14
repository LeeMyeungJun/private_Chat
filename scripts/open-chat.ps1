$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$electronPath = Join-Path $projectPath 'node_modules\electron\dist\electron.exe'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electronPath -ArgumentList ('"' + $projectPath + '"') -WorkingDirectory $projectPath -WindowStyle Hidden
