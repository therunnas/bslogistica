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
--                            (J51 foi realinhado à 021: o admin move o cliente
--                            junto com o contrato; ver J51a..J51e)
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
-- QUINTA RODADA. Os casos J93..J107 vieram da revisão seguinte, e os três
-- achados são consequência das correções anteriores. Contra o schema anterior:
--
--   MEDEM O BURACO e falham: J93..J96, J98..J104, J106, J107
--   PASSAM ANTES E DEPOIS:   J97, J105, J58c, J58d, J58e — o contexto de
--                            `gerar_fatura` vinculando, a alocação com par
--                            válido, e as três invariantes semânticas que já
--                            eram verdadeiras por construção da RPC
--
-- SEXTA RODADA. Os casos J108..J113 acompanham a troca da pergunta na guarda
-- de DELETE de turno: de "tem apontamento faturado" para "tem folha". Contra o
-- schema anterior:
--
--   MEDEM O BURACO e falham: J109, J110, J111, J113
--   PASSAM ANTES E DEPOIS:   J108, J112 — turno sem folha segue excluível, e o
--                            turno do lastro faturado já era protegido
--
-- J113 registra uma MUDANÇA DE COMPORTAMENTO, não um buraco fechado: como não
-- há exceção por cascata, apagar operação ou cliente que tenha qualquer folha
-- passa a falhar mesmo sem faturamento. O caminho é apagar as folhas antes
-- (J20) ou inativar.
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

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('88888888-8888-4888-8888-888888888888')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('e8888888-8888-4888-8888-888888888888', '88888888-8888-4888-8888-888888888888');

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
   'Turno F com folha e equipe', '06:00:00', '15:00:00', 60, false),
  -- Destino do J31: existe só para uma folha VAZIA ter para onde apontar.
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa1a', '44444444-4444-4444-8444-4444444444f1',
   'Turno F destino', '06:00:00', '15:00:00', 60, false);

insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('66666666-6666-4666-8666-6666666666a1', '44444444-4444-4444-8444-4444444444a1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date),
  ('66666666-6666-4666-8666-6666666666b1', '44444444-4444-4444-8444-4444444444b1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date),
  -- Sem apontamento: existe só para dar ao turno F7 uma referência de folha.
  ('66666666-6666-4666-8666-6666666666f1', '44444444-4444-4444-8444-4444444444f1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', current_date),
  -- Folha VAZIA, sem turno, alvo do J31. Precisa ser vazia: desde a sétima
  -- rodada, folha COM apontamento não muda mais de operação nem de turno.
  ('66666666-6666-4666-8666-6666666666e1', '44444444-4444-4444-8444-4444444444f1',
   null, current_date - 7);

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
-- J1..J13. OPERACIONAL — a RLS impede antes do trigger (migration 016)
--
-- CONTRATO ATUALIZADO. Antes da `016`, o operador ALCANÇAVA estas linhas — pela
-- permissiva por `is_staff()`, verdadeira para qualquer papel — e era o
-- TRIGGER quem o recusava, com 42501. A `016` acrescentou a exigência de
-- `admin` para acesso direto, então agora ele nem chega lá: o UPDATE não
-- encontra linha e o INSERT morre na WITH CHECK.
--
-- A proteção do trigger NÃO foi perdida nesta suíte: o bloco seguinte,
-- `J1a..J11a`, repete cada tentativa como ADMIN — que alcança a linha — e mede
-- que a recusa com 42501 continua de pé. Duas camadas, medidas separadamente.
-- ---------------------------------------------------------------------------

do $operacional_bloqueios$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set agreed_amount = 999999
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J1. operacional nao alcanca agreed_amount', 'sem efeito', _e);

  begin
    update public.operations set contract_id = '33333333-3333-4333-8333-333333333335'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J2. operacional nao alcanca contract_id', 'sem efeito', _e);

  begin
    update public.shifts set start_time = '04:00:00'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J3. operacional nao alcanca shifts.start_time', 'sem efeito', _e);

  begin
    update public.shifts set end_time = '08:00:00'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J4. operacional nao alcanca shifts.end_time', 'sem efeito', _e);

  begin
    update public.shifts set break_minutes = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J5. operacional nao alcanca shifts.break_minutes', 'sem efeito', _e);

  begin
    update public.shifts set crosses_midnight = true
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J6. operacional nao alcanca crosses_midnight', 'sem efeito', _e);

  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J7. operacional nao alcanca shifts.operation_id', 'sem efeito', _e);

  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444a1'
     where id = '66666666-6666-4666-8666-6666666666b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J8. operacional nao alcanca timesheets.operation_id', 'sem efeito', _e);

  begin
    update public.timesheets set shift_id = null
     where id = '66666666-6666-4666-8666-6666666666b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J9. operacional nao alcanca timesheets.shift_id', 'sem efeito', _e);

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
-- J7a..J9a. ADMIN — o congelamento real, medido em quem alcança a linha
--
-- Este bloco existe por causa da `016`. Os casos J1..J9 acima mediam o
-- operador chegando ao trigger e sendo recusado; agora a RLS o impede antes, e
-- a recusa dele virou "sem efeito". Isso NÃO perde cobertura de trigger:
--
--   - J1..J6 (agreed_amount, contract_id, jornada do turno) nunca foram
--     congelamento, e sim autorização por papel — o guard isenta admin de
--     propósito, porque aí se perde proveniência e não dinheiro. O lado do
--     admin já é medido em J29 e J30, que continuam onde estavam;
--   - o que era congelamento de verdade é o que segue aqui: remapear turno de
--     operação, e mexer no vínculo de uma folha COM apontamento faturado.
--     Nenhum dos três estava medido para o admin antes.
-- ---------------------------------------------------------------------------

