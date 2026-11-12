# Testes de ponta a ponta (E2E) com Supabase local

Os testes E2E dirigem o painel pela tela (Playwright + Chromium) contra o app em loopback e um
**Supabase LOCAL descartável**, criado e destruído na VM do GitHub Actions a cada execução. Não
existe caminho para o HML (`qbnfcm…`) nem para a Production (`ehkduq…`): sem secrets, sem
`supabase link` e com travas que interrompem a execução antes de qualquer escrita.

> CI verde aqui **não é homologação** e **não autoriza Production**. Confere código e regra de
> cálculo num banco local idêntico em esquema; não substitui o teste em Preview com o ambiente real
> de homologação (ver "O que continua dependendo do Preview").

## Como roda

| Peça | Onde |
| --- | --- |
| Workflow | `.github/workflows/e2e.yml` (job `e2e-local`, separado do `ci.yml`) |
| Orquestração | `scripts/e2e-local.sh` (`npm run e2e:local`) |
| Travas de isolamento | `e2e/guarda/` (`npm run e2e:guardas` exercita cada uma com casos negativos) |
| Semente local | `e2e/sql/semente-local.sql` (papéis e configuração igual à Production) |
| Configuração | `playwright.config.ts` |
| Apoio | `e2e/apoio/` (login, fixtures, leituras do banco, telas, exportações) |
| Cenários | `e2e/specs/` |
| Resumo | `e2e/relatorio.mjs` → `e2e-results/resumo.md` e resumo do job |

Sequência do script:

1. travas (`testar-guardas.mjs` e `verificar-ambiente.mjs`), Docker disponível;
2. `supabase start` (só os serviços necessários) e `supabase db reset --local` — todas as
   migrations versionadas, na ordem;
3. identidade conferida: API em `http://127.0.0.1:54321` e container `supabase_db_bs-e2e-…`;
4. duas contas sintéticas (`e2e-admin@exemplo.test`, `e2e-operacional@exemplo.test`) pela Admin
   API **local**, com senhas aleatórias desta execução, nunca impressas;
5. semente: papéis `admin` e `operacional`, motor por vigência ligado pela RPC (sessão sintética
   temporária), domingo/feriado em dobro ligado, resolução por função desligada;
6. `npm run build` e `next start` em `127.0.0.1:3000`, com `e2e/guarda/rede.cjs` bloqueando
   qualquer conexão do servidor para fora do loopback;
7. Playwright (1 worker, sem retry); o login é feito pela tela uma vez por papel;
8. falha se o servidor tentou rede externa; resumo; contexto de cada falha no log;
9. `supabase stop --no-backup` e encerramento do app no `trap EXIT`, passe ou falhe.

Localmente (com Docker): `npm ci`, trocar o `project_id` do `supabase/config.toml` por
`bs-e2e-<algo>` **sem commitar** e rodar `npm run e2e:local`. Sem a troca, as travas recusam.

## Isolamento comprovado (e2e/guarda)

- referências proibidas: os refs do HML e da Production e os domínios `supabase.co`,
  `supabase.in`, `supabase.com`, `vercel.app`, `bslogisticas.com.br` — em qualquer variável de
  ambiente e no `project_id`;
- `NEXT_PUBLIC_SUPABASE_URL` só pode ser `http://127.0.0.1:54321`;
- `project_id` precisa começar com `bs-e2e-` (o do repositório é o da Production e é recusado);
- vínculo remoto (`supabase/.temp/project-ref`) é recusado;
- rede do servidor: só loopback (`rede.cjs`), com registro de cada tentativa;
- rede do navegador: toda requisição fora do loopback é abortada e o teste falha;
- leitura do banco nos testes: `docker exec` no container local, em transação
  `default_transaction_read_only=on` (escrita é recusada; há teste para isso);
- o Playwright não recebe a chave `service_role` local (removida do ambiente do processo).

Os casos G1–G13 de `testar-guardas.mjs` provam cada trava com entradas que **devem** ser
recusadas.

## Cenários

| Arquivo | O que cobre |
| --- | --- |
| `00-fumaca.spec.ts` | estado do banco (56 migrations, motor ON, resolução OFF, dobro ON, RLS em tudo), leitura somente leitura, admin abre as 10 telas, operacional restrito |
| `10-ciclo-completo.spec.ts` | cadastros pela tela; V1–V5 do PR #132; operação fixa ao centavo (normal, incompleta, horas extras, limites 15/45, sábado, domingo, feriado, noturno, falta, substituição); avulsa genérica com 2 participantes; fechamento; Excel interno × Excel do cliente (sem custo/margem); CSV; adicional e fatura; sem cobrança dupla; faturado travado; Dashboard e Relatórios |
| `20-seguranca.spec.ts` | operador só por RPC e sem chave financeira; tabela direta devolve zero linha; chave extra recusada com `22023`; admin não usa a RPC do operador; faturado travado para o operador; sem sessão não há dado |
| `30-falhas-conhecidas.spec.ts` | defeitos e riscos conhecidos escritos como o comportamento correto, com `test.fail` |

Esperado × obtido: os valores esperados estão escritos à mão nos cenários (diária 250, custo 150,
hora extra 1,5, tolerância 10 min, domingo/feriado em dobro) e são comparados com o que o banco
gravou (derivação por trigger) e com o que a tela mostra. A tabela completa da execução fica em
`e2e-results/esperado-x-obtido.json` no artefato.

### Status no resumo

- **PASS** — comportamento conferido;
- **FAIL** — regressão ou problema novo (a CI fica vermelha);
- **FALHA CONHECIDA** — teste marcado com `test.fail` falhou como esperado: o defeito continua lá;
- **PULADO** — não rodou (num arquivo serial, um passo anterior falhou).

Quando um defeito conhecido for corrigido, o teste dele passa a "passar inesperadamente" e a CI
acusa: tirar o `test.fail` no mesmo PR da correção.

## Evidências

Cada execução publica o artefato `e2e-<SHA>` (14 dias) com `resumo.md`, `resultado.json`,
relatório HTML, `esperado-x-obtido.json`, logs do build, do app e da rede, e — só nas falhas —
screenshot e trace. Senhas são geradas por execução e não aparecem em log, screenshot ou
relatório; cookies e tokens não são gravados nos artefatos.

## O que continua dependendo do Preview

- a configuração real de Auth do ambiente de homologação (MFA, e-mails, Site URL) — o local usa
  o `config.toml`, que **não** descreve a configuração real;
- dados, feriados e calendário reais do ambiente de homologação;
- a borda da Vercel (proteção do Preview, CSP servida pela plataforma, domínio);
- MFA com fator TOTP real (o E2E usa contas sem fator, liberadas em AAL1 como na regra vigente);
- e-mail (convite, recuperação de senha).
