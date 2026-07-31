$ErrorActionPreference = "Continue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $projectRoot "logs"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$config = Join-Path $PSScriptRoot "public-tunnel.yml"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$log = Join-Path $logsDir "public-tunnel.log"

# Keep a small supervisor alive. Although cloudflared normally reconnects by
# itself, an update or an unexpected process exit used to leave the public URL
# offline until the next Windows login.
while ($true) {
    $startedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
    "[$startedAt] Iniciando tunnel publico" | Out-File -FilePath $log -Append -Encoding utf8

    try {
        & $cloudflared --config $config tunnel run *>> $log
        $exitCode = $LASTEXITCODE
    }
    catch {
        $_ | Out-String | Out-File -FilePath $log -Append -Encoding utf8
        $exitCode = 1
    }

    $stoppedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
    "[$stoppedAt] Tunnel encerrou (codigo $exitCode); nova tentativa em 10 segundos" |
        Out-File -FilePath $log -Append -Encoding utf8
    Start-Sleep -Seconds 10
}