do $admin_congelamento$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- Remapear o turno para outra operação é recusado por CHECK, não por guard:
  -- o SQLSTATE é `23514` e vale para qualquer papel que alcance a linha.
  begin
    update public.shifts set operation_id = '44444444-4444-4444-8444-4444444444c1'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J7a. admin remapeia turno de operação', 'erro 23514', _e);

  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444c1'
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J8a. admin altera operation_id de folha faturada', 'recusou 42501', _e);

  begin
    update public.timesheets set shift_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'alterou' else 'sem efeito' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J9a. admin altera shift_id de folha faturada', 'recusou 42501', _e);
end;
$admin_congelamento$;

-- ---------------------------------------------------------------------------
-- J14..J21. OPERACIONAL — o que ele fazia direto, e não faz mais
--
-- CONTRATO REVOGADO PELA MIGRATION 016. Este bloco media o caminho direto do
-- operador na tabela: renomear operação e turno, criar e fechar folha, apagar
-- apontamento não faturado, mexer em `operation_team`. Nada disso vinha do
-- papel `operacional` — vinha da permissiva por `is_staff()`, verdadeira para
-- qualquer papel atribuído, de quando `admin` era o único papel existente.
--
-- Desde a `013`/`015` o caminho do operador é a superfície estreita de RPC, e
-- a `016` fecha a porta larga: acesso direto exige `aal2` E `admin`. O que ele
-- de fato precisa fazer — apontar presença, entrada, saída e intervalo —
-- continua funcionando por `salvar_apontamento_operacional`, medido em `009`,
-- `011` e `012`.
--
-- O que era comportamento LEGÍTIMO aqui não se perdeu: os casos J14a..J18a,
-- logo abaixo, repetem como ADMIN o que não estava coberto em J28..J33 — em
-- especial o J18, que guarda um falso positivo real do guard financeiro.
-- ---------------------------------------------------------------------------

do $operacional_sem_acesso_direto$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set name = 'OP-B renomeada', site = 'Pátio 2', notes = 'obs'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J14. operacional NAO edita name/site/notes da operação', '0 linhas', _e);

  begin
    update public.shifts set name = 'Turno renomeado'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J15. operacional NAO edita name do turno', '0 linhas', _e);

  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-6666666666c1', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date - 1, 'open');
    _e := 'criou';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J16. operacional NAO cria folha direto', 'recusou 42501', _e);

  begin
    update public.timesheets set status = 'closed'
     where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J17. operacional NAO muda status da folha', '0 linhas', _e);

  begin
    update public.operations
       set name = 'OP-B v2',
           contract_id = '33333333-3333-4333-8333-333333333334',
           agreed_amount = 250
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J18. operacional NAO reenvia o objeto da operação', '0 linhas', _e);

  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J19. operacional NAO apaga apontamento não faturado', '0 linhas', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J20. operacional NAO apaga folha sem faturamento', '0 linhas', _e);

  begin
    insert into public.operation_team (operation_id, employee_id)
    values ('44444444-4444-4444-8444-4444444444b1', '55555555-5555-4555-8555-5555555555d1');
    _e := 'inseriu';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J21. operation_team deixou de ser livre para staff', 'recusou 42501', _e);
end;
$operacional_sem_acesso_direto$;


-- ---------------------------------------------------------------------------
-- J14a..J18a. ADMIN — o comportamento legítimo que estava só no bloco acima
--
-- Os casos J28..J33 já cobrem o admin criando operação, alterando
-- contract_id/agreed_amount e jornada, e apagando o que não tem histórico
-- faturado. O que NÃO estava coberto e vinha do bloco do operador vem para cá:
-- renomear operação e turno, o fluxo diário de criar e fechar folha, apagar
-- apontamento não faturado, `operation_team`, e — o mais importante — o falso
-- positivo do guard: a tela reenvia o objeto inteiro a cada gravação, então
-- campo protegido IGUAL ao OLD não pode ser recusado.
-- ---------------------------------------------------------------------------

do $admin_permitido$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set name = 'OP-B renomeada', site = 'Pátio 2', notes = 'obs'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J14a. admin edita name/site/notes da operação', '1 linhas', _e);

  begin
    update public.shifts set name = 'Turno renomeado'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J15a. admin edita name do turno', '1 linhas', _e);

  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-6666666666c1', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date - 1, 'open');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J16a. admin cria folha (fluxo diário)', 'criou', _e);

  begin
    update public.timesheets set status = 'closed'
     where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J17a. admin muda status da folha', '1 linhas', _e);

  -- O falso positivo que não pode voltar: reenviar campo protegido com o mesmo
  -- valor do OLD é gravação normal da tela, não tentativa de fraude.
  begin
    update public.operations
       set name = 'OP-B v2',
           contract_id = '33333333-3333-4333-8333-333333333334',
           agreed_amount = 250
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J18a. reenvio de protegidos IGUAIS ao OLD é aceito', '1 linhas', _e);

  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J19a. admin apaga apontamento NÃO faturado', '1 linhas', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J20a. admin apaga folha SEM faturamento', '1 linhas', _e);

  begin
    insert into public.operation_team (operation_id, employee_id)
    values ('44444444-4444-4444-8444-4444444444b1', '55555555-5555-4555-8555-5555555555d1');
    delete from public.operation_team
     where operation_id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J21a. operation_team segue livre para o admin', '1 linhas', _e);
