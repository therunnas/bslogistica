# Instruções para agentes — BS Soluções Logística

Subconjunto essencial e permanente das regras do projeto. A versão completa, para
Claude Code, é o [CLAUDE.md](CLAUDE.md); as regras compartilhadas **não podem se
contradizer**. Detalhes em [README](README.md) ·
[Arquitetura](docs/ARQUITETURA.md) · [Segurança](docs/SEGURANCA.md) ·
[Estado do projeto](docs/ESTADO_DO_PROJETO.md) · [Progresso](PROGRESS.md).

## Projeto

Painel interno de gestão de mão de obra terceirizada, em
`admin.bslogisticas.com.br`. O site institucional (`bslogisticas.com.br`) é
**outro repositório e outro projeto: nunca tocar nele.**

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
Supabase com `@supabase/ssr` · TanStack Query · npm · Vercel. Node ≥ 22.6.

**Não reintroduzir** TanStack Start, TanStack Router, Vite, Nitro, Vinxi, Wrangler
ou Lovable. `@tanstack/react-query` **permanece**. É `proxy.ts`, nunca
`middleware.ts` (no Next.js 16 o segundo é ignorado em silêncio).

## Segurança

- **A RLS é a proteção real dos dados.** O guard do layout governa o que a
  interface mostra; nunca o trate como substituto das policies.
- **`service_role` nunca vai para o cliente.** Nenhuma variável `NEXT_PUBLIC_*`
  pode conter segredo. Operação administrativa privilegiada é server-side.
- **Sem cadastro público**, sem bootstrap automático de admin. Papel é atribuição
  administrativa explícita. O último admin é protegido, e alterações de usuário e
  papel são auditadas.
- **MFA TOTP é opcional para `admin` e `operacional`** (AUTH-01B), mas quem o ativou
  não acessa dados sem concluir o TOTP, e as operações críticas exigem AAL2 de
  fato (`exigirAdminAal2`, `condicoes_exigir_admin()`). A decisão de acesso é uma
  só (`lerAcesso()`); não a recriar em outro lugar.
- **O MFA também é exigido no banco**, por classe (migration 032: cotidiano aceita
  `mfa_cotidiano_ok()`; escrita financeira, auditoria e identidade seguem `aal2`
  literal), e acesso direto exige também `admin`. `user_roles` fica
  fora de propósito — não adicionar AAL2 nela. Não remover a policy global sem
  substituição segura.
- **`operacional` só alcança dados pelas cinco RPCs operacionais**, que revalidam
  papel, nível de MFA e atribuição por dentro, sempre sobre `auth.uid()`, nunca
  sobre um `user_id` recebido. Nenhum valor financeiro atravessa essa superfície.
  Não ampliar grants, não trocar grant de coluna por grant de tabela, não trocar
  o dono das funções.
- **A CSP está em enforcement** (`src/proxy.ts`); não a afrouxar. Ver
  [Segurança](docs/SEGURANCA.md).
- **Função `SECURITY DEFINER` roda acima da RLS**: a verificação de papel e de
  `aal2` precisa estar dentro da função.
- **Falha ao consultar o estado de MFA não é ausência de fator.** Nunca mandar
  para o cadastro de fator por causa de um erro transitório.
- **Token de recuperação de senha não se consome em GET.** O GET só confere
  formato e tipo; quem chama `verifyOtp` é a Server Action, disparada por um
  clique. A recuperação de conta com MFA exige **um** TOTP, não dois.

## Migrations e banco

- **Nunca editar migration já aplicada**, nem para corrigir. Criar nova com
  `supabase migration new <nome>`. O estado de Production está em
  [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).
- **Não alterar RLS, policies, grants ou triggers** fora de tarefa com esse escopo
  explícito.
- **Nunca `supabase config push`**: apagaria a configuração real de Auth. Nunca
  `TRUNCATE` nem `DELETE` sem `WHERE`.
- O `postgres` do Supabase **não é superusuário**; o do harness local é. Teste de
  privilégio local não prova nada sobre Production.
- `supabase db query` executa só a primeira linha se o SQL for inline: usar
  `-f <arquivo>`. Prefixar comandos do CLI com `env -u SUPABASE_ACCESS_TOKEN`.

## Regras financeiras

- **O valor financeiro nasce no banco, não no payload.** `billed_amount`,
  `cost_amount` e os snapshots são derivados por trigger. Não reintroduzir cálculo
  no cliente como autoridade: `src/lib/billing.ts` só prevê o número na interface.
- **Linha faturada é imutável** e o lastro não se destrói. O vínculo de fatura só
  nasce em execução como `postgres` (`gerar_fatura`).
- **Não alterar regras financeiras** (diária, hora extra, custo, faturamento) fora
  de tarefa com esse escopo explícito.

## Limites de escopo

- Não tocar em nada fora da tarefa pedida. Se a premissa não bater com o
  repositório, **parar e reportar**.
- Não inventar configuração de terceiro (DNS, provedor de e-mail).
- Não criar usuário `operacional` real antes da matriz E2E de
  [PROGRESS.md](PROGRESS.md).
- Não commitar, fazer push, abrir PR ou fazer merge sem aval explícito. Nunca
  `force push`, nunca alterar `main` diretamente.

## Validação obrigatória

```bash
npm run lint
npx tsc --noEmit
npm run test:<nome>   # todas as suítes test:* do package.json
npm run build
```

Várias suítes asseveram a **forma literal** do código. Erro de Prettier se corrige
à mão, não com `--fix`.
