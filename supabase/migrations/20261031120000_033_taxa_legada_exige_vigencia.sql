-- Integridade das colunas financeiras legadas com o motor por vigência LIGADO (AUTH-01C.1, 033).
--
-- ACHADO (homologação, AUTH-01C). Com o motor ligado, os gatilhos *_bloqueia_taxa_direta (025) só
-- recusam UPDATE. Um INSERT direto de contrato, colaborador ou operação com taxa preenchida passava
-- para um administrador em AAL2 e criava a linha com diária/custo/valor acordado SEM a vigência
-- correspondente (contract_terms / employee_cost_terms / operation_terms vazios): o valor que a
-- tela mostra e o que o motor calcula deixavam de coincidir, e a trilha financial_terms_audit
-- não registrava nada.
--
-- POR QUE NÃO BASTA PROIBIR O INSERT COM TAXA. O cadastro atômico legítimo (026:
-- criar_contrato_com_vigencia, criar_colaborador_com_vigencia, criar_operacao_com_vigencia) é
-- SECURITY INVOKER e faz exatamente esse INSERT (a taxa espelhada nas colunas legadas, que as
-- telas ainda leem) e, na MESMA transação, chama registrar_* (SECURITY DEFINER) para gravar a
-- vigência e a trilha. Proibir o INSERT quebraria o cadastro.
--
-- REGRA (decidida pelo responsável). Com o motor ligado, nenhum INSERT/UPDATE direto pode introduzir
-- ou alterar valor legado contornando as vigências, mesmo em AAL2.
--   * UPDATE: já recusado pelos gatilhos 025 (55000), para todo nível. Nada muda.
--   * INSERT: passa a valer a regra de CONSISTÊNCIA NO COMMIT. A linha pode nascer com valor fora do
--     default da coluna somente se, na mesma transação, existir uma vigência ATIVA de valor igual.
--     O cadastro atômico satisfaz a regra (a vigência é gravada antes do commit); o INSERT direto
--     com taxa e sem vigência falha e a linha NÃO é criada. Linha com os defaults (sem taxa) segue
--     livre, como é hoje: aparece nas pendências do motor.
--
-- DESENHO DE SEGURANÇA
--   * CONSTRAINT TRIGGER AFTER INSERT, DEFERRABLE INITIALLY DEFERRED, por linha (com WHEN que só enfileira
--     valor legado fora do default e chamador não isento). Verificado no commit:
--     a ordem entre o INSERT da entidade e o registrar_* deixa de importar, e não há flag, parâmetro
--     ou variável de sessão que o cliente possa ligar/desligar para escapar.
--   * Função SECURITY INVOKER: current_user é o chamador (authenticated no PostgREST). Exceção só
--     para postgres/service_role, igual aos gatilhos 025 (migrations, scripts do dono, Admin API);
--     authenticated NÃO ganha bypass. Sob RLS, a leitura da vigência só funciona para admin em AAL2,
--     o mesmo nível que o INSERT exige: quem não enxerga a vigência é tratado como "sem vigência"
--     (falha fechada).
--   * Só age com o motor LIGADO (gatilhos de bloqueio de taxa habilitados no momento do commit).
--     Com o motor desligado valem as regras legadas e o AAL2 dos gatilhos 032, inalterados.
--   * Sem EXECUTE para anon/authenticated/public (não é chamável por RPC).
--   * Não toca policies, grants de tabela, cálculos, dados existentes, motor ou a migration 032.
--
-- ROLLBACK: docs/runbooks/rollback-taxa-legada-vigencia.sql (dropa os 3 gatilhos e a função). Dados
-- não mudam. Reverter só o aplicativo não é necessário: nenhuma tela depende desta migration.

begin;

create or replace function public.exigir_vigencia_na_taxa_legada()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  _ligado boolean;
  _confere boolean;
begin
  if current_user in ('postgres', 'service_role') then
    return null;
  end if;

  -- "Motor ligado" = o gatilho de bloqueio de taxa direta do contrato habilitado: é o mesmo mecanismo
  -- que alterar_motor_vigencia (025/027) liga e desliga na mesma transação da chave
  -- financial_engine_settings.vigencia_ativa (o estado_motor_vigencia confere os dois). O catálogo é
  -- legível por qualquer papel; a tabela da chave está sob RLS, e ler a chave daqui poderia devolver
  -- "sem linha" a um chamador sem acesso e abrir a verificação.
  select exists (
    select 1 from pg_trigger
     where tgrelid = 'public.contracts'::regclass
       and tgname = 'trg_contracts_bloqueia_taxa_direta'
       and tgenabled = 'O' and not tgisinternal
  ) into _ligado;
  if not _ligado then
    return null;
  end if;

  if tg_table_name = 'contracts' then
    -- nasceu com os defaults da tabela: nenhuma taxa foi introduzida
    if new.daily_rate = 0 and new.shift_hours = 8 and new.ot_factor = 1 and new.ot_tolerance_min = 10 then
      return null;
    end if;
    select exists (
      select 1 from public.contract_terms t
       where t.contract_id = new.id and t.active
         and t.daily_rate = new.daily_rate and t.shift_hours = new.shift_hours
         and t.ot_factor = new.ot_factor and t.ot_tolerance_min = new.ot_tolerance_min
    ) into _confere;
  elsif tg_table_name = 'employees' then
    if new.daily_cost = 0 then
      return null;
    end if;
    select exists (
      select 1 from public.employee_cost_terms t
       where t.employee_id = new.id and t.active and t.daily_cost = new.daily_cost
    ) into _confere;
  else
    if new.agreed_amount is null then
      return null;
    end if;
    select exists (
      select 1 from public.operation_terms t
       where t.operation_id = new.id and t.active and t.agreed_amount = new.agreed_amount
    ) into _confere;
  end if;

  if not _confere then
    raise exception 'Com o motor por vigência ligado, taxa, custo ou valor acordado só entram por registro de vigência (data de início e motivo), não por INSERT direto.'
      using errcode = '55000',
            hint = 'Use o cadastro com vigência (criar_contrato_com_vigencia, criar_colaborador_com_vigencia, criar_operacao_com_vigencia).';
  end if;
  return null;
end;
$$;

revoke all on function public.exigir_vigencia_na_taxa_legada() from public, anon, authenticated;

-- O WHEN só enfileira a verificação para linha que introduz valor legado fora do default e para
-- chamador que não é postgres/service_role. Linhas sem taxa e cargas do dono (migrations, scripts)
-- nem entram na fila de eventos deferidos. A função repete as mesmas condições por dentro.
create constraint trigger trg_contracts_exige_vigencia_na_taxa
  after insert on public.contracts
  deferrable initially deferred
  for each row
  when (current_user not in ('postgres', 'service_role')
        and (new.daily_rate <> 0 or new.shift_hours <> 8 or new.ot_factor <> 1 or new.ot_tolerance_min <> 10))
  execute function public.exigir_vigencia_na_taxa_legada();
create constraint trigger trg_employees_exige_vigencia_na_taxa
  after insert on public.employees
  deferrable initially deferred
  for each row
  when (current_user not in ('postgres', 'service_role') and new.daily_cost <> 0)
  execute function public.exigir_vigencia_na_taxa_legada();
create constraint trigger trg_operations_exige_vigencia_na_taxa
  after insert on public.operations
  deferrable initially deferred
  for each row
  when (current_user not in ('postgres', 'service_role') and new.agreed_amount is not null)
  execute function public.exigir_vigencia_na_taxa_legada();

commit;