end;
$admin_permitido$;

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
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    delete from public.timesheet_entries where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas (RLS)' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J22. operacional apaga apontamento FATURADO', '0 linhas (RLS)', _e);

  begin
    delete from public.timesheets where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas (RLS)' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J24. operacional apaga folha com apontamento faturado', '0 linhas (RLS)', _e);

  -- J23, J25, J26, J27. ADMIN também não pode
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);

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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
  -- Desde a 028 o contrato de operação com apontamento não muda (a operação OP-B tem apontamento).
  perform pg_temp.registrar('J29. admin altera contract_id/agreed_amount de operação com apontamento: recusado (028)', 'erro 55000', _e);

  begin
    update public.shifts set end_time = '16:00:00', break_minutes = 30
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J30. admin altera jornada do turno', '1 linhas', _e);

  -- O alvo é uma folha VAZIA, e a troca é deliberada: até a sétima rodada este
  -- caso mexia numa folha COM apontamento, e era exatamente isso que corrompia
  -- o lastro — a chave ia para a operação nova e os snapshots ficavam na
  -- antiga. Corrigir o vínculo de uma folha ainda sem apontamento continua
  -- sendo decisão administrativa legítima.
  begin
    update public.timesheets set shift_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa1a'
     where id = '66666666-6666-4666-8666-6666666666e1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J31. admin altera vínculo de folha VAZIA', '1 linhas', _e);

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
  _n integer;
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
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.operations set agreed_amount = 999999
     where id = '44444444-4444-4444-8444-4444444444a1';
    get diagnostics _n = row_count;
    _e := case when _n > 0 then 'passo 1 passou' else 'bloqueado no passo 1' end;
  exception when insufficient_privilege then _e := 'bloqueado no passo 1';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J35. ataque via agreed_amount', 'bloqueado no passo 1', _e);

  begin
    update public.shifts set end_time = '08:00:00', break_minutes = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    get diagnostics _n = row_count;
    _e := case when _n > 0 then 'passo 1 passou' else 'bloqueado no passo 1' end;
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
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J49 continua sendo sobre o OPERADOR, e o motivo mudou de lugar: o `42501`
  -- que ele recebia aqui vinha do guard recusando quem não é admin, e não de
  -- congelamento — OP-B não tem histórico faturado (a faturada é OP-A, medida
  -- em J52). Desde a `016` ele nem alcança a linha. O congelamento de verdade,
  -- para o admin, é J52; o lado administrativo legítimo é J51.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '88888888-8888-4888-8888-888888888888', 'session_id', 'e8888888-8888-4888-8888-888888888888', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444b1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J49. operacional NAO muda operations.client_id', '0 linhas', _e);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);

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
  --
  -- Desde a 021 (C05-A) a decisão precisa ser COERENTE: a chave composta
  -- `operations_contrato_do_cliente_fkey` impede que a operação aponte para o contrato
  -- de OUTRO cliente. Mover só o `client_id` deixaria OP-C com o contrato do cliente
  -- antigo e é recusado com 23503 (J51a); o admin move o cliente JUNTO com o contrato
  -- (aqui, saindo do contrato: `contract_id` nulo, J51), ou escolhe um contrato do novo
  -- cliente (J51c). O que a 021 recusa continua recusado para o admin (J51a, J51d).
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);

  -- J51a. Só o client_id, mantendo o contrato do cliente antigo: relação incoerente.
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b'
     where id = '44444444-4444-4444-8444-4444444444c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51a. admin NAO muda so o client_id mantendo o contrato do cliente antigo', 'erro 23503', _e);

  perform pg_temp.registrar('J51a2. e a operacao segue no cliente e no contrato de antes', '33333333-3333-4333-8333-333333333333|33333333-3333-4333-8333-333333333334',
    (select client_id || '|' || contract_id from public.operations where id = '44444444-4444-4444-8444-4444444444c1'));

  -- J51. Mover o cliente junto com o contrato (sem contrato) é a decisão legítima.
  begin
    update public.operations set client_id = '33333333-3333-4333-8333-33333333333b', contract_id = null
     where id = '44444444-4444-4444-8444-4444444444c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51. admin muda client_id junto com o contrato (sem contrato)', '1 linhas', _e);

  -- J51c / J51d. Escolher contrato: o do novo cliente passa, o do cliente antigo não.
  begin
    insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
    values ('33333333-3333-4333-8333-33333333333c', '33333333-3333-4333-8333-33333333333b', 'Contrato B destino', 200, 8, 1.5, 10);
    _e := 'contrato criado';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51b. admin cria contrato do cliente destino', 'contrato criado', _e);

  begin
    update public.operations set contract_id = '33333333-3333-4333-8333-333333333334'
     where id = '44444444-4444-4444-8444-4444444444c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51d. admin NAO aponta a operacao do cliente B para contrato do cliente A', 'erro 23503', _e);

  begin
    update public.operations set contract_id = '33333333-3333-4333-8333-33333333333c'
     where id = '44444444-4444-4444-8444-4444444444c1';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J51c. admin aponta a operacao para contrato do proprio cliente', '1 linhas', _e);

  perform pg_temp.registrar('J51e. estado final coerente (cliente B e contrato de B)', '33333333-3333-4333-8333-33333333333b|33333333-3333-4333-8333-33333333333c',
    (select client_id || '|' || contract_id from public.operations where id = '44444444-4444-4444-8444-4444444444c1'));
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J53. Par VÁLIDO: é o fluxo diário e continua livre.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e001', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', current_date - 2, 'open');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J53. admin cria folha com par VÁLIDO', 'criou', _e);

  -- J54. Par INVÁLIDO: operação B com o turno da operação A.
  begin
    insert into public.timesheets (id, operation_id, shift_id, work_date, status)
    values ('66666666-6666-4666-8666-66666666e002', '44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date - 3, 'open');
    _e := 'CRIOU par inválido';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J54. admin cria folha com par INVÁLIDO', 'recusou 23514', _e);

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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.timesheet_entries set status = 'absent'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J59. admin muda status de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set check_in = '04:00:00'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J60. admin muda check_in de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set check_out = '23:00:00'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J61. admin muda check_out de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set break_minutes = 0
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J62. admin muda break_minutes de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set employee_id = '55555555-5555-4555-8555-5555555555d1'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J63. admin muda employee_id de entry faturada', 'recusou 42501', _e);

  begin
    update public.timesheet_entries set timesheet_id = '66666666-6666-4666-8666-6666666666b1'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J64. admin muda timesheet_id de entry faturada', 'recusou 42501', _e);

  -- Descritivo também: um histórico faturado não muda de narrativa em silêncio.
  begin
    update public.timesheet_entries set notes = 'reescrito depois da fatura'
     where id = '77777777-7777-4777-8777-7777777777a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J65. admin muda notes de entry faturada', 'recusou 42501', _e);

  -- J66..J68. E não é questão de papel.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    update public.timesheets set work_date = current_date - 41
     where id = '66666666-6666-4666-8666-6666666666a1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J73. admin muda work_date de folha faturada', 'recusou 42501', _e);

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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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
-- J93..J97. A ENTRADA do vínculo
--
-- Fechar `X -> NULL` e `X -> Y` sem fechar `NULL -> X` deixava o admin criar
-- vínculo arbitrário — e as guardas novas tornavam o erro irreversível.
--
-- A fronteira é `current_user = 'postgres'`, que é o contexto de
-- `gerar_fatura` por ela ser SECURITY DEFINER de `postgres`. J97 mede isso em
-- vez de presumir.
-- ---------------------------------------------------------------------------

