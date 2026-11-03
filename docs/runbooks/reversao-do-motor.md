# Reversão controlada do motor financeiro por vigência (RB-01)

Desliga o motor por vigência e devolve o cálculo ao motor antigo. **Só com autorização própria
do responsável**, em Production inclusive. Não apaga dado: troca a chave, quatro travas e dois
gatilhos, e sincroniza as colunas antigas com a versão vigente de hoje (função do banco).

## Quando usar

Falha comprovada depois de ligar o motor (cálculo errado, apontamento recusado indevidamente,
divergência inesperada). Não use para "testar": ligar e desligar grava trilha e troca preço.

## Caminho 1 (preferido): a própria tela

1. Autorização explícita do responsável para a janela de reversão.
2. Na Vercel do projeto, definir `BS_REVERSAO_MOTOR_HABILITADA=true` (server-only, nunca
   `NEXT_PUBLIC_*`) e publicar de novo. Sem a variável a tela mostra só o aviso e a Server Action
   recusa.
3. Entrar com a sessão real do próprio administrador: AAL1 se não houver fator
   verificado; com fator verificado, concluir TOTP no login e usar AAL2. Não há
   desafio adicional por operação. Ninguém digita senha ou código por outra pessoa.
4. `/implantacao-vigencias` → "Desligar motor" → motivo (mínimo 10 caracteres) → digitar
   `DESLIGAR MOTOR` → confirmar.
5. Conferir: a tela volta a mostrar "motor desligado", sem pendência de consistência.
6. **Remover** `BS_REVERSAO_MOTOR_HABILITADA` e publicar de novo (a trava volta a fechar).

A tela só desliga com o motor comprovadamente ligado e consistente; estado desconhecido,
inconsistente ou já desligado é recusado sem chamar o banco. Chamada duplicada recebe `55000`.

## Caminho 2: UI indisponível

Chamar a mesma RPC com **a sessão real do administrador com o piso de MFA da conta**, nunca com `service_role` e nunca
com claims simuladas:

```
select public.alterar_motor_vigencia(false, '<motivo registrado>');
```

Vale qualquer cliente que use o JWT real do administrador: AAL1 sem fator
verificado, ou AAL2 após TOTP no login com fator verificado. Sessão inválida,
MFA pendente ou ausência de papel admin continuam recusados. No SQL Editor do
Supabase a chamada roda como `postgres`, sem JWT, e o banco recusa (`42501`): isso é proposital.

## Verificação (leitura apenas)

- `select public.estado_motor_vigencia();` → `ativo = false`, `consistente = true`.
- Trilha: `financial_terms_audit` (colunas `occurred_at, actor_id, actor_session_id, action,
entity_kind, entity_id, previous, new, reason`), ação `motor_vigencia_desativado`, entidade
  `sistema`, com ator, sessão e motivo. Não é `admin_audit_log`, que registra ações sobre
  usuários.

## Último recurso: restauração do backup

Só se os caminhos 1 e 2 falharem. É destrutiva (sobrescreve dados posteriores ao backup) e não
cobre configuração de Auth, segredos da Vercel, Storage nem event triggers. Exige decisão
própria do responsável, o dump criptografado mais recente e ensaio prévio de restauração.

## Testes

`npm run test:reversao-motor` (Server Action e regras da tela, sem rede) e
`supabase/tests/031_reversao_do_motor.sql` (banco descartável: papéis, MFA, gatilhos, trilha,
duplicidade, ida e volta, dados intactos).

## Política vigente e contexto histórico

A redação original do RB-01 exigia AAL2 literal. A AUTH-01D.R1 (migration 034)
superou essa exigência por funcionalidade; a regra vigente está em
[Segurança](../SEGURANCA.md#segundo-fator-mfa). A ação usa `exigirAdminAtor()` e a
RPC revalida papel, sessão e `mfa_cotidiano_ok()`. Este ajuste documental não muda
a autenticação, as travas de execução nem autoriza uma reversão.

Para distinguir desligamento do motor de rollback de schema, consulte o
[índice e os limites dos runbooks](README.md).
