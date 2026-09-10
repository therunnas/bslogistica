-- Regressão autocontida: excluir um cliente faturado não pode acionar a
-- sincronização da chave diária durante o ON DELETE SET NULL de invoice_id.
--
-- O schema já declara a cadeia do cliente com ON DELETE CASCADE/SET NULL. Este
-- teste apenas verifica esse contrato existente e termina em ROLLBACK.

begin;

insert into public.clients (id, name)
values ('a4000000-0000-4000-8000-000000000001', 'Cliente Exclusão Faturada');

insert into public.contracts (id, client_id, name)
values (
  'a4000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000001',
  'Contrato Exclusão Faturada'
);

insert into public.operations (id, client_id, contract_id, name)
values (
  'a4000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000002',
  'Operação Exclusão Faturada'
);

insert into public.shifts (id, operation_id, name, start_time, end_time)
values (
  'a4000000-0000-4000-8000-000000000004',
  'a4000000-0000-4000-8000-000000000003',
  'Turno Exclusão Faturada',
  '08:00',
  '17:00'
);

insert into public.employees (id, name, daily_cost)
values (
  'a4000000-0000-4000-8000-000000000005',
  'Colaborador Exclusão Faturada',
  100
);

insert into public.operation_team (id, operation_id, shift_id, employee_id)
values (
  'a4000000-0000-4000-8000-000000000006',
  'a4000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000004',
  'a4000000-0000-4000-8000-000000000005'
);

insert into public.timesheets (id, operation_id, shift_id, work_date)
values (
  'a4000000-0000-4000-8000-000000000007',
  'a4000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000004',
  date '2099-04-04'
);

insert into public.timesheet_entries (id, timesheet_id, employee_id, billed_amount, cost_amount)
values (
  'a4000000-0000-4000-8000-000000000008',
  'a4000000-0000-4000-8000-000000000007',
  'a4000000-0000-4000-8000-000000000005',
  250,
  100
);

insert into public.invoices (id, client_id, period_start, period_end, total_amount)
values (
  'a4000000-0000-4000-8000-000000000009',
  'a4000000-0000-4000-8000-000000000001',
  date '2099-04-01',
  date '2099-04-30',
  250
);

insert into public.invoice_items (
  id, invoice_id, operation_id, description, quantity, unit_price, amount
) values (
  'a4000000-0000-4000-8000-000000000010',
  'a4000000-0000-4000-8000-000000000009',
  'a4000000-0000-4000-8000-000000000003',
  'Diária de regressão',
  1,
  250,
  250
);

update public.timesheet_entries
   set invoice_id = 'a4000000-0000-4000-8000-000000000009'
 where id = 'a4000000-0000-4000-8000-000000000008';

do $fixture$
declare
  _n bigint;
begin
  select count(*) into _n
    from public.timesheet_entries
   where id = 'a4000000-0000-4000-8000-000000000008'
     and operation_id = 'a4000000-0000-4000-8000-000000000003'
     and work_date = date '2099-04-04'
     and invoice_id = 'a4000000-0000-4000-8000-000000000009';
  if _n <> 1 then
    raise exception 'FIXTURE: chave diária ou vínculo financeiro não foi criado corretamente';
  end if;
end
$fixture$;

-- Antes da correção, esta exclusão falha com 23503 porque o SET NULL de
-- invoice_id aciona indevidamente a sincronização da chave diária.
delete from public.clients
 where id = 'a4000000-0000-4000-8000-000000000001';

do $assertions$
declare
  _n bigint;
begin
  select count(*) into _n
    from public.clients
   where id = 'a4000000-0000-4000-8000-000000000001';
  if _n <> 0 then raise exception 'CASCADE: cliente permaneceu'; end if;

  select count(*) into _n
    from public.contracts
   where id = 'a4000000-0000-4000-8000-000000000002';
  if _n <> 0 then raise exception 'CASCADE: contrato órfão permaneceu'; end if;

  select count(*) into _n
    from public.operations
   where id = 'a4000000-0000-4000-8000-000000000003';
  if _n <> 0 then raise exception 'CASCADE: operação órfã permaneceu'; end if;

  select count(*) into _n
    from public.shifts
   where id = 'a4000000-0000-4000-8000-000000000004';
  if _n <> 0 then raise exception 'CASCADE: turno órfão permaneceu'; end if;

  select count(*) into _n
    from public.operation_team
   where id = 'a4000000-0000-4000-8000-000000000006';
  if _n <> 0 then raise exception 'CASCADE: vínculo de equipe órfão permaneceu'; end if;

  select count(*) into _n
    from public.timesheets
   where id = 'a4000000-0000-4000-8000-000000000007';
  if _n <> 0 then raise exception 'CASCADE: folha órfã permaneceu'; end if;

  select count(*) into _n
    from public.timesheet_entries
   where id = 'a4000000-0000-4000-8000-000000000008';
  if _n <> 0 then raise exception 'CASCADE: lançamento órfão permaneceu'; end if;

  select count(*) into _n
    from public.invoices
   where id = 'a4000000-0000-4000-8000-000000000009';
  if _n <> 0 then raise exception 'CASCADE: fatura órfã permaneceu'; end if;

  select count(*) into _n
    from public.invoice_items
   where id = 'a4000000-0000-4000-8000-000000000010';
  if _n <> 0 then raise exception 'CASCADE: item de fatura órfão permaneceu'; end if;

  -- Employees não pertence a um cliente no schema; deve permanecer intacto.
  select count(*) into _n
    from public.employees
   where id = 'a4000000-0000-4000-8000-000000000005';
  if _n <> 1 then raise exception 'CASCADE: colaborador independente foi removido'; end if;

  select count(*) into _n
    from public.timesheet_entries
   where employee_id = 'a4000000-0000-4000-8000-000000000005'
   group by employee_id, operation_id, work_date
  having count(*) > 1;
  if _n is not null then raise exception 'UNICIDADE: restaram lançamentos duplicados'; end if;

  raise notice 'EXCLUSÃO FATURADA: PASS (cascatas, SET NULL e unicidade sem órfãos)';
end
$assertions$;

select 'REGRESSÃO DE EXCLUSÃO FATURADA PASSOU' as resultado;

rollback;