do $vinculo_entrada$
declare
  _e text;
  _n integer;
begin
  -- Apontamento livre da OP-B para servir de alvo.
  execute 'reset role';
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-777777777791', '66666666-6666-4666-8666-6666666666b1',
          '55555555-5555-4555-8555-5555555555d1', '44444444-4444-4444-8444-4444444444b1',
          current_date, 'present', '06:00:00', '15:00:00', 60);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777791';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'VINCULOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J93. ADMIN cria vínculo direto (NULL -> X)', 'recusou 42501', _e);

  -- J95. Nem criando o apontamento já vinculado.
  begin
    insert into public.timesheet_entries
      (id, timesheet_id, employee_id, operation_id, work_date, status, invoice_id)
    values ('77777777-7777-4777-8777-777777777792', '66666666-6666-4666-8666-6666666666b1',
            '55555555-5555-4555-8555-5555555555c1', '44444444-4444-4444-8444-4444444444b1',
            current_date, 'present', '99999999-9999-4999-8999-999999999991');
    _e := 'CRIOU já vinculado';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J95. ADMIN insere apontamento já vinculado', 'recusou 42501', _e);

  -- J94. `service_role` perde o acesso de propósito: a aplicação não a usa, e
  -- ela chegaria pela mesma API que se está fechando.
  execute 'reset role';
  execute 'set local role service_role';
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777791';
    _e := 'VINCULOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J94. service_role cria vínculo direto', 'recusou 42501', _e);

  -- J96. operacional continua barrado, como já era.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777791';
    _e := 'VINCULOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J96. admin cria vínculo direto', 'recusou 42501', _e);

  -- J97. A fronteira é `current_user`, não papel. Como `postgres` — o mesmo
  -- contexto de `gerar_fatura` — o vínculo passa. Sem este caso a proteção
  -- poderia estar simplesmente proibindo tudo, e o faturamento quebraria.
  execute 'reset role';
  begin
    update public.timesheet_entries set invoice_id = '99999999-9999-4999-8999-999999999991'
     where id = '77777777-7777-4777-8777-777777777791';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J97. postgres (contexto de gerar_fatura) vincula', '1 linhas', _e);
end;
$vinculo_entrada$;


-- ---------------------------------------------------------------------------
-- J98..J104. FATURA FECHADA — o resumo congela junto com o lastro
--
-- Este bloco existe por um erro de método registrado no PR: a migration
-- AFIRMAVA que a fatura era imutável, e não era. Lastro congelado com resumo
-- mutável é pior que nenhum dos dois, porque parece protegido.
--
-- "Fechada" = possui ao menos um apontamento vinculado. A fatura nasce
-- `'closed'` em `gerar_fatura`, então `status` não serve para distinguir
-- construção de histórico; o vínculo, que é o último passo, serve.
-- ---------------------------------------------------------------------------

