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
2. `supabase start` (só os serviços necessários, incluindo o capturador de e-mail Mailpit em
   `127.0.0.1:54324`). O Auth local sobe com TOTP habilitado e cadastro público desligado, como na
   Production, **só por variáveis de ambiente do processo** (`SUPABASE_AUTH_MFA_TOTP_*`,
   `SUPABASE_AUTH_ENABLE_SIGNUP=false`): o `config.toml` não ganha `[auth]`. Só a partir daqui o
   Supabase do `project_id` desta execução passa a ser dela;
3. identidade conferida **antes do reset**: API em `http://127.0.0.1:54321`, container
   `supabase_db_bs-e2e-…` rodando e com o rótulo `com.supabase.cli.project` igual ao projeto desta
   execução; depois, `supabase db reset --local` — todas as migrations versionadas, na ordem;
4. contas sintéticas pela Admin API **local**, com senhas aleatórias desta execução, nunca
   impressas: `e2e-admin` e `e2e-operacional` (login global) e, para o CP-01, `e2e-admin2` (MFA,
   recuperação com MFA, último admin), `e2e-sem-papel`, `e2e-revogar` (operacional que perde o
   acesso) e `e2e-recupera` (recuperação sem MFA), todas `@exemplo.test`;
5. semente: papéis (a conta sem papel fica sem linha), motor por vigência ligado pela RPC (sessão
   sintética temporária), domingo/feriado em dobro ligado, resolução por função desligada;
6. `npm run build` e `next start` em `127.0.0.1:3000`, com `e2e/guarda/rede.cjs` bloqueando
   qualquer conexão do servidor para fora do loopback. O app sobe num **grupo de processos
   próprio** pelo controle de tarefas do bash (`set -m`), sem `setsid` (ausente no macOS); o script
   confere que o app é líder do próprio grupo e para se não for;
7. Playwright (1 worker, sem retry); o login é feito pela tela uma vez por papel;
8. falha se o servidor tentou rede externa; resumo; contexto de cada falha inesperada no log;
9. encerramento no `trap EXIT`, passe ou falhe, **só do que esta execução criou**: o app que ela
   subiu, a pasta temporária de sessões e o Supabase do projeto dela
   (`supabase stop --project-id <bs-e2e-…> --no-backup`; nunca o projeto padrão do config, nunca
   `--all`). Se a execução parou nas validações do passo 1, nada é parado.

Localmente (com Docker): `npm ci`, trocar o `project_id` do `supabase/config.toml` por
`bs-e2e-<algo>` **sem commitar** e rodar `npm run e2e:local`. Sem a troca, as travas recusam. As
travas também recusam qualquer variável de ambiente que contenha um domínio proibido — por exemplo
um e-mail `@bslogisticas.com.br` exportado pela própria ferramenta de desenvolvimento. Nesse caso,
rode sem essa variável (`env -u NOME npm run e2e:local`); não afrouxe a trava.

Portabilidade: o script não usa `setsid` (I1 da QA-BS-01). A subida e o encerramento do app foram
comprovados no Linux (CI e sessão em nuvem) e pelos casos G22–G25 com `setsid` indisponível; a
execução nativa no macOS ainda não foi comprovada.

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
recusadas. Os casos G14–G25 rodam uma **cópia** do `scripts/e2e-local.sh` num diretório
temporário com `docker`, `npx`, `npm` e `curl` falsos (que só registram as chamadas) e provam: destino
inválido, URL externa e vínculo remoto saem sem `start`, reset nem stop; instância preexistente e
porta ocupada são recusadas sem operação destrutiva; com instância própria validada e erro no
ensaio, o reset acontece depois da conferência de identidade e o único stop é
`stop --project-id <projeto da execução> --no-backup`; identidade divergente depois do `start`
não dispara reset; nenhum cenário usa stop sem `--project-id` nem `--all`; o script não chama
`setsid` e, com um `setsid` falso que falha (como no macOS), o app sobe como líder do próprio grupo
e um erro no ensaio encerra o líder e o filho (G22–G25).

## Cenários

