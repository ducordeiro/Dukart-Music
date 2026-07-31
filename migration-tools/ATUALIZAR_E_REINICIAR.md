# Atualizar e reiniciar o Esporte Fai

Este procedimento recompila a interface web e reinicia somente o servidor do
Esporte Fai na porta 3000. O banco, as músicas e as configurações não são
apagados.

## Método mais fácil

1. Abra a pasta do Esporte Fai no Explorador de Arquivos.
2. Entre na pasta `migration-tools`.
3. Clique com o botão direito em uma área vazia e escolha **Abrir no Terminal**.
4. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\UPDATE_WEB_AND_RESTART.ps1
```

5. Aguarde a mensagem `Atualização concluída`.
6. Abra `http://127.0.0.1:3000` no computador.
7. No celular, feche e abra novamente o PWA ou o navegador.

O servidor continua funcionando em segundo plano depois que o terminal é
fechado. Os registros ficam na pasta `logs` do projeto.

## Se o PowerShell estiver aberto na raiz do projeto

Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\migration-tools\UPDATE_WEB_AND_RESTART.ps1
```

## Verificar se o servidor está funcionando

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

O resultado precisa conter `ok: true`.

## Se ocorrer um erro

Não execute vários servidores ao mesmo tempo. Copie toda a mensagem mostrada no
terminal e guarde também estes arquivos:

```text
logs\server-update-output.log
logs\server-update-error.log
```