do $fatura_fechada$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.invoices set total_amount = 1
     where id = '99999999-9999-4999-8999-999999999991';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J98. ADMIN altera total_amount de fatura fechada', 'recusou 42501', _e);

  begin
    update public.invoices set client_id = '33333333-3333-4333-8333-33333333333b',
                               period_start = current_date - 90,
                               period_end = current_date - 80
     where id = '99999999-9999-4999-8999-999999999991';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J99. ADMIN altera cliente e período de fatura fechada', 'recusou 42501', _e);

  begin
    update public.invoices set status = 'draft'::public.invoice_status, notes = 'reescrito'
     where id = '99999999-9999-4999-8999-999999999991';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J100. ADMIN altera status e notes de fatura fechada', 'recusou 42501', _e);

  begin
    update public.invoice_items set amount = 1, description = 'reescrito'
     where invoice_id = '99999999-9999-4999-8999-999999999991';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J101. ADMIN altera invoice_items de fatura fechada', 'recusou 42501', _e);

  begin
    insert into public.invoice_items (invoice_id, operation_id, description, amount)
    values ('99999999-9999-4999-8999-999999999991',
            '44444444-4444-4444-8444-4444444444b1', 'item injetado', 99999);
    _e := 'INSERIU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J102. ADMIN insere invoice_item em fatura fechada', 'recusou 42501', _e);

  begin
    delete from public.invoice_items
     where invoice_id = '99999999-9999-4999-8999-999999999991';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J103. ADMIN apaga invoice_item de fatura fechada', 'recusou 42501', _e);

  -- J104. E não é questão de papel: `postgres`, que é quem PODE vincular,
  -- não pode reescrever o resumo depois de fechado.
  execute 'reset role';
  begin
    update public.invoices set total_amount = 1
     where id = '99999999-9999-4999-8999-999999999991';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J104. postgres altera fatura fechada', 'recusou 42501', _e);
end;
$fatura_fechada$;


-- ---------------------------------------------------------------------------
-- J105..J107. PAR DA ALOCAÇÃO
--
-- Simétrico de J89/J90: lá se impede mover o turno, aqui se impede criar a
-- alocação já torta.
-- ---------------------------------------------------------------------------

do $par_alocacao$
declare
  _e text;
  _n integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J105. Par VÁLIDO: alocação na OP-F com turno da OP-F.
  -- O turno é o F5, e não o F6: o F6 foi movido para a OP-B em J88, então a
  -- essa altura ele já NÃO pertence mais à OP-F. O F5 ficou porque J89 recusou
  -- movê-lo.
  begin
    insert into public.operation_team (operation_id, shift_id, employee_id)
    values ('44444444-4444-4444-8444-4444444444f1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
            '55555555-5555-4555-8555-5555555555a1');
    _e := 'criou';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J105. admin cria alocação com par VÁLIDO', 'criou', _e);

  -- J106. Par INVÁLIDO no INSERT.
  begin
    insert into public.operation_team (operation_id, shift_id, employee_id)
    values ('44444444-4444-4444-8444-4444444444b1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
            '55555555-5555-4555-8555-5555555555d1');
    _e := 'CRIOU par inválido';
  exception when check_violation then _e := 'recusou 23514';
            when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J106. admin cria alocação com par INVÁLIDO', 'recusou 23514', _e);

  -- J107. E o UPDATE que produziria par inválido, também para o ADMIN.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  -- `get diagnostics` é obrigatório aqui: sem ele, um UPDATE que não encontra
  -- linha alguma passaria por sucesso e o caso mediria nada. Foi o que
  -- aconteceu na primeira escrita deste teste.
  begin
    update public.operation_team
       set shift_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
     where operation_id = '44444444-4444-4444-8444-4444444444f1'
       and employee_id  = '55555555-5555-4555-8555-5555555555a1';
    get diagnostics _n = row_count;
    _e := case when _n > 0 then 'ALTEROU para par inválido'
               else 'ALVO INEXISTENTE — caso não mediu nada' end;
  exception when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J107. ADMIN faz UPDATE que produziria alocação inválida',
    'recusou 23514', _e);
end;
$par_alocacao$;


-- ---------------------------------------------------------------------------
-- J108..J113. DELETE DE TURNO — a pergunta é referência, não faturamento
--
-- A guarda antiga perguntava se o turno tinha apontamento FATURADO, e isso era
-- cedo demais: o turno era apagado enquanto o apontamento ainda era rascunho,
-- a FK zerava `timesheets.shift_id`, e o rascunho virava fatura depois — com
-- `billed_amount` derivado de uma jornada que não existe mais.
--
-- J113 documenta a CONSEQUÊNCIA da regra nova, que vai além do turno: como não
-- há exceção por cascata, apagar operação ou cliente que tenha qualquer folha
-- também passa a falhar, mesmo sem faturamento. O caminho continua sendo
-- apagar as folhas primeiro (J20) ou inativar.
-- ---------------------------------------------------------------------------

do $delete_turno$
declare
  _e text;
  _n integer;