| Arquivo | O que cobre |
| --- | --- |
| `00-fumaca.spec.ts` | estado do banco (56 migrations, motor ON, resolução OFF, dobro ON, RLS em tudo), leitura somente leitura, admin abre as 10 telas, operacional restrito |
| `10-ciclo-completo.spec.ts` | cadastros pela tela; V1–V5 do PR #132; operação fixa ao centavo (normal, incompleta, horas extras, limites 15/45, sábado, domingo, feriado, noturno, falta, substituição); avulsa genérica com 2 participantes; fechamento; Excel interno × Excel do cliente (sem custo/margem); CSV; adicional e fatura; sem cobrança dupla; faturado travado; Dashboard e Relatórios |
| `20-seguranca.spec.ts` | operador só por RPC e sem chave financeira; tabela direta devolve zero linha; chave extra recusada com `22023`; admin não usa a RPC do operador; faturado travado para o operador; sem sessão não há dado |
| `30-falhas-conhecidas.spec.ts` | defeitos e riscos conhecidos: cada teste reproduz o defeito e confere que ele continua lá (etiqueta `@falha-conhecida`) |
| `40-autenticacao.spec.ts` | CP-01: login (vazio, senha errada, e-mail inexistente, carregamento, logout, cookie antigo), recuperação de senha com o e-mail capturado no Mailpit (scanner GET, Continuar, duplo clique, validações, link reusado/inválido, sessões anteriores), MFA/TOTP real (cadastro, código errado, desafio no login, AAL1 barrada na tela/API/banco, recuperação com um único TOTP, desativação), usuários (convite e aceite, duplo clique, papel, último admin, operação atribuída, revogação e reativação) |
| `41-permissoes.spec.ts` | CP-01: matriz ADMIN × OPERACIONAL × SEM PAPEL × ANÔNIMO × REVOGADO em URL direta, API Routes, Server Action reenviada com os cookies de outro papel, PostgREST direto e RPC do operador |
| `50-clientes-contratos.spec.ts` | CP-02: cliente (rótulos, nome obrigatório e limpo, persistência, duplo clique e Enter = 1 registro, falha de rede, edição, exclusões com e sem dependência e a confirmação que diz o que some) e contrato (datas inválidas, duplo clique, vínculos com operação, condições por vigência A→B→C aplicadas pela data e congeladas, alteração retroativa recusada, lista sem valor de cadastro como "hoje", fechamento, renomear cliente, fim do contrato `@falha-conhecida`, exclusões, feriados) |
| `60-colaboradores-custos.spec.ts` | CP-03: catálogo de funções; colaborador (rótulos, nome e custo válidos, persistência, duplo clique e Enter = 1 registro, falha de rede, edição, exclusão); "Alterar custo" (D2: o digitado não se perde ao trocar a data; erro e nova tentativa; duplo clique); lista sem custo do cadastro como "hoje" (erro, lentidão e 300 colaboradores); custo 150 → 250 → 270 aplicado pela data, hora extra pelo custo vigente, retroativo recusado, dois profissionais, fechamento e relatório ao centavo; troca de função |
| `70-operacoes-turnos-equipes.spec.ts` | CP-04: operação fixa e avulsa (rótulos, nome limpo, duplo clique e Enter = 1 registro, cliente inativo e contrato encerrado identificados, valor de hoje com erro de leitura, edição, exclusões); turnos (06–15, 15–00, 22–07, horários impossíveis bloqueados, D3 duplo clique, falha de rede, turno com apontamento travado e cópia, exclusão com equipe); equipe (vários no turno, exclusividade entre operações, filtros, desalocar com histórico); reajustes de contrato e custo pela data, dois profissionais, turno noturno, fechamento e relatório ao centavo; D3b: clique durante o fechamento do diálogo não grava de novo (cliente, colaborador, operação, turno) |

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
- o **modelo** de e-mail real (Dashboard): o local usa o modelo padrão do CLI, cujo link aponta
  para `/auth/v1/verify`; o E2E extrai o `token_hash` da mensagem capturada e abre
  `/auth/confirm?token_hash=…&type=recovery`, o formato do modelo da Production. A entrega real
  (SMTP, gateway de segurança do provedor) não é exercitada;
- o domínio do link: no `next start` local, `request.nextUrl` sai como `http://localhost:3000`
  qualquer que seja o Host, e o redirecionamento de `/auth/confirm` vai para `localhost`. O E2E abre
  o link já em `localhost` para o cookie do token pendente acompanhar o salto. Na Vercel o `nextUrl`
  é o domínio real; confirmar no Preview.

MFA com TOTP real **é** exercitado localmente desde o CP-01 (segredo lido da tela, código calculado
no teste pela RFC 6238 e verificado pelo GoTrue local).
