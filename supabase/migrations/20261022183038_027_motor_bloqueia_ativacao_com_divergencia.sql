-- Ativação do motor recusa divergência entre coluna e vigência (C05-B5.5).
--
-- PROBLEMA (reproduzido no banco local, C05-B5.5). Com o motor DESLIGADO a tela edita
-- `contracts.daily_rate` (e demais taxas), `employees.daily_cost` e `operations.agreed_amount`
-- por UPDATE direto, e isso NÃO atualiza a vigência cadastrada. `alterar_motor_vigencia(true, ...)`
-- só olhava pendências (cadastro sem vigência para hoje); ligava mesmo com a coluna diferente da
-- vigência vigente. Não havia sobrescrita das colunas, mas a FONTE DO PREÇO mudava em silêncio:
-- o motor antigo calculava pela coluna editada, o novo passava a calcular pela vigência antiga.
--
-- SOLUÇÃO (fail-closed). Ligar passa a ser recusado (55000) enquanto existir cadastro cuja coluna
-- difere da vigência ATIVA vigente hoje (America/Sao_Paulo). A comparação é numérica e exata, com
-- uma exceção que não muda preço: jornada <= 0 vale 8 h e fator de hora extra nulo ou 0 vale 1,
-- como no motor antigo (010) e na 025; os dois lados são normalizados antes de comparar.
--
--   * Ausência de vigência para hoje NÃO é divergência: continua sendo pendência (025), com a
--     regra `p_aceitar_pendencias` inalterada. Vigência futura não se compara com a coluna.
--   * `p_aceitar_pendencias` NÃO libera divergência: aceitar um cadastro sem preço é diferente
--     de aceitar dois preços conflitantes.
--   * Nada é sobrescrito nem criado: o chamador corrige de forma explícita (editar a coluna
--     enquanto o motor está desligado, ou `sincronizar_colunas_legadas`, que copia a vigência para
--     a coluna com motivo e trilha, ou registrar a vigência que ele quer).
--   * A verificação roda DENTRO da transação de ativação, depois do advisory lock e da linha da
--     chave, e DEPOIS de habilitar os triggers de bloqueio: o `ALTER TABLE ... ENABLE TRIGGER`
--     toma SHARE ROW EXCLUSIVE em contracts/employees/operations até o fim da transação, então
--     nenhuma escrita concorrente muda uma coluna entre a verificação e a ativação, e a que
--     esperava é recusada pelo trigger. Se houver divergência, a exceção desfaz tudo (inclusive
--     o ALTER TABLE): motor continua desligado, triggers no estado anterior, sem auditoria de
--     ativação e sem sincronização residual.
--   * A mensagem só informa quantidades. Quem quer saber QUAIS cadastros divergem chama
--     `divergencias_implantacao_vigencias()` (admin AAL2, como `pendencias_implantacao_vigencias`).
--
-- Não altera `gerar_fatura`, preços, migration 019, RLS, policies, triggers existentes nem dados.
-- A auditoria da ativação é a mesma (`motor_vigencia_ativado`), com a contagem de divergências (0).
--
-- ROLLBACK (funções sem estado): recriar `alterar_motor_vigencia` com o corpo da 025 e
--   drop function public.divergencias_implantacao_vigencias();
--   drop function public.motor_divergencias();