begin
  -- Turno F8 com folha e apontamento NÃO faturado. `work_date` fora do período
  -- de J58 de propósito, para não mexer no que aquele caso fatura.
  execute 'reset role';
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', '44444444-4444-4444-8444-4444444444f1',
          'Turno F8 com rascunho', '06:00:00', '15:00:00', 60, false);
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('66666666-6666-4666-8666-6666666666f8', '44444444-4444-4444-8444-4444444444f1',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', current_date - 20);
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777777f8', '66666666-6666-4666-8666-6666666666f8',
          '55555555-5555-4555-8555-5555555555a1', '44444444-4444-4444-8444-4444444444f1',
          current_date - 20, 'present', '06:00:00', '17:00:00', 60);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J109. O caso do achado: entry ainda NÃO faturada.
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J109. admin apaga turno com folha e entry NÃO faturada',
    'recusou 42501', _e);

  -- J111. E a mensagem precisa dizer o que fazer no lugar.
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
    _e := 'não recusou';
  exception when insufficient_privilege then
    _e := case when sqlerrm like '%Inative-o%' then 'orienta inativar'
               else 'mensagem sem orientação: ' || sqlerrm end;
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J111. a recusa orienta inativação', 'orienta inativar', _e);

  -- J110. Folha SEM apontamento nenhum já basta: a referência é o critério.
  -- O turno B é referenciado pela folha criada em J53, que não tem entries.
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J110. admin apaga turno com folha SEM apontamentos',
    'recusou 42501', _e);

  -- J108. Turno sem folha nenhuma continua excluível. Sem este caso a guarda
  -- poderia estar simplesmente proibindo todo DELETE de turno.
  execute 'reset role';
  insert into public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0', '44444444-4444-4444-8444-4444444444f1',
          'Turno F9 sem uso', '06:00:00', '15:00:00', 60, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J108. admin apaga turno SEM folha', '1 linhas', _e);

  -- J112. A jornada de origem continua de pé depois de tudo.
  execute 'reset role';
  perform pg_temp.registrar('J112. turno do lastro faturado continua existindo',
    '1', (select count(*)::text from public.shifts
           where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));

  -- J113. CONSEQUÊNCIA: sem exceção por cascata, apagar a operação que tem
  -- folha também falha, mesmo sem faturamento. É mudança de comportamento e
  -- está registrada aqui para não passar despercebida. J32 continua provando
  -- que operação SEM folha é excluível.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    delete from public.operations where id = '44444444-4444-4444-8444-4444444444f1';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J113. cascata: apagar operação COM folha também falha',
    'recusou 42501', _e);
end;
$delete_turno$;


-- ---------------------------------------------------------------------------
-- J114..J120. FOLHA COM APONTAMENTO NÃO MUDA DE OPERAÇÃO NEM DE TURNO
--
-- A guarda de folha faturada congelava tarde: mover uma folha ainda em
-- rascunho já corrompe o lastro, porque os apontamentos guardam SNAPSHOTS.
-- `propagar_chave_da_diaria` leva a chave para a operação nova e
-- `derivar_valores_financeiros` preserva os valores da antiga, de propósito —
-- então a fatura seguinte agrupa sob o cliente novo somando a configuração
-- velha.
--
-- `work_date` NÃO entra nesta proibição: não é coluna motriz, e editar a data
-- de uma folha em rascunho segue legítimo (J72).
-- ---------------------------------------------------------------------------

do $mover_folha$
declare
  _e text;
  _n integer;
  _b numeric;
begin
  -- Folha VAZIA para os casos permitidos.
  execute 'reset role';
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('66666666-6666-4666-8666-6666666666e2', '44444444-4444-4444-8444-4444444444f1',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa1a', current_date - 8);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J114. Folha vazia: mover é correção administrativa legítima. O turno vai
  -- junto para manter o par válido.
  begin
    update public.timesheets
       set operation_id = '44444444-4444-4444-8444-4444444444b1',
           shift_id     = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
     where id = '66666666-6666-4666-8666-6666666666e2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J114. admin move folha VAZIA de operação', '1 linhas', _e);

  -- J115. E só o turno, também na folha vazia.
  begin
    update public.timesheets set shift_id = null
     where id = '66666666-6666-4666-8666-6666666666e2';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J115. admin altera shift_id de folha VAZIA', '1 linhas', _e);

  -- J116..J118. Folha PRÓPRIA com apontamento NÃO faturado, e ela precisa ser
  -- própria: a folha da OP-B já carrega a entry que J97 vinculou, e ali quem
  -- recusaria seria a guarda de folha FATURADA — o caso mediria outra coisa.
  -- Sem turno, para que a recusa venha da regra nova e não do par
  -- operação/turno. Data distante, fora do período que J58 fatura.
  execute 'reset role';
  insert into public.timesheets (id, operation_id, shift_id, work_date)
  values ('66666666-6666-4666-8666-6666666666e3', '44444444-4444-4444-8444-4444444444f1',
          null, current_date - 60);
  insert into public.timesheet_entries
    (id, timesheet_id, employee_id, operation_id, work_date, status, check_in, check_out, break_minutes)
  values ('77777777-7777-4777-8777-7777777777e3', '66666666-6666-4666-8666-6666666666e3',
          '55555555-5555-4555-8555-5555555555d1', '44444444-4444-4444-8444-4444444444f1',
          current_date - 60, 'present', '06:00:00', '15:00:00', 60);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = '66666666-6666-4666-8666-6666666666e3';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'MOVEU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J116. admin move operação de folha COM apontamento',
    'recusou 42501', _e);

  begin
    update public.timesheets set shift_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
     where id = '66666666-6666-4666-8666-6666666666e3';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'ALTEROU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when check_violation then _e := 'recusou 23514';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J117. admin altera turno de folha COM apontamento',
    'recusou 42501', _e);

  -- J118. Reenvio dos MESMOS valores não pode virar 42501.
  begin
    update public.timesheets
       set operation_id = '44444444-4444-4444-8444-4444444444f1',
           shift_id     = null,
           status       = 'closed'
     where id = '66666666-6666-4666-8666-6666666666e3';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J118. reenvio de operação/turno IGUAIS é aceito', '1 linhas', _e);

  -- J119. E a folha FATURADA segue recusada, agora por duas guardas.
  begin
    update public.timesheets set operation_id = '44444444-4444-4444-8444-4444444444b1'
     where id = '66666666-6666-4666-8666-6666666666a1';
    _e := 'MOVEU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J119. admin move operação de folha FATURADA', 'recusou 42501', _e);

  -- J120. E o apontamento continua com o valor da configuração em que nasceu.
  -- J29 tentou trocar o contrato da OP-B DEPOIS deste apontamento; desde a 028 a troca é
  -- recusada e o snapshot segue como nasceu.
  execute 'reset role';
  select billed_amount into _b from public.timesheet_entries
   where id = '77777777-7777-4777-8777-7777777777b1';
  perform pg_temp.registrar('J120. snapshot do apontamento intacto', '200.00',
    to_char(_b, 'FM999999990.00'));
