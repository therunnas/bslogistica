-- GATE-FIN-05. Origem: schema 054. Destino: 053 quanto ao COMPORTAMENTO (contratos v2, gatilho de
-- versão, confirmação de virada). Os DADOS da 054 ficam.
--
-- O QUE FAZ:
--   - remove as cinco funções públicas da 054 (admin v2, operador v2 e listagem v2, confirmação e
--     situação da virada) e as internas de versão, invalidação e classificação;
--   - remove os gatilhos `trg_timesheet_entries_zz_versao` e `trg_timesheet_entries_zz_invalida_virada`;
--   - devolve o papel do operador ao inventário da 053 (sem SELECT(versao)).
--
-- O QUE PRESERVA (de propósito):
--   - a coluna `timesheet_entries.versao`, com os valores atuais (deixa de subir sozinha; reaplicar
--     a 054 retoma a partir deles, sem voltar atrás);
--   - a trilha `apontamento_confirmacoes_virada` inteira, com a RLS, a política de leitura do admin e
--     o gatilho que a protege contra alteração e exclusão;
--   - valores, snapshots, faturas, RPCs v1, regra da 053 e o motor: nada disso é tocado.
--
-- HISTÓRICO DE MIGRATIONS: este rollback NÃO apaga o registro da 054 em
-- `supabase_migrations.schema_migrations`. O histórico aplicado é preservado; a reversão é registrada
-- como operação distinta (data, ambiente, autorização, motivo e o resultado da verificação abaixo) no
-- HANDOFF e no ESTADO_DO_PROJETO. Reaplicar = executar a 054 de novo, com autorização (ela recria as
-- funções e os gatilhos e não recria a coluna nem a trilha, que já existem).
--
-- PRÉ-CONDIÇÕES (conferir antes, em ambiente remoto): nenhum aplicativo publicado chamando as
-- funções v2 (o app da 058 depende delas — reverter aqui exige reverter o app antes); o executor
-- consegue remover funções da `bslog_rpc_operacional` (o mesmo vínculo de papel que permitiu a troca
-- de dono na 013 e na 054).
--
-- RISCO: depois dele, os clientes que usam os contratos v2 passam a receber 42883 (função
-- inexistente); o legado (v1, escrita direta) continua funcionando como antes da 054. I1 e I7 seguem
-- RISCO como já estavam.
--
-- REVALIDAR DEPOIS: a suíte SQL 054 e a concorrência real passam a falhar, de propósito; as suítes
-- anteriores (até a 053 e a 090) continuam verdes.
begin;

drop function if exists public.salvar_apontamento_admin_v2(uuid, uuid, date, jsonb);
drop function if exists public.salvar_apontamento_operacional_v2(uuid, uuid, date, jsonb);
drop function if exists public.listar_apontamentos_do_operador_v2(uuid, uuid, date);
drop function if exists public.confirmar_virada_do_apontamento(uuid, bigint);
drop function if exists public.situacao_da_virada(uuid);
drop function if exists public.classificar_virada_do_apontamento(uuid);

drop trigger if exists trg_timesheet_entries_zz_versao on public.timesheet_entries;
drop trigger if exists trg_timesheet_entries_zz_invalida_virada on public.timesheet_entries;
drop function if exists public.versionar_apontamento();
drop function if exists public.invalidar_confirmacao_de_virada();

revoke select (versao) on table public.timesheet_entries from bslog_rpc_operacional;

do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('salvar_apontamento_admin_v2', 'salvar_apontamento_operacional_v2', 'listar_apontamentos_do_operador_v2',
                              'confirmar_virada_do_apontamento', 'situacao_da_virada', 'classificar_virada_do_apontamento',
                              'versionar_apontamento', 'invalidar_confirmacao_de_virada')) then
    raise exception 'rollback 054: funções da 054 ainda presentes.';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.timesheet_entries'::regclass
              and tgname in ('trg_timesheet_entries_zz_versao', 'trg_timesheet_entries_zz_invalida_virada')) then
    raise exception 'rollback 054: gatilhos da 054 ainda presentes.';
  end if;
  if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'versao', 'SELECT') then
    raise exception 'rollback 054: o operador ainda lê a versão.';
  end if;
  -- O que fica: a coluna, a trilha protegida e as RPCs v1.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'timesheet_entries' and column_name = 'versao')
     or to_regclass('public.apontamento_confirmacoes_virada') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.apontamento_confirmacoes_virada'::regclass
                     and tgname = 'trg_apontamento_confirmacoes_virada_protege')
     or to_regprocedure('public.salvar_apontamento_admin(uuid,uuid,date,jsonb)') is null
     or to_regprocedure('public.salvar_apontamento_operacional(uuid,uuid,date,jsonb)') is null then
    raise exception 'rollback 054: algo que deveria ser preservado sumiu — parar e investigar.';
  end if;
end;
$$;

commit;
