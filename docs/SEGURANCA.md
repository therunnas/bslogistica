# Segurança

Modelo de segurança vigente do painel de **BS Soluções Logística** e riscos
residuais conhecidos. Este é o documento de referência: onde outro texto divergir
dele, vale o que está aqui. O estado de implantação (migrations, testes, o que
está em Production) fica em [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md); o
histórico de cada mudança, no Git.

## Princípios

1. **A RLS é a proteção real.** O guard do layout governa o que a interface
   mostra; se ele tivesse um defeito, as tabelas continuariam protegidas.
2. **O banco decide, o frontend não.** Autorização, valor financeiro e
   invariantes de dado são impostos no Postgres. Corrigir só na interface não
   resolve.
3. **Fechar por padrão.** Erro de leitura, claim ausente, estado desconhecido:
   a decisão é "não liberado". `NULL` não é `false`.
4. **Operação privilegiada é server-side.** O navegador nunca é autoridade.

## Acesso e papéis

**Sem cadastro público.** O signup está desativado no Auth do Supabase
(`disable_signup = true`), e a tela de login não oferece registro. Contas nascem
por **convite** ou pela mão do administrador, nunca por autosserviço. As demais
opções de Auth (providers, confirmação de e-mail, recuperação) são configuração
externa, do Dashboard do Supabase, e não vêm do repositório: o `config.toml`
não as descreve. Reconferir no Dashboard antes de mexer em Auth.

**Papel é explícito.** O trigger de onboarding cria só o `profiles`. O papel, em
`public.user_roles`, é uma atribuição administrativa separada. O bootstrap
automático do primeiro admin foi **removido** (migration
`remove_automatic_admin_bootstrap`) e não deve voltar.

| Papel                 | Acesso                                                               |
| --------------------- | -------------------------------------------------------------------- |
| `admin` em AAL2       | leitura e escrita nas tabelas de negócio, pelo painel administrativo |
| `admin` em AAL1       | só conta SEM fator: uso cotidiano; com fator, o guard envia a `/mfa` |
| `operacional`         | **nenhuma** tabela de negócio pelo PostgREST; só as cinco RPCs       |
| autenticado sem papel | nenhum dado de negócio                                               |
| não autenticado       | redirecionado ao login                                               |

`admin` + `operacional` é tratado como `admin`. Sem papel, bloqueia.

## Segundo fator (MFA)

TOTP pelo MFA oficial do Supabase. Nenhum segredo é gerado, guardado ou
conferido pela aplicação, e não existe tabela própria de OTP.

- **`admin` e `operacional`: MFA OPCIONAL** (AUTH-01B). Sem fator verificado,
  trabalham em AAL1 no uso cotidiano; com fator verificado, são barrados em AAL1
  até concluir o TOTP. Opcional **não** é dispensável: quem optou pelo segundo
  fator não continua acessando dados só com a senha.
