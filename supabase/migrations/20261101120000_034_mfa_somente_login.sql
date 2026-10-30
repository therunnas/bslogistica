-- MFA protege só o LOGIN (AUTH-01D.R1, migration 034).
--
-- DECISÃO DO PROPRIETÁRIO. O segundo fator protege exclusivamente o login e a própria conta; não é
-- requisito de nenhuma funcionalidade. Sem MFA: e-mail e senha e todas as funcionalidades do papel.
-- Com MFA: TOTP em todo novo login; sessão aal1 de conta com fator verificado continua barrada no
-- app e no banco; depois do TOTP vale tudo do papel, sem novo código por operação. Única exceção
-- (só na interface, ver docs/SEGURANCA.md): desativar o próprio MFA pede um código novo.
--
-- O QUE MUDA. A 032 classificou as operações em cotidianas (piso mfa_cotidiano_ok()) e críticas
-- (AAL2 literal). Esta migration remove a classe crítica: todo ponto que testava 'aal2' direto passa
-- a usar public.mfa_cotidiano_ok() (032), que: conta com fator verificado exige aal2; conta sem fator
-- trabalha em aal1; sessão inválida, claim ausente ou conta inexistente nega (falha fechada).
--   * função condicoes_exigir_admin()  (guard de todos registrar_/corrigir_/encerrar_/aposentar_*,
--     adicionais, feriados, motor, implantação, legado)
--   * função gerar_fatura(uuid, date, date)
--   * gatilhos exigir_aal2_taxa_legada() (032): mesma troca; o que o gatilho recusa agora é só
--     a sessão aal1 de conta com fator verificado
--   * 14 policies: invoices e invoice_items (insert/update/delete), admin_audit_log,
--     financial_engine_settings, financial_terms_audit (restritiva + leitura) e
--     user_operation_access (admin + restritiva). Os NOMES das policies não mudam (`*_exige_aal2`
--     ficou histórico: hoje significam "exige o piso de MFA da conta").
--
-- O QUE NÃO MUDA. Nenhuma verificação de PAPEL é removida: has_role('admin'), identidade_atual_
-- utilizavel(), a superfície restrita do operacional, as policies *_exige_admin, a auditoria, as
-- fórmulas financeiras e a proteção da migration 033 (gatilhos de vigência no INSERT). A 032 e a 033
-- não são editadas. Nada é concedido a anon/public.
--
-- COMPATIBILIDADE. Só AFROUXA para conta sem fator verificado (que já era o piso da 032 nas tabelas
-- cotidianas); conta com fator continua exigindo aal2. O app anterior (AUTH-01B/C) segue funcionando:
-- ele continua pedindo aal2 do admin na interface, e o banco aceita. Ordem: 032, 033, 034.
-- ROLLBACK: docs/runbooks/rollback-mfa-somente-login.sql (volta a 032+033, sem tocar a 033).

begin;

-- Funções (CREATE OR REPLACE preserva dono, ACL e comentários).

