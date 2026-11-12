# QA-BS-01 · CP-01 — Autenticação e permissões

Evidência da auditoria do CP-01 (sessão 04, 12/11/2026, sessão em nuvem, Linux). Escopo: login,
recuperação de senha, MFA/TOTP, administração de usuários e a matriz de autorização. Tudo em
Supabase **local descartável**, com contas sintéticas `@exemplo.test`, TOTP real calculado no teste
(RFC 6238) e verificado pelo GoTrue local, e e-mail capturado no Mailpit local. Nenhum acesso a HML,
Preview ou Production.

Testes: `e2e/specs/40-autenticacao.spec.ts`, `e2e/specs/41-permissoes.spec.ts` (E2E) e
`scripts/testar-mensagens-auth.mjs` (`npm run test:mensagens-auth`, regressão de forma e de função).
Infraestrutura: `scripts/e2e-local.sh` (TOTP habilitado, cadastro desligado e Mailpit, só por
variáveis de ambiente do processo), `e2e/apoio/totp.ts`, `e2e/apoio/email.ts`, `e2e/apoio/contas.ts`.

## Defeitos

Cada um foi reproduzido no E2E com o código do HEAD `1b2ee20` (RED), corrigido e revalidado (GREEN).

| ID        | Sev. | Defeito (obtido antes)                                                                                                                                                                                                                                                                                                       | Correção                                                                                                                                                                                                                                                                    | Regressão                                   |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| D-CP01-01 | P2   | Login mostrava o texto cru do GoTrue: "Invalid login credentials" (senha errada e e-mail inexistente) e "User is banned" (conta revogada)                                                                                                                                                                                    | `src/lib/mensagens-de-login.ts`: texto único em português para credencial inválida e conta revogada (o GoTrue confere o banimento antes da senha; texto próprio revelaria contas revogadas); e-mail não confirmado, limite de tentativas e falha genérica com texto próprio | L2, L3, U6 (E2E); A1–A8                     |
| D-CP01-02 | P2   | Código TOTP errado mostrava "Invalid TOTP code entered" no desafio do `/mfa` e na ativação em Configurações                                                                                                                                                                                                                  | as duas telas usam `mensagemDeCodigoInvalido` (já usada na desativação)                                                                                                                                                                                                     | M1–M3, M4/M5 (E2E); B1–B4                   |
| D-CP01-03 | P2   | Duplo clique executava a ação administrativa duas vezes: "Enviar convite" mandou dois e-mails e gravou dois `convite_criado`; "Atribuir" gravou dois `operacao_atribuida`. O comentário do código afirmava que o React Query impedia isso — não impede: `mutate` reexecuta, e o `isPending` só chega depois do próximo ciclo | trava síncrona `src/app/(painel)/usuarios/_trava.ts` em todas as 7 mutations da tela (convite + 6 do diálogo), liberada no `onSettled`; os `disabled={isPending}` continuam                                                                                                 | U1, U5 (E2E, conferindo a auditoria); C1–C4 |
| D-CP01-04 | P2   | Duplo clique em "Continuar" na recuperação: o 1º envio consumia o token, o 2º encontrava o token gasto e levava o próprio usuário a "link inválido"                                                                                                                                                                          | `botao-confirmar.tsx`: botão de envio único (trava por `ref` no clique + `useFormStatus`); a página continua Server Component postando para a mesma Server Action; o token continua só no cookie httpOnly                                                                   | R12 (E2E); E1–E4                            |
| D-CP01-05 | P3   | Convite para e-mail já cadastrado mostrava "A user with this email address has already been registered"                                                                                                                                                                                                                      | `mensagemDeFalhaDoConvite` em `servico.ts`: e-mail existente e limite de envio com texto próprio; outro erro do provedor vira o genérico; erro do próprio módulo (já em português) é preservado                                                                             | U1/U2 (E2E); D1–D5                          |
| D-CP01-06 | P3   | Botões só de ícone sem nome acessível (engrenagem "gerenciar" na lista e lixeira "remover operação"), inalcançáveis por leitor de tela e por nome                                                                                                                                                                            | `aria-label` e `title` nos dois                                                                                                                                                                                                                                             | U5 (E2E localiza pelo nome); F1–F2          |

