param(
  [string]$ProviderVersion = "1.3.1"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsRoot = Join-Path $ProjectRoot ".server-tools"
$ProviderRoot = Join-Path $ToolsRoot "bgutil-ytdlp-pot-provider"
$ProviderServer = Join-Path $ProviderRoot "server"
$ProviderScript = Join-Path $ProviderServer "build\generate_once.js"
$PluginDirectory = Join-Path $ToolsRoot "yt-dlp-plugins"
$PluginZip = Join-Path $PluginDirectory "bgutil-ytdlp-pot-provider.zip"
$RepositoryUrl = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git"
$PluginUrl = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/$ProviderVersion/bgutil-ytdlp-pot-provider.zip"

foreach ($Command in @("git.exe", "node.exe", "npm.cmd", "npx.cmd")) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "$Command não foi encontrado. Instale Git e Node.js antes de continuar."
  }
}

New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PluginDirectory | Out-Null

if (-not (Test-Path (Join-Path $ProviderRoot ".git"))) {
  Write-Host "Baixando o provedor de token $ProviderVersion..."
  & git.exe clone --depth 1 --branch $ProviderVersion $RepositoryUrl $ProviderRoot
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível baixar o provedor de token." }
} else {
  Write-Host "Atualizando o provedor de token para $ProviderVersion..."
  & git.exe -C $ProviderRoot fetch --depth 1 origin "refs/tags/${ProviderVersion}:refs/tags/${ProviderVersion}"
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível atualizar o provedor de token." }
  & git.exe -C $ProviderRoot checkout --detach $ProviderVersion
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível selecionar a versão $ProviderVersion do provedor." }
}

Write-Host "Instalando as dependências do provedor..."
Push-Location $ProviderServer
try {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "A instalação das dependências do provedor falhou." }
  & npx.cmd tsc
  if ($LASTEXITCODE -ne 0) { throw "A compilação do provedor falhou." }
} finally {
  Pop-Location
}

Write-Host "Baixando o plugin do yt-dlp..."
Invoke-WebRequest -Uri $PluginUrl -OutFile $PluginZip
if (-not (Test-Path $PluginZip) -or (Get-Item $PluginZip).Length -lt 1024) {
  throw "O arquivo do plugin não foi baixado corretamente."
}
if (-not (Test-Path $ProviderScript)) {
  throw "O script compilado do provedor não foi encontrado."
}

$YtDlp = Get-Command "yt-dlp.exe" -ErrorAction SilentlyContinue
if ($YtDlp) {
  Write-Host "Atualizando o yt-dlp..."
  & $YtDlp.Source -U
}

Write-Host ""
Write-Host "Suporte do YouTube instalado com sucesso."
Write-Host "Plugin: $PluginDirectory"
Write-Host "Provedor: $ProviderServer"
Write-Host ""
Write-Host "Agora execute:"
Write-Host ".\migration-tools\UPDATE_WEB_AND_RESTART.ps1"