end;
$mover_folha$;


-- ---------------------------------------------------------------------------
-- J121..J126. CONTRATO JÁ USADO, e composições adversariais
--
-- O contrato é a origem da TAXA como o turno é a origem da JORNADA. Este bloco
-- não veio de revisão: veio da auditoria preventiva que percorreu o grafo de
-- FKs procurando a mesma forma da guarda de turno, e achou
-- `operations.contract_id ON DELETE SET NULL`.
--
-- J125 e J126 medem COMPOSIÇÃO, não regras novas: o formato real de gravação
-- da tela (objeto inteiro, várias colunas por instrução) e um turno
-- referenciado por mais de uma folha.
-- ---------------------------------------------------------------------------

do $contrato$
declare
  _e text;
  _n integer;
  _c uuid;
begin
  -- Contrato NOVO, sem apontamento nenhum derivado dele.
  execute 'reset role';
  insert into public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min)
  values ('33333333-3333-4333-8333-333333333336', '33333333-3333-4333-8333-333333333333',
          'Contrato sem uso', 300, 8, 1.5, 10);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';

  -- J121. Sem uso: continua excluível. Sem este caso a guarda poderia estar
  -- proibindo todo DELETE de contrato.
  begin
    delete from public.contracts where id = '33333333-3333-4333-8333-333333333336';
    get diagnostics _n = row_count; _e := _n || ' linhas';
  exception when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J121. admin apaga contrato SEM apontamento', '1 linhas', _e);

  -- J122. O contrato da OP-A tem apontamento faturado derivado dele.
  begin
    delete from public.contracts where id = '33333333-3333-4333-8333-333333333334';
    get diagnostics _n = row_count; _e := case when _n > 0 then 'APAGOU' else '0 linhas' end;
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J122. admin apaga contrato COM apontamento', 'recusou 42501', _e);

  -- J123. E a mensagem precisa dizer o que fazer no lugar.
  begin
    delete from public.contracts where id = '33333333-3333-4333-8333-333333333334';
    _e := 'não recusou';
  exception when insufficient_privilege then
    _e := case when sqlerrm like '%Inative-o%' then 'orienta inativar'
               else 'mensagem sem orientação: ' || sqlerrm end;
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J123. a recusa orienta inativação', 'orienta inativar', _e);

  -- J124. E a origem da taxa continua ligada à operação: sem a guarda, o
  -- ON DELETE SET NULL teria deixado NULL aqui e a operação cairia no
  -- fallback de agreed_amount em silêncio.
  execute 'reset role';
  select contract_id into _c from public.operations
   where id = '44444444-4444-4444-8444-4444444444a1';
  perform pg_temp.registrar('J124. operations.contract_id intacto',
    '33333333-3333-4333-8333-333333333334', coalesce(_c::text, 'NULL'));

  -- J125. Composição: a tela grava o objeto INTEIRO. Numa entry faturada, um
  -- UPDATE que muda só `notes` e reenvia o resto igual continua recusado —
  -- é a comparação da linha inteira funcionando sob o payload real.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    update public.timesheet_entries
       set notes = 'observação nova', status = 'present',
           check_in = '06:00:00', check_out = '15:00:00', break_minutes = 60
     where id = '77777777-7777-4777-8777-7777777777a1';
    _e := 'ALTEROU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J125. UPDATE misto em entry faturada, só notes muda',
    'recusou 42501', _e);

  -- J126. Composição: turno referenciado por MAIS DE UMA folha. A guarda usa
  -- EXISTS, então uma folha basta — mas o caso fixa que várias não criam
  -- caminho alternativo.
  execute 'reset role';
  insert into public.timesheets (id, operation_id, shift_id, work_date) values
    ('66666666-6666-4666-8666-66666666f9a1', '44444444-4444-4444-8444-4444444444a1',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date - 91),
    ('66666666-6666-4666-8666-66666666f9a2', '44444444-4444-4444-8444-4444444444a1',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date - 92);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  begin
    delete from public.shifts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    _e := 'APAGOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J126. turno usado por VÁRIAS folhas não é apagável',
    'recusou 42501', _e);
end;
$contrato$;


-- ---------------------------------------------------------------------------
-- J127..J134. TRUNCATE — a classe que nenhuma guarda de linha enxerga
--
-- `TRUNCATE` não executa trigger de LINHA, então todas as proteções acima são
-- invisíveis para ele. Medido antes da correção: SEIS dos sete caminhos
-- destruíam lastro faturado, incluindo `TRUNCATE invoice_items`, que deixava a
-- fatura fechada com zero itens, e `TRUNCATE clients CASCADE`, que levava o
-- sistema inteiro.
--
-- Duas guardas `BEFORE TRUNCATE ... FOR EACH STATEMENT` cobrem os sete casos,
-- porque um `BEFORE TRUNCATE` DISPARA quando a tabela é alcançada por CASCADE
-- — e todas as cascatas convergem para `timesheet_entries` ou `invoice_items`.
--
-- A política é por ESTADO, como as demais: não é "TRUNCATE é sempre proibido",
-- é "não enquanto existir lastro faturado". Instalação nova continua truncável.
-- ---------------------------------------------------------------------------

