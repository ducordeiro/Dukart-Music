param(
  [string]$DatabasePath,
  [string]$MediaDirectory
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "server.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot

if ($DatabasePath) { $env:ESPORTE_FAI_DB_PATH = $DatabasePath }
if ($MediaDirectory) { $env:ESPORTE_FAI_MEDIA_DIR = $MediaDirectory }
$env:ESPORTE_FAI_CANONICAL_HOST = "e.duk4rt.com"
$env:ESPORTE_FAI_LEGACY_HOST = "duk4rt.com"
$env:PORT = "3002"

$WinGetLinks = "C:\Users\gesso\AppData\Local\Microsoft\WinGet\Links"
$YtDlp = Join-Path $WinGetLinks "yt-dlp.exe"
$Ffmpeg = Join-Path $WinGetLinks "ffmpeg.exe"
$Ffprobe = Join-Path $WinGetLinks "ffprobe.exe"
if (Test-Path $YtDlp) { $env:ESPORTE_FAI_YTDLP_PATH = $YtDlp }
if (Test-Path $Ffmpeg) { $env:ESPORTE_FAI_FFMPEG_PATH = $Ffmpeg }
if (Test-Path $Ffprobe) { $env:ESPORTE_FAI_FFPROBE_PATH = $Ffprobe }

$ServerTools = Join-Path $ProjectRoot ".server-tools"
$YtDlpPluginDirectory = Join-Path $ServerTools "yt-dlp-plugins"
$YtDlpProviderHome = Join-Path $ServerTools "bgutil-ytdlp-pot-provider\server"
$YtDlpProviderScript = Join-Path $YtDlpProviderHome "build\generate_once.js"
if ((Test-Path $YtDlpPluginDirectory) -and (Test-Path $YtDlpProviderScript)) {
  if (-not $env:ESPORTE_FAI_YTDLP_PLUGIN_DIR) { $env:ESPORTE_FAI_YTDLP_PLUGIN_DIR = $YtDlpPluginDirectory }
  if (-not $env:ESPORTE_FAI_YTDLP_PROVIDER_HOME) { $env:ESPORTE_FAI_YTDLP_PROVIDER_HOME = $YtDlpProviderHome }
  if (-not $env:ESPORTE_FAI_YOUTUBE_PLAYER_CLIENT) { $env:ESPORTE_FAI_YOUTUBE_PLAYER_CLIENT = "web_embedded" }
}

"[$(Get-Date -Format o)] Iniciando Dukart Music" | Out-File -FilePath $LogFile -Append -Encoding utf8
npm run start:web *>> $LogFile