-- Cadastros com vigência ativa HOJE cuja coluna difere dela. Interna: nenhum papel de API.
create or replace function public.motor_divergencias()
returns table (tipo text, id uuid, nome text, campos text[])
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select 'contrato'::text, c.id, c.name,
         array_remove(array[
           case when c.daily_rate        is distinct from t.daily_rate        then 'daily_rate' end,
           case when case when c.shift_hours > 0 then c.shift_hours else 8 end
                     is distinct from case when t.shift_hours > 0 then t.shift_hours else 8 end then 'shift_hours' end,
           case when case when coalesce(c.ot_factor, 0) = 0 then 1 else c.ot_factor end
                     is distinct from case when coalesce(t.ot_factor, 0) = 0 then 1 else t.ot_factor end then 'ot_factor' end,
           case when c.ot_tolerance_min  is distinct from t.ot_tolerance_min  then 'ot_tolerance_min' end
         ], null)
    from public.contracts c
    join public.contract_terms t on t.contract_id = c.id and t.active
    cross join hoje
   where daterange(t.valid_from, t.valid_to, '[)') @> hoje.d
     and (c.daily_rate is distinct from t.daily_rate
          or case when c.shift_hours > 0 then c.shift_hours else 8 end
             is distinct from case when t.shift_hours > 0 then t.shift_hours else 8 end
          or case when coalesce(c.ot_factor, 0) = 0 then 1 else c.ot_factor end
             is distinct from case when coalesce(t.ot_factor, 0) = 0 then 1 else t.ot_factor end
          or c.ot_tolerance_min is distinct from t.ot_tolerance_min)
  union all
  select 'colaborador'::text, e.id, e.name, array['daily_cost']
    from public.employees e
    join public.employee_cost_terms t on t.employee_id = e.id and t.active
    cross join hoje
   where daterange(t.valid_from, t.valid_to, '[)') @> hoje.d
     and e.daily_cost is distinct from t.daily_cost
  union all
  -- Operação com contrato é precificada pelo contrato: o valor acordado dela não entra em conta.
  select 'operacao_sem_contrato'::text, o.id, o.name, array['agreed_amount']
    from public.operations o
    join public.operation_terms t on t.operation_id = o.id and t.active
    cross join hoje
   where o.contract_id is null
     and daterange(t.valid_from, t.valid_to, '[)') @> hoje.d
     and o.agreed_amount is distinct from t.agreed_amount;
$$;

create or replace function public.divergencias_implantacao_vigencias()
returns table (tipo text, id uuid, nome text, campos text[])
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.condicoes_exigir_admin();
  return query select d.tipo, d.id, d.nome, d.campos from public.motor_divergencias() d order by d.tipo, d.nome;
end;
$$;