- **As operações críticas exigem AAL2 de verdade** (ver "MFA opcional e a
  classificação das operações" abaixo).
- **Conta com fator verificado exige TOTP no login.** Não há caminho que aceite
  só a senha.
- **Falha ao consultar o nível de garantia não é ausência de fator.** Erro
  transitório vai para "não foi possível verificar", nunca para o cadastro de
  fator — cadastrar sobre conta que já tem fator trava a conta.

### A decisão de acesso

Uma só, em `lerAcesso()` (`src/app/(painel)/_autorizacao.ts`), com a lógica pura
em `src/lib/mfa.ts`. Layout, `/mfa`, dashboard e guards apenas a leem.

| Papel efetivo | Nível  | Estado do fator | Decisão            |
| ------------- | ------ | --------------- | ------------------ |
| `admin`       | `aal2` | qualquer        | liberado           |
| `admin`       | `aal1` | com fator       | `mfa-pendente`     |
| `admin`       | `aal1` | sem fator       | liberado (AAL1)    |
| `operacional` | `aal1` | sem fator       | liberado           |
| `operacional` | `aal1` | com fator       | `mfa-pendente`     |
| `operacional` | `aal2` | qualquer        | liberado           |
| sem papel     | —      | —               | bloqueado          |
| qualquer      | outro  | qualquer        | `mfa-indisponivel` |
| qualquer      | `aal1` | indeterminado   | `mfa-indisponivel` |

`lerAcesso()` devolve também o `nivel` (`aal1`/`aal2`) de quem foi liberado, e é ele,
não a palavra "liberado", que as operações críticas conferem. `mfa-pendente` manda
para `/mfa` (desafiar o fator já verificado). `mfa-ausente` só sobrevive na
recuperação de senha e na tela `/mfa`; o painel não o produz mais.

### Onde a verdade do MFA mora

`getAuthenticatorAssuranceLevel()` sem argumento **não fala com o servidor**:
`currentLevel` sai da claim `aal` do token, e `nextLevel` sai de
`session.user.factors`, campo do cookie fora da assinatura do JWT. Serve para UX,
não para autorização. Por isso o estado do fator usado no enforcement vem de
`public.mfa_bloqueia_excecao_aal1()` (migration `012`), que lê `auth.mfa_factors`
por `SECURITY DEFINER` e responde se o estado de MFA da conta **impede** a
exceção de AAL1. Ela fecha em quatro casos: fator verificado, sem sessão, erro de
leitura e `uid` do JWT inexistente em `auth.users` (token ainda válido de conta
apagada). `nextLevel` não participa do enforcement do painel; sobrevive só na
recuperação de senha, onde não concede acesso a dado e quem recusa a troca sem
AAL2 é o próprio GoTrue.

A tela `/mfa` fica fora do grupo `(painel)`, para não ser barrada pela guarda que
a invoca. Exige sessão e papel, mas não AAL2 — é o que se vem obter ali.

## MFA opcional e a classificação das operações (AUTH-01B, migration 032)

**Política:** o segundo fator é opcional para `admin` e `operacional`; cada titular o
ativa e desativa em Configurações > Segurança. Com fator verificado, o TOTP é
obrigatório no login. **O que é crítico continua exigindo AAL2 de verdade.** Na dúvida
sobre uma operação, ficou a proteção mais forte e a decisão foi registrada.

| Classe | O quê                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nível exigido                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A      | cadastros e apontamento diário (clients, contracts, employees, operations, shifts, timesheets, timesheet_entries, operation_team, profiles); **leitura** de faturas, vigências, adicionais e feriados; RPCs de leitura (`resumo_financeiro_periodo`, `saldo_de_horas_do_periodo`, `ajustes_de_arredondamento_acumulado`, `estado_motor_vigencia`, `condicao_contrato_na_data`, `custo_colaborador_na_data`, `valor_acordado_operacao_na_data`); `salvar_apontamento_admin` | AAL2, **ou AAL1 de conta sem fator** (`mfa_cotidiano_ok()`)            |
| B/C    | financeiro crítico: escrita em `invoices`/`invoice_items`; `gerar_fatura`; registrar/corrigir/encerrar/aposentar condição de contrato, custo e valor acordado; adicionais; feriados; `regularizar_apontamento_legado`; `sincronizar_colunas_legadas`; `alterar_motor_vigencia` (ativar **e** reverter); pendências/divergências da implantação; `financial_engine_settings`; `financial_terms_audit`                                                                       | **AAL2** (`condicoes_exigir_admin()` e policies estritas, não tocadas) |
| D      | identidade e segurança: `admin_audit_log`, `user_operation_access`; administração de usuários e papéis (Server Action com `service_role`, atrás de `exigirAdminAal2`)                                                                                                                                                                                                                                                                                                      | **AAL2**                                                               |

Na aplicação: `exigirAdmin()` (telas cotidianas, AAL1 sem fator ok), `exigirAdminAal2Tela()`
(Usuários e Implantação: sem AAL2 mostra "ative o MFA") e `exigirAdminAal2()` (Server
Actions críticas: lança sem `nivel === "aal2"`). Nenhuma delas substitui o banco.

**Como o banco decide:** `mfa_cotidiano_ok()` = sessão válida de conta existente e
(`aal2` ou (`aal1` e `mfa_bloqueia_excecao_aal1() = false`, isto é, SEM fator verificado)).
Falha fechada: sem sessão, conta inexistente ou estado desconhecido nega. O guard
`condicoes_exigir_admin_leitura()` serve só às 7 RPCs de leitura; a
`condicoes_exigir_admin()` original **não foi alterada**, então toda RPC não listada
segue estrita por padrão. Uma RPC nova com `SECURITY DEFINER` continua escrevendo o
AAL2 dentro de si.

**Decisões pendentes (mantidas no mais forte):**

1. Criar contrato, colaborador ou operação **já com a vigência inicial** (`criar_*_com_vigencia`)
   chama `registrar_*` (financeiro crítico) e portanto exige AAL2. Admin sem fator cadastra
   contratos só depois de ativar o MFA.
2. Com o motor por vigência **desligado** (estado legado/reversão), os gatilhos
   `*_bloqueia_taxa_direta` ficam desabilitados e as colunas de taxa de `contracts`/`employees`/
   `operations` voltam a ser editáveis direto. Para que isso não vire brecha para conta sem fator,
   a 032 cria gatilhos próprios (`trg_*_exige_aal2_taxa_legada`, sempre habilitados, independentes
   do motor, em INSERT e UPDATE): informar ou alterar `daily_rate`, `shift_hours`, `ot_factor`,
   `ot_tolerance_min`, `daily_cost` ou `agreed_amount` direto exige AAL2 (no INSERT, vale o que foge
   do default da coluna; 42501 com "dois fatores"). Os demais campos dessas tabelas seguem
   cotidianos. As RPCs `registrar_*`/`sincronizar_*` (SECURITY DEFINER) passam como antes.
   A reversão do motor em si exige AAL2.
3. **Com o motor ligado (033, AUTH-01C.1)**, nenhum INSERT/UPDATE direto introduz ou altera valor
   legado sem vigência, nem em AAL2. UPDATE já era recusado pelos gatilhos 025 (55000). O INSERT
   direto com taxa fora do default passava para admin AAL2 e criava a linha sem
   `contract_terms`/`employee_cost_terms`/`operation_terms`. A 033 adiciona três CONSTRAINT TRIGGER
   (`trg_*_exige_vigencia_na_taxa`) deferidos: a linha só é aceita se, **na mesma transação**,
   existir uma vigência ativa de valor igual. O cadastro atômico (`criar_*_com_vigencia`, 026) é
   `SECURITY INVOKER` e faz o INSERT com a taxa espelhada na coluna legada e, na sequência,
   `registrar_*`; por isso o INSERT com taxa não pode ser simplesmente proibido, e o commit confere.
   Sem flag, parâmetro ou GUC que o cliente controle; `authenticated` não ganha bypass (a isenção é
   só `postgres`/`service_role`, como nos gatilhos 025). "Motor ligado" é lido do catálogo (gatilho
   de bloqueio habilitado), não da tabela da chave, que está sob RLS. Linha sem taxa (defaults)
   segue livre e aparece nas pendências. Rollback: `docs/runbooks/rollback-taxa-legada-vigencia.sql`.

### Gestão individual do fator

- Só o titular gerencia o próprio fator: a tela lista os fatores **da própria sessão**
  (`listFactors`) e o `unenroll` recebe esse identificador; o Supabase recusa fator de
  outra conta. Nenhuma Server Action, rota ou parâmetro recebe o id de fator alheio.
- Remover um fator verificado exige AAL2 (regra do próprio Supabase); depois da remoção a
  tela chama `refreshSession()` e relê o estado. O banco lê `auth.mfa_factors` a cada
  requisição, então a primeira operação seguinte já usa o piso de AAL1, mesmo que o cookie
  ainda traga `aal2`.
- O rótulo do fator em novos cadastros é "BS Soluções Logísticas"; fatores existentes não
  foram alterados.
- Nenhum segredo TOTP é registrado em log ou gravado pela aplicação.

### Perda do autenticador

Quem tem fator verificado e perdeu o aplicativo **não entra só com a senha** (isso seria o
bypass que a política proíbe). O caminho é o procedimento de recuperação conduzido pelo
responsável do projeto, fora do aplicativo: confirmar a identidade da pessoa por canal
próprio e remover o fator dela pelo painel de autenticação do Supabase (ação auditável do
dono do projeto), com registro. **Esta etapa não criou nenhuma tela de remoção de fator de
terceiros**, de propósito.

### Implantação (plano) e rollback

1. Backup novo de Production (o PROD-02 é anterior às migrations 029–031).
2. Homologação: aplicar a 032, rodar as 32 suítes SQL (`supabase/tests`), validar login sem
   fator, com fator, e as operações críticas negadas em AAL1.
3. Production, com autorização por etapa: **a migration primeiro**, depois o aplicativo.
   A 032 só afrouxa a classe A e só para contas **sem fator**; as classes B/C/D não mudam. O
   aplicativo antigo continua mandando o admin para o MFA na interface, então nada crítico
   fica exposto entre as duas etapas. A ordem inversa também falha fechada (a interface
   liberaria o admin sem fator e o banco antigo negaria tudo).
4. Hoje há um admin com fator verificado: ele **continua exigindo o TOTP** até remover o próprio
   fator. Nenhum fator ou usuário existente é alterado.
5. **Rollback:** reverter o aplicativo primeiro; depois aplicar
   `docs/runbooks/rollback-mfa-opcional.sql` (restaura policies e funções originais; verificado
   rodando as suítes ORIGINAIS no banco revertido). Não executar sem autorização.

## Recuperação de senha

- **Token de uso único não se consome em GET.** Gateways de segurança de e-mail
  visitam cada link da mensagem sozinhos, e a varredura queimava a recuperação
  antes do usuário. O `GET /auth/confirm` confere **apenas formato e `type`** e
  guarda o token num cookie `httpOnly`. Quem chama `verifyOtp` — e portanto cria
  a sessão de recuperação — é a Server Action de `/auth/confirmar-recuperacao`,
  disparada por um clique. Conferir a validade de um token de uso único **é**
  consumi-lo; vale para qualquer link desse tipo que venha a existir.
- **Prova HMAC.** Depois do `verifyOtp`, o servidor emite uma prova assinada
  (HMAC-SHA-256, `PASSWORD_RECOVERY_PROOF_SECRET`, só no servidor) que
  `/redefinir-senha` revalida. Sem o segredo, o fluxo falha fechado. As funções
  puras ficam em `src/lib/prova-recuperacao.ts`.
- **Conta com MFA exige exatamente um TOTP** na recuperação. Depois de uma
  redefinição bem-sucedida **não se cobra um segundo**: a sessão que chega ali já
  provou posse do link, da prova e do segundo fator.
- **Depois que a senha muda, a prova é apagada** e não é reutilizável em nenhum
  desfecho posterior. Falhas **anteriores** ao `updateUser` podem preservá-la,
  de propósito, para nova tentativa dentro da validade. A tela nunca diz que a
  redefinição falhou num caminho em que o `updateUser` teve sucesso.

## RLS e banco

- **Todas as tabelas de `public` têm RLS ativa e ao menos uma policy.** Um event
  trigger (`ensure_rls`) habilita RLS em tabela nova.
- Autorização em SQL usa `public.has_role()` e `public.is_staff()`.
  **`is_staff()` é verdadeira para qualquer papel atribuído**, não distingue
  `admin` de `operacional`; por isso não é a barreira entre os dois.
- **MFA também é exigido no banco**, por classe. Desde a migration 032 as 9 tabelas
  de uso cotidiano (`*_exige_aal2`) aceitam `mfa_cotidiano_ok()`; a ESCRITA em
  `invoices`/`invoice_items` e as policies de auditoria, motor e acesso por operação
  seguem pedindo `aal2` literal. Papel sozinho não distingue uma sessão AAL1 de uma
  AAL2: quem tem fator verificado e só a senha continua sem alcançar os dados pelo
  PostgREST.
- **Acesso direto exige `aal2` E `admin`.** Uma RESTRICTIVE adicional
  `*_exige_admin` (migration `016`) fecha as dez tabelas de negócio para qualquer
  papel que não seja `admin`. Sem ela, um `operacional` que concluísse o TOTP
  alcançava essas tabelas pela policy permissiva de `is_staff()`. Ficam de fora,
  de propósito: `profiles` (cada conta lê a própria linha), `user_roles` (lida em
  AAL1, antes do MFA) e `user_operation_access` (já é admin + AAL2).
- **`user_roles` não recebe policy de AAL2.** O guard lê o papel ainda em AAL1,
  antes de mandar para o MFA; bloqueá-la cria deadlock — seria preciso AAL2 para
  chegar à tela que concede AAL2.
- **Funções `SECURITY DEFINER` rodam acima da RLS**, então policy não as
  protege: cada uma revalida o que precisa por dentro (papel, `aal2`, atribuição),
  com `search_path` fixo e `EXECUTE` revogado de `PUBLIC` e `anon`.
  `gerar_fatura`, por exemplo, confere `aal2` e o papel dentro da função.
- **Identidade utilizável (C02, migration `020`).** `has_role()` e `is_staff()`
  só autorizam quando o chamador é uma identidade **utilizável**: a conta existe
  em `auth.users`, não está banida (`banned_until` no futuro) nem excluída
  (`deleted_at`), **e** a sessão do JWT (`session_id`) existe em `auth.sessions`,
  é da mesma conta e não venceu (`not_after`). Falha fechada: JWT sem
  `session_id`, malformado ou de outra conta é recusado, nunca vira exceção.
  O PostgREST só valida a assinatura do JWT, então sem isto um token anterior a
  banimento, exclusão ou `signOut` seguia autorizado até o `exp` (reproduzido na
  homologação local, L2-C02-B). **A remoção do papel já revogava na hora** e
  continua assim: o papel é lido ao vivo.
  - `has_role()` **continua `SECURITY INVOKER`** (migration `49252bbc`: sem
    bypass de RLS, só enxerga a própria linha). A leitura de `auth.users` e
    `auth.sessions` fica em `identidade_atual_utilizavel()`, `SECURITY DEFINER`
    **sem parâmetro**: só responde sobre o chamador, então não serve de oráculo.
    `conta_ativa(uuid)`, que aceita UUID qualquer, é executável **só por
    `service_role`** (o trigger do último admin).
  - As RPCs operacionais não chamam `has_role()` diretamente: passam por
    `operador_elegivel_*`, `DEFINER` do `postgres`. `bslog_rpc_operacional` não
    ganhou `EXECUTE` em nada novo.
  - A `020` também reescreve a **expressão** de 29 policies (`ALTER POLICY`; nome,
    comando, `PERMISSIVE`/`RESTRICTIVE` e `TO authenticated` ficam iguais).
    25 delas só trocam `has_role(...)`/`is_staff()` solto por `(SELECT ...)`: a
    verificação não depende da linha, então o Postgres a calcula uma vez por
    comando em vez de uma por linha. As 4 de linha própria (`profiles_insert_own`,
    `profiles_update_own`, `profiles_select_own_or_admin`, `user_roles_select_own`)
    passam a exigir `identidade_atual_utilizavel()`, para que um JWT revogado não
    leia nem altere a própria linha. `user_roles` continua **fora do enforcement de
    AAL2** (o guard lê o papel em AAL1): a identidade utilizável não depende do
    nível `aal`.
  - **Enquanto a migration `020` não estiver aplicada** em um ambiente, vale o
    comportamento anterior descrito em "Riscos residuais".
- **`TRUNCATE`** está revogado de `anon` e `authenticated` em `public`, e de
  `service_role` **nas 10 tabelas de negócio**, com `ALTER DEFAULT PRIVILEGES`
  para tabelas futuras. Há trigger `BEFORE TRUNCATE` em `timesheet_entries` e
  `invoice_items`, que recusa o comando quando existe lastro faturado — proteção
  por estado, que também dispara em tabelas atingidas por `CASCADE`. Ver o
  resíduo em "Riscos residuais".
- **`SECURITY DEFINER` não é superusuário.** O `postgres` do Supabase **não** é
  superusuário, e o do harness local é: teste de privilégio que passa localmente
  não prova nada sobre Production. `ALTER ... OWNER TO` exige `CREATE` no schema
  para o **novo dono** — conceder antes e revogar depois, na mesma transação.

## Superfície operacional (RPC)

É a **única** porta do `operacional` para os dados. `operacional` lê **zero
linha** de tabela de negócio pelo PostgREST, em AAL1 e em AAL2. A tela
`/operacional` e `src/lib/operacional/` falam exclusivamente com estas funções, e
os testes asseveram isso na forma dos arquivos.

- `public.user_operation_access`: atribuição usuário → operação. Leitura e
  escrita só por `admin` em AAL2 (policy permissiva e RESTRICTIVE de mesmo
  predicado). O operador não a consulta; ela o autoriza.
- Cinco RPCs de contrato fechado: `listar_operacoes_do_operador`,
  `listar_turnos_do_operador`, `listar_equipe_do_operador`,
  `listar_apontamentos_do_operador` e `salvar_apontamento_operacional`.
- **Elegibilidade** (`operador_elegivel_operacional()`): `aal1` com
  `mfa_bloqueia_excecao_aal1() = false` **ou** `aal2`; papel `operacional` e **não**
  `admin`; conta ainda existente; atribuição em `user_operation_access`. A decisão
  é sempre sobre `auth.uid()` — nenhuma RPC aceita `user_id` por parâmetro.
- **`NULL` não é `false`.** Os helpers fecham com `coalesce(..., false)` e as RPCs
  decidem com `IS NOT TRUE`. Um JWT sem a claim `aal` fazia a cadeia de `AND`
  devolver `NULL` e `IF NOT NULL` não dispara: era fail-open.
- **O operador não recebe valor financeiro.** Nem `billed_amount`, `cost_amount`,
  snapshots, `invoice_id`, `daily_cost`, `daily_rate`, `shift_hours`, `ot_factor`,
  `ot_tolerance_min` ou `agreed_amount`. Do cliente atravessa só `cliente_nome`.
  "Faturado" chega como booleano derivado de `public.apontamento_faturado()`, um
  helper de `postgres` que lê `invoice_id` e devolve só o booleano.
- **A escrita aceita seis campos por linha** (`employee_id`, `status`, `check_in`,
  `check_out`, `break_minutes`, `notes`) e **recusa a chamada inteira** com
  `22023` diante de qualquer outra chave. Não existe `DELETE`; linha ausente do
  payload é linha não tocada.
- **As RPCs não rodam como `postgres`.** Pertencem a `bslog_rpc_operacional`:
  `NOLOGIN`, `BYPASSRLS`, sem membership em `anon`, `authenticated` ou
  `service_role`, e com grants **por coluna** — nenhum privilégio de tabela. Sem
  dono próprio, as guardas de `010`/`011` que isentam `postgres` seriam
  contornadas pela superfície do papel menos privilegiado. Um comando que nomeie
  coluna financeira é recusado com `42501` pelo próprio PostgreSQL. Em `timesheets` e `shifts`
  o `UPDATE` é só de `updated_at`, apenas porque o PostgreSQL exige privilégio de
  `UPDATE` para travar linha com `FOR SHARE`, e dois triggers da `011` fazem isso
  no caminho da escrita.
- **Esse papel não tem nada no schema `auth`.** Em Production o `postgres` não
  consegue conceder `USAGE` em `auth` a outro papel; identidade entra por
  `uid_do_operador()`. Uma RPC desta superfície que referencie `auth.*` quebra.
- **Não ampliar grants, não trocar grant de coluna por `GRANT ... ON TABLE`, não
  trocar o dono das funções.** Ao criar helper novo, mantê-lo somente leitura
  (ou mudar o dono).
- A exigência de equipe ativa e a recusa de folha fechada dependem **só do
  contrato da RPC**, não do banco: nenhuma das duas é invariante de banco para
  papel nenhum. Se virar invariante, é tarefa própria.

## Proteção financeira

- **O payload do cliente não é fonte de valor.** `billed_amount`, `cost_amount` e
  os três snapshots (diária, hora extra, custo) são **derivados por trigger**
  (migration `010`) a partir de contrato, operação, turno e colaborador. No
  `INSERT`, a derivação sobrescreve o payload. Um `UPDATE` só em campo derivado é
  **recusado com `42501`**. Um `UPDATE` aceito recalcula **só se alterou coluna
  motriz** (`status`, `check_in`, `check_out`, `break_minutes`, `employee_id`,
  `timesheet_id`); do contrário preserva o gravado — é isso que mantém o snapshot
  congelado. `postgres` e `service_role` escapam **desse bloqueio específico**,
  não das demais proteções.
- **Linha faturada é imutável e o lastro não se destrói** (migration `011`).
  `timesheet_entries` com `invoice_id` recusa `UPDATE` e `DELETE`, inclusive o
  `SET NULL` da FK. O vínculo só nasce em execução como `postgres`, contexto de
  `gerar_fatura`: `authenticated` (admin incluído) e `service_role` não o criam.
- **A fronteira é a API da aplicação.** O gatilho mede `current_user`, então não
  distingue `gerar_fatura` de uma sessão `postgres` escrevendo à mão. Sessão
  `postgres` direta e superusuário ficam fora; nenhuma proteção aqui promete o
  contrário.
- **Bloqueios de `DELETE` com critérios distintos**, não "em uso": cliente só é
  protegido se tiver fatura ou apontamento faturado; contrato, se for o
  `contract_id` **atual** de uma operação com apontamento; turno, se alguma folha
  o referencia. Com faturamento congelam `operations.client_id`, o
  `work_date`/`operation_id`/`shift_id` da folha e a linha do apontamento.
- `break_minutes` não pode ser negativo (migration `014`): valor negativo inflava
  `billed_amount`.
- `src/lib/billing.ts` serve para a interface mostrar o número **antes** de salvar,
  nunca para decidi-lo.

## Administração de usuários e auditoria

Convidar, atribuir ou trocar papel, remover acesso e atribuir operações passam
por `src/lib/admin-usuarios/`, **exclusivamente no servidor**, depois de
`exigirAdminAal2()` (que reaproveita `lerAcesso()`).

- **`service_role` só no servidor**, instanciada em
  `src/integrations/supabase/admin.ts` e só depois dos controles de autorização.
  Nunca em código client, nunca com prefixo `NEXT_PUBLIC_`.
- **O último admin é protegido** no banco (migration `017`): o trigger
  `trg_proteger_ultimo_admin` recusa com `42501` qualquer `DELETE`/`UPDATE` que
  deixaria zero linhas `admin`, **sem isentar `postgres` nem `service_role`**.
  Desde a migration `020` a contagem considera só admins com **conta ativa**
  (`conta_ativa`): uma linha de conta banida, excluída ou sem registro em
  `auth.users` não conta como "sobrou admin", e remover a linha de uma conta já
  inutilizável é permitido (é o que deixa limpar um papel órfão). A
  decisão é serializada por `pg_advisory_xact_lock`; sem o lock, duas transações
  concorrentes removendo admins diferentes passavam ambas.
- **Revogar acesso** segue uma ordem deliberada: remover papéis (único passo que o
  trigger pode recusar) → limpar as atribuições em `user_operation_access` (pela
  sessão RLS do admin) → banir a conta pela Admin API. Reativar concede o papel
  primeiro e só depois desbane; não restaura as operações removidas. Falha no
  meio de uma sequência já iniciada devolve `"parcial"`, nunca `"erro"`.
- **Alteração de usuário ou papel é auditada** em `public.admin_audit_log`:
  leitura só `admin` em AAL2, sem grant de escrita para `authenticated` (a
  migration `018` normaliza os grants da tabela pelo menor privilégio). Só
  `service_role` grava, então nem um admin adultera a própria trilha.
- **A auditoria é best-effort, não garantia transacional.** Se a alteração já
  ocorreu e a gravação do evento falha, a alteração **não é revertida** — a falha
  só é registrada no servidor. Não afirmar cobertura absoluta de auditoria.

## Segredos

| Item                             | Regra                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`      | só servidor; nunca `NEXT_PUBLIC_`; ausente, falha fechada   |
| `PASSWORD_RECOVERY_PROOF_SECRET` | só servidor; ao menos 32 bytes aleatórios em produção       |
| `NEXT_PUBLIC_SUPABASE_*`         | públicas por natureza; quem protege os dados é a RLS        |
| credenciais de SMTP / e-mail     | só no Dashboard do Supabase; nunca em Git, `.env` ou Vercel |
| `.env`, `.env.local`             | fora do Git; só `.env.example` é versionado, sem valores    |

**Nenhuma variável `NEXT_PUBLIC_*` pode conter segredo:** o prefixo embute o
valor no bundle do navegador. O Sentry roda com `userInfo`, `httpBodies`, cookies,
headers e query params desligados, e não há source maps servidos ao navegador.

## Isolamento entre ambientes

`NODE_ENV` **não** identifica o ambiente: um Preview da Vercel também roda com
`NODE_ENV=production`. O critério é `VERCEL_ENV`, e **só `VERCEL_ENV=production`
conta como Production** (`src/lib/ambiente.ts`).

**A ausência de `VERCEL_ENV` não prova ambiente seguro.** Os sinais de execução
que a Vercel define (`VERCEL`, `VERCEL_URL`, `VERCEL_REGION`,
`VERCEL_DEPLOYMENT_ID`, `VERCEL_PROJECT_ID`) distinguem "estou na Vercel" de
"estou na minha máquina". Com qualquer sinal presente, `VERCEL_ENV` precisa ser
exatamente `production`, `preview` ou `development`: ausente, vazio, com outra
caixa ou desconhecido **faz o build e a requisição falharem**, e o ambiente não é
assumido nem como Production nem como local. Sem nenhum sinal (máquina local, CI
do GitHub, E2E), nada é verificado.

| Ambiente                         | Supabase de Production                    | Destino exigido                                            |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Production                       | permitido (comportamento preservado)      | as variáveis de Production, como sempre                    |
| Preview, Development             | **barrado** (build e cada requisição)     | URL https e chave publicável próprias, de um projeto teste |
| Na Vercel, `VERCEL_ENV` inválido | **falha** (não vira Production nem local) | —                                                          |
| Local, CI, E2E (sem sinais)      | não se aplica (o `.env` de quem executa)  | —                                                          |

**Não existe exceção por variável.** Nenhuma variável de ambiente autoriza um
Preview a usar o projeto Supabase de Production; uma `BS_PREVIEW_SHARED_SUPABASE`
que ainda exista na Vercel não tem efeito algum, e a suíte `test:isolamento` o
prova. Quem precisa de um Preview funcional configura um projeto Supabase de teste
no escopo Preview.

Camadas:

1. **Build** (`next.config.ts`): valida o ambiente e o destino antes de qualquer
   página ser pré-renderizada, e publica o ambiente já validado ao navegador como
   `NEXT_PUBLIC_AMBIENTE`.
2. **Runtime do servidor** (`lerAmbienteSupabase`, usada pelo `proxy.ts`, pelas
   Server Actions e pelo cliente do servidor): repete a regra a cada uso. O
   `proxy.ts` valida antes de montar a CSP.
3. **Chave privilegiada** (`admin.ts`): fora de Production, uma
   `SUPABASE_SERVICE_ROLE_KEY` que declare ser do projeto de Production é barrada.
4. **Navegador**: só confere o ambiente que o build publicou; quem decide é o build.

Limites honestos:

- o gate barra o **projeto de Production**; não prova que o destino seja de teste.
  Um Preview só é isolado de fato com um projeto Supabase próprio;
- a chave publicável só é atribuída a um projeto quando é o formato legado (JWT com
  `ref`). Chaves `sb_publishable_…` e `sb_secret_…` não carregam o projeto: para elas
  decide a URL, e o isolamento da chave privilegiada depende de o escopo Preview
  **não** ter a variável;
- o Next embute as variáveis `NEXT_PUBLIC_*` no build: o destino de um deploy é o
  do momento do build;
- o desenvolvimento local continua livre para usar o `.env` de quem o roda;
- se a URL de Production um dia passar a um domínio próprio, a comparação por
  referência deixa de reconhecê-la — atualizar `REFERENCIA_SUPABASE_PRODUCTION`;
- se a Vercel deixar de expor as variáveis de sistema, os sinais somem e o gate não
  se aplica. A opção de expô-las deve ficar ligada.

**Sentry:** só Production envia eventos. Fora dela o SDK sobe sem DSN (servidor,
edge e navegador), com traces zerados, e não há túnel `/monitoring`, source maps,
release nem telemetria do plugin — **sem depender** de `SENTRY_AUTH_TOKEN` estar
ausente. A coleta restrita de dados é a mesma.

**Configuração que continua sendo da Vercel** (não verificável a partir do
repositório): variáveis do escopo Preview, Deployment Protection, vínculo do
repositório ao projeto e a limpeza dos deploys anteriores à contenção, cujo bundle
guarda o destino do momento do build.

## Cabeçalhos HTTP e CSP

Em `next.config.ts`, para todas as rotas: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` e
`Permissions-Policy` negando câmera, microfone, geolocalização, pagamento e USB.

**HSTS vem da plataforma** (Vercel, borda do domínio próprio). **Não duplicar na
aplicação**: criaria duas fontes de verdade. Sem `includeSubDomains` até mapear
todos os subdomínios, e sem `preload` sem decisão explícita — sair da lista dos
navegadores leva meses. Se a origem sair da Vercel, o header passa a ser da
aplicação.

**`Content-Security-Policy` está em enforcement**, montada por requisição em
`src/proxy.ts` com **nonce** (precisa mudar a cada requisição, por isso não está
em `next.config.ts`):

```
default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self' <origem do Supabase>;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
upgrade-insecure-requests; report-uri <endpoint do Sentry — só em Production>
```

- O nonce cobre os scripts inline que o Next injeta no streaming do RSC, sem
  `unsafe-inline` em `script-src`. O `RootLayout` chama `headers()`, o que força
  renderização por requisição — é o custo do nonce: `/`, `/login` e
  `/esqueci-senha` deixam de ser estáticas.
- O script de tema é um arquivo (`public/theme-script.js`), o que elimina o único
  `dangerouslySetInnerHTML` alcançável.
- A origem do Supabase em `connect-src` vem de `NEXT_PUBLIC_SUPABASE_URL`,
  validada por `origemDoSupabase()` (https, ou http só em loopback; sem
  credenciais) — não há host fixo no código nem host vindo da requisição. A
  montagem está em `src/lib/csp.ts`. Em Production a origem é a mesma de antes; um
  Preview não aceita a de Production (ver "Isolamento entre ambientes").
- O Sentry usa o túnel `/monitoring` (same-origin) **só em Production**; fora dela
  a rota não existe, e o `report-uri` também só existe em Production.
- As fontes são auto-hospedadas por `next/font`, por isso `font-src 'self'`.
- **`style-src` mantém `'unsafe-inline'`** — Radix/shadcn usam estilo inline para
  posicionamento. Apertar isso é etapa própria (ver riscos residuais).

## Frontend

- **Exportação CSV** (`src/lib/csv.ts`): toda célula sai entre aspas com aspas
  internas duplicadas (RFC 4180), registro terminando em CRLF, e valor que comece
  com caractere de fórmula (`=`, `+`, `-`, `@`, TAB, CR) recebe apóstrofo
  inicial. Número puro passa intacto: `-123` não é fórmula.
- **CRUD genérico sem allowlist de colunas** (`useSaveRow`): não é fronteira de
  segurança — é código de navegador, e quem quisesse enviar campos arbitrários
  chamaria o PostgREST direto. O controle é a RLS, mais os triggers e guardas de
  coluna. A correção certa é RLS e privilégio de coluna, nunca allowlist no
  navegador.
- **Escrita recusada pela RLS** não pode parecer sucesso: um `UPDATE`/`DELETE`
  bloqueado afeta zero linhas sem erro, e `exigirLinhaAfetada()`
  (`src/lib/mutations.ts`) trata `count === 0` como falha.
- Nenhum `eval`, `new Function` ou `.innerHTML` no código da aplicação. O único
  `src` dinâmico é o QR do MFA, entregue como data URI em `<img>`, onde SVG não
  executa script. O `alt` do QR é neutro de propósito: a `totp.uri` carrega o
  segredo TOTP.

## Infraestrutura

- Vercel, projeto do sistema, com domínio customizado em Production. O site
  institucional é **outro projeto e outro repositório**.
- **Preview** não usa o banco de Production: o escopo Preview não tem as
  variáveis de Production, e o código barra o contrário (ver "Isolamento entre
  ambientes"). Sem destino de teste próprio, o build de Preview falha, de
  propósito. Não conectar Preview ao banco de produção para deixar o check verde.
- Sem as variáveis, o build falha nomeando o que falta, em vez de publicar uma
  aplicação quebrada.
- **Nunca `supabase config push`.** O `config.toml` não descreve a configuração de
  Auth real; um push aplicaria padrões do CLI e desligaria MFA, confirmação de
  e-mail e a Site URL de produção.
- Dependências: `npm audit` deve permanecer em zero; o estado atual está em
  [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md).

## Riscos residuais

Nenhum bloqueia a operação atual. Cada item tem uma condição objetiva de
fechamento.

| Risco                                                                            | Severidade  | Situação e condição de fechamento                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proteção contra senhas vazadas indisponível** (HaveIBeenPwned exige plano Pro) | baixa       | Risco aceito. Controle equivalente em vigor: o MFA do admin é obrigatório, então a senha sozinha não abre o painel. Fecha com upgrade de plano.                                                                                                                                                                                                                                                                                                          |
| **`TRUNCATE` ainda concedido a `service_role` em `profiles` e `user_roles`**     | baixa       | A migration `011` listou só as 10 tabelas de negócio, e `ALTER DEFAULT PRIVILEGES` não mexe em grant existente. Exige a chave `service_role` **e** conexão direta ao Postgres (o PostgREST não expõe `TRUNCATE`). Fecha revogando, ou registrando como risco aceito: decisão de quem responde pelo projeto.                                                                                                                                              |
| **Grants herdados dos default privileges do Supabase** em tabelas de `public`    | informativa | `anon` e `authenticated` herdam privilégios de tabela além do necessário. Não é acesso: nenhuma policy alcança `anon` e a RLS nega por padrão, verificado em execução. Um `REVOKE` seria defesa em profundidade, mas muda o retorno da API de "vazio" para `42501` e deve ser testado antes.                                                                                                                                                             |
| **Sem FK de `profiles` e `user_roles` para `auth.users`**                        | baixa       | Remover usuário pelo painel do Supabase deixa registros órfãos nessas tabelas. Com a migration `020` o papel órfão **deixa de autorizar**, mas a linha continua lá e **não aparece na tela de usuários** (que parte de `auth.users`). Limpeza controlada (trigger ou rotina administrativa): pendência própria, **não** regressão da C02 e não implementada; exige análise de retenção. Até lá, apagar antes as linhas das duas tabelas.                 |
| **`mfa_bloqueia_excecao_aal1()` de conta revogada**                              | informativa | `SECURITY DEFINER`, responde só sobre o **próprio** chamador (boolean sobre fator verificado): uma conta revogada ainda pode perguntar. Não expõe dado alheio, e fechá-la mudaria o contrato (ela **bloqueia** a exceção de AAL1). Fixado pelo caso I11 da `015`. As 4 policies de linha própria de `profiles`/`user_roles` já exigem a identidade utilizável.                                                                                           |
| **Custo por linha de `has_role()`/`is_staff()` após a `020`**                    | média       | A versão anterior da `020` mediu ~20x em leituras sob RLS (L2-C02-C2: 101 ms -> 2.002 ms em 12,4 mil linhas), pois as policies chamavam as funções por linha. A corrigida usa `(SELECT ...)` (uma avaliação por comando) e helper PL/pgSQL. Remedido na homologação local (amostra sintética, sem concorrência; leituras muito mais rápidas que a versão anterior da `020`, escritas até ~1,6x). **Não medido em Production**; observar a latência real. |
| **`postgres` ler `auth.sessions` em Production**                                 | média       | O precedente das migrations `012` e `015` é `auth.users` e `auth.mfa_factors`, não `auth.sessions`. Conferido em Production antes da aplicação da `020` (18/10/2026); sem esse privilégio, as helpers falhariam em tempo de execução. Reconferir se o Supabase mudar privilégios do schema `auth`.                                                                                                                                                       |
| **`style-src 'unsafe-inline'` na CSP**                                           | baixa       | Necessário hoje para Radix/shadcn. Apertar exige nonce ou hash para estilo.                                                                                                                                                                                                                                                                                                                                                                              |
| **Perda do autenticador do admin**                                               | operacional | Um fator verificado perdido só se remove pelo painel do Supabase. Mitigação organizacional (mais de um admin com MFA); não é defeito de código.                                                                                                                                                                                                                                                                                                          |
| **Proveniência da taxa faturada não é preservada**                               | baixa       | Um admin ainda altera `operations.contract_id`, `agreed_amount`, as taxas do contrato e `employees.daily_cost`, porque não há gatilho de congelamento em `contracts` e `employees`, e as guardas de `operations` isentam admin. **O valor já cobrado não muda** (a entry carrega os snapshots congelados), mas perde-se a resposta para "de qual contrato e com que taxa saiu esta fatura". Fechar exige decisão de desenho: congelar ou versionar.      |
| **Paridade `calcEntry()` × derivação SQL é manual**                              | baixa       | A regra existe em TypeScript e em trigger; os testes de banco guardam constantes, não executam as duas implementações lado a lado. Toda mudança em `calcEntry()` exige revisão explícita da paridade.                                                                                                                                                                                                                                                    |
| **Backup integral restaurável não comprovado**                                   | média       | Existe backup técnico anterior à `020`, mas não restauração integral comprovada no plano Free. Fecha com plano de backup/PITR ou restauração testada.                                                                                                                                                                                                                                                                                                    |
| **Banimento direto do último admin pela Auth Admin API**                         | baixa       | O trigger do último admin protege `user_roles`; banir a conta direto em `auth.users` não passa por ele. Fecha com decisão de desenho própria.                                                                                                                                                                                                                                                                                                            |
| **Revisão de segurança específica (Codex) da C02 não executada**                 | informativa | Homologação e testes locais foram feitos; falta a revisão independente.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Isolamento Preview/Production: prova com Preview real pendente**               | média       | O código barra Preview apontado para Production, no build e em cada requisição, sem exceção por variável (testado localmente). Falta comprovar com um Preview real depois do merge e tratar os deploys anteriores à contenção.                                                                                                                                                                                                                           |
| **Observabilidade histórica limitada**                                           | informativa | A verificação de logs após a `020` cobriu só as janelas disponíveis nos planos atuais.                                                                                                                                                                                                                                                                                                                                                                   |
| **Auditoria best-effort**                                                        | informativa | Ver "Administração de usuários e auditoria".                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Alocação de equipe sem autor nem histórico**                                   | informativa | `operation_team` não registra quem alocou. Só `admin` escreve nela, mas não há trilha por linha.                                                                                                                                                                                                                                                                                                                                                         |
| **Mensagens cruas do SDK em `/mfa` e `link-invalido` genérico na recuperação**   | informativa | Melhoria de diagnóstico; separar os desfechos exige mudar mensagens e destinos, em tarefa própria.                                                                                                                                                                                                                                                                                                                                                       |