do $truncate$
declare
  _e text;
  _n integer;
begin
  execute 'reset role';

  -- J127/J128. Privilégio, antes do comportamento: nenhum papel da API alcança
  -- TRUNCATE nas dez tabelas de negócio.
  select count(*) into _n
    from (values ('clients'),('contracts'),('employees'),('operations'),('shifts'),
                 ('operation_team'),('timesheets'),('timesheet_entries'),
                 ('invoices'),('invoice_items')) t(tabela)
   where has_table_privilege('service_role', 'public.' || t.tabela, 'TRUNCATE');
  perform pg_temp.registrar('J127. service_role sem TRUNCATE nas 10 tabelas', '0', _n::text);

  select count(*) into _n
    from (values ('clients'),('contracts'),('employees'),('operations'),('shifts'),
                 ('operation_team'),('timesheets'),('timesheet_entries'),
                 ('invoices'),('invoice_items')) t(tabela)
   where has_table_privilege('authenticated', 'public.' || t.tabela, 'TRUNCATE')
      or has_table_privilege('anon', 'public.' || t.tabela, 'TRUNCATE');
  perform pg_temp.registrar('J128. authenticated e anon sem TRUNCATE', '0', _n::text);

  -- J129..J133. O comando normal, como `postgres`, falha em vez de destruir.
  -- Cada um destes EXECUTOU no baseline.
  begin execute 'truncate table public.timesheet_entries'; _e := 'TRUNCOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J129. TRUNCATE timesheet_entries com lastro', 'recusou 42501', _e);

  begin execute 'truncate table public.invoice_items'; _e := 'TRUNCOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J130. TRUNCATE invoice_items com lastro', 'recusou 42501', _e);

  begin execute 'truncate table public.invoices cascade'; _e := 'TRUNCOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J131. TRUNCATE invoices CASCADE', 'recusou 42501', _e);

  begin execute 'truncate table public.timesheets cascade'; _e := 'TRUNCOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J132. TRUNCATE timesheets CASCADE', 'recusou 42501', _e);

  -- O pior caso: a raiz da árvore inteira.
  begin execute 'truncate table public.clients cascade'; _e := 'TRUNCOU';
  exception when insufficient_privilege then _e := 'recusou 42501';
            when others then _e := 'erro ' || sqlstate; end;
  perform pg_temp.registrar('J133. TRUNCATE clients CASCADE', 'recusou 42501', _e);

  -- J134. E depois de todas as tentativas, o lastro e a fatura seguem de pé.
  -- A asserção é por IDENTIDADE e não por contagem: a esta altura da suíte há
  -- mais de um apontamento faturado, e contar tornaria o caso frágil a cada
  -- bloco novo. O que importa é que estas três linhas específicas continuam lá.
  perform pg_temp.registrar('J134. lastro, fatura e item intactos após os TRUNCATE',
    'entry sim / fatura sim / item sim',
    (select case when count(*) = 1 then 'entry sim' else 'entry SUMIU' end
       from public.timesheet_entries
      where id = '77777777-7777-4777-8777-7777777777a1'
        and invoice_id = '99999999-9999-4999-8999-999999999991') || ' / ' ||
    (select case when count(*) = 1 then 'fatura sim' else 'fatura SUMIU' end
       from public.invoices where id = '99999999-9999-4999-8999-999999999991') || ' / ' ||
    (select case when count(*) >= 1 then 'item sim' else 'item SUMIU' end
       from public.invoice_items
      where invoice_id = '99999999-9999-4999-8999-999999999991'));
end;
$truncate$;


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
  _n          integer;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111', 'session_id', 'e1111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

  -- J58c..J58e. As invariantes semânticas do vínculo. Elas NÃO viraram CHECK
  -- na migration de propósito: com a entrada restrita a `gerar_fatura`, já são
  -- verdadeiras por construção dela — o passo 6 filtra por `o.client_id` e por
  -- `t.work_date BETWEEN`, e os passos 7 a 9 derivam totais e itens dos mesmos
  -- ids. Reescrevê-las como constraint duplicaria a regra em dois lugares que
  -- podem divergir. Ficam aqui, como medição.
  select count(*) into _n
    from public.timesheet_entries te
    join public.timesheets t ON t.id = te.timesheet_id
    join public.operations  o ON o.id = t.operation_id
   where te.invoice_id = _nova.id
     and o.client_id is distinct from _nova.client_id;
  perform pg_temp.registrar('J58c. todo lastro da fatura é do cliente dela', '0', _n::text);

  select count(*) into _n
    from public.timesheet_entries te
    join public.timesheets t ON t.id = te.timesheet_id
   where te.invoice_id = _nova.id
     and t.work_date not between _nova.period_start and _nova.period_end;
  perform pg_temp.registrar('J58d. todo lastro cai dentro do período', '0', _n::text);

  select case
           when coalesce(sum(ii.amount), 0) = _nova.total_amount then 'fecha'
           else coalesce(sum(ii.amount), 0)::text || ' vs ' || _nova.total_amount::text
         end
    into _e
    from public.invoice_items ii where ii.invoice_id = _nova.id;
  perform pg_temp.registrar('J58e. soma dos itens fecha com o total da fatura', 'fecha', _e);
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
