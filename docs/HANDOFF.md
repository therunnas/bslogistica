# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. Sessão 19G, 06/11/2026. NO-GO.**
SDLC: Testes / homologação funcional. Objetivo: continuidade confiável e controles
restantes; sem nova funcionalidade. Este checkpoint supera os relatos históricos.

## Identificação

| Campo                     | Valor                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Etapa                     | Testes / homologação funcional; continuidade documental, S19G                            |
| Gate atual                | NO-GO; 137 controles ainda não testados                                                  |
| Último gate concluído     | CI de da1bd6f aprovada: validar, sql-local e build Turbopack; homologação ainda NO-GO    |
| Worktree                  | `/private/tmp/bs-session-19`                                                             |
| Branch                    | `fix/session-19-dashboard-currency`                                                      |
| Base                      | `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                               |
| HEAD validado             | `da1bd6f4bad9cb8ed5c80598e4a66800224def00`; atualização posterior somente neste HANDOFF  |
| Alterações não commitadas | Nenhuma após publicar o commit de encerramento deste HANDOFF; conferir git status        |
| PR                        | [#106](https://github.com/therunnas/bslogistica/pull/106), aberto Draft; sem merge       |
| Ambiente-alvo             | Local × HML qbnfcmrxmssnwkhaitgd; staging estável e Production fora do escopo            |
| Última ação comprovada    | S20B: backup do HML e ensaio local do expurgo (35 PASS); nada executado no HML remoto    |
| Próxima ação exata        | Autorização escrita para a limpeza do HML (seção 8 do runbook); depois homologar do zero |

O commit que publica este checkpoint muda o HEAD. Conferir o SHA remoto do PR e
os checks desse SHA; não inferir aprovação pelo SHA citado no histórico.

## Evidências

- Fonte versionada por ID: [livro dos controles](continuidade/controles-sessao-19.json).
  **283 PASS / 0 FAIL / 64 BLOQUEADO / 137 NÃO TESTADO**, total 484, herdados da S19F
  sem novos PASS por inspeção. [Matriz e histórico](homologacao-sessao-19.md).
- S19F preservada: hashes dos 11 arquivos locais e seis artefatos do checkpoint
  conferidos na retomada; nenhum foi descartado. O livro agora é publicado com a
  documentação. Os relatos por caso/ação são sanitizados; logs, screenshots e
  dumps brutos em `/private/tmp/bs-session-19-evidence` continuam **somente locais**.
- Jornada: RED S19F com oito falhas antes da correção, GREEN 21/21; recusa zero,
  negativos e não finitos; preserva 4/7,5/8 e metadados legados sem reenviar finanças.
  Nova execução S19G: 79/79 suítes, lint e TypeScript PASS. Sem nova alteração de código.
  Os cinco testes documentais, check:workflow, Prettier e diff check também passaram.
- Build Webpack HML e UI da jornada aprovados S19F; arquivos de código idênticos
  por hash na retomada. Turbopack foi conferido na CI S19G identificada abaixo.
- Publicados: `058b361` (jornada) e `da1bd6f` (continuidade/livro).
- CI de `da1bd6f4bad9cb8ed5c80598e4a66800224def00`:
  [run 42219723390](https://github.com/therunnas/bslogistica/actions/runs/42219723390),
  `validar` e `sql-local` SUCCESS. Log: Next.js 16.4.1 (Turbopack), compilação em
  14,6 s. Não usar checks de `55d2153` para aprovar S19G.
- O commit seguinte atualiza somente este HANDOFF. A CI do HEAD que o publica
  deve ser conferida no GitHub pelo SHA exato, inclusive se o código não mudou.

## Migrations por ambiente

- Local: aplicativo em 127.0.0.1:3202 e ponte sintética em 127.0.0.1:3203 observados
  em LISTEN S19G. Backend exclusivamente HML conforme configuração comprovada S19F.
  Não há Supabase local nesta homologação. Não presumir serviços ativos na retomada.
- HML `qbnfcmrxmssnwkhaitgd`: leitura S19G em transação READ ONLY confirma
  50 migrations, head `20261112120000` (045), motor ativo. Nenhuma migration aplicada.
  SQL/resultado locais: `s19g/hml-preflight.sql` e `.out` no diretório de evidências.
- Staging estável: última referência S19, `38b4349`; não revalidado nem publicado
  por esta sessão. Preview do PR é distinto; push pode gerar Preview automático.
- Production: última referência histórica 034, não consultada nem alterada S19G.
- [Inventário histórico](AMBIENTES.md): fatos datados, não prova de estado corrente.

## Autorizações

Prompt explícito S19G: consolidar documentação, revisar/testar jornada zero,
criar commits e enviar à branch do PR Draft #106; conferir CI no novo HEAD,
incluindo Turbopack. Retomar testes exclusivamente no HML com mecanismo sintético
seguro. A autorização de commit/push substitui a proibição histórica da S19F.

## Proibições

Sem merge, Production, migrations, publicação no staging estável, mudança de regra
comercial global, alteração de faturas/fechamentos existentes ou credenciais reais.
Não alterar fator HE inferior a 1 nem criar trava de competência faturada sem decisão.

## Bloqueios e riscos

- Host de navegador indisponível em duas verificações S19G:
  `The browser access host is unavailable`. Inventário sem navegadores; getBrowser
  também recusa. Fallback nativo exibiu `The user changed /Applications/Google Chrome.app`
  durante ação; catálogo fechou sem confirmação de gravação. Não há novo PASS S19G.
  Coordenar uso exclusivo da janela e restaurar integração antes de mutações reais.
  Não enfraquecer autenticação/CSP/grants; não trocar para credencial real.
- Cookie do harness sintético dura 900 s; renovar antes de cada bloco longo.
  Recusa de operação S19F com cookie expirado deixou de ocorrer após renovação:
  não é defeito de produto confirmado. Dados sintéticos S19F permanecem preservados.
- 64 controles bloqueados possuem motivo no livro: inclui ativação global vedada,
  regime territorial indisponível no legado, fluxos Auth/TOTP/recuperação sem prova
  permitida. Bloqueio não equivale a PASS nem aprova módulo inteiro.
- Decisões pendentes: fator HE < 1 e lançamentos novos em competência faturada.
- Publicação da correção e CI não substituem homologação funcional. Cobertura
  recalculada do livro: 283/0/64/137; resultados mantidos porque nenhuma jornada
  nova teve execução confiável nesta sessão.

## Retomada

1. Conferir status/HEAD/PR Draft e CI exata; ler este checkpoint e o livro versionado.
2. Confirmar serviços locais e HML. Renovar sessão sintética S19B pela ponte local,
   sem criar identidades nem usar conta real. Não alterar o produto para autenticar.
3. Testar seletores da vigência contratual (`vigencias.tsx:334`) e valor-hora de HE
   paga (`vigencias.tsx:347`); são IDs/locais do inventário, não linhas atuais.
4. Seguir os 137 NÃO TESTADOS, priorizando Apontamentos, Colaboradores/equipes,
   Containers, Fechamento e operações. Cada PASS exige caso/ação/resultado próprios.
5. Se automação falhar, registrar diagnóstico real e manter resultados pendentes.
   Atualizar HANDOFF, livro e relatório de publicação antes de encerrar.

## Limpeza do HML (S20B, 06/11/2026)

Fonte detalhada: [runbook](runbooks/limpeza-hml-sintetico.md). Resumo do estado:

- **Nada foi executado no HML remoto.** Só leituras `READ ONLY` e um dump somente leitura. O HML ficou idêntico
  (impressão digital) antes e depois.
- Backup cifrado do HML (head 045) criado e restaurado em Supabase local isolado; cópia local coincide em 65 de 67
  campos de catálogo, com as duas diferenças conhecidas documentadas. Segunda cópia feita **na mesma máquina**:
  destino independente aguarda decisão da BS. Sem backup gerenciado nem PITR: o dump é a única recuperação.
- Expurgo ensaiado só na cópia local: `scripts/hml-limpeza-ensaio-local.sh` com 35 PASS, 0 FAIL (413 → 53 linhas;
  Auth, perfis, papéis, migrations, RLS, grants, funções e gatilhos intactos, inclusive o gatilho legado que já
  estava desabilitado).
- Branch `docs/hml-limpeza-runbook` (base `5246e8d`, PR de documentação sobre o #106). Conferir o SHA remoto e a CI
  do SHA exato; não inferir aprovação por este texto.
- Decisões comerciais ainda abertas (não decididas aqui): arredondamento 15/45 no modo acumulado, estado de
  ativação da resolução de tarifas e do calendário, folha aberta/competência no Faturamento.
- Riscos: desabilitar gatilhos de proteção (mitigado por guardas e ensaio); recuperação depende de uma só máquina;
  a API de gerenciamento só foi exercitada em leitura. A execução remota exige autorização específica.