Nenhum defeito exigiu mudança de SQL, RLS, policy, grant, migration ou regra financeira. MFA continua
opcional; nenhum guard foi afrouxado.

## Matriz de ações

Legenda: **PASS** conferido · **CORRIGIDO** defeito reproduzido, corrigido e revalidado ·
**NÃO TESTADO** com motivo. Nenhuma ação ficou **FAIL** nem **BLOQUEADO**.

### Login

| ID  | Ação                                          | Esperado                                     | Obtido                                                                 | Status                                                                                                                              |
| --- | --------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Enviar com campos vazios                      | não envia; campo obrigatório                 | `valueMissing` em e-mail e senha, fica em `/login`                     | PASS                                                                                                                                |
| L2  | Senha errada                                  | texto em português, sem texto do provedor    | antes: "Invalid login credentials"; depois: texto único em português   | CORRIGIDO (D-CP01-01)                                                                                                               |
| L3  | E-mail inexistente                            | mesmo texto da senha errada                  | idem                                                                   | CORRIGIDO (D-CP01-01)                                                                                                               |
| L4  | Estado de carregamento                        | botão "Aguarde..." desabilitado              | conferido com atraso de 1,5 s no Auth                                  | PASS                                                                                                                                |
| L5  | Credenciais corretas                          | painel                                       | `/dashboard` (admin), `/operacional` (operacional)                     | PASS                                                                                                                                |
| L6  | Abrir `/login` já logado                      | volta ao painel                              | `/dashboard`                                                           | PASS                                                                                                                                |
| L7  | Sair pelo menu da conta                       | sessão encerrada no servidor                 | `/login`; cookies anteriores ao logout reaproveitados caem em `/login` | PASS                                                                                                                                |
| L8  | Rotas sem cookie                              | `/login`                                     | `/dashboard`, `/usuarios`, `/operacional`, `/configuracoes` → `/login` | PASS                                                                                                                                |
| L9  | Conta revogada tenta entrar                   | recusa em português, sem revelar a revogação | antes: "User is banned"; depois: o texto único                         | CORRIGIDO (D-CP01-01)                                                                                                               |
| L10 | Expiração natural do JWT (1 h)                | `/login` ou renovação                        | —                                                                      | NÃO TESTADO: exigiria esperar 1 h. Cobertos: sessão encerrada no servidor (L7, R10, U6) e JWT ainda válido recusado pelo banco (P4) |
| L11 | Renovação da sessão pelo `proxy.ts` (refresh) | sessão renovada                              | —                                                                      | NÃO TESTADO de forma isolada (exercitado indiretamente em toda navegação longa da suíte)                                            |

### Recuperação de senha

| ID  | Ação                                           | Esperado                            | Obtido                                                                                            | Status                                                                                        |
| --- | ---------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1  | Solicitar para conta existente                 | mensagem neutra; e-mail com link    | mensagem neutra; e-mail capturado com `token_hash`                                                | PASS                                                                                          |
| R2  | Solicitar para e-mail desconhecido             | mesma mensagem; nenhum e-mail       | idem; 0 mensagens                                                                                 | PASS                                                                                          |
| R3  | Abrir o link e clicar "Continuar"              | tela de nova senha                  | `/auth/confirmar-recuperacao` → `/redefinir-senha`                                                | PASS                                                                                          |
| R4  | GET automático de scanner                      | não consome o token                 | 303 `no-store`, sem token no `Location`; o clique depois funciona                                 | PASS                                                                                          |
| R5  | Senha vazia / diferentes / fraca / só espaços  | não salva; mensagem                 | obrigatório; "As duas senhas precisam ser iguais."; texto de senha fraca (também para só espaços) | PASS                                                                                          |
| R6  | Salvar nova senha                              | login com a nova; antiga recusada   | `/login?senha-redefinida=1` com aviso; nova entra; antiga recusada em português                   | PASS                                                                                          |
| R7  | Reusar o link                                  | link inválido                       | `/esqueci-senha?status=link-invalido`                                                             | PASS                                                                                          |
| R8  | Token inválido; `type` diferente de `recovery` | link inválido                       | idem                                                                                              | PASS                                                                                          |
| R9  | Abrir a confirmação sem cookie                 | link inválido, sem botão            | idem                                                                                              | PASS                                                                                          |
| R10 | Sessão aberta antes da troca                   | perde o acesso                      | `/login`                                                                                          | PASS                                                                                          |
| R11 | `/redefinir-senha` sem prova                   | sem formulário                      | sem formulário                                                                                    | PASS                                                                                          |
| R12 | Duplo clique em "Continuar"                    | uma confirmação; tela de nova senha | antes: "link inválido"; depois: `/redefinir-senha`                                                | CORRIGIDO (D-CP01-04)                                                                         |
| R13 | Link expirado por tempo                        | link inválido                       | —                                                                                                 | NÃO TESTADO: validade de 1 h do GoTrue local (o comportamento do token gasto é o mesmo de R7) |

