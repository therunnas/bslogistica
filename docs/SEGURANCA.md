# Segurança

Estado verificado em 04/09/2026, projeto Supabase **BSLOG**
(`qaibhlucbpetxrtswulf`).

## Acesso ao sistema

**Cadastro público bloqueado.** `disable_signup = true` — confirmado por leitura
direta da API. Apenas contas existentes conseguem entrar; a criação passa
exclusivamente pelo administrador no painel do Supabase.

O frontend não oferece caminho de cadastro: a tela de login tem apenas e-mail e
senha.

| Papel                 | Acesso                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `admin`               | leitura e escrita em tudo                                         |
| `operacional`         | lê tudo; escreve operações, turnos, equipe, folhas e apontamentos |
| autenticado sem papel | nenhum dado de negócio                                            |
| não autenticado       | redirecionado ao login                                            |

Os quatro perfis foram testados: pela interface e simulando a sessão de cada um
diretamente no banco.

## Proteção no servidor

O layout de `(painel)` verifica a sessão **antes de enviar qualquer HTML**. Sem
sessão, a resposta é HTTP 307 para `/login` — verificado nas sete rotas
protegidas, e nenhuma vaza dado de negócio no corpo da resposta.

Isso substituiu o guard anterior, que rodava apenas depois do JavaScript
carregar no navegador.

## RLS

**A RLS é a camada real de proteção.** O guard governa o que a interface mostra;
se ele tivesse um defeito, as tabelas continuariam protegidas.

- 12 tabelas no schema `public`, **todas com RLS ativa e ao menos uma política**
- Um event trigger (`ensure_rls`) habilita RLS automaticamente em tabelas novas
- Três funções `SECURITY DEFINER` — `handle_bslog_auth_user_created`,
  `provision_bslog_user` e `rls_auto_enable` — com `EXECUTE` restrito a
  `postgres` e `service_role`
- O advisor de segurança do Supabase reporta um único achado, listado nas
  pendências

## Segredos

| Item                      | Estado                       |
| ------------------------- | ---------------------------- |
| `.env`                    | fora do Git, ignorado        |
| `.env.local`              | fora do Git, ignorado        |
| `.env.example`            | versionado, sem valores      |
| `service_role`            | **não usada pela aplicação** |
| Chaves reais no histórico | nenhuma                      |
| Segredos no bundle        | nenhum                       |

O bundle do navegador foi auditado: zero ocorrências de `service_role`,
`sb_secret_` com valor, JWT, ou vazamento de `next/headers` e do cliente de
servidor.

**Nenhuma variável `NEXT_PUBLIC_*` pode conter segredo** — o prefixo faz o Next
embutir o valor no JavaScript servido ao navegador. As duas em uso são públicas
por natureza; quem protege os dados é a RLS.

## Vercel

- Projeto do sistema: `bs-logistica-sistema`, sem domínio customizado
- **Preview protegida por Vercel Authentication**: exige login na Vercel, não é
  acessível publicamente
- Variáveis apenas nos ambientes onde são necessárias
- Sem as variáveis, o build **falha na pré-renderização** com mensagem nomeando
  o que falta — em vez de publicar uma aplicação quebrada
- O site institucional é outro projeto (`bs-logisticas`) e não deve ser tocado

## Dependências

`npm audit`: **0 vulnerabilidades**.

## Pendências abertas

Nenhuma bloqueia produção. Todas estão documentadas.

**Proteção contra senha vazada desligada** — o Supabase pode checar senhas
contra a base do HaveIBeenPwned. É o único achado do advisor de segurança.
Ativa-se no painel, em Authentication → Policies.

**Escrita permissiva em `operation_team`** — única tabela de cadastro cuja
escrita usa `is_staff()` em vez de `has_role(admin)`. Pode ser intencional, mas
a tabela não guarda autor nem histórico, então remanejamento de equipe não deixa
rastro. Ver [dívida técnica](divida-tecnica/escrita-em-operation-team.md).

**Falso sucesso em escrita bloqueada** — um `UPDATE` barrado pela RLS não
levanta erro, e a interface mostra "Registro salvo." sem ter salvo. Não é falha
de proteção — os dados ficam íntegros —, mas engana o usuário. Ver
[dívida técnica](divida-tecnica/falso-sucesso-em-update-bloqueado-por-rls.md).

**Migration `20260903205051` fora do histórico** — o efeito está aplicado no
banco (verificado na ACL da função), mas não consta no histórico remoto.
Reconciliar com `supabase migration repair`.

**Sem FK de `profiles` e `user_roles` para `auth.users`** — remover usuário pelo
painel não limpa essas tabelas e deixa registros órfãos. Ao remover uma conta,
apagar primeiro as linhas dessas duas tabelas.