CREATE OR REPLACE FUNCTION public.condicoes_exigir_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  -- Política definitiva: o MFA protege só o login. Sessão aal1 de conta COM fator verificado continua
  -- barrada (e sem papel consultado); conta sem fator trabalha em aal1. Falha fechada.
  if not public.mfa_cotidiano_ok() then
    raise exception 'Autenticação de dois fatores obrigatória.' using errcode = '42501';
  end if;
  if not coalesce(public.identidade_atual_utilizavel(), false) then
    raise exception 'Conta ou sessão sem validade.' using errcode = '42501';
  end if;
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Apenas administradores podem gerir condições financeiras.' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_fatura(_client_id uuid, _period_start date, _period_end date)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _fatura       public.invoices;
  _ids          uuid[];
  _adicionais   uuid[];
  _elegiveis    integer;
  _n_adicionais integer;
  _vinculados   integer;
  _total_adic   numeric(12,2);
  _total_ajuste numeric(12,2);
  _minutos_ajuste integer;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.'
      using errcode = '28000';
  end if;

  -- Política definitiva (034): o MFA protege só o login. Conta com fator verificado em aal1 segue barrada.
  if not public.mfa_cotidiano_ok() then
    raise exception 'Autenticação de dois fatores obrigatória.'
      using errcode = '42501';
  end if;

  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Apenas administradores podem gerar faturas.'
      using errcode = '42501';
  end if;

  if _client_id is null or _period_start is null or _period_end is null then
    raise exception 'Cliente e período são obrigatórios.'
      using errcode = '22023';
  end if;

  if _period_start > _period_end then
    raise exception 'Período inválido: início (%) posterior ao fim (%).',
      _period_start, _period_end
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.clients where id = _client_id) then
    raise exception 'Cliente não encontrado.'
      using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));

  select coalesce(array_agg(x.id), '{}'::uuid[])
    into _ids
  from (
    select te.id
    from public.timesheet_entries te
    join public.timesheets t on t.id = te.timesheet_id
    join public.operations  o on o.id = t.operation_id
    where o.client_id     = _client_id
      and t.work_date     between _period_start and _period_end
      and te.status      <> 'absent'::public.attendance_status
      and te.invoice_id  is null
    order by te.id
    for update of te
  ) x;

  select coalesce(array_agg(x.id), '{}'::uuid[])
    into _adicionais
  from (
    select a.id
    from public.billing_additionals a
    where a.client_id    = _client_id
      and a.period_start >= _period_start
      and a.period_end   <= _period_end
      and a.canceled_at  is null
      and a.invoice_id   is null
    order by a.id
    for update of a
  ) x;

  _elegiveis := coalesce(array_length(_ids, 1), 0);
  _n_adicionais := coalesce(array_length(_adicionais, 1), 0);

  if _elegiveis = 0 and _n_adicionais = 0 then
    raise exception 'Nenhum lançamento faturável no período para este cliente.'
      using errcode = 'P0002';
  end if;

  select coalesce(sum(a.amount), 0) into _total_adic
    from public.billing_additionals a where a.id = any(_adicionais);

  -- B8.17: o arredondamento acumulado só vale sobre um período de fechamento inteiro e sem
  -- fracionamento do mesmo colaborador entre faturas.
  perform public.validar_fechamento_acumulado(_client_id, _period_start, _period_end, _ids);

  -- B8.15: arredondamento acumulado, calculado sobre os MESMOS apontamentos travados acima (a
  -- função é estável e as linhas estão travadas: as duas leituras abaixo dão o mesmo resultado).
  select coalesce(sum(j.ajuste), 0), coalesce(sum(j.minutos_arredondados - j.minutos_brutos), 0)
    into _total_ajuste, _minutos_ajuste
    from public.ajustes_de_arredondamento_acumulado(_client_id, _period_start, _period_end, _ids) j;

  insert into public.invoices (
    client_id, period_start, period_end, status,
    total_dailies, total_overtime, total_amount, total_cost
  )
  select
    _client_id,
    _period_start,
    _period_end,
    'closed'::public.invoice_status,
    count(*),
    round((coalesce(sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes)), 0) + _minutos_ajuste)::numeric / 60, 2),
    coalesce(sum(te.billed_amount), 0) + _total_adic + _total_ajuste,
    coalesce(sum(te.cost_amount), 0)
  from public.timesheet_entries te
  where te.id = any(_ids)
  returning * into _fatura;

  -- Diárias por operação (billed_amount - hora extra; na saída antecipada, a diária proporcional).
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — diárias',
    count(*),
    round(
      (sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)))
      / count(*), 2),
    sum(te.billed_amount) - sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)),
    'diarias'
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name;

  -- Horas extras por operação, pelos minutos COBRADOS.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    o.id,
    o.name || ' — horas extras',
    round(sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes))::numeric / 60, 2),
    case
      when sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes)) > 0
        then round(
          sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0))
          / (sum(coalesce(te.billed_overtime_minutes, te.overtime_minutes))::numeric / 60), 2)
      else 0
    end,
    sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)),
    'horas_extras'
  from public.timesheet_entries te
  join public.timesheets t on t.id = te.timesheet_id
  join public.operations  o on o.id = t.operation_id
  where te.id = any(_ids)
  group by o.id, o.name
  having sum(greatest(te.billed_amount - te.daily_rate_snapshot, 0)) > 0;

  -- B8.15: um item por colaborador com arredondamento acumulado diferente de zero.
  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    null,
    'Arredondamento acumulado de horas extras — ' || j.colaborador
      || ' (' || j.minutos_brutos || ' min → ' || j.minutos_arredondados || ' min)',
    round((j.minutos_arredondados - j.minutos_brutos)::numeric / 60, 2),
    j.valor_hora,
    j.ajuste,
    'arredondamento'
  from public.ajustes_de_arredondamento_acumulado(_client_id, _period_start, _period_end, _ids) j
  where j.ajuste <> 0
  order by j.colaborador, j.employee_id;

  insert into public.invoice_items (
    invoice_id, operation_id, description, quantity, unit_price, amount, kind
  )
  select
    _fatura.id,
    a.operation_id,
    'Adicional — ' || a.description || coalesce(' (ref. ' || a.reference || ')', ''),
    1,
    a.amount,
    a.amount,
    'adicional'
  from public.billing_additionals a
  where a.id = any(_adicionais)
  order by a.period_start, a.id;

  update public.timesheet_entries te
  set invoice_id = _fatura.id
  where te.id = any(_ids)
    and te.invoice_id is null;

  get diagnostics _vinculados = row_count;

  if _vinculados <> _elegiveis then
    raise exception 'Conflito de concorrência: % de % lançamentos vinculados.',
      _vinculados, _elegiveis
      using errcode = '40001';
  end if;

  update public.billing_additionals a
  set invoice_id = _fatura.id
  where a.id = any(_adicionais)
    and a.invoice_id is null
    and a.canceled_at is null;

  get diagnostics _vinculados = row_count;

  if _vinculados <> _n_adicionais then
    raise exception 'Conflito de concorrência: % de % adicionais vinculados.',
      _vinculados, _n_adicionais
      using errcode = '40001';
  end if;

  return _fatura;
