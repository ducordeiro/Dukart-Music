# Implementação das recomendações da auditoria

Branch de teste: `codex/auditoria-recomendacoes`

A versão estável permanece na branch `main`. Esta implementação não deve substituir o servidor público antes da homologação.

## O que foi implementado

- R01–R03: banco central separado do Electron, migração por cópia com backup, gravação atômica, recuperação por integridade, backups rotativos, cotas e relatório administrativo de armazenamento/retencão.
- R04: perfil e biblioteca recentes em cache por conta para abertura sem conexão; mídias offline continuam isoladas por usuário.
- R05–R09: player interno do Electron, busca desktop pelo backend, campo único para texto/link, tocar diretamente do resultado, recentes e sugestões locais persistidas por conta.
- R10–R11: acompanhamento de downloads por ID, cancelamento real do processo, nova tentativa e polling tolerante a falhas transitórias.
- R12–R14: playlist offline em lote, cancelamento, progresso por bytes, painel de armazenamento, SHA-256, validação de tamanho e suporte a Range offline.
- R15–R16: ordem da playlist preservada, fila visível/editável/persistente e remoção da atualização React a 60 FPS.
- R17–R18: timeouts, cache de metadados e busca Electron centralizada sem distribuir a chave do YouTube.
- R19–R20: zoom restaurado, nomes acessíveis, teclado, diálogos, movimento reduzido, capas menores e salvamentos da biblioteca consolidados.
- R21–R22: testes automatizados, medição p50/p95 e atualização previsível do Service Worker sem cache prolongado de `sw.js`.

## Verificação executada

```powershell
npm.cmd test
npm.cmd exec tsc -- -p tsconfig.electron.json --outDir .tmp-electron-audit --tsBuildInfoFile .tmp-electron-audit/tsconfig.tsbuildinfo
```

Também foi feita homologação visual isolada em 390×844 e 1280×800, sem rolagem horizontal e sem erros no console. Busca inteligente, autenticação, início, configurações e painel de armazenamento foram verificados no navegador.

## Como testar sem afetar a versão estável

```powershell
git switch codex/auditoria-recomendacoes
npm.cmd test
```

Use uma porta e banco de homologação próprios antes de iniciar o servidor. Não aponte o Cloudflare Tunnel para a homologação.

## Como voltar para a versão anterior

Pare apenas o processo de homologação e execute:

```powershell
git switch main
npm.cmd run build
```

Depois reinicie o servidor estável pelo procedimento normal. O banco central novo mantém uma cópia de migração; não apague bancos ou backups manualmente.

## Pontos para homologação manual

- Cancelar e repetir downloads reais de áudio e vídeo.
- Interromper a rede durante um download e confirmar a retomada do acompanhamento.
- Abrir o PWA sem rede após salvar uma playlist offline.
- Reproduzir MP3 e MP4 no Electron e testar avanço/retrocesso.
- Conferir leitores de tela e navegação completa por teclado nos aparelhos utilizados em produção.
