-- Proteção das fontes da derivação financeira e do lastro faturado.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor do Supabase, ou execute
-- contra o banco local, e rode de uma vez. Termina em `rollback`: nenhum dado
-- é criado, alterado ou removido.
--
-- POR QUE O `set local role`: o SQL Editor conecta como `postgres`, dono das
-- tabelas, e nessa sessão a RLS não é aplicada. Cada bloco troca para
-- `authenticated` e injeta `request.jwt.claims`. Os claims usam `aal2` porque
-- é o único estado que hoje alcança as tabelas de negócio — o que se mede aqui
-- é papel e coluna, não AAL.
--
-- ESTE TESTE FOI ESCRITO ANTES DA MIGRATION, DE PROPÓSITO.
--
-- Rodando contra o schema anterior à 011, os casos J1..J13, J22..J27, J35 e
-- J36 FALHAM, e é essa falha que documenta o buraco. Os casos J14..J21, J28,
-- J29, J32 e J33 passam ANTES e DEPOIS: são a prova de que a migration não
-- quebrou fluxo legítimo.
--
-- COLATERAL ESPERADO NO BASELINE: J30, J31, J34 e J36b também falham antes da
-- migration, mas por consequência, não por medição. No baseline as exclusões
-- destrutivas REALMENTE acontecem — J26 apaga a operação faturada e a cascata
-- leva junto o turno que J7 acabou de mover para ela, e J22..J27 apagam o
-- apontamento que J34 e J36b conferem. Depois da migration nada disso é
-- apagado e os quatro passam. Isso é inerente a medir destruição: não dá para
-- observar o estado posterior de um registro cuja exclusão o baseline permite.
--
-- SEGUNDA RODADA. Os casos J41..J58 vieram da revisão que apontou três
-- caminhos ainda abertos na primeira versão da 011. Contra o schema anterior:
--
--   MEDEM O BURACO e falham: J41..J45, J49, J52, J54, J56, J57
--   COLATERAL e falham:      J46, J47, J48 — no baseline J45 apaga mesmo a
--                            fatura, e não há o que conferir depois
--   PASSAM ANTES E DEPOIS:   J50, J51, J53, J55, J58, J58b — a prova de que
--                            reenvio legítimo, decisão administrativa, fluxo
--                            diário e `gerar_fatura` não foram atingidos
--
-- TERCEIRA RODADA. Os casos J59..J82 vieram da revisão seguinte, que mostrou
-- que proteger o vínculo e o DELETE deixava a LINHA faturada editável — e
-- editá-la reescrevia os valores. Contra o schema anterior:
--
--   MEDEM O BURACO e falham: J59..J68, J71, J73..J76, J78, J80, J81
--   COLATERAL e falham:      J70, J82 — no baseline as edições acontecem de
--                            verdade, então não há estado posterior íntegro
--                            para conferir. J70 chega a 5000.00 no baseline:
--                            J64 move a entry para a folha do Contrato Caro e
--                            a derivação recalcula em cima dele
--   PASSAM ANTES E DEPOIS:   J69, J72, J77, J79 — reenvio sem alteração, folha
--                            sem faturamento e turno sem folha
--
-- QUARTA RODADA. Os casos J83..J92 vieram da revisão seguinte. Contra o schema
-- anterior:
--
--   MEDEM O BURACO e falham: J83, J84, J85, J87, J89
--   COLATERAL e falham:      J91, J92 — no baseline os movimentos acontecem
--                            mesmo, e a varredura final encontra o estrago
--   PASSAM ANTES E DEPOIS:   J86, J88, J90 — reenvio do mesmo cliente,
--                            movimento de turno sem nenhuma referência, e o
--                            turno com folha E equipe, que a metade "folha"
--                            da guarda anterior já recusava
--
-- J82, J91 e J92 varrem o BANCO INTEIRO, não só a fixture. É deliberado: são
-- invariantes, não casos. A contrapartida é que rodar a suíte contra um banco
-- que já carregue incoerência herdada faz os três acusarem — e é exatamente o
-- que se quer que aconteça.
--
-- A CORRIDA NÃO CABE AQUI. J82, J91 e J92 varrem o estado final, mas uma suíte
-- roda numa transação só e não consegue exercitar duas sessões. A prova da
-- corrida entre criar folha e mover turno está em
-- `scratchpad/corrida.sh`, com duas sessões psql — comandos e resultados
-- documentados no PR.

begin;

create temporary table _resultado (
  ordem    serial,
  caso     text,
  esperado text,
  obtido   text,
  situacao text
) on commit drop;

create or replace function pg_temp.registrar(
  _caso text, _esperado text, _obtido text
) returns void language plpgsql security definer as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, _obtido,
          case when _esperado = _obtido then 'PASS' else 'FAIL' end);
end;
$$;


-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email) values
  ('11111111-1111-4111-8111-111111111111', 'Admin',       'admin@example.invalid'),
  ('88888888-8888-4888-8888-888888888888', 'Operacional', 'operacional@example.invalid');

