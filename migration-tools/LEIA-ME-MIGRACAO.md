# Migracao do Esporte Fai para outro computador

Este pacote foi preparado para levar o app para um novo computador que vai funcionar como servidor.

## O que vai no pacote

- Codigo-fonte do projeto.
- Configuracoes do projeto.
- Arquivo `.env`, se existir.
- Banco atual: `esporte_fai.sqlite`.
- Musicas e videos baixados da pasta `Music\Esporte fai`.
- Scripts de restauracao em `migration-tools`.

## O que nao vai no pacote

- `node_modules`, porque deve ser recriado no novo computador com `npm install`.
- Caches temporarios do Electron/Chromium.
- Arquivos de build antigos, porque o script recompila tudo.

## Passo a passo no novo computador

1. Instale as ferramentas base:

```powershell
winget install OpenJS.NodeJS
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

2. Descompacte o pacote em uma pasta simples, por exemplo:

```text
C:\Esporte fai
```

3. Abra o PowerShell dentro da pasta descompactada.

4. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\migration-tools\RESTORE_AND_START.ps1
```

5. No proprio servidor, acesse:

```text
http://localhost:3001
```

6. Em outros aparelhos da mesma rede, acesse:

```text
http://IP_DO_SERVIDOR:3001
```

Use `ipconfig` no servidor para descobrir o IPv4.

## Sobre o computador antigo

O computador antigo nao vira servidor secundario automaticamente. Ele so continua servindo o app se voce deixar o servidor rodando nele tambem.

Se os dois computadores rodarem ao mesmo tempo, eles serao dois servidores independentes:

- cada um tera seu proprio banco;
- cada um tera sua propria pasta de musicas;
- downloads novos em um PC nao aparecem automaticamente no outro.

Para trabalhar no codigo pelo notebook depois da migracao, o ideal e usar acesso remoto, Git/GitHub ou VS Code Remote SSH.

## Publicar em e.duk4rt.com

Depois de confirmar que o app abre em `http://localhost:3001`, abra o PowerShell
como Administrador dentro da pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\migration-tools\INSTALL_DUK4RT_HOSTING.ps1
```

O script instala o Cloudflare Tunnel, abre a autorizacao da conta Cloudflare,
liga o subdominio `e.duk4rt.com` ao servidor e configura o app e o tunel para iniciarem
automaticamente com o Windows. Nao e necessario abrir a porta 3001 no roteador.

Ao terminar, acesse:

```text
https://e.duk4rt.com
```

## Sincronizacao do aplicativo desktop

O desktop usa o backend publicado para contas, playlists e favoritos, mas
continua fazendo downloads e guardando os arquivos no computador do usuario.
Configure a URL no `.env` usado pelo desktop:

```text
ESPORTE_FAI_API_URL=https://e.duk4rt.com
```

Depois de atualizar o codigo do servidor, execute novamente o build e reinicie
a tarefa `Esporte Fai Server`. O desktop exige HTTPS fora do desenvolvimento
local.
