$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$installation = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Installed VS 2022 x64 tools unavailable' }
$developer = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
$setup = Join-Path $env:RUNNER_TEMP 'cadence-msvc.cmd'
@"
@echo off
call "$developer" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b 1
set
"@ | Set-Content -Path $setup -Encoding ascii
try {
  $toolEnvironment = & cmd.exe /d /c $setup
  if ($LASTEXITCODE -ne 0) { throw 'MSVC environment setup failed' }
  # Never emit the full inherited environment into CI logs.
  foreach ($line in $toolEnvironment) {
    if ($line -match '^(VCToolsInstallDir|WindowsSDKVersion|INCLUDE|LIB|LIBPATH|PATH)=(.*)$') {
      "$($Matches[1])=$($Matches[2])" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
    }
  }
} finally {
  Remove-Item -LiteralPath $setup -Force
}
