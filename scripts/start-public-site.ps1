$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot "logs"
$serverEntry = Join-Path $projectRoot "dist-web-server\server\main.js"
$node = "C:\Program Files\nodejs\node.exe"
$winGetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Location $projectRoot

$env:ESPORTE_FAI_MEDIA_DIR = Join-Path ([Environment]::GetFolderPath("MyMusic")) "Esporte fai"
$env:ESPORTE_FAI_DB_PATH = Join-Path $env:APPDATA "esporte-fai\esporte_fai.sqlite"
$env:ESPORTE_FAI_YTDLP_PATH = Join-Path $winGetLinks "yt-dlp.exe"
$env:ESPORTE_FAI_FFMPEG_PATH = Join-Path $winGetLinks "ffmpeg.exe"
$env:ESPORTE_FAI_FFPROBE_PATH = Join-Path $winGetLinks "ffprobe.exe"
$env:ESPORTE_FAI_CANONICAL_HOST = "e.duk4rt.com"
$env:ESPORTE_FAI_LEGACY_HOST = "duk4rt.com"
$env:PORT = "3002"

$serverTools = Join-Path $projectRoot ".server-tools"
$ytDlpPluginDirectory = Join-Path $serverTools "yt-dlp-plugins"
$ytDlpProviderHome = Join-Path $serverTools "bgutil-ytdlp-pot-provider\server"
$ytDlpProviderScript = Join-Path $ytDlpProviderHome "build\generate_once.js"
if ((Test-Path $ytDlpPluginDirectory) -and (Test-Path $ytDlpProviderScript)) {
    $env:ESPORTE_FAI_YTDLP_PLUGIN_DIR = $ytDlpPluginDirectory
    $env:ESPORTE_FAI_YTDLP_PROVIDER_HOME = $ytDlpProviderHome
    $env:ESPORTE_FAI_YOUTUBE_PLAYER_CLIENT = "web_embedded"
}

if (-not (Test-Path $serverEntry)) {
    throw "Build web nao encontrado: $serverEntry"
}

& $node $serverEntry *>> (Join-Path $logsDir "public-server.log")