insert into public.user_roles (user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('88888888-8888-4888-8888-888888888888', 'operacional');

-- Cliente B existe só como DESTINO: é para onde os casos de `client_id` tentam
-- mover a operação. Nunca recebe fatura nem apontamento.
insert into public.clients (id, name) values
  ('33333333-3333-4333-8333-333333333333', 'Cliente'),
  ('33333333-3333-4333-8333-33333333333b', 'Cliente B destino');

insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min) values
  ('33333333-3333-4333-8333-333333333334', '33333333-3333-4333-8333-333333333333',
   'Contrato', 200, 8, 1.5, 10),
  ('33333333-3333-4333-8333-333333333335', '33333333-3333-4333-8333-333333333333',
   'Contrato Caro', 5000, 8, 1.5, 10);

-- QUATRO operações, e a separação é necessária: no baseline os DELETE de
-- operacional REALMENTE funcionam, e se mirassem a OP-B a cascata levaria
-- turno, folha e apontamentos, fazendo os casos seguintes falharem por falta
-- de fixture em vez de falharem pelo que pretendem medir. Mesmo cuidado que o
-- 005 tem com o "Cliente Descartavel".
--
--   OP-A  histórico FATURADO — alvo dos casos que devem ser recusados
--   OP-B  limpa              — sustenta os casos que devem continuar passando
--   OP-C  descartável        — alvo dos DELETE de operacional (J12/J13)
--   OP-D  descartável        — alvo dos DELETE de admin (J32/J33)
insert into public.operations (id, client_id, contract_id, name, agreed_amount) values
  ('44444444-4444-4444-8444-4444444444a1', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'OP-A faturada', 250),
  ('44444444-4444-4444-8444-4444444444b1', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'OP-B limpa', 250),
  ('44444444-4444-4444-8444-4444444444c1', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'OP-C descartavel', 250),
  ('44444444-4444-4444-8444-4444444444d1', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'OP-D descartavel', 250),
  -- OP-F existe só para os casos de `operation_team`, e precisa ser separada:
  -- J21 apaga a equipe INTEIRA da OP-B, e uma alocação de fixture ali seria
  -- levada junto, quebrando aquele caso e sumindo com a desta.
  ('44444444-4444-4444-8444-4444444444f1', '33333333-3333-4333-8333-333333333333',
   '33333333-3333-4333-8333-333333333334', 'OP-F equipe', 250);

insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '44444444-4444-4444-8444-4444444444a1',
   'Turno A faturado', '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '44444444-4444-4444-8444-4444444444b1',
   'Turno B limpo',    '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '44444444-4444-4444-8444-4444444444c1',
   'Turno C descartavel', '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '44444444-4444-4444-8444-4444444444d1',
   'Turno D descartavel', '06:00:00', '15:00:00', 60, false),
  -- Os três turnos da OP-F cobrem as três combinações de referência que a
  -- guarda de movimento precisa distinguir.
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '44444444-4444-4444-8444-4444444444f1',
   'Turno F so com equipe',      '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', '44444444-4444-4444-8444-4444444444f1',
   'Turno F livre',              '06:00:00', '15:00:00', 60, false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', '44444444-4444-4444-8444-4444444444f1',
   'Turno F com folha e equipe', '06:00:00', '15:00:00', 60, false);

insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('66666666-6666-4666-8666-6666666666a1', '44444444-4444-4444-8444-4444444444a1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date),
  ('66666666-6666-4666-8666-6666666666b1', '44444444-4444-4444-8444-4444444444b1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date),
  -- Sem apontamento: existe só para dar ao turno F7 uma referência de folha.
  ('66666666-6666-4666-8666-6666666666f1', '44444444-4444-4444-8444-4444444444f1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', current_date);

insert into public.employees (id, name, daily_cost) values
  ('55555555-5555-4555-8555-5555555555a1', 'Colab A', 120),
  ('55555555-5555-4555-8555-5555555555b1', 'Colab B', 120),
  ('55555555-5555-4555-8555-5555555555c1', 'Colab C', 120),
  ('55555555-5555-4555-8555-5555555555d1', 'Colab D', 120);

-- A segunda fatura existe só para o caso "fatura A -> fatura B": trocar de
-- fatura não é menos grave que desvincular, e sem um segundo destino não dá
-- para medir isso.
insert into public.invoices (id, client_id, period_start, period_end, total_amount) values
  ('99999999-9999-4999-8999-999999999991', '33333333-3333-4333-8333-333333333333',
   current_date, current_date, 250),
  ('99999999-9999-4999-8999-999999999992', '33333333-3333-4333-8333-333333333333',
   current_date - 30, current_date - 30, 0);

insert into public.invoice_items (invoice_id, operation_id, description, amount) values
  ('99999999-9999-4999-8999-999999999991', '44444444-4444-4444-8444-4444444444a1',
   'Diárias', 250);

-- Apontamento FATURADO em OP-A, e rascunhos para os casos permitidos.
insert into public.timesheet_entries
  (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes) values
  ('77777777-7777-4777-8777-7777777777a1', '66666666-6666-4666-8666-6666666666a1',
   '55555555-5555-4555-8555-5555555555a1', '44444444-4444-4444-8444-4444444444a1',
   current_date, 'present', '06:00:00', '15:00:00', 60),
  ('77777777-7777-4777-8777-7777777777b1', '66666666-6666-4666-8666-6666666666b1',
   '55555555-5555-4555-8555-5555555555b1', '44444444-4444-4444-8444-4444444444b1',
   current_date, 'present', '06:00:00', '15:00:00', 60),
  ('77777777-7777-4777-8777-7777777777c1', '66666666-6666-4666-8666-6666666666b1',
   '55555555-5555-4555-8555-5555555555c1', '44444444-4444-4444-8444-4444444444b1',
   current_date, 'present', '06:00:00', '15:00:00', 60);

update public.timesheet_entries
   set invoice_id = '99999999-9999-4999-8999-999999999991'
 where id = '77777777-7777-4777-8777-7777777777a1';

-- Alocações de equipe da OP-F. Colaboradores DIFERENTES de propósito: o índice
-- `operation_team_um_ativo_por_colaborador` só admite uma alocação ativa por
-- colaborador, e `active` já nasce true. O Colab D fica de fora porque J21 o
-- usa.
insert into public.operation_team (operation_id, shift_id, employee_id) values
  ('44444444-4444-4444-8444-4444444444f1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
   '55555555-5555-4555-8555-5555555555c1'),
  ('44444444-4444-4444-8444-4444444444f1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
   '55555555-5555-4555-8555-5555555555b1');


-- ---------------------------------------------------------------------------
-- J1..J13. OPERACIONAL — colunas e autorização
-- ---------------------------------------------------------------------------

do $operacional_bloqueios$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set agreed_amount = 999999
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J1. operacional altera agreed_amount', 'recusou 42501', _e);

  begin
    update public.operations set contract_id = '33333333-3333-4333-8333-333333333335'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J2. operacional altera contract_id', 'recusou 42501', _e);

  begin
    update public.shifts set start_time = '04:00:00'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J3. operacional altera shifts.start_time', 'recusou 42501', _e);

  begin
    update public.shifts set end_time = '08:00:00'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J4. operacional altera shifts.end_time', 'recusou 42501', _e);

  begin
    update public.shifts set break_minutes = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J5. operacional altera shifts.break_minutes', 'recusou 42501', _e);

  begin
    update public.shifts set crosses_midnight = true
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J6. operacional altera crosses_midnight', 'recusou 42501', _e);

  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J7. operacional altera shifts.operation_id', 'recusou 42501', _e);

  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = '66666666-6666-4666-8666-6666666666b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J8. operacional altera timesheets.operation_id', 'recusou 42501', _e);

  begin
    update public.timesheets set shift_id = null
     where id = '66666666-6666-4666-8666-6666666666b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J9. operacional altera timesheets.shift_id', 'recusou 42501', _e);

  -- INSERT/DELETE barrados pela RLS não levantam erro no DELETE: a cláusula
  -- USING apenas remove as linhas. Por isso o DELETE confere linhas afetadas.
  begin
    insert into public.operations (id, client_id, name)
    values ('44444444-4444-4444-8444-4444444444f1', '33333333-3333-4333-8333-333333333333', 'Nova');
    _e := 'inseriu';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J10. operacional cria operação', 'recusou 42501', _e);

  begin
    insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1', '44444444-4444-4444-8444-4444444444b1',
            'Novo', '06:00:00', '15:00:00', 60, false);
    _e := 'inseriu';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J11. operacional cria turno', 'recusou 42501', _e);

  -- O turno vem ANTES da operação de propósito: no baseline o DELETE da
  -- operação funciona e a cascata leva o turno junto, e aí o caso do turno
  -- passaria vazio, medindo nada.
  delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  get diagnostics _n = row_count;
  perform pg_temp.registrar('J13. operacional apaga turno', '0 linhas', _n || ' linhas');

  delete from public.operations where id = '44444444-4444-4444-8444-4444444444c1';
  get diagnostics _n = row_count;
  perform pg_temp.registrar('J12. operacional apaga operação', '0 linhas', _n || ' linhas');
end;
$operacional_bloqueios$;


-- ---------------------------------------------------------------------------
-- J14..J21. OPERACIONAL — o que tem de continuar funcionando
-- ---------------------------------------------------------------------------

do $operacional_permitido$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set name = 'OP-B renomeada', site = 'Pátio 2', notes = 'obs'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J14. operacional edita name/site/notes da operação', '1 linhas', _e);

  begin
    update public.shifts set name = 'Turno renomeado'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J15. operacional edita name do turno', '1 linhas', _e);

  -- O fluxo diário: a tela de apontamento cria a folha quando não existe.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-6666666666c1', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date - 1, 'open');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J16. operacional cria folha (fluxo diário)', 'criou', _e);

  begin
    update public.timesheets set status = 'closed'
     where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J17. operacional muda status da folha', '1 linhas', _e);

  -- Falso positivo: a tela reenvia o objeto inteiro a cada gravação, então
  -- campo protegido IGUAL ao OLD não pode ser recusado.
  begin
    update public.operations
       set name = 'OP-B v2',
           contract_id = '33333333-3333-4333-8333-333333333334',
           agreed_amount = 250
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J18. reenvio de protegidos IGUAIS ao OLD é aceito', '1 linhas', _e);

  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J19. operacional apaga apontamento NÃO faturado', '1 linhas', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J20. operacional apaga folha SEM faturamento', '1 linhas', _e);

  begin
    insert into public.operation_team (operation_id, employee_id)
    values ('44444444-4444-4444-8444-4444444444b1', '55555555-5555-4555-8555-5555555555d1');
    delete from public.operation_team
     where operation_id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J21. operation_team segue livre para staff', '1 linhas', _e);
