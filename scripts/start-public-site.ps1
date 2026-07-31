$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot "logs"
$serverEntry = Join-Path $projectRoot "dist-web-server\server\main.js"
$node = "C:\Program Files\nodejs\node.exe"
$winGetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Location $projectRoot

$env:ESPORTE_FAI_MEDIA_DIR = Join-Path ([Environment]::GetFolderPath("MyMusic")) "Esporte fai"
$env:ESPORTE_FAI_DB_PATH = Join-Path $env:APPDATA "esporte-fai-server\esporte_fai_central.sqlite"
$env:ESPORTE_FAI_YTDLP_PATH = Join-Path $winGetLinks "yt-dlp.exe"
$env:ESPORTE_FAI_FFMPEG_PATH = Join-Path $winGetLinks "ffmpeg.exe"
$env:ESPORTE_FAI_FFPROBE_PATH = Join-Path $winGetLinks "ffprobe.exe"
$env:ESPORTE_FAI_CANONICAL_HOST = "e.duk4rt.com"
$env:ESPORTE_FAI_LEGACY_HOST = "duk4rt.com"
$env:PORT = "3001"

if (-not (Test-Path $serverEntry)) {
    throw "Build web nao encontrado: $serverEntry"
}

& $node $serverEntry *>> (Join-Path $logsDir "public-server.log")
