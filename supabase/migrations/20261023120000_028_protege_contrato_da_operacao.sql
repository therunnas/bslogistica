-- Contrato da operação não muda depois que há histórico financeiro (C05-B5.6).
--
-- PROBLEMA. `operations.contract_id` decide de onde vem o preço: com contrato, a vigência do
-- contrato; sem contrato, a vigência do valor acordado (`operation_terms`). A 025 só recusava a
-- troca de contrato com o motor LIGADO e só quando já havia apontamento (trigger habilitado junto
-- com o motor). Ficavam abertos:
--
--   * motor DESLIGADO: a troca era livre mesmo com apontamentos (a tela reenvia `contract_id` a
--     cada salvamento, e o antigo motor recalcula o próximo salvamento pelo contrato novo);
--   * motor ligado, SEM apontamento ainda, mas com vigência de valor acordado (`operation_terms`):
--     prender a operação a um contrato faz o valor acordado deixar de ser a fonte do preço.
--
-- SOLUÇÃO. Um trigger sempre habilitado (independe da chave do motor): a coluna `contract_id` não
-- pode mudar — trocar, preencher ou remover — quando a operação tem HISTÓRICO FINANCEIRO, isto é,
-- ao menos um apontamento em alguma folha dela ou ao menos uma linha em `operation_terms`
-- (ativa ou não). A recusa é 55000 e a mensagem manda criar uma nova operação. Sem histórico a
-- troca segue livre (cadastro corrigido antes do primeiro lançamento). `client_id` e a integridade
-- cliente/contrato continuam com a 021 (FK composta).
--
-- NÃO FAZ: alterar registro antigo, recalcular, mexer em RLS/policies/grants de tabela, em
-- `gerar_fatura`, no trigger da 025 (que segue valendo, com mensagem própria, quando ligado) ou
-- na migration 019. Como nos demais bloqueios financeiros, `postgres` e `service_role` ficam
-- isentos (manutenção e a ação `ON DELETE SET NULL` da chave estrangeira, que roda como dono;
-- apagar contrato com apontamento derivado já é recusado pela guarda da 011).
--
-- A função é SECURITY INVOKER, como as demais guardas financeiras (025): o isento por papel precisa
-- enxergar `current_user` de quem escreve (em SECURITY DEFINER seria sempre o dono, `postgres`, e a
-- regra nunca valeria). Quem chega a este UPDATE pela API é admin em AAL2, que lê todo o histórico
-- pela RLS. Não tem EXECUTE para papel de API e `search_path` é fixo.
--
-- SEGUNDA PORTA: EXCLUIR O CONTRATO. `operations.contract_id` é `ON DELETE SET NULL` (e a chave
-- composta da 021 também, só da coluna `contract_id`). Apagar o contrato desvincula as operações
-- por uma ação referencial, que é um UPDATE interno executado como dono da tabela (`postgres`):
-- o trigger acima nasce isento para `postgres` e não via esse caminho. Reproduzido (C05-B5.6A):
-- excluir o contrato de uma operação com `operation_terms` e sem apontamento apagava o contrato,
-- as vigências dele (cascata) e deixava a operação sem origem de preço. A guarda de DELETE da 011
-- (`bloquear_delete_contrato_usado`) só olha apontamento derivado.
--
-- Um segundo trigger, BEFORE DELETE em `contracts`, recusa (55000) a exclusão enquanto alguma
-- operação ligada ao contrato tiver apontamento ou valor acordado cadastrado. Roda ANTES da ação
-- referencial, então nada é desvinculado nem apagado em cascata (a recusa desfaz o comando
-- inteiro). Sem exceção de papel, como a 011. Trava as operações ligadas (`FOR UPDATE`) para que um
-- lançamento ou um valor acordado concorrente espere a exclusão ou a faça recusar. Contrato sem
-- operação ou só com operação sem histórico continua podendo ser excluído, como antes.
--
-- ROLLBACK (funções sem estado):
--   drop trigger trg_operations_protege_contrato on public.operations;
--   drop trigger trg_contracts_protege_exclusao_com_historico on public.contracts;
--   drop function public.proteger_contrato_da_operacao();
--   drop function public.proteger_contrato_contra_exclusao();

create or replace function public.proteger_contrato_da_operacao()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.contract_id is not distinct from old.contract_id then
    return new;
  end if;
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if exists (select 1
               from public.timesheets t
               join public.timesheet_entries e on e.timesheet_id = t.id
              where t.operation_id = old.id)
     or exists (select 1 from public.operation_terms ot where ot.operation_id = old.id) then
    raise exception 'O contrato de uma operação com apontamentos ou valor acordado cadastrado não pode mudar: não há histórico de quando o vínculo valia. Crie uma nova operação para o novo contrato.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.proteger_contrato_da_operacao() from public, anon, authenticated, service_role, bslog_rpc_operacional;
alter function public.proteger_contrato_da_operacao() owner to postgres;

create trigger trg_operations_protege_contrato
  before update of contract_id on public.operations
  for each row execute function public.proteger_contrato_da_operacao();

create or replace function public.proteger_contrato_contra_exclusao()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Serializa com lançamento e valor acordado novos nas operações ligadas a este contrato.
  perform 1 from public.operations o where o.contract_id = old.id for update;

  if exists (select 1
               from public.operations o
              where o.contract_id = old.id
                and (exists (select 1
                               from public.timesheets t
                               join public.timesheet_entries e on e.timesheet_id = t.id
                              where t.operation_id = o.id)
                     or exists (select 1 from public.operation_terms ot where ot.operation_id = o.id))) then
    raise exception 'Contrato de operação com apontamentos ou valor acordado cadastrado não pode ser excluído: a operação perderia a origem do preço. Inative o contrato.'
      using errcode = '55000';
  end if;

  return old;
end;
$$;

revoke all on function public.proteger_contrato_contra_exclusao() from public, anon, authenticated, service_role, bslog_rpc_operacional;
alter function public.proteger_contrato_contra_exclusao() owner to postgres;

create trigger trg_contracts_protege_exclusao_com_historico
  before delete on public.contracts
  for each row execute function public.proteger_contrato_contra_exclusao();

comment on function public.proteger_contrato_contra_exclusao() is
  'Recusa (55000) excluir contrato cuja operacao ligada tenha apontamento ou valor acordado cadastrado (o SET NULL da chave estrangeira tiraria a origem do preco). Sempre habilitado, sem excecao de papel.';

comment on function public.proteger_contrato_da_operacao() is
  'Recusa (55000) mudar operations.contract_id quando a operacao tem apontamento ou valor acordado cadastrado. Sempre habilitado, com o motor ligado ou desligado. postgres e service_role isentos.';