end;
$operacional_permitido$;


-- ---------------------------------------------------------------------------
-- J22..J27, J37, J38. LASTRO FATURADO — absoluto, para todos os papéis
-- ---------------------------------------------------------------------------

do $lastro$
declare
  _e text;
  _n integer;
begin
  -- J22. operacional
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas (RLS)' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J22. operacional apaga apontamento FATURADO', 'recusou 42501', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas (RLS)' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J24. operacional apaga folha com apontamento faturado', 'recusou 42501', _e);

  -- J23, J25, J26, J27. ADMIN também não pode
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);

  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J23. ADMIN apaga apontamento FATURADO', 'recusou 42501', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666a1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J25. ADMIN apaga folha com apontamento faturado', 'recusou 42501', _e);

  begin
    delete from public.operations where id = '44444444-4444-4444-8444-4444444444a1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J26. ADMIN apaga operação com histórico faturado', 'recusou 42501', _e);

  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J27. ADMIN apaga turno com histórico faturado', 'recusou 42501', _e);

  -- J37. service_role. A RLS não se aplica a ele, então o que tem de barrar é
  -- exclusivamente o trigger — que é justamente o ponto.
  execute 'reset role';
  execute 'set local role service_role';
  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J37. service_role apaga apontamento FATURADO', 'recusou 42501', _e);

  -- J38. postgres, dono das tabelas, sem RLS. Último bypass privilegiado
  -- possível dentro deste ambiente.
  execute 'reset role';
  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J38. postgres apaga apontamento FATURADO', 'recusou 42501', _e);
end;
$lastro$;


-- ---------------------------------------------------------------------------
-- J41..J48. VÍNCULO DE FATURA — imutável depois de vinculado
--
-- Sem esta camada o bloqueio de DELETE acima é contornável em dois passos:
-- desvincular primeiro, apagar depois. `protect_timesheet_invoice_link` não
-- ajuda aqui, porque ela isenta exatamente quem tem esse poder — admin,
-- `postgres` e `service_role`.
--
-- J45..J48 medem o efeito colateral DESEJADO: como a FK é ON DELETE SET NULL,
-- apagar a fatura tentaria desvincular, e agora falha. A fatura, os itens e o
-- vínculo continuam de pé.
-- ---------------------------------------------------------------------------

do $vinculo$
declare
  _e text;
  _n integer;
  _v uuid;
begin
  -- J41. admin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheet_entries set invoice_id = null
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'DESVINCULOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J41. ADMIN faz invoice_id -> NULL', 'recusou 42501', _e);

  -- J44. trocar de fatura é o mesmo problema, com outra roupa.
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999992'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'TROCOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J44. ADMIN troca fatura A -> fatura B', 'recusou 42501', _e);

  -- J45. apagar a FATURA é o caminho indireto: a FK faria o SET NULL.
  begin
    delete from public.invoices where id = '99999999-9999-4999-8999-999999999991';
    _e := 'APAGOU a fatura';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J45. ADMIN apaga FATURA com lastro vinculado', 'recusou 42501', _e);

  -- J42. service_role
  execute 'reset role';
  execute 'set local role service_role';
  begin
    update public.timesheet_entries set invoice_id = null
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'DESVINCULOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J42. service_role faz invoice_id -> NULL', 'recusou 42501', _e);

  -- J43. postgres, dono das tabelas.
  execute 'reset role';
  begin
    update public.timesheet_entries set invoice_id = null
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'DESVINCULOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J43. postgres faz invoice_id -> NULL', 'recusou 42501', _e);

  -- J46..J48. Nada do lastro se moveu.
  select count(*) into _n from public.invoices
   where id = '99999999-9999-4999-8999-999999999991';
  perform pg_temp.registrar('J46. fatura continua existindo', '1', _n::text);

  select count(*) into _n from public.invoice_items
   where invoice_id = '99999999-9999-4999-8999-999999999991';
  perform pg_temp.registrar('J47. invoice_items continuam', '1', _n::text);

  select invoice_id into _v from public.timesheet_entries
   where id = '77777777-7777-4777-8777-7777777777a1';
  perform pg_temp.registrar('J48. apontamento mantém o mesmo invoice_id',
    '99999999-9999-4999-8999-999999999991', coalesce(_v::text, 'NULL'));
end;
$vinculo$;


-- ---------------------------------------------------------------------------
-- J28..J33. ADMIN — o que continua podendo
-- ---------------------------------------------------------------------------

