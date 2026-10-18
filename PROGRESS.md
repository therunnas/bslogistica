# BS Soluções Logística — Progresso

Andamento do projeto: marcos concluídos, etapa atual e próximas etapas. Regras
permanentes ficam em [CLAUDE.md](CLAUDE.md); o estado factual de Production, dos
testes e das dependências, em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md);
o modelo de segurança, em [docs/SEGURANCA.md](docs/SEGURANCA.md). O histórico
detalhado de cada mudança está no Git — este arquivo não o repete.

## Objetivo

Painel interno de gestão de mão de obra terceirizada: clientes e contratos,
colaboradores, operações e turnos, apontamento de diárias e horas extras,
faturamento por período e relatórios. Duas trilhas de uso:

- **Admin** — login com MFA, cadastros, operações, turnos, equipe, apontamentos,
  faturamento, relatórios e administração de usuários.
- **Operacional** — recebe convite, entra, vê **somente** as operações que lhe
  foram atribuídas, registra presença e horários, e **não** vê financeiro nem
  telas administrativas.

## Marcos concluídos

| Frente                                             | Entrega                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Migração para Next.js e reconstrução do Supabase   | Next.js 16 é a arquitetura definitiva; banco e Auth reconstruídos e validados                        |
| MFA e enforcement de AAL2                          | TOTP obrigatório para o admin, na interface e no banco (11 policies RESTRICTIVE)                     |
| Recuperação de senha                               | confirmação deliberada (token não se consome em GET), prova HMAC e um único TOTP para contas com MFA |
| Proteção financeira no banco (`010`, `011`, `014`) | valores derivados por trigger, lastro faturado imutável, `break_minutes` não negativo                |
| Estado de MFA verificável pelo banco (`012`)       | `mfa_bloqueia_excecao_aal1()`                                                                        |
| Superfície operacional (`013`, `015`)              | cinco RPCs, papel dedicado com grants por coluna, elegível em AAL1 sem MFA ou AAL2                   |
| Interface operacional                              | camada de dados em `src/lib/operacional/`, papel e guards por rota, tela `/operacional`              |
| Guard role-aware                                   | uma só decisão de acesso, em `lerAcesso()`                                                           |
| Acesso direto restrito (`016`)                     | tabelas de negócio exigem `aal2` **e** `admin` pelo PostgREST                                        |
| Administração de usuários (`017`)                  | backend server-side, `admin_audit_log`, último admin protegido                                       |
| Telas `/usuarios` e `/configuracoes`               | gestão de usuários e papéis; ativação/desativação de MFA conforme o papel                            |
| Hardening de grants de `admin_audit_log` (`018`)   | menor privilégio na tabela de auditoria                                                              |
| Baseline e CI                                      | Next.js atualizado, testes estruturais alinhados, CI no GitHub Actions                               |
| Cabeçalhos e CSP                                   | CSP com nonce em enforcement, fontes auto-hospedadas, contraste do login                             |
| Dependências                                       | `npm audit` zerado                                                                                   |

## Etapa atual — matriz E2E

**Objetivo:** provar de ponta a ponta, com contas reais, a política de acesso por
papel antes de existir o primeiro usuário `operacional`.

A matriz aprovada cobre:

- `admin` em AAL1 bloqueado · `admin` em AAL2 liberado;
- `operacional` sem MFA em AAL1 · `operacional` com fator verificado em AAL1
  **bloqueado** · `operacional` com MFA em AAL2;
- conta sem papel · `admin` + `operacional`;
- operação atribuída · operação não atribuída · operação sem turno;
- apontamento · folha fechada;
- financeiro inacessível ao operador · rotas administrativas bloqueadas;
- convite · troca de papel · último admin · auditoria;
- recuperação de acesso — **incluindo a variante sem MFA**, cuja arquitetura
  (`decidirMfaNaRecuperacao` devolve `prosseguir` para `mfa-ausente`) existe, mas
  que ainda não foi exercitada com conta real;
- logout/login e MFA.

**Gate:** o primeiro usuário `operacional` real só é criado depois da matriz.

## Próximas etapas

1. Concluir a matriz E2E acima.
2. Criar o primeiro usuário `operacional` real, pelo fluxo de convite.
3. Acompanhar o uso real e priorizar os riscos abaixo conforme apareçam.

## Riscos e pendências abertos

Os riscos de segurança, com condição de fechamento, estão em
[docs/SEGURANCA.md](docs/SEGURANCA.md) (seção "Riscos residuais"): proveniência
da taxa faturada, paridade manual `calcEntry()` × SQL, `TRUNCATE` de
`service_role` em `profiles` e `user_roles`, grants herdados, ausência de FK para
`auth.users`, e outros.

### C02 — revogação de identidade (implementado localmente, NÃO aplicado)

Migration `20261018120000_020_revogacao_de_identidade.sql` e suíte
`supabase/tests/015_revogacao_de_identidade.sql`, na branch
`fix/security-c02-auth-revocation` (base `d06b849`). Nada foi aplicado a banco
algum; as suítes só passaram por análise estática. Pendente:

- **Aplicar e testar na homologação isolada**, primeiro em `ROLLBACK`, depois a
  migration, comparando impressão digital do catálogo antes e depois.
- **Pré-condição das suítes `013` e `015` (bloco F):** assumem **nenhum admin fora
  da fixture**. A homologação tem o U1; a `015` pula o bloco F nesse caso, mas a
  `013` (`B_setup`, `B2`) **falharia** e mexeria transitoriamente no papel do U1.
  Rodar em banco limpo ou decidir antes.
- **Suítes `002`, `005`–`007` e `009`–`013` foram adaptadas** (contas reais em
  `auth.users`, `auth.sessions` e `session_id` em cada claim). Nenhuma expectativa
  foi alterada, mas **nenhuma foi executada** depois da adaptação.
