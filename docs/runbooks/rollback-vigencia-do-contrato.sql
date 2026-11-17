-- Gate C / D1. Origem: schema 055. Destino: 054 quanto à vigência do contrato.
--
-- O QUE FAZ: remove o gatilho `trg_timesheet_entries_bloqueia_fora_da_vigencia`, a função
-- `public.recusar_execucao_fora_da_vigencia()` e o CHECK `contracts_vigencia_valida`, exatamente o
-- que a 055 criou. Não toca dados, valores, snapshots, faturas, RLS, grants de tabela, RPCs nem o
-- motor.
--
-- RISCO DE EXECUTAR: REABRE o D1 e o DEC-CP02-01. Um dia fora da vigência do contrato volta a ser
-- lançado e cobrado; a API e `criar_contrato_com_vigencia` voltam a aceitar fim antes do início e
-- ano 0001. Só executar com autorização específica, por ambiente, e com motivo registrado (ex.: um
-- fluxo legítimo que a 055 recusou e não pode esperar a correção).
--
-- COMPATIBILIDADE: o app não depende do gatilho (a tela do admin mostra a mensagem do banco; a do
-- operador, o texto fixo da vigência quando o detalhe é `vigencia_do_contrato`). Nenhuma linha
-- gravada sob a 055 precisa de ajuste: todas respeitam a regra.
--
-- HISTÓRICO DE MIGRATIONS: este rollback NÃO apaga o registro da 055 em
-- `supabase_migrations.schema_migrations`. O histórico aplicado é preservado como está, e a reversão
-- fica registrada como operação distinta (data, ambiente, autorização, motivo e o resultado da
-- verificação abaixo) no HANDOFF e no ESTADO_DO_PROJETO. Uma reaplicação é feita pela própria 055
-- reexecutada com autorização (é idempotente: `drop … if exists` antes de criar), nunca
-- reescrevendo o histórico.
--
-- REVALIDAR DEPOIS: a suíte 055 falha em A1–A4 e nos casos de recusa (de propósito); SQL 090 K1
-- volta a mostrar o dia depois do fim aceito; spec 50 CN-D falha.
begin;

drop trigger if exists trg_timesheet_entries_bloqueia_fora_da_vigencia on public.timesheet_entries;
drop function if exists public.recusar_execucao_fora_da_vigencia();
alter table public.contracts drop constraint if exists contracts_vigencia_valida;

do $verificacao$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_timesheet_entries_bloqueia_fora_da_vigencia')
     or to_regprocedure('public.recusar_execucao_fora_da_vigencia()') is not null
     or exists (select 1 from pg_constraint where conrelid = 'public.contracts'::regclass
                  and conname = 'contracts_vigencia_valida') then
    raise exception 'rollback 055: ainda há objeto da 055.';
  end if;
end;
$verificacao$;

commit;
