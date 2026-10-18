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

**Gate:** o primeiro usuário `operacional` definitivo (do cliente) só é criado depois
da matriz.

**Situação do perfil operacional:**

- **Homologação do perfil (feita):** uma conta existente, que era admin, teve o papel
  de admin revogado e o `operacional` atribuído pela administração de usuários. Com
  ela, `/operacional` e a interface de apontamentos abriram, e o acesso direto a
  `/dashboard` foi barrado com redirecionamento para `/operacional`. Valida a
  navegação por perfil; **não** cria conta definitiva e **não** testa o fluxo de
  convite de operadores.
- **Criação por convite:** não exercitada nessa operação; segue na matriz E2E.
- **Contas definitivas do cliente:** preparação futura, depois da matriz.
- **Dados fictícios:** limpeza controlada antes da entrega, ainda pendente.
- A matriz E2E **não** está concluída.

## Próximas etapas

1. Concluir a matriz E2E acima.
2. Criar as contas `operacional` definitivas, pelo fluxo de convite, e limpar os
   dados fictícios antes da entrega.
3. Acompanhar o uso real e priorizar os riscos abaixo conforme apareçam.
4. Auditoria de segurança: **C03** é a próxima prioridade (não iniciada).

## Riscos e pendências abertos

Os riscos de segurança, com condição de fechamento, estão em
[docs/SEGURANCA.md](docs/SEGURANCA.md) (seção "Riscos residuais"): proveniência
da taxa faturada, paridade manual `calcEntry()` × SQL, `TRUNCATE` de
`service_role` em `profiles` e `user_roles`, grants herdados, ausência de FK para
`auth.users`, e outros.

### Auditoria de segurança — andamento

Inventário original preservado: **21 frentes** (P0: 0 · P1: 7 · P2: 13 · P3: 1).
Concluídas em Production: **2** (C01, C02). Restantes: **19**. Próxima prioridade
de tratamento: **C03** (não iniciada). A severidade original não foi alterada.

### C02 — revogação de identidade e sessões (P1) — CONCLUÍDA EM PRODUCTION

- **Data:** 18/10/2026. **PR:** #65. **Merge commit:**
  `37bd0a9ded7de97ec3965a6a1bd17361c1f500ae`. **Migration:**
  `20261018120000_020_revogacao_de_identidade.sql`, aplicada por `supabase db push`
  (código 0) no projeto `ehkduqokntemtmqzdrbd`; 25 migrations registradas; a `019`
  **não** foi aplicada.
- **Resultado técnico:** `has_role()` e `is_staff()` só autorizam identidade
  utilizável (conta existente, não banida, sessão do JWT viva em `auth.sessions`);
  29 policies atualizadas; trigger do último admin conta só admins utilizáveis;
  privilégios previstos preservados. Modelo em [docs/SEGURANCA.md](docs/SEGURANCA.md).
- **Validação:** homologação local em instância isolada (14 suítes SQL, 1.235
  asserções, JWT/MFA/revogação com tokens reais); 15 verificações SQL de catálogo em
  Production; login de admin e tela `/operacional` funcionando; operador barrado no
  dashboard e levado a `/operacional`; deployment e checks da CI aprovados; sem erro
  identificado nos logs de Vercel, PostgreSQL e Auth **nas janelas que os planos
  atuais permitem consultar** (não é cobertura de todo o período desde a publicação).
- **O que NÃO foi feito em Production:** nenhum teste destrutivo. Banimento,
  exclusão e logout de contas reais **não** foram exercitados na publicação; esses
  comportamentos estão provados só na homologação local.
- **Recuperação:** `docs/runbooks/recuperacao-c02-020.md`. Reabre a C02; só com
  autorização expressa. Foi feito um backup técnico preventivo antes da `020`; ele
  **não** é backup integral restaurável comprovado.

#### Pendências relacionadas (não são regressões da C02)

- **Backup integral restaurável não comprovado** (plano Free).
- **Último admin:** banimento direto pela Auth Admin API não passa pelo trigger.
- **Registros órfãos** em `profiles` e `user_roles` (a `020` os faz negar, não os
  remove): exigem análise própria de retenção e limpeza controlada.
- **Revisão de segurança específica (Codex) não executada.**
- **Isolamento Preview/Production** ainda não completamente comprovado.
- **Observabilidade histórica incompleta**, limitada pelas janelas de log dos planos.
- **Custo do trigger do último admin em Production** não medido.
- **Migration `019`** (fechamento): fora da C02; exige reordenar o timestamp, adaptar
  a suíte `014` e resolver conflitos nas branches da feature.

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