### MFA/TOTP (conta admin2)

| ID  | Ação                                            | Esperado                                 | Obtido                                                                                                                     | Status                |
| --- | ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| M1  | Iniciar cadastro e cancelar                     | nada ativo                               | 0 fator verificado                                                                                                         | PASS                  |
| M2  | Código errado no cadastro                       | recusa em português                      | antes: "Invalid TOTP code entered"; depois: "Código inválido…"; 0 fator                                                    | CORRIGIDO (D-CP01-02) |
| M3  | Código real no cadastro                         | fator ativo                              | "Verificação em duas etapas ativada."; 1 fator `verified` no banco                                                         | PASS                  |
| M4  | Login com fator                                 | `/mfa`; painel barrado em AAL1           | `/mfa`; `/dashboard` e `/usuarios` → `/mfa`; API Route 403; tabela de negócio 0 linha; `user_roles` legível (sem deadlock) | PASS                  |
| M5  | Desafio: código errado, depois real             | recusa em português; depois painel       | antes: texto cru; depois: "Código inválido…"; código real → `/dashboard`, API liberada                                     | CORRIGIDO (D-CP01-02) |
| M6  | "Sair" na tela do segundo fator                 | sessão encerrada                         | `/login`; `/mfa` → `/login`                                                                                                | PASS                  |
| M7  | Recuperação com MFA                             | exatamente um TOTP; painel sem 2º código | TOTP errado recusado; código real → nova senha → `/dashboard` sem novo pedido                                              | PASS                  |
| M8  | Desativar: código errado, Cancelar, código real | só o código real remove                  | errado e Cancelar mantêm 1 fator; real remove (0); login volta a ser só senha                                              | PASS                  |
| M9  | Conta sem fator                                 | entra só com senha (MFA opcional)        | `/dashboard` em AAL1                                                                                                       | PASS                  |

### Usuários (tela `/usuarios`, admin)

| ID  | Ação                                            | Esperado                                                                                       | Obtido                                                                                                                                          | Status                           |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| U1  | Convidar (duplo clique)                         | 1 convite, 1 e-mail, papel, auditoria, na lista                                                | antes: 2 e-mails e 2 auditorias; depois: 1 e 1; papel `operacional`; na lista                                                                   | CORRIGIDO (D-CP01-03)            |
| U2  | Convite com e-mail inválido / já cadastrado     | recusa em português; nada muda                                                                 | inválido: texto em português; já cadastrado: antes texto cru, depois texto próprio; papel da conta existente intacto                            | CORRIGIDO (D-CP01-05)            |
| U3  | Aceitar convite                                 | define senha pela recuperação e entra com o papel                                              | `/operacional`                                                                                                                                  | PASS                             |
| U4  | Conceder/revogar papel; Cancelar; último admin  | lista e banco atualizados; último admin protegido                                              | conceder e revogar refletidos; Cancelar não muda; revogar papel e revogar acesso do único admin recusados com aviso                             | PASS                             |
| U4b | Mudança de papel com a sessão do usuário aberta | vale na próxima requisição                                                                     | concedido: abre `/usuarios`; revogado: "Área administrativa restrita"                                                                           | PASS                             |
| U5  | Atribuir (duplo clique) e remover operação      | uma execução; o operador vê e deixa de ver                                                     | antes: 2 auditorias e lixeira sem nome; depois: 1; visível e removida na tela do operador                                                       | CORRIGIDO (D-CP01-03, D-CP01-06) |
| U6  | Revogar acesso (Cancelar, confirmar) e reativar | papéis e operações removidos; sessão aberta e login barrados; reativação sem operações antigas | Cancelar mantém; badge "Acesso revogado"; 0 papel, 0 operação; sessão aberta sai; login recusado (texto corrigido); reativar devolve só o papel | PASS (mensagem: D-CP01-01)       |