- **Medido na L2-C02-C2 (versão anterior da 020) e corrigido na L2-C02-C3A:**
  1. `session_id` inválido dava `22P02` (a chave do índice é avaliada antes do
     `CASE`). A helper virou PL/pgSQL, com o cast depois do `IF`.
  2. Regressão de ~20x em leituras sob RLS (count de `timesheet_entries`, 12,4 mil
     linhas: 101 ms -> 2.002 ms), porque 25 policies chamavam `has_role()`/`is_staff()`
     **por linha**. Viraram `(SELECT ...)` (InitPlan, uma avaliação por comando);
     isolada, essa troca levou o count a ~1,4 ms. Equivalência coberta pelo bloco H
     da `015` (matriz identidade x tabela x operação).
  3. JWT revogado ainda lia/editava a própria linha de `profiles` e lia o próprio
     papel em `user_roles`. As 4 policies de linha própria agora exigem
     `identidade_atual_utilizavel()` (bloco I da `015`).
- **Estado da correção:** tudo isso **só foi revisado estaticamente**. Nenhum SQL com
  escrita rodou, a `020` corrigida **não foi aplicada em lugar nenhum** e a `015`
  ampliada **nunca foi executada**. A instância `bs-c02-hml-132969` tem a `020`
  ANTIGA aplicada: não reaplicar a corrigida nela.
- **Próximo passo (C3B): validar a `020` corrigida em instância NOVA, do zero**, a
  partir das 24 migrations da `main`, sem reaproveitar volume nem a instância
  anterior: baseline das 13 suítes, `020`, as 14 adaptadas (incl. a `015`
  ampliada), T1-T5 com JWTs reais, e remedir (`count` de `timesheet_entries`, soma
  por período, `count` de `profiles` e `employees`, busca por id, `has_role`/`is_staff`
  por linha, RPCs operacionais) com `EXPLAIN (ANALYZE, BUFFERS)` antes/depois. Os
  números da C2 são de amostra sintética (12,4 mil apontamentos, um container, sem
  concorrência): servem para comparar versões, não para prever Production.
- **Papéis e profiles órfãos:** a `020` os faz **negar**, mas não os remove, e a
  tela de usuários não os mostra. Limpeza controlada e visibilidade na tela são
  pendência do C02 (trigger `AFTER DELETE` em `auth.users` **não** foi
  implementado de propósito).
- **Antes de aplicar em Production:** inventário somente leitura de admins
  banidos com papel e papéis órfãos, e conferência de
  `has_table_privilege('postgres','auth.sessions','SELECT')`.
- **Integração com a feature:** a feature tem a migration `019` e a suíte `014`;
  a `020` e a `015` foram numeradas depois delas e não dependem de nada do
  fechamento.

Outros itens, de menor gravidade:

- **Diagnóstico P3 no banco** — `sincronizar_chave_da_diaria` pode devolver
  `23503` "Folha não encontrada" numa tentativa em AAL1, porque o trigger é
  `SECURITY INVOKER` e lê `timesheets`, que a policy esconde. A operação
  continua bloqueada: é problema de mensagem, não de acesso.
- **Incidente de recuperação não reproduzido** — uma falha posterior ao
  `verifyOtp` redirecionou uma vez para `link-invalido` e a causa não foi
  comprovada. Não é bug aberto. Se voltar, o caminho é reinstrumentar o fluxo,
  não adivinhar.
- **Banco de Production com poucos dados** — "AAL1 leu 0 linhas" num banco vazio
  não distingue bloqueio de ausência de dado; testes em Production provam menos
  do que parecem. Os testes SQL locais é que medem as proteções.

## Decisões que não se reabrem

- **Não** reconstruir o Supabase, nem reaplicar migration já aplicada, nem editar
  uma aplicada. Mudança de banco exige migration nova.
- **Não** reintroduzir TanStack Start/Router, Vite, Nitro, Vinxi, Wrangler ou
  Lovable.
- **Não** afrouxar as proteções financeiras das migrations `010`/`011`.
- **Não** adicionar enforcement de AAL2 em `user_roles`, e **não** remover a
  policy AAL2 global sem substituição segura.
- **Não** abrir a superfície do operador: nenhuma coluna financeira, `client_id`,
  documento ou telefone no retorno das RPCs; nenhum campo novo no JSON de escrita
  sem decisão de produto; nenhuma RPC de exclusão; nenhum `EXECUTE` dos helpers
  para `authenticated`.
- **Não** transformar o frontend em autoridade de segurança.
- **Não** reabrir a hipótese de incompatibilidade PKCE na recuperação: foi
  refutada pelo código-fonte do GoTrue.
- **Não** mudar sem entender as quatro linhas `if (…) return
falharDepoisDeVerificar()` da Server Action de recuperação.
- Decisões de produto congeladas da interface operacional: fonte de dados por
  papel, tela operacional separada, fechar e reabrir folha só pelo admin, nenhum
  fallback para operação sem turno, `admin` + `operacional` tratado como admin e
  tipos gerados do banco conferidos antes de sobrescrever.
- **Não** tocar no site institucional, **não** ativar signup público, **não**
  usar `supabase config push`, **não** modificar DNS sem confirmação.

## Como retomar

1. Leia o [CLAUDE.md](CLAUDE.md).
2. Leia este arquivo e, antes de qualquer mudança de autorização, a seção
   "Superfície operacional" e "RLS e banco" de [docs/SEGURANCA.md](docs/SEGURANCA.md).
3. Confira `git status` e o `HEAD`.
4. Não reaudite o projeto inteiro sem necessidade.
5. Se o estado real divergir do que está escrito, **pare e reporte**.
