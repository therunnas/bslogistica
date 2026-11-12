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

1. validações, **antes de qualquer operação destrutiva**: travas (`testar-guardas.mjs` e
   `verificar-ambiente.mjs`), Docker disponível, `project_id` no formato `bs-e2e-…`, nenhum
   vínculo remoto, **nenhuma instância do Supabase CLI já existente** (container de qualquer
   projeto, em execução ou parado) e nenhuma das portas locais (54321–54324, 3000) ocupada. Uma
   falha aqui encerra a execução **sem `start`, sem reset e sem stop**;
2. `supabase start` (só os serviços necessários). Só a partir daqui o Supabase do `project_id`
   desta execução passa a ser dela;
3. identidade conferida **antes do reset**: API em `http://127.0.0.1:54321`, container
   `supabase_db_bs-e2e-…` rodando e com o rótulo `com.supabase.cli.project` igual ao projeto desta
   execução; depois, `supabase db reset --local` — todas as migrations versionadas, na ordem;
4. duas contas sintéticas (`e2e-admin@exemplo.test`, `e2e-operacional@exemplo.test`) pela Admin
   API **local**, com senhas aleatórias desta execução, nunca impressas;
5. semente: papéis `admin` e `operacional`, motor por vigência ligado pela RPC (sessão sintética
   temporária), domingo/feriado em dobro ligado, resolução por função desligada;
6. `npm run build` e `next start` em `127.0.0.1:3000`, com `e2e/guarda/rede.cjs` bloqueando
   qualquer conexão do servidor para fora do loopback;
7. Playwright (1 worker, sem retry); o login é feito pela tela uma vez por papel;
8. falha se o servidor tentou rede externa; resumo; contexto de cada falha inesperada no log;
9. encerramento no `trap EXIT`, passe ou falhe, **só do que esta execução criou**: o app que ela
   subiu, a pasta temporária de sessões e o Supabase do projeto dela
   (`supabase stop --project-id <bs-e2e-…> --no-backup`; nunca o projeto padrão do config, nunca
   `--all`). Se a execução parou nas validações do passo 1, nada é parado.

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
- instância preexistente do Supabase CLI ou porta local ocupada: recusada antes de qualquer
  operação destrutiva;
- encerramento só do que a execução criou, pelo `project_id` dela; validação que falha não dispara
  reset nem stop.

Os casos G1–G13 de `testar-guardas.mjs` provam cada trava com entradas que **devem** ser
recusadas. Os casos G14–G21 rodam uma **cópia** do `scripts/e2e-local.sh` num diretório
temporário com `docker`, `npx`, `npm` e `curl` falsos (que só registram as chamadas) e provam: destino
inválido, URL externa e vínculo remoto saem sem `start`, reset nem stop; instância preexistente e
porta ocupada são recusadas sem operação destrutiva; com instância própria validada e erro no
ensaio, o reset acontece depois da conferência de identidade e o único stop é
`stop --project-id <projeto da execução> --no-backup`; identidade divergente depois do `start`
não dispara reset; nenhum cenário usa stop sem `--project-id` nem `--all`.

## Cenários

| Arquivo | O que cobre |
| --- | --- |
| `00-fumaca.spec.ts` | estado do banco (56 migrations, motor ON, resolução OFF, dobro ON, RLS em tudo), leitura somente leitura, admin abre as 10 telas, operacional restrito |
| `10-ciclo-completo.spec.ts` | cadastros pela tela; V1–V5 do PR #132; operação fixa ao centavo (normal, incompleta, horas extras, limites 15/45, sábado, domingo, feriado, noturno, falta, substituição); avulsa genérica com 2 participantes; fechamento; Excel interno × Excel do cliente (sem custo/margem); CSV; adicional e fatura; sem cobrança dupla; faturado travado; Dashboard e Relatórios |
| `20-seguranca.spec.ts` | operador só por RPC e sem chave financeira; tabela direta devolve zero linha; chave extra recusada com `22023`; admin não usa a RPC do operador; faturado travado para o operador; sem sessão não há dado |
| `30-falhas-conhecidas.spec.ts` | defeitos e riscos conhecidos: cada teste reproduz o defeito e confere que ele continua lá (etiqueta `@falha-conhecida`) |

Esperado × obtido: os valores esperados estão escritos à mão nos cenários (diária 250, custo 150,
hora extra 1,5, tolerância 10 min, domingo/feriado em dobro) e são comparados com o que o banco
gravou (derivação por trigger) e com o que a tela mostra. A tabela completa da execução fica em
`e2e-results/esperado-x-obtido.json` no artefato.

### Status no resumo

- **PASS** — comportamento conferido;
- **FAIL** — regressão ou problema novo (a CI fica vermelha);
- **FALHA CONHECIDA** — teste com a etiqueta `@falha-conhecida` reproduziu o defeito: ele continua lá;
- **PULADO** — não rodou (num arquivo serial, um passo anterior falhou).

Quando um defeito conhecido for corrigido, a conferência do defeito falha e a CI acusa: no mesmo PR
da correção, trocar o teste pelo comportamento correto e tirar a etiqueta. Um passo anterior que
quebre (seletor, preparação) também dá FAIL — nunca vira falha conhecida por engano.

## Evidências

Cada execução publica o artefato `e2e-<SHA>` (14 dias) com `resumo.md`, `resultado.json`,
relatório HTML, `esperado-x-obtido.json`, logs do build, do app e da rede, e — só nas falhas —
screenshot e trace.

O que pode e o que não pode aparecer nesses arquivos:

- **senhas**: geradas a cada execução, não são impressas no log. O login pela tela acontece no
  `globalSetup`, que não grava trace. O E2E não verifica ausência de senha em todo artefato
  possível;
- **traces de falha** (`trace.zip`, também embutido no relatório HTML): registram as requisições
  do navegador e **podem conter cookies e tokens JWT da sessão sintética local** (assinados pela
  chave de desenvolvimento do Supabase local, válidos só naquela VM e naquela execução, destruídos
  no fim). Não há ausência de token comprovada nos traces: trate o artefato como material de
  teste interno e não o compartilhe fora do repositório;
- o log e o resumo mostram e-mails sintéticos (`@exemplo.test`) e UUIDs locais da semente, que não
  são credenciais;
- nenhuma credencial real existe no E2E: não há secrets no workflow, e as chaves usadas
  (publicável e `service_role`) são as do Supabase local descartável. A `service_role` local não
  é repassada ao processo do Playwright.

## O que continua dependendo do Preview

- a configuração real de Auth do ambiente de homologação (MFA, e-mails, Site URL) — o local usa
  o `config.toml`, que **não** descreve a configuração real;
- dados, feriados e calendário reais do ambiente de homologação;
- a borda da Vercel (proteção do Preview, CSP servida pela plataforma, domínio);
- MFA com fator TOTP real (o E2E usa contas sem fator, liberadas em AAL1 como na regra vigente);
- e-mail (convite, recuperação de senha).
