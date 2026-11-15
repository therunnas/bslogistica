-- GATE-FIN-03. Origem: schema 053. Destino: 052 quanto à recusa de intervalo maior que a jornada.
--
-- O QUE FAZ: remove o trigger `trg_timesheet_entries_bloqueia_intervalo_maior` e a função
-- `public.recusar_intervalo_maior_que_jornada()`, exatamente o que a 053 criou. Não toca dados,
-- valores, snapshots, faturas, RLS, grants de tabela, RPCs nem o motor.
--
-- RISCO DE EXECUTAR: REABRE O I5 (SQL 090). Com o motor por vigência DESLIGADO, um intervalo maior
-- que o tempo entre entrada e saída volta a ser gravado com jornada 0 e a diária cobrada. Com o
-- motor LIGADO, o núcleo (035) volta a ser a única barreira, com a mensagem técnica
-- `nucleo:zero_minuto_com_horarios` (22023), que não diz o que corrigir. Só executar com
-- autorização específica, por ambiente, e com motivo registrado (ex.: um fluxo legítimo de
-- gravação que a 053 recusou e não pode esperar a correção).
--
-- COMPATIBILIDADE: o app não depende do trigger (a tela do admin mostra a mensagem do banco; a do
-- operador, a explicação fixa do 23514). Nenhuma linha gravada sob a 053 precisa de ajuste: todas
-- respeitam a regra.
--
-- HISTÓRICO DE MIGRATIONS: este rollback NÃO apaga o registro da 053 em
-- `supabase_migrations.schema_migrations`. O histórico aplicado é preservado como está, e a
-- reversão fica registrada como operação distinta (data, ambiente, autorização, motivo e o
-- resultado da verificação abaixo) no HANDOFF e no ESTADO_DO_PROJETO. Uma reaplicação é feita pela
-- própria 053 reexecutada com autorização (é idempotente: `create or replace` e
-- `drop trigger if exists`), nunca reescrevendo o histórico.
--
-- REVALIDAR DEPOIS: SQL 090 I5 volta a mostrar o intervalo aceito (a suíte passa a falhar, de
-- propósito); a suíte 053 falha em A1–A3; spec 80 IJ1–IJ4 falham.
begin;

drop trigger if exists trg_timesheet_entries_bloqueia_intervalo_maior on public.timesheet_entries;
drop function if exists public.recusar_intervalo_maior_que_jornada();

do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.timesheet_entries'::regclass
                and tgname = 'trg_timesheet_entries_bloqueia_intervalo_maior') then
    raise exception 'rollback 053: o trigger deveria ter saído.';
  end if;
  if to_regprocedure('public.recusar_intervalo_maior_que_jornada()') is not null then
    raise exception 'rollback 053: a função deveria ter saído.';
  end if;
  -- A trava anterior (029, entrada igual à saída) e o motor seguem no lugar.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.timesheet_entries'::regclass
                    and tgname = 'trg_timesheet_entries_bloqueia_horario_igual') then
    raise exception 'rollback 053: a trava da 029 sumiu — parar e investigar.';
  end if;
end;
$$;

commit;