### Matriz de autorização (`41-permissoes.spec.ts`)

Cada célula chama o servidor diretamente, sem depender de botão escondido.

| Camada                                                                       | ADMIN                                              | OPERACIONAL                                                                                                          | SEM PAPEL                      | NÃO AUTENTICADO | REVOGADO (cookies e JWT de antes da revogação) |
| ---------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------- | ---------------------------------------------- |
| Tela por URL (8 telas admin, `/dashboard`, `/configuracoes`, `/operacional`) | abre; `/operacional` → "Área operacional restrita" | telas admin → "Área administrativa restrita"; `/dashboard` → `/operacional`; `/configuracoes` e `/operacional` abrem | "Acesso não liberado" em todas | `/login`        | `/login`                                       |
| API Routes (fechamento GET, xlsx, xlsx-cliente, municípios)                  | não barrado (400 de validação, sem rede externa)   | 403                                                                                                                  | 403                            | 401             | 401                                            |
| Server Action `listarUsuarios` reenviada com os cookies do papel             | devolve a lista (controle positivo)                | sem lista                                                                                                            | sem lista                      | sem lista       | sem lista                                      |
| PostgREST direto (`clients`)                                                 | lê                                                 | 0 linha                                                                                                              | 0 linha                        | 0 linha         | 0 linha                                        |
| RPC do operador                                                              | recusada                                           | aceita                                                                                                               | recusada                       | recusada        | recusada                                       |
| `user_roles`                                                                 | —                                                  | —                                                                                                                    | vazio                          | —               | vazio (sessão revogada não lê)                 |

Resultado: PASS em todas as células (14 casos E2E).

## Limitações do ambiente local (não são defeitos do app)

- No `next start` local, `request.nextUrl` sai como `http://localhost:3000` qualquer que seja o Host,
  e `/auth/confirm` redireciona para `localhost`. O E2E abre o link já em `localhost` para o cookie
  pendente acompanhar o salto. Na Vercel o `nextUrl` é o domínio real; confirmar no Preview.
- O modelo de e-mail local é o padrão do CLI (`/auth/v1/verify`); o E2E extrai o `token_hash` e abre
  a rota do modelo da Production (`/auth/confirm`). Entrega real por SMTP não exercitada.
- O `APIRequestContext` do Playwright não envia cookie `Secure` por http; as chamadas diretas montam
  o cabeçalho `Cookie` a partir dos cookies do contexto (`requisitarComo`).

## Riscos residuais e pendências

- O GoTrue responde `user_banned` antes de conferir a senha: pela **API do Auth** (fora do app) dá
  para saber se um e-mail pertence a uma conta revogada. A tela não revela mais isso (D-CP01-01).
  Mitigação exige configuração do provedor; registrar para decisão.
- `toast.error(erroUnenroll.message)` (falha do `unenroll` depois de código válido) e as falhas de
  leitura de fatores no `/mfa` continuam mostrando o texto do SDK. É decisão documentada nas suítes
  (`testar-configuracoes` F9, `testar-mfa-opcional` C6: "mostra o erro do Supabase (AAL2 exigido) sem
  esconder") e não foi reproduzida pela tela; fica para revisão no CP-09.
- L10, L11 e R13 não testados (motivos na tabela).