do $admin$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.operations (id, client_id, name, agreed_amount)
    values ('44444444-4444-4444-8444-4444444444e1', '33333333-3333-4333-8333-333333333333', 'Nova admin', 300);
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J28. admin cria operação', 'criou', _e);

  begin
    update public.operations
       set agreed_amount = 999, contract_id = '33333333-3333-4333-8333-333333333335'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J29. admin altera contract_id/agreed_amount', '1 linhas', _e);

  begin
    update public.shifts set end_time = '16:00:00', break_minutes = 30
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J30. admin altera jornada do turno', '1 linhas', _e);

  begin
    update public.timesheets set shift_id = null
     where id = '66666666-6666-4666-8666-6666666666b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J31. admin altera vínculo da folha', '1 linhas', _e);

  -- OP-D e o turno D são descartáveis e não têm histórico faturado: o admin
  -- apaga normalmente, e é isso que separa "sem lastro" de "com lastro".
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J33. admin apaga turno SEM histórico faturado', '1 linhas', _e);

  begin
    delete from public.operations where id = '44444444-4444-4444-8444-4444444444d1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J32. admin apaga operação SEM histórico faturado', '1 linhas', _e);
end;
$admin$;


-- ---------------------------------------------------------------------------
-- J34..J36. Invariante de fatura e o ataque completo
-- ---------------------------------------------------------------------------

do $invariante$
declare
  _entries integer;
  _total   numeric;
  _e       text;
  _billed  numeric;
begin
  execute 'reset role';

  -- J34. Depois de todas as tentativas acima, a fatura continua com o lastro
  -- que originou o seu valor.
  select count(*) into _entries
    from public.timesheet_entries
   where invoice_id = '99999999-9999-4999-8999-999999999991';
  select total_amount into _total
    from public.invoices where id = '99999999-9999-4999-8999-999999999991';
  perform pg_temp.registrar('J34. fatura continua com lastro',
    '1 apontamentos / 250.00',
    _entries || ' apontamentos / ' || to_char(_total, 'FM999999990.00'));

  -- J35/J36. Ataque completo: inflar a fonte, gravar, restaurar.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set agreed_amount = 999999
     where id = '44444444-4444-4444-8444-4444444444a1';
    _e := 'passo 1 passou';
  exception when insufficient_privilege then _e := 'bloqueado no passo 1';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J35. ataque via agreed_amount', 'bloqueado no passo 1', _e);

  begin
    update public.shifts set end_time = '08:00:00', break_minutes = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    _e := 'passo 1 passou';
  exception when insufficient_privilege then _e := 'bloqueado no passo 1';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J36. ataque via jornada do turno', 'bloqueado no passo 1', _e);

  -- E o apontamento faturado continua com o valor legítimo.
  execute 'reset role';
  select billed_amount into _billed from public.timesheet_entries
   where id = '77777777-7777-4777-8777-7777777777a1';
  perform pg_temp.registrar('J36b. apontamento faturado intacto', '200.00',
    to_char(_billed, 'FM999999990.00'));
end;
$invariante$;


-- ---------------------------------------------------------------------------
-- J39, J40. Exclusão de cliente
-- ---------------------------------------------------------------------------

do $cliente$
declare
  _e text;
  _n integer;
begin
  -- J39. O operacional nunca alcança DELETE em clients — isso já era garantido
  -- pela policy `clients_write_admin`, anterior a esta migration. O caso existe
  -- para que uma futura mudança naquela policy não passe despercebida.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    delete from public.clients where id = '33333333-3333-4333-8333-333333333333';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J39. operacional apaga cliente', '0 linhas', _e);

  -- J40. O advisory lock por cliente é o que serializa `gerar_fatura` e o
  -- DELETE de cliente. Sem ele existe janela: a fatura pode nascer entre a
  -- verificação e o commit. Se alguém remover o lock, este caso acusa.
  execute 'reset role';
  select count(*) into _n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'bloquear_delete_cliente_faturado'
     and p.prosrc like '%pg_advisory_xact_lock(hashtextextended(%';
  perform pg_temp.registrar('J40. guarda de cliente usa o mesmo advisory lock', '1', _n::text);
end;
$cliente$;


-- ---------------------------------------------------------------------------
-- J49..J52. operations.client_id — administrativo como contrato e valor
--
-- `client_id` não entra na fórmula, mas decide QUEM paga: `gerar_fatura` filtra
-- os elegíveis por `operations.client_id`. Mover a operação para outro cliente,
-- faturar e devolvê-la tem a mesma silhueta do ataque de `agreed_amount` — a
-- configuração volta ao normal e a cobrança errada fica de pé.
-- ---------------------------------------------------------------------------

