param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$MigrationData = Join-Path $ProjectRoot "migration-data"
$DbSource = Join-Path $MigrationData "database\esporte_fai.sqlite"
$MusicSource = Join-Path $MigrationData "music"
$DbTargetDir = Join-Path $env:APPDATA "esporte-fai"
$DbTarget = Join-Path $DbTargetDir "esporte_fai.sqlite"
$MusicTarget = Join-Path ([Environment]::GetFolderPath("MyMusic")) "Esporte fai"

Set-Location $ProjectRoot

Write-Host "== Esporte Fai: restauracao do servidor =="
Write-Host "Projeto: $ProjectRoot"
Write-Host "Banco destino: $DbTarget"
Write-Host "Musicas destino: $MusicTarget"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js nao encontrado. Instale com: winget install OpenJS.NodeJS"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm nao encontrado. Reinstale/ajuste o Node.js."
}

if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue) -and -not (Get-Command yt-dlp.exe -ErrorAction SilentlyContinue)) {
  Write-Warning "yt-dlp nao encontrado no PATH. Instale com: winget install yt-dlp.yt-dlp"
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and -not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
  Write-Warning "ffmpeg nao encontrado no PATH. Instale com: winget install Gyan.FFmpeg"
}

if (-not $SkipInstall) {
  Write-Host "Instalando dependencias npm..."
  npm install
}

New-Item -ItemType Directory -Force -Path $DbTargetDir | Out-Null
New-Item -ItemType Directory -Force -Path $MusicTarget | Out-Null

if (Test-Path $DbSource) {
  Write-Host "Restaurando banco..."
  Copy-Item -LiteralPath $DbSource -Destination $DbTarget -Force
} else {
  Write-Warning "Banco de migracao nao encontrado: $DbSource"
}

if (Test-Path $MusicSource) {
  Write-Host "Copiando musicas e videos..."
  Get-ChildItem -LiteralPath $MusicSource -Force | Copy-Item -Destination $MusicTarget -Recurse -Force
} else {
  Write-Warning "Pasta de musicas da migracao nao encontrada: $MusicSource"
}

if (Test-Path $DbTarget) {
  Write-Host "Ajustando caminhos dos arquivos no banco para este computador..."
  node (Join-Path $PSScriptRoot "patch-db-paths.cjs") $DbTarget $MusicTarget
}

if (-not $SkipBuild) {
  Write-Host "Compilando projeto..."
  npm run build
}

Write-Host ""
Write-Host "Restauracao concluida."
Write-Host "Acesso local: http://localhost:3001"
Write-Host "Para outros aparelhos, use o IPv4 deste computador: ipconfig"
Write-Host ""

if (-not $NoStart) {
  Write-Host "Iniciando servidor..."
  node "dist-web-server\server\main.js"
}
