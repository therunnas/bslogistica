# GATE-FIN-02 — Migration 052: encerra o cadastro pela RPC legada de contêiner (AUT-CP06-01)

Sessão 18 (14/11/2026, sessão em nuvem, Linux, Supabase local descartável). Branch
`fix/gate-fin-02-migration-052`, criada do HEAD `9a5702fec9097d144f5cc2a7289d785ef65a8b49` do #134
(`fix/qa-bs-01-estabilizacao`), em PR Draft **empilhado** sobre o #134. O #134 não foi tocado.

**Estado: implementada e testada LOCALMENTE e na CI. NÃO aplicada em HML nem em Production.**

## Problema (CP-10, SQL 090 C1)

O painel de Contêineres saiu no CP-06B e a Server Action de cadastro recusa desde o CP-06 (D7), mas
`public.registrar_servico_container(jsonb,uuid,text)` continuava executável por `authenticated` (045):
um admin com token criava, pela API, serviço de contêiner com receita própria por um caminho que não
existe na interface (cobrança paralela; SQL 090 D4/D5).

## Inventário das chamadas legadas (repositório inteiro)

| Onde                                                                              | Uso                                                                                                 | Tratamento                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `supabase/tests/045, 046, 047, 049, 050`                                          | fixture (registro antigo) e matriz de papéis                                                        | fixture pela dona; matriz dividida (API × guarda interna)  |
| `supabase/tests/090`                                                              | D4 (fixture), C1–C4 (testes)                                                                        | D4 pela dona; C1 passa a exigir 42501; C1b–C9 novos        |
| `e2e/specs/90` (2), `95` (2), `97` (1)                                            | fixture do histórico                                                                                | `e2e/apoio/legado-local.ts`                                |
| `e2e/specs/90` (1)                                                                | recusa do operacional pela API                                                                      | inalterado (continua recusado)                             |
| `e2e/specs/99`                                                                    | matriz de RPCs                                                                                      | M8 novo; a RPC sai da lista executável por `authenticated` |
| `scripts/testar-concorrencia-fatura.sh`, `testar-container-concorrencia-local.py` | ferramentas manuais (fora da CI)                                                                    | fixture pela dona                                          |
| `scripts/testar-container-paridade-local.py`                                      | comparação histórica de catálogo da 045                                                             | inalterado (ferramenta da 045)                             |
| `scripts/test-container-backend.mjs`                                              | unidade com banco simulado                                                                          | inalterado (não toca o banco)                              |
| `src/lib/container-servico-backend.ts`                                            | caminho do app já encerrado na Server Action (`registrarContainerAction` devolve "encerrado" antes) | inalterado; se alguém o chamar, falha fechado (42501)      |
| `corrigir_servico_container` (049)                                                | chama a função por dentro, como dona                                                                | inalterado; continua funcionando                           |

## Defeito encontrado nas fixtures originais

Seis suítes SQL e três specs E2E criavam o **registro antigo** — dado histórico — chamando a RPC como
admin autenticado. Com o `REVOKE`, todas ficariam vermelhas sem que nada no produto estivesse errado.
E a semente inicial do E2E roda **antes** de as specs criarem clientes e operações pela tela, então não
servia para essas fixtures.

## Estratégia de fixtures

- **SQL:** a função é `SECURITY DEFINER`; dentro dela `current_user` já é `postgres` para qualquer
  chamador. Chamada pela dona (`postgres`, com as claims do admin injetadas), ela produz exatamente as
  mesmas linhas, gatilhos e trilha. Só a checagem de `EXECUTE` muda.
- **E2E:** `e2e/apoio/legado-local.ts`, **a única escrita do E2E fora da interface** (exceção de teste
  documentada), depois de as entidades existirem:
  - só o container Docker local `supabase_db_bs-e2e-…`, verificado em execução, e só com a API em
    loopback;
  - um comando fixo (a própria RPC, como dona, com o JWT real do admin) e parâmetros como variáveis do
    psql (`:'var'`) — sem SQL arbitrário, sem host nem porta;
  - nada no aplicativo (nenhuma rota, Server Action ou função de teste); `psqlSomenteLeitura` segue
    para as consultas normais.
- `test:legado-local` (novo, na CI) prova as guardas antes do Docker, o comando fixo, que nenhuma spec
  chama a RPC legada como admin pela API e a forma da 052 e do rollback.

**Sem a 052, a refatoração sozinha ficou verde:** SQL 53/53 (090: 25 SEGURO e 15 RISCO, inalterada) e
E2E completo 237 (236 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1677 s). Commit `94da0a4`.

## RED (antes da 052)

- SQL 045: `registrar pela API bloqueia admin sem MFA AAL1: esperado erro 42501, obtido <uuid>`.
- SQL 090: C1 `esperado erro 42501|0, obtido <uuid>|1` (o admin criou); C4 mostra `authenticated` com
  `EXECUTE`; C5 falha em cascata (o registro criado pelo C1).

## Migration 052