do $cliente_da_operacao$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J49. operacional muda operations.client_id', 'recusou 42501', _e);

  -- Mesmo falso positivo de J18: a tela reenvia o objeto inteiro, e reenviar
  -- `client_id` IGUAL ao OLD junto de uma edição legítima não pode ser recusado.
  begin
    update public.operations
       set notes = 'observação do dia',
           client_id = '33333333-3333-4333-8333-333333333333'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J50. reenvio de client_id IGUAL ao OLD é aceito', '1 linhas', _e);

  -- J52. Ataque completo, com o passo 1 sendo o que importa: se ele passasse,
  -- o resto seria indetectável depois da restauração.
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444a1';
    _e := 'passo 1 passou';
  exception when insufficient_privilege then _e := 'bloqueado no passo 1';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J52. ataque via client_id', 'bloqueado no passo 1', _e);

  -- J51. Admin continua podendo: é decisão administrativa, não proibição.
  -- OP-C é descartável e não tem histórico faturado.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51. admin muda client_id', '1 linhas', _e);
end;
$cliente_da_operacao$;


-- ---------------------------------------------------------------------------
-- J53..J57. Par operação/turno — invariante estrutural
--
-- Não é questão de papel: nem admin deve conseguir montar uma folha cujo turno
-- pertence a outra operação. A derivação leria a taxa de uma ponta e a jornada
-- prevista da outra, fabricando hora extra que ninguém configurou. Por isso o
-- erro é 23514 (violação de invariante) e não 42501 (privilégio) — não existe
-- papel que possa.
-- ---------------------------------------------------------------------------

do $par$
declare
  _e text;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J53. Par VÁLIDO: é o fluxo diário e continua livre.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e001', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date - 2, 'open');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J53. operacional cria folha com par VÁLIDO', 'criou', _e);

  -- J54. Par INVÁLIDO: operação B com o turno da operação A.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e002', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date - 3, 'open');
    _e := 'CRIOU par inválido';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J54. operacional cria folha com par INVÁLIDO', 'recusou 23514', _e);

  -- J55. Sem turno segue válido: a coluna é anulável no modelo atual e o
  -- painel cria folha sem turno. Esta migration não inventa proibição nova.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e003', '44444444-4444-4444-8444-4444444444b1',
            null, current_date - 4, 'open');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J55. folha com shift_id NULL segue aceita', 'criou', _e);

  -- J56. ADMIN também não monta par inválido.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e004', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date - 5, 'open');
    _e := 'CRIOU par inválido';
  exception when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J56. ADMIN cria folha com par INVÁLIDO', 'recusou 23514', _e);

  -- J57. E o UPDATE que PRODUZIRIA um par inválido também é recusado: a folha
  -- de J53 é válida hoje, e mudar só a operação a tornaria inválida.
  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = '66666666-6666-4666-8666-66666666e001';
    _e := 'ALTEROU para par inválido';
  exception when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J57. UPDATE que produziria par inválido', 'recusou 23514', _e);
end;
$par$;


-- ---------------------------------------------------------------------------
-- J59..J71. APONTAMENTO FATURADO — a LINHA inteira é imutável
--
-- Proteger o vínculo e o DELETE não bastava: a linha seguia editável, e editar
-- REESCREVIA os valores. O alvo é sempre o apontamento faturado da OP-A, que
-- vale 200.00 e está dentro de uma fatura de 250.00.
--
-- J71 é o caso que separa "lista de seis colunas" de "invariante sobre a
-- linha": `created_at` não aparece em nenhuma lista de campos de negócio, e
-- mesmo assim não pode ser reescrito numa linha faturada.
-- ---------------------------------------------------------------------------

do $entry_faturada$
declare
  _e text;
  _n integer;
  _b numeric;
  _c numeric;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.timesheet_entries set status = 'absent'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J59. operacional muda status de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set check_in = '04:00:00'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J60. operacional muda check_in de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set check_out = '23:00:00'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J61. operacional muda check_out de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set break_minutes = 0
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J62. operacional muda break_minutes de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set employee_id = '55555555-5555-4555-8555-5555555555d1'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J63. operacional muda employee_id de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set timesheet_id = '66666666-6666-4666-8666-6666666666b1'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J64. operacional muda timesheet_id de entry faturada', 'recusou 42501', _e);

  -- Descritivo também: um histórico faturado não muda de narrativa em silêncio.
  begin
    update public.timesheet_entries set notes = 'reescrito depois da fatura'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J65. operacional muda notes de entry faturada', 'recusou 42501', _e);

  -- J66..J68. E não é questão de papel.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    update public.timesheet_entries set status = 'absent'
     where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J66. ADMIN muda status de entry faturada', 'recusou 42501', _e);

  execute 'reset role';
  execute 'set local role service_role';
  begin
    update public.timesheet_entries set notes = 'service_role'
     where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J67. service_role muda notes de entry faturada', 'recusou 42501', _e);

  execute 'reset role';
  begin
    update public.timesheet_entries set notes = 'postgres'
     where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J68. postgres muda notes de entry faturada', 'recusou 42501', _e);

  -- J71. A guarda compara a LINHA, não uma lista: `created_at` não é campo de
  -- negócio e mesmo assim não pode ser reescrito depois da fatura.
  begin
    update public.timesheet_entries set created_at = now() - interval '1 year'
     where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J71. até created_at de entry faturada é recusado', 'recusou 42501', _e);

  -- J69. Falso positivo: a tela reenvia o objeto inteiro. Reenviar os MESMOS
  -- valores não pode virar 42501, nem em linha faturada.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheet_entries
       set status = 'present', check_in = '06:00:00', check_out = '15:00:00', break_minutes = 60
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J69. reenvio SEM alteração material é aceito', '1 linhas', _e);

  -- J70. E depois de tudo isso, incluindo o reenvio, nada foi recalculado.
  execute 'reset role';
  select billed_amount, cost_amount into _b, _c
    from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
  perform pg_temp.registrar('J70. valores da entry faturada sem recálculo',
    '200.00 / 120.00',
    to_char(_b, 'FM999999990.00') || ' / ' || to_char(_c, 'FM999999990.00'));
