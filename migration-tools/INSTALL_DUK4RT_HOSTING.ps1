param(
  [string]$Hostname = "e.duk4rt.com",
  [string]$LegacyHostname = "duk4rt.com",
  [string]$TunnelName = "esporte-fai-duk4rt"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$CloudflaredDir = Join-Path $env:USERPROFILE ".cloudflared"
$ConfigPath = Join-Path $CloudflaredDir "config.yml"
$ServerScript = Join-Path $PSScriptRoot "START_ESPORTE_FAI_SERVER.ps1"
$ServerTask = "Esporte Fai Server"
$TunnelTask = "Esporte Fai Cloudflare Tunnel"
$DatabasePath = Join-Path $env:APPDATA "esporte-fai\esporte_fai.sqlite"
$MediaDirectory = Join-Path ([Environment]::GetFolderPath("MyMusic")) "Esporte fai"

function Require-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute este script novamente."
  }
}

function Find-TunnelId([string]$Name) {
  $json = cloudflared tunnel list --output json | ConvertFrom-Json
  return ($json | Where-Object { $_.name -eq $Name } | Select-Object -First 1).id
}

Require-Administrator
Set-Location $ProjectRoot

if (-not (Get-Command cloudflared.exe -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando Cloudflare Tunnel..."
  winget install --id Cloudflare.cloudflared --exact --accept-package-agreements --accept-source-agreements
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

if (-not (Test-Path (Join-Path $CloudflaredDir "cert.pem"))) {
  Write-Host "Autorize a conta Cloudflare na janela do navegador."
  cloudflared tunnel login
}

$TunnelId = Find-TunnelId $TunnelName
if (-not $TunnelId) {
  Write-Host "Criando tunel permanente..."
  cloudflared tunnel create $TunnelName
  $TunnelId = Find-TunnelId $TunnelName
}
if (-not $TunnelId) {
  throw "Nao foi possivel obter o identificador do tunel."
}

$CredentialsPath = Join-Path $CloudflaredDir "$TunnelId.json"
if (-not (Test-Path $CredentialsPath)) {
  throw "Credencial do tunel nao encontrada: $CredentialsPath"
}

New-Item -ItemType Directory -Force -Path $CloudflaredDir | Out-Null
@"
tunnel: $TunnelId
credentials-file: $($CredentialsPath -replace '\\','/')
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:3001
    originRequest:
      connectTimeout: 10s
  - hostname: $LegacyHostname
    service: http://127.0.0.1:3001
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
"@ | Set-Content -Path $ConfigPath -Encoding ascii

Write-Host "Ligando $Hostname ao tunel..."
cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname
Write-Host "Mantendo $LegacyHostname como endereco de compatibilidade..."
cloudflared tunnel route dns --overwrite-dns $TunnelName $LegacyHostname

$PowerShell = (Get-Command powershell.exe).Source
$Cloudflared = (Get-Command cloudflared.exe).Source
$ServerArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ServerScript`" -DatabasePath `"$DatabasePath`" -MediaDirectory `"$MediaDirectory`""
$ServerAction = New-ScheduledTaskAction -Execute $PowerShell -Argument $ServerArguments -WorkingDirectory $ProjectRoot
$TunnelAction = New-ScheduledTaskAction -Execute $Cloudflared -Argument "--config `"$ConfigPath`" tunnel run $TunnelName" -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

Register-ScheduledTask -TaskName $ServerTask -Action $ServerAction -Trigger $Trigger -Settings $Settings -RunLevel Highest -User "SYSTEM" -Force | Out-Null
Register-ScheduledTask -TaskName $TunnelTask -Action $TunnelAction -Trigger $Trigger -Settings $Settings -RunLevel Highest -User "SYSTEM" -Force | Out-Null

Start-ScheduledTask -TaskName $ServerTask
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $TunnelTask

Write-Host "Verificando o servidor local..."
$health = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/health" -TimeoutSec 20
if (-not $health.ok) { throw "O servidor local nao respondeu corretamente." }

Write-Host ""
Write-Host "Hospedagem configurada. Aguarde o DNS/HTTPS ativar e acesse: https://$Hostname"
Write-Host "O app e o tunel agora iniciam automaticamente com o Windows."
