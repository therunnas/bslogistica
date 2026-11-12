-- Semente do E2E, SOMENTE no Supabase LOCAL descartável (scripts/e2e-local.sh confere o ambiente
-- antes). Não fica em supabase/tests/: o job sql-local não a executa.
--
-- Deixa o banco local no mesmo estado de configuração da Production (docs/AMBIENTES.md):
-- motor por vigência LIGADO, resolução de tarifas por função DESLIGADA, domingo e feriado em
-- dobro (051) LIGADO. Os dois usuários sintéticos são criados antes pela Admin API do Auth LOCAL;
-- aqui só recebem os papéis.
--
-- O motor é ligado pela RPC normal, como foi em Production: uma sessão sintética temporária do
-- admin local existe só durante esta transação e é apagada no fim. Os testes, depois, entram
-- pela tela de login com e-mail e senha, em sessões reais do Auth local.
--
-- Variáveis psql: admin_id, oper_id, sessao_id.

\set ON_ERROR_STOP on

begin;

insert into public.user_roles (user_id, role)
values (:'admin_id', 'admin'), (:'oper_id', 'operacional');

insert into auth.sessions (id, user_id, not_after) values (:'sessao_id', :'admin_id', null);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_id', 'role', 'authenticated', 'aal', 'aal1',
                    'session_id', :'sessao_id')::text,
  true);
set local role authenticated;
select public.alterar_motor_vigencia(true, 'E2E local: mesmo estado da Production');
reset role;

delete from auth.sessions where id = :'sessao_id';

-- Igual à ativação feita em Production (docs/runbooks/dias-especiais-em-dobro.md).
update public.pricing_settings
   set dias_especiais_em_dobro = true, changed_at = now(),
       reason = 'E2E local: mesmo estado da Production'
 where id;

do $$
begin
  if not public.motor_ativo() then
    raise exception 'semente E2E: o motor por vigência não ficou ligado';
  end if;
  if not public.dias_especiais_em_dobro_ativo() then
    raise exception 'semente E2E: domingo/feriado em dobro não ficou ligado';
  end if;
  if public.resolucao_de_tarifas_ativa() then
    raise exception 'semente E2E: a resolução de tarifas deveria estar desligada';
  end if;
  if (select count(*) from auth.sessions) <> 0 then
    raise exception 'semente E2E: sessão sintética não foi removida';
  end if;
end $$;

commit;
