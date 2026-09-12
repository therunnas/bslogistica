-- Integridade de histórico faturado na exclusão de cliente.
--
-- CONTRATO ATUAL, desde a migration 011: cliente COM histórico faturado não
-- pode ser excluído — nem por admin, nem por cascata. Cliente SEM faturamento
-- continua excluível normalmente. Termina em ROLLBACK.

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
-- NOVO CONTRATO, desde a migration 011.
--
-- Antes, esta exclusão era PERMITIDA e a cascata levava a árvore inteira —
-- cliente, contrato, operação, turno, folha, apontamentos, fatura e itens —
-- sem deixar órfão. Era coerente, e este teste afirmava exatamente isso.
--
-- A regra mudou: histórico faturado é imutável contra DELETE comum. Apagar um
-- cliente que já tem faturamento passa a ser RECUSADO, para admin inclusive, e
-- sem exceção por cascata. A ação correta é inativar o cliente.
--
-- O bloqueio acontece na raiz, no trigger de `clients`, e não lá embaixo no
-- trigger de turno — assim a mensagem fala de cliente, que é o que se tentou
-- apagar.
do $exclusao_recusada$
declare
  _estado text;
begin
  begin
    delete from public.clients
     where id = 'a4000000-0000-4000-8000-000000000001';
    _estado := 'APAGOU';
  exception
    when insufficient_privilege then _estado := 'recusou 42501';
    when others then _estado := 'erro ' || sqlstate;
  end;

  if _estado <> 'recusou 42501' then
    raise exception 'EXCLUSÃO FATURADA: esperava recusa 42501, obtido %', _estado;
  end if;
end
$exclusao_recusada$;

do $assertions$
declare
  _n bigint;
begin
  -- A transação do DELETE não pode ter removido NADA. Cada contagem abaixo
  -- prova que um nível da árvore sobreviveu à tentativa.
  select count(*) into _n from public.clients
   where id = 'a4000000-0000-4000-8000-000000000001';
  if _n <> 1 then raise exception 'INTEGRIDADE: cliente foi removido'; end if;

  select count(*) into _n from public.contracts
   where id = 'a4000000-0000-4000-8000-000000000002';
  if _n <> 1 then raise exception 'INTEGRIDADE: contrato foi removido'; end if;

  select count(*) into _n from public.operations
   where id = 'a4000000-0000-4000-8000-000000000003';
  if _n <> 1 then raise exception 'INTEGRIDADE: operação foi removida'; end if;

  select count(*) into _n from public.shifts
   where id = 'a4000000-0000-4000-8000-000000000004';
  if _n <> 1 then raise exception 'INTEGRIDADE: turno foi removido'; end if;

  select count(*) into _n from public.timesheets
   where id = 'a4000000-0000-4000-8000-000000000007';
  if _n <> 1 then raise exception 'INTEGRIDADE: folha foi removida'; end if;

  select count(*) into _n from public.timesheet_entries
   where id = 'a4000000-0000-4000-8000-000000000008';
  if _n <> 1 then raise exception 'INTEGRIDADE: apontamento foi removido'; end if;

  -- E o vínculo financeiro continua de pé: a fatura não perdeu o lastro.
  select count(*) into _n from public.timesheet_entries
   where id = 'a4000000-0000-4000-8000-000000000008'
     and invoice_id = 'a4000000-0000-4000-8000-000000000009';
  if _n <> 1 then raise exception 'INTEGRIDADE: vínculo de fatura foi desfeito'; end if;

  select count(*) into _n from public.invoices
   where id = 'a4000000-0000-4000-8000-000000000009';
  if _n <> 1 then raise exception 'INTEGRIDADE: fatura foi removida'; end if;

  select count(*) into _n from public.invoice_items
   where id = 'a4000000-0000-4000-8000-000000000010';
  if _n <> 1 then raise exception 'INTEGRIDADE: item de fatura foi removido'; end if;

  select count(*) into _n from public.employees
   where id = 'a4000000-0000-4000-8000-000000000005';
  if _n <> 1 then raise exception 'INTEGRIDADE: colaborador foi removido'; end if;

  raise notice 'EXCLUSÃO FATURADA: PASS (recusada com 42501, árvore intacta)';
end
$assertions$;

-- Complementar: a regra não é bloqueio absoluto de DELETE em clients. Cliente
-- SEM histórico faturado continua excluível pelo admin, com a cascata de
-- sempre.
insert into public.clients (id, name)
values ('a4000000-0000-4000-8000-0000000000f1', 'Cliente Sem Faturamento');

insert into public.operations (id, client_id, name)
values ('a4000000-0000-4000-8000-0000000000f2',
        'a4000000-0000-4000-8000-0000000000f1', 'Operação Sem Faturamento');

do $exclusao_permitida$
declare
  _n bigint;
begin
  delete from public.clients
   where id = 'a4000000-0000-4000-8000-0000000000f1';
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'SEM FATURAMENTO: cliente limpo deveria ter sido excluído, linhas=%', _n;
  end if;

  select count(*) into _n from public.operations
   where id = 'a4000000-0000-4000-8000-0000000000f2';
  if _n <> 0 then raise exception 'SEM FATURAMENTO: cascata não removeu a operação'; end if;

  raise notice 'SEM FATURAMENTO: PASS (cliente limpo excluído, cascata normal)';
end
$exclusao_permitida$;

select 'REGRESSÃO DE EXCLUSÃO FATURADA PASSOU' as resultado;

rollback;