create or replace function public.alterar_motor_vigencia(
  p_ativar              boolean,
  p_reason              text,
  p_aceitar_pendencias  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _motivo text;
  v_ant   public.financial_engine_settings%rowtype;
  v_dep   public.financial_engine_settings%rowtype;
  _pend   integer := 0;
  _div    integer := 0;
  _div_c  integer;
  _div_e  integer;
  _div_o  integer;
  _sync   jsonb := null;
  _id     constant uuid := '00000000-0000-4000-8000-000000000025';
begin
  perform public.condicoes_exigir_admin();
  _motivo := public.condicoes_validar_motivo(p_reason);
  if p_ativar is null then
    raise exception 'Informe se o motor deve ser ligado ou desligado.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('motor_vigencia', 0));
  select * into v_ant from public.financial_engine_settings where id for update;

  if v_ant.vigencia_ativa = p_ativar then
    raise exception '%', case when p_ativar then 'O motor por vigência já está ligado.' else 'O motor por vigência já está desligado.' end
      using errcode = '55000';
  end if;

  if p_ativar then
    select count(*) into _pend from public.motor_pendencias();
    if _pend > 0 and not coalesce(p_aceitar_pendencias, false) then
      raise exception 'Há % cadastro(s) em uso sem vigência para hoje; apontamentos remuneráveis deles serão recusados.', _pend
        using errcode = '55000',
              hint = 'Veja pendencias_implantacao_vigencias(), registre as vigências, ou ligue com p_aceitar_pendencias = true.';
    end if;

    alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_financeiro;
    alter table public.timesheet_entries enable  trigger trg_timesheet_entries_calculo_vigencia;
    alter table public.contracts         enable  trigger trg_contracts_bloqueia_taxa_direta;
    alter table public.employees         enable  trigger trg_employees_bloqueia_taxa_direta;
    alter table public.operations        enable  trigger trg_operations_bloqueia_taxa_direta;
    alter table public.shifts            enable  trigger trg_shifts_congela_jornada_usada;

    -- Depois dos ALTER TABLE: as tabelas estão travadas até o fim da transação, então a leitura
    -- abaixo é a que vale na hora de ligar. A exceção desfaz também os ALTER TABLE acima.
    select count(*) filter (where d.tipo = 'contrato'),
           count(*) filter (where d.tipo = 'colaborador'),
           count(*) filter (where d.tipo = 'operacao_sem_contrato')
      into _div_c, _div_e, _div_o
      from public.motor_divergencias() d;
    _div := _div_c + _div_e + _div_o;
    if _div > 0 then
      raise exception 'Há % cadastro(s) (contratos: %, colaboradores: %, operações sem contrato: %) com a taxa diferente da vigência de hoje; ligar trocaria o preço sem aviso.',
                      _div, _div_c, _div_e, _div_o
        using errcode = '55000',
              hint = 'Veja divergencias_implantacao_vigencias(). Corrija a coluna com o motor desligado, use sincronizar_colunas_legadas ou registre a vigência desejada. p_aceitar_pendencias não libera divergência.';
    end if;

    update public.financial_engine_settings
       set vigencia_ativa = true, ativada_em = (now() at time zone 'America/Sao_Paulo')::date,
           changed_at = now(), changed_by = auth.uid(), reason = _motivo
     where id returning * into v_dep;
  else
    -- Desligar: as colunas antigas voltam a refletir a versão vigente hoje, porque o motor
    -- antigo volta a calcular a partir delas.
    _sync := public.motor_sincronizar_colunas_interno();

    alter table public.timesheet_entries disable trigger trg_timesheet_entries_calculo_vigencia;
    alter table public.timesheet_entries enable  trigger trg_timesheet_entries_calculo_financeiro;
    alter table public.contracts         disable trigger trg_contracts_bloqueia_taxa_direta;
    alter table public.employees         disable trigger trg_employees_bloqueia_taxa_direta;
    alter table public.operations        disable trigger trg_operations_bloqueia_taxa_direta;
    alter table public.shifts            disable trigger trg_shifts_congela_jornada_usada;

    update public.financial_engine_settings
       set vigencia_ativa = false, changed_at = now(), changed_by = auth.uid(), reason = _motivo
     where id returning * into v_dep;
  end if;

  perform public.condicoes_auditar(
    case when p_ativar then 'motor_vigencia_ativado' else 'motor_vigencia_desativado' end,
    'sistema', _id, _id,
    to_jsonb(v_ant),
    to_jsonb(v_dep) || jsonb_build_object('pendencias', _pend, 'aceitou_pendencias', coalesce(p_aceitar_pendencias, false),
                                          'divergencias', _div, 'sincronizacao', _sync),
    _motivo);

  return jsonb_build_object('ativo', v_dep.vigencia_ativa, 'ativada_em', v_dep.ativada_em,
                            'pendencias', _pend, 'sincronizacao', _sync);
end;
$$;

do $privilegios$
declare
  _f record;
begin
  for _f in
    select p.oid::regprocedure as assinatura, p.proname as nome
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('motor_divergencias', 'divergencias_implantacao_vigencias', 'alterar_motor_vigencia')
  loop
    execute format('alter function %s owner to postgres', _f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional', _f.assinatura);
    if _f.nome in ('divergencias_implantacao_vigencias', 'alterar_motor_vigencia') then
      execute format('grant execute on function %s to authenticated', _f.assinatura);
    end if;
  end loop;
end;
$privilegios$;

comment on function public.divergencias_implantacao_vigencias() is
  'Admin AAL2. Lista os cadastros cuja taxa/custo/valor acordado difere da vigencia ativa de hoje (ligar o motor e recusado enquanto existirem).';
