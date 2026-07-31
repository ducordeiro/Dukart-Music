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
$env:PORT = "3001"

$WinGetLinks = "C:\Users\gesso\AppData\Local\Microsoft\WinGet\Links"
$YtDlp = Join-Path $WinGetLinks "yt-dlp.exe"
$Ffmpeg = Join-Path $WinGetLinks "ffmpeg.exe"
$Ffprobe = Join-Path $WinGetLinks "ffprobe.exe"
if (Test-Path $YtDlp) { $env:ESPORTE_FAI_YTDLP_PATH = $YtDlp }
if (Test-Path $Ffmpeg) { $env:ESPORTE_FAI_FFMPEG_PATH = $Ffmpeg }
if (Test-Path $Ffprobe) { $env:ESPORTE_FAI_FFPROBE_PATH = $Ffprobe }

"[$(Get-Date -Format o)] Iniciando Esporte Fai" | Out-File -FilePath $LogFile -Append -Encoding utf8
npm run start:web *>> $LogFile
