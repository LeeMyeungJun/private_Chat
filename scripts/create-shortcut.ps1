$projectPath = Split-Path -Parent $PSScriptRoot
$shellObject = New-Object -ComObject WScript.Shell
foreach ($chatLauncher in @(
  @{ Name = '모음 서버.lnk'; Arguments = '"' + $projectPath + '"'; Description = 'MainPC 서버 관리창만 실행합니다.' },
  @{ Name = '모음 채팅.lnk'; Arguments = '"' + $projectPath + '" --chat'; Description = '열려 있는 MainPC 서버의 채팅창만 엽니다.' }
)) {
  $shortcutObject = $shellObject.CreateShortcut((Join-Path $projectPath $chatLauncher.Name))
  $shortcutObject.TargetPath = Join-Path $projectPath 'node_modules\electron\dist\electron.exe'
  $shortcutObject.Arguments = $chatLauncher.Arguments
  $shortcutObject.WorkingDirectory = $projectPath
  $shortcutObject.WindowStyle = 1
  $shortcutObject.Description = $chatLauncher.Description
  $shortcutObject.Save()
}
