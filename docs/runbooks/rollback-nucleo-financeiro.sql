-- REVERSÃO da migration 20261102120000_035_nucleo_financeiro_puro (FIN-PR-01).
--
-- A 035 só CRIA funções puras que nada usa: nenhuma tabela, policy, gatilho, grant de tabela ou
-- função existente foi tocado, e não há dado a recuperar. Reverter = remover as seis funções.
--
-- PRÉ-CONDIÇÃO (verificada abaixo, dentro da transação): nenhuma outra função e nenhum gatilho
-- chama o núcleo. Depois da FIN-PR-02 (ligação ao motor) ESTE SCRIPT NÃO SERVE MAIS: reverter a
-- ligação primeiro, pelo runbook próprio daquela etapa.
--
-- Executar só com autorização, como `postgres`, em uma transação. Não toca autenticação, MFA,
-- guards, RLS, policies nem as proteções de histórico.

begin;

do $pre$
declare
  _usos integer;
begin
  select count(*) into _usos
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.proname not like 'nucleo\_%'
     and p.prosrc ~ 'nucleo_';
  if _usos > 0 then
    raise exception 'Reversão recusada: % função(ões) fora do núcleo chamam nucleo_*.', _usos;
  end if;

  select count(*) into _usos
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.proname like 'nucleo\_%';
  if _usos > 0 then
    raise exception 'Reversão recusada: % gatilho(s) usam o núcleo.', _usos;
  end if;
end;
$pre$;

-- As compostas primeiro: elas chamam as primitivas.
drop function public.nucleo_componentes_v2(text, text, time, time, integer, bigint, integer, integer, integer, text, text, bigint, bigint, bigint);
drop function public.nucleo_componentes_legado_010(text, time, time, integer, integer, bigint, bigint, integer, integer, integer);
drop function public.nucleo_minutos_trabalhados(time, time, integer);
drop function public.nucleo_minutos_previstos(time, time, integer, boolean);
drop function public.nucleo_arredondar_he_diaria(integer);
drop function public.nucleo_arredondar_centavos(numeric, numeric);

do $pos$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'nucleo\_%') then
    raise exception 'Reversão incompleta: ainda há funções nucleo_*.';
  end if;
end;
$pos$;

-- Conferir antes de confirmar. Para desfazer o ensaio: rollback.
commit;