end;
$entry_faturada$;


-- ---------------------------------------------------------------------------
-- J72..J78. FOLHA FATURADA — data, operação e turno congelados
--
-- `gerar_fatura` escolhe o período por `t.work_date`. Mover a data depois de
-- faturar joga o lastro para outro período sem tocar na fatura.
-- ---------------------------------------------------------------------------

do $folha_faturada$
declare
  _e text;
  _n integer;
begin
  -- J72. Folha SEM apontamento faturado continua editável. `...e001` foi criada
  -- em J53 e não tem apontamento nenhum.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheets set work_date = current_date - 10
     where id = '66666666-6666-4666-8666-66666666e001';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J72. folha SEM faturamento muda work_date', '1 linhas', _e);

  -- J74. Folha COM apontamento faturado: nem admin.
  begin
    update public.timesheets set work_date = current_date - 40
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J74. ADMIN muda work_date de folha faturada', 'recusou 42501', _e);

  -- J77. Reenviar a MESMA data não pode virar 42501.
  begin
    update public.timesheets set work_date = current_date, status = 'closed'
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J77. reenvio do MESMO work_date é aceito', '1 linhas', _e);

  -- J73. operacional
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    update public.timesheets set work_date = current_date - 41
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J73. operacional muda work_date de folha faturada', 'recusou 42501', _e);

  -- J75, J76. service_role e postgres
  execute 'reset role';
  execute 'set local role service_role';
  begin
    update public.timesheets set work_date = current_date - 42
     where id = '66666666-6666-4666-8666-6666666666a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J75. service_role muda work_date de folha faturada', 'recusou 42501', _e);

  execute 'reset role';
  begin
    update public.timesheets set work_date = current_date - 43
     where id = '66666666-6666-4666-8666-6666666666a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J76. postgres muda work_date de folha faturada', 'recusou 42501', _e);

  -- J78. A corrida com `gerar_fatura` é fechada pelo mesmo advisory lock por
  -- cliente. Se alguém remover o lock, este caso acusa — como o J40.
  select count(*) into _n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'bloquear_alteracao_folha_faturada'
     and p.prosrc like '%pg_advisory_xact_lock(hashtextextended(%';
  perform pg_temp.registrar('J78. guarda da folha usa o mesmo advisory lock', '1', _n::text);
end;
$folha_faturada$;


-- ---------------------------------------------------------------------------
-- J79..J82. TURNO REFERENCIADO — o par visto do outro lado
--
-- `validar_par_operacao_turno` guarda a folha. Sem esta guarda o par podia ser
-- quebrado movendo o TURNO, sem tocar em folha nenhuma.
-- ---------------------------------------------------------------------------

do $turno$
declare
  _e text;
  _n integer;
  _incoerentes integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J79. Turno C não é referenciado por folha nenhuma: mover é legítimo.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J79. admin move turno SEM folha', '1 linhas', _e);

  -- J80. Turno B é referenciado pela folha criada em J53, que não tem
  -- faturamento. Basta ser referenciado.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    _e := 'MOVEU';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J80. admin move turno referenciado por folha SEM fatura', 'recusou 23514', _e);

  -- J81. Turno A é referenciado pela folha do apontamento faturado.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    _e := 'MOVEU';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J81. admin move turno referenciado por folha FATURADA', 'recusou 23514', _e);

  -- J82. Depois de tudo, nenhuma folha do banco tem turno de outra operação.
  execute 'reset role';
  select count(*) into _incoerentes
    from public.timesheets t
    join public.shifts s on s.id = t.shift_id
   where s.operation_id is distinct from t.operation_id;
  perform pg_temp.registrar('J82. nenhum par operação/turno incoerente no banco',
    '0', _incoerentes::text);
end;
$turno$;


-- ---------------------------------------------------------------------------
-- J83..J87. CLIENTE DE OPERAÇÃO FATURADA
--
-- A fatura é imutável e guarda o cliente original; o extrato resolve o cliente
-- pelo `operations.client_id` de hoje. Mover o cliente de uma operação já
-- faturada faz os dois discordarem sobre quem pagou o quê.
--
-- J51, mais acima, prova o outro lado: operação SEM faturamento continua livre
-- para o admin. A proteção é sobre o passado, não sobre a operação.
-- ---------------------------------------------------------------------------

