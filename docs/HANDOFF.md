# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. Sessão 19G, 06/11/2026. NO-GO.**
SDLC: Testes / homologação funcional. Objetivo: continuidade confiável e controles
restantes; sem nova funcionalidade. Este checkpoint supera os relatos históricos.

## Identificação

| Campo                     | Valor                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Etapa                     | Testes / homologação funcional; continuidade documental, S19G                                          |
| Gate atual                | NO-GO; 137 controles ainda não testados                                                                |
| Último gate concluído     | 79/79 suítes, lint e TypeScript locais; CI do novo candidato ainda será conferida                      |
| Worktree                  | `/private/tmp/bs-session-19`                                                                           |
| Branch                    | `fix/session-19-dashboard-currency`                                                                    |
| Base                      | `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                             |
| HEAD validado             | `058b3619e5b34f1b13087b718074af6cb1c0ddd9`; correção de jornada, com documentação S19G no working tree |
| Alterações não commitadas | Documentos de continuidade e livro sanitizado; caminhos no Git status da sessão                        |
| PR                        | [#106](https://github.com/therunnas/bslogistica/pull/106), aberto Draft; sem merge                     |
| Ambiente-alvo             | Local × HML qbnfcmrxmssnwkhaitgd; staging estável e Production fora do escopo                          |
| Última ação comprovada    | S19F preservada por hashes; jornada revisada e 79 suítes reexecutadas S19G                             |
| Próxima ação exata        | Publicar documentação/correção; conferir CI no HEAD remoto; retomar apenas os 137 pendentes            |

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
- Build Webpack HML e UI da jornada aprovados S19F; arquivos de código idênticos
  por hash na retomada. Turbopack será conferido na CI do **novo** HEAD.
- CI de `55d2153` é histórica, não aprova o candidato S19G. Atualizar após o push.

## Migrations por ambiente

- Local: aplicativo em 127.0.0.1:3202 e ponte sintética em 127.0.0.1:3203 observados
  em LISTEN S19G. Backend exclusivamente HML conforme configuração comprovada S19F.
  Não há Supabase local nesta homologação. Não presumir serviços ativos na retomada.
- HML `qbnfcmrxmssnwkhaitgd`: última leitura S19F, 50 migrations, head
  `20261112120000` (045). Nenhuma migration aplicada S19F/S19G.
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

- Host de navegador indisponível na retomada: `The browser access host is unavailable`.
  Fallback nativo em diagnóstico; não enfraquecer autenticação/CSP/grants para usá-lo.
- Cookie do harness sintético dura 900 s; renovar antes de cada bloco longo.
  Recusa de operação S19F com cookie expirado deixou de ocorrer após renovação:
  não é defeito de produto confirmado. Dados sintéticos S19F permanecem preservados.
- 64 controles bloqueados possuem motivo no livro: inclui ativação global vedada,
  regime territorial indisponível no legado, fluxos Auth/TOTP/recuperação sem prova
  permitida. Bloqueio não equivale a PASS nem aprova módulo inteiro.
- Decisões pendentes: fator HE < 1 e lançamentos novos em competência faturada.
- Publicação da correção e CI não substituem homologação funcional.

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
