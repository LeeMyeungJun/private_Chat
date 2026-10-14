$projectPath = Split-Path -Parent $PSScriptRoot
$shellObject = New-Object -ComObject WScript.Shell
$shortcutObject = $shellObject.CreateShortcut((Join-Path $projectPath '모음 채팅.lnk'))
$shortcutObject.TargetPath = Join-Path $projectPath 'node_modules\electron\dist\electron.exe'
$shortcutObject.Arguments = '"' + $projectPath + '"'
$shortcutObject.WorkingDirectory = $projectPath
$shortcutObject.Description = '모음 개인 채팅 — 서버 관리 창과 채팅창을 따로 실행합니다.'
$shortcutObject.Save()
