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

## Fechamento quinzenal (V1) — pronto na branch, fora de Production

Conferência financeira por cliente e período (`/fechamento`), com exportação
XLSX (principal) e CSV (secundária). Vive em `feat/fechamento-quinzenal` e
**ainda não foi mesclado nem publicado**: nada disto está em Production.

| Etapa | Entrega                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------- |
| 4.1   | leitura paginada, provada completa, sob RLS                                                           |
| 4.2   | domínio financeiro (centavos inteiros, margem em milésimos), sem recalcular regra contratual          |
| 4.3   | paridade SQL com `gerar_fatura` (`014_paridade_fechamento.sql`), carregamento e `GET /api/fechamento` |
| 4.4   | tela `/fechamento`: filtros, resumo, alertas, tabela por colaborador, detalhamento diário             |
| 4.5   | `POST /api/fechamento/xlsx`, CSV (por colaborador e diário), assinatura de frescor e HTTP 409         |
| 4.6.1 | testes do fechamento na CI e `next typegen` antes do `tsc`                                            |
| 4.6.2 | assinatura `v2` cobre os textos exibidos; corpo do POST lido com limite efetivo                       |
| 4.6.5 | isolamento entre ambientes: Sentry só em Production, CSP por ambiente, gate do Supabase               |

Estrutura e segurança: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e
[docs/SEGURANCA.md](docs/SEGURANCA.md) ("Fechamento e exportação").

**Validado:** as 17 suítes Node, as 14 suítes SQL, o E2E do endpoint contra um
Supabase **local** descartável (sem sessão 401, operacional 403, admin em AAL1
403, admin em AAL2 200, filtros inválidos 400, cliente inexistente 404,
assinatura antiga 409 e depois 200) e a conferência manual no Excel pt-BR
(abertura sem reparação, abas, autofiltro, congelamento, valores).

**Pendente — só no Preview** (nada disto se prova localmente):

- clique real em "Baixar Excel (.xlsx)" e em "Baixar CSV" na tela;
- feedback visual (toast e atualização) depois de um HTTP 409;
- permissões com contas reais no ambiente de Preview;
- cabeçalhos da resposta na Vercel (`Content-Type`, `Content-Disposition`,
  `Cache-Control: no-store`, CSP);
- limite de 4.000.000 bytes e a resposta 413: **não foi exercitado** (12.400
  lançamentos geraram ~650 KB; o teto equivale a ~76 mil);
- integridade do arquivo baixado pelo navegador;
- a CI remota no GitHub (o workflow foi só conferido por leitura e por
  simulação local numa cópia limpa).

**Gates antes de enviar a branch ao GitHub** (o push pode disparar um Preview
sozinho; nada abaixo foi verificado, e a ausência de evidência não é aprovação):

1. qual é o projeto Vercel do `admin.bslogisticas.com.br` e a conta ou equipe dona
   dele (a CLI consultada só enxergou dois outros projetos);
2. se este repositório está vinculado a esse projeto;
3. quais variáveis existem no escopo Preview e se alguma é de Production — o
   PR #62 recebeu um Preview que terminou com sucesso, o que indica que o Preview
   tem as variáveis `NEXT_PUBLIC_SUPABASE_*`;
4. se há deploy automático no push de branches;
5. se `SENTRY_AUTH_TOKEN` existe no escopo Preview (o código já não depende
   disso, mas a variável não deveria estar lá);
6. se existe um projeto Supabase de teste para o Preview. Sem ele, o Preview
   falha de forma controlada no build — esse é o comportamento esperado;
7. que o Preview falha de forma segura quando o isolamento não está configurado
   (o gate cobre o build e o runtime, mas só a Vercel real prova).

**Fluxo de implantação:** revisão final e commit na branch → PR para `main` →
CI verde → Preview (sem banco de produção) → merge → deploy a partir de `main`.
Não há migration nova neste conjunto.

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
   (Em paralelo, o fechamento quinzenal aguarda revisão final, PR e Preview.)
2. Criar o primeiro usuário `operacional` real, pelo fluxo de convite.
3. Acompanhar o uso real e priorizar os riscos abaixo conforme apareçam.

## Riscos e pendências abertos

Os riscos de segurança, com condição de fechamento, estão em
[docs/SEGURANCA.md](docs/SEGURANCA.md) (seção "Riscos residuais"): proveniência
da taxa faturada, paridade manual `calcEntry()` × SQL, `TRUNCATE` de
`service_role` em `profiles` e `user_roles`, grants herdados, ausência de FK para
`auth.users`, e outros.

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