`supabase/migrations/20261119120000_052_encerrar_cadastro_container_legado.sql`:

```sql
revoke execute on function public.registrar_servico_container(jsonb, uuid, text)
  from public, anon, authenticated, service_role;
```

Mais o comentário da função e uma autoverificação: nenhum papel externo executa; nenhum `EXECUTE` além da
dona no ACL efetivo (inclusive `PUBLIC`); a função segue `SECURITY DEFINER` da `postgres`;
`corrigir_servico_container` e `cancelar_servico_container` seguem executáveis por `authenticated`, e a
correção segue `SECURITY DEFINER` da `postgres`. **Sem DROP; nenhuma outra função, tabela, dado, RLS ou
regra financeira tocada.**

## GREEN

| Prova                                                           | Evidência                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A. admin não cria pela RPC legada                               | SQL 090 C1 (`erro 42501                                                     | 0`); spec 99 M8 (42501 pela API local, nada gravado); SQL 045 |
| B. operacional, sem papel, anônimo e service_role sem acesso    | SQL 090 C4; SQL 045 e 050; spec 99 M8; spec 90                              |
| C. correção de histórico disponível segue funcionando           | SQL 090 C5; SQL 049                                                         |
| D. um único substituto, adicional correto, idempotência, trilha | SQL 090 C5 (1 ativo, R$ 320, original cancelado, `corrected`) e C6; SQL 049 |
| E. cancelamento do histórico segue                              | SQL 090 C9 (com trilha `canceled`); SQL 045                                 |
| F. faturado e cancelado protegidos contra correção              | SQL 090 C7 e C8 (55000)                                                     |
| G. histórico consultável dentro de Operações                    | specs 90, 95 e 97 (leitura pela tela, sem painel próprio)                   |
| H. duplicidade histórica continua demonstrada                   | SQL 090 D4/D5 (RISCO, R$ 2.000)                                             |
| I. nenhum total muda                                            | specs 95 e 97 conferem os mesmos totais ao centavo; SQL 090 D5              |
| J. spec 99 cobre a recusa                                       | M8; a RPC sai da lista das DEFINER executáveis por `authenticated`          |
| Guarda interna da função                                        | SQL 045: pela dona, a mesma matriz de papel e MFA de antes                  |

**Catálogo efetivo (local):** `registrar_servico_container` → EXECUTE só `postgres`;
`corrigir_servico_container` e `cancelar_servico_container` → `postgres, authenticated`.
**Ensaio do rollback (local):** o runbook devolveu `authenticated`; reaplicar a 052 o retirou de novo
(idempotente).

SQL 090 passa a **32 SEGURO e 14 RISCO**: a única mudança de classificação é o C1 (RISCO → SEGURO); C1b
e C5–C9 são casos novos da 052.

## Regressão completa (com a 052)

| Verificação | Resultado |
| --- | --- |
| `npm run e2e:local` | **238 testes · 237 PASS · 0 FAIL · 1 FALHA CONHECIDA (CN-D) · 0 PULADO** · 1671 s · nenhuma rede externa (237 de antes + M8) |
| SQL local | 53 suítes PASS (090: 32 SEGURO, 14 RISCO) |
| `test:*` | 82/82 (`test:legado-local` 13, novo; inventário de migrations atualizado em 4 suítes) |
| lint · `tsc` · Prettier · `check:workflow` · `git diff --check` · build | PASS |
| travas | 25/25 |

## Rollback e compatibilidade

`docs/runbooks/rollback-encerrar-cadastro-container-legado.sql`: `GRANT EXECUTE … TO authenticated`.
**Reabre AUT-CP06-01.** O app do #134 não chama a RPC; um app anterior ao #134 (o site `ecd67f2`) volta a
cadastrar pela tela antiga por URL. A correção funciona igual com ou sem o grant. Revalidar: SQL 090 C1
e spec 99 M8 passam a falhar, de propósito.

Compatibilidade da 052 em ambientes remotos (quando autorizada): o app do #134 não muda; no site
`ecd67f2`, a tela antiga por URL passa a receber 42501 — efeito desejado.

## Resíduo e riscos que permanecem

- **Correção como caminho de receita:** `corrigir_servico_container` segue acessível ao admin e cria um
  substituto (com receita) para registro antigo **não cancelado e não faturado**. Em Production não há
  registros antigos; no HML há (`HOMOLOG-SINT`), não contados nesta sessão.
- Seguem abertos: AUT-CP05-01 (jornada), AUT-CP07-01 (emissão conferida), DEC-CP06-04 (duplicidade C),
  DEC-CP07-03 (cancelamento de fatura), DEC-CP02-01 (contrato encerrado) — SQL 090, 14 RISCO.
- O `postgres` local é superusuário; em Production não é. O REVOKE e a chamada interna como dona valem
  igual, mas a conferência de ACL no ambiente remoto faz parte do gate de aplicação.

## Próximo gate (não autorizado)

Aplicar a 052 no HML exige autorização nominal; Production, outra. Antes: backup e conferência de ACL
por leitura autorizada.
