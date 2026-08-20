param(
  [int]$Port = 3002
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDirectory = Join-Path $ProjectRoot "logs"
$OutputLog = Join-Path $LogDirectory "server-update-output.log"
$ErrorLog = Join-Path $LogDirectory "server-update-error.log"

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw "Node.js não foi encontrado. Instale o Node.js antes de continuar."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd não foi encontrado. Reinstale o Node.js antes de continuar."
}

Write-Host "== Dukart Music: atualização web =="
Write-Host "Projeto: $ProjectRoot"
Write-Host "Porta: $Port"

function Get-ListeningProcessIds {
  $ProcessIds = @()
  try {
    $ProcessIds = @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Select-Object -ExpandProperty OwningProcess
    )
  } catch {
    # Alguns terminais bloqueiam Get-NetTCPConnection. O netstat ainda
    # permite identificar com seguranca o PID que escuta a porta.
  }

  if (-not $ProcessIds) {
    $Pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
    $ProcessIds = @(
      netstat.exe -ano -p tcp |
        ForEach-Object {
          if ($_ -match $Pattern) { [int]$Matches[1] }
        }
    )
  }

  return @($ProcessIds | Sort-Object -Unique)
}

$PreviousServerIds = @(Get-ListeningProcessIds)
foreach ($ProcessId in $PreviousServerIds) {
  $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($Process -and $Process.ProcessName -ne "node") {
    throw "A porta $Port está sendo usada por $($Process.ProcessName), não pelo Dukart Music. Nada foi encerrado."
  }
  if ($Process) {
    Write-Host "Encerrando servidor anterior (PID $($Process.Id))..."
    Stop-Process -Id $Process.Id -Force
  }
}

foreach ($ProcessId in $PreviousServerIds) {
  Wait-Process -Id $ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}
if (Get-ListeningProcessIds) {
  throw "A porta $Port continuou ocupada. O servidor anterior não foi encerrado."
}

Write-Host "Compilando a interface..."
& npm.cmd run build:web
if ($LASTEXITCODE -ne 0) {
  throw "A compilação falhou. O servidor não foi reiniciado."
}

$env:PORT = [string]$Port
$ServerTools = Join-Path $ProjectRoot ".server-tools"
$YtDlpPluginDirectory = Join-Path $ServerTools "yt-dlp-plugins"
$YtDlpProviderHome = Join-Path $ServerTools "bgutil-ytdlp-pot-provider\server"
$YtDlpProviderScript = Join-Path $YtDlpProviderHome "build\generate_once.js"
if ((Test-Path $YtDlpPluginDirectory) -and (Test-Path $YtDlpProviderScript)) {
  if (-not $env:ESPORTE_FAI_YTDLP_PLUGIN_DIR) { $env:ESPORTE_FAI_YTDLP_PLUGIN_DIR = $YtDlpPluginDirectory }
  if (-not $env:ESPORTE_FAI_YTDLP_PROVIDER_HOME) { $env:ESPORTE_FAI_YTDLP_PROVIDER_HOME = $YtDlpProviderHome }
  if (-not $env:ESPORTE_FAI_YOUTUBE_PLAYER_CLIENT) { $env:ESPORTE_FAI_YOUTUBE_PLAYER_CLIENT = "web_embedded" }
}
Write-Host "Iniciando o servidor em segundo plano..."

# Alguns terminais iniciados por aplicativos mantêm Path e PATH ao mesmo
# tempo. O Start-Process do Windows trata os nomes sem diferenciar maiúsculas
# e precisa que exista apenas uma entrada.
$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
[Environment]::SetEnvironmentVariable("Path", "$MachinePath;$UserPath", "Process")

$ServerProcess = Start-Process `
  -FilePath (Get-Command npm.cmd).Source `
  -ArgumentList @("run", "start:web") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutputLog `
  -RedirectStandardError $ErrorLog `
  -PassThru

$Deadline = (Get-Date).AddSeconds(30)
$Healthy = $false
while ((Get-Date) -lt $Deadline) {
  Start-Sleep -Milliseconds 750
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    if ($Health.ok) {
      $Healthy = $true
      break
    }
  } catch {
    if ($ServerProcess.HasExited) { break }
  }
}

if (-not $Healthy) {
  throw "O servidor não respondeu após a atualização. Consulte $ErrorLog"
}

$NewServerIds = @(Get-ListeningProcessIds)
if (-not $NewServerIds) {
  throw "A verificação respondeu, mas nenhum processo novo foi encontrado na porta $Port."
}

Write-Host ""
Write-Host "Atualização concluída."
Write-Host "Acesso local: http://127.0.0.1:$Port"
Write-Host "Servidor ativo (PID): $($NewServerIds -join ', ')"
Write-Host "Saída: $OutputLog"
Write-Host "Erros: $ErrorLog"
