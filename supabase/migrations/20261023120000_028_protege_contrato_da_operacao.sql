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
-- ROLLBACK (função sem estado):
--   drop trigger trg_operations_protege_contrato on public.operations;
--   drop function public.proteger_contrato_da_operacao();

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

comment on function public.proteger_contrato_da_operacao() is
  'Recusa (55000) mudar operations.contract_id quando a operacao tem apontamento ou valor acordado cadastrado. Sempre habilitado, com o motor ligado ou desligado. postgres e service_role isentos.';