do $cliente_faturado$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J83. ADMIN muda client_id de operação FATURADA', 'recusou 42501', _e);

  -- J86. Reenvio do MESMO cliente não pode virar 42501, nem aqui.
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-333333333333',
                                 notes = 'anotação administrativa'
     where id = '44444444-4444-4444-8444-4444444444a1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J86. reenvio do MESMO client_id em operação faturada', '1 linhas', _e);

  execute 'reset role';
  execute 'set local role service_role';
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J84. service_role muda client_id de operação FATURADA', 'recusou 42501', _e);

  execute 'reset role';
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J85. postgres muda client_id de operação FATURADA', 'recusou 42501', _e);

  -- J87. A corrida com `gerar_fatura` é fechada pelo advisory lock por cliente,
  -- como em J40 e J78.
  select count(*) into _n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'bloquear_cliente_operacao_faturada'
     and p.prosrc like '%pg_advisory_xact_lock(hashtextextended(%';
  perform pg_temp.registrar('J87. guarda de cliente da operação usa o advisory lock', '1', _n::text);
end;
$cliente_faturado$;


-- ---------------------------------------------------------------------------
-- J88..J91. `operation_team` também é uso do turno
--
-- Uma alocação guarda `operation_id` E `shift_id`. Mover o turno sem mover a
-- alocação deixa o par quebrado, o colaborador some da tela de apontamento, e
-- o índice de alocação exclusiva impede realocá-lo — ele fica preso. Não é
-- dano financeiro, e foi por isso que passou despercebido antes.
-- ---------------------------------------------------------------------------

do $equipe$
declare
  _e text;
  _n integer;
  _incoerentes integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J89. Só equipe, sem folha nenhuma: basta isso para recusar.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    _e := 'MOVEU';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J89. admin move turno com SÓ operation_team', 'recusou 23514', _e);

  -- J90. Folha e equipe ao mesmo tempo.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
    _e := 'MOVEU';
  exception when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J90. admin move turno com folha E equipe', 'recusou 23514', _e);

  -- J88. Nenhuma referência: mover continua sendo decisão administrativa
  -- legítima. Sem este caso a guarda poderia estar recusando tudo.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J88. admin move turno SEM folha e SEM equipe', '1 linhas', _e);

  -- J91. Invariante B: varredura do banco inteiro.
  execute 'reset role';
  select count(*) into _incoerentes
    from public.operation_team ot
    join public.shifts s on s.id = ot.shift_id
   where s.operation_id is distinct from ot.operation_id;
  perform pg_temp.registrar('J91. nenhuma alocação apontando para turno de outra operação',
    '0', _incoerentes::text);
end;
$equipe$;


-- ---------------------------------------------------------------------------
-- J92. Invariante C, varrida no banco inteiro
--
-- Todo apontamento faturado precisa estar sob o mesmo cliente que a fatura que
-- o cobra. É a formulação global do que J83..J85 medem caso a caso, e o que
-- falharia em silêncio se alguém afrouxasse aquela guarda depois.
-- ---------------------------------------------------------------------------

do $invariante_cliente$
declare
  _divergentes integer;
begin
  execute 'reset role';
  select count(*) into _divergentes
    from public.timesheet_entries te
    join public.invoices   i ON i.id = te.invoice_id
    join public.timesheets t ON t.id = te.timesheet_id
    join public.operations o ON o.id = t.operation_id
   where o.client_id is distinct from i.client_id;
  perform pg_temp.registrar('J92. nenhum lastro faturado sob cliente diferente da fatura',
    '0', _divergentes::text);
end;
$invariante_cliente$;


-- ---------------------------------------------------------------------------
-- J58. O caminho legítimo continua aberto
--
-- Todo o resto deste arquivo mede recusa. Este caso mede o oposto, e é o que
-- impede que a proteção do vínculo tenha fechado o faturamento junto: vincular
-- a partir de NULL é exatamente o que `gerar_fatura` faz, e continua passando.
-- ---------------------------------------------------------------------------

do $faturamento$
declare
  _e          text;
  _nova       public.invoices;
  _vinculados integer;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    _nova := public.gerar_fatura(
      '33333333-3333-4333-8333-333333333333', current_date, current_date);
    _e := 'gerou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J58. gerar_fatura ainda vincula NULL -> invoice_id', 'gerou', _e);

  execute 'reset role';
  select count(*) into _vinculados
    from public.timesheet_entries where invoice_id = _nova.id;
  perform pg_temp.registrar('J58b. a nova fatura recebeu lastro',
    'pelo menos 1', case when _vinculados >= 1 then 'pelo menos 1'
                         else _vinculados::text end);
end;
$faturamento$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

do $relatorio$
declare
  _linha  record;
  _falhas integer;
begin
  reset role;
  raise notice '';
  raise notice '=== 007 — fontes financeiras e lastro faturado ===';
  for _linha in select * from _resultado order by ordem loop
    raise notice '% % (esperado: % | obtido: %)',
      rpad(_linha.situacao, 5), _linha.caso, _linha.esperado, _linha.obtido;
  end loop;

  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  raise notice '';
  raise notice 'total: % casos, % falhas', (select count(*) from _resultado), _falhas;

  if _falhas > 0 then
    raise exception '007: % casos falharam', _falhas;
  end if;
end;
$relatorio$;

rollback;