end;
$function$;

CREATE OR REPLACE FUNCTION public.exigir_aal2_taxa_legada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  _mudou boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;
  -- INSERT: vale o que foge do default da coluna (a linha nasce sem taxa); UPDATE: vale o que mudou.
  if tg_table_name = 'contracts' then
    _mudou := case when tg_op = 'INSERT'
      then new.daily_rate is distinct from 0 or new.shift_hours is distinct from 8
        or new.ot_factor is distinct from 1 or new.ot_tolerance_min is distinct from 10
      else new.daily_rate is distinct from old.daily_rate
        or new.shift_hours is distinct from old.shift_hours
        or new.ot_factor is distinct from old.ot_factor
        or new.ot_tolerance_min is distinct from old.ot_tolerance_min end;
  elsif tg_table_name = 'employees' then
    _mudou := case when tg_op = 'INSERT'
      then new.daily_cost is distinct from 0
      else new.daily_cost is distinct from old.daily_cost end;
  else
    _mudou := case when tg_op = 'INSERT'
      then new.agreed_amount is not null
      else new.agreed_amount is distinct from old.agreed_amount end;
  end if;
  if _mudou and not public.mfa_cotidiano_ok() then
    raise exception 'Informar ou alterar condições financeiras exige a verificação em duas etapas (dois fatores).'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Policies que testavam aal2 literal -> piso de MFA da conta (nomes preservados).
alter policy admin_audit_log_exige_admin_aal2 on public.admin_audit_log using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy admin_audit_log_leitura_admin on public.admin_audit_log using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_engine_settings_exige_admin_aal2 on public.financial_engine_settings using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_engine_settings_leitura_admin on public.financial_engine_settings using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_terms_audit_exige_admin_aal2 on public.financial_terms_audit using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy financial_terms_audit_leitura_admin on public.financial_terms_audit using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy invoice_items_delete_exige_aal2 on public.invoice_items using ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy invoice_items_insert_exige_aal2 on public.invoice_items with check ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy invoice_items_update_exige_aal2 on public.invoice_items using ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok))) with check ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy invoices_delete_exige_aal2 on public.invoices using ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy invoices_insert_exige_aal2 on public.invoices with check ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy invoices_update_exige_aal2 on public.invoices using ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok))) with check ((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)));
alter policy user_operation_access_admin on public.user_operation_access using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));
alter policy user_operation_access_somente_admin_aal2 on public.user_operation_access using (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role))) with check (((( SELECT public.mfa_cotidiano_ok() AS mfa_cotidiano_ok)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

commit;
