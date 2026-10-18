-- O operador com MFA concluído também é operador — migration 015.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`.
--
-- Este arquivo toca `auth.users` e `auth.mfa_factors` pelo mesmo motivo do
-- `008` e do `009`: a fixture precisa de contas reais, porque
-- `mfa_factors_user_id_fkey` aponta para `auth.users`. Só a coluna `id` é
-- obrigatória, então as linhas são mínimas e não carregam dado pessoal.
--
-- O QUE ELE PROVA, E POR QUE CADA METADE IMPORTA
--
-- A metade óbvia: a superfície passa a aceitar o operador em `aal2`. A metade
-- que importa tanto quanto: o contrato de `operador_elegivel_aal1()` NÃO foi
-- adulterado. Esse primitivo significa "elegível à EXCEÇÃO de AAL1", e deixá-lo
-- responder `true` para `aal2` teria sido o jeito preguiçoso de fazer isto
-- funcionar — e corromperia o significado dele para qualquer decisão futura
-- que venha a consultá-lo. O bloco A existe só para travar isso.
--
-- E a terceira metade, a que ninguém pede mas é a que assusta: que aceitar um
-- nível de garantia MAIOR não ampliou dado nenhum. O bloco H mede isso.
--
-- CONTRA O SCHEMA SEM A 015 este arquivo falha, e falha no lugar certo: o
-- operador em `aal2` recebe `42501` nas cinco RPCs. Nenhuma expectativa foi
-- invertida para fabricar PASS.

begin;

create temporary table _resultado (
  ordem     serial,
  caso      text,
  esperado  text,
  obtido    text,
  situacao  text
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

-- Executa `_sql` sob os claims pedidos, como `postgres`, e devolve o resultado
-- como texto. Os helpers são internos — `authenticated` não os executa —, então
-- medi-los exige o papel dono. O que muda entre os casos é só o JWT.
create or replace function pg_temp.medir_helper(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  if _uid is null then
    _claims := jsonb_build_object('role', 'anon');
  else
    _claims := jsonb_build_object('sub', _uid, 'session_id', 'e' || substr(_uid::text, 2), 'role', 'authenticated');
    if _aal is not null then
      _claims := _claims || jsonb_build_object('aal', _aal);
    end if;
  end if;
  perform set_config('request.jwt.claims', _claims::text, true);
  begin
    execute _sql into _r;
  exception when others then
    return 'erro ' || sqlstate;
  end;
  return coalesce(_r, 'nulo');
end;
$$;

-- As RPCs, essas, são chamadas como `authenticated`, que é quem tem EXECUTE.
create or replace function pg_temp.medir_rpc(_uid text, _aal text, _sql text)
returns text language plpgsql as $$
declare _r text; _claims jsonb;
begin
  _claims := jsonb_build_object('sub', _uid, 'session_id', 'e' || substr(_uid::text, 2), 'role', 'authenticated');
  if _aal is not null then
    _claims := _claims || jsonb_build_object('aal', _aal);
  end if;
  perform set_config('request.jwt.claims', _claims::text, true);
  set local role authenticated;
  begin
    execute _sql into _r;
  exception when others then
    set local role postgres;
    return 'erro ' || sqlstate;
  end;
  set local role postgres;
  return coalesce(_r, 'nulo');
end;
$$;


-- ---------------------------------------------------------------------------
-- Fixture
--
-- Seis contas, uma por estado de autorização que a 015 precisa separar.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('0a000000-0000-4000-8000-000000000001'),  -- operacional, SEM fator     (OP1)
  ('0a000000-0000-4000-8000-000000000002'),  -- operacional, COM fator     (OP2)
  ('0a000000-0000-4000-8000-000000000003'),  -- admin                      (ADM)
  ('0a000000-0000-4000-8000-000000000004'),  -- sem papel                  (SEM)
  ('0a000000-0000-4000-8000-000000000005'),  -- operacional, sera apagado  (DEL)
  ('0a000000-0000-4000-8000-000000000006');  -- admin + operacional        (DUP)

-- C02 (migration 020): has_role()/is_staff() só autorizam uma identidade UTILIZÁVEL — conta
-- existente em auth.users, não banida nem excluída, e com a sessão do JWT viva em
-- auth.sessions. Por isso as contas das claims abaixo existem de verdade e cada claim
-- carrega o `session_id` da sessão correspondente (o UUID da conta com o primeiro
-- caractere trocado por 'e'). Não há exceção para fixture sem conta: isso seria
-- reproduzir o comportamento que a migration 020 removeu.
insert into auth.sessions (id, user_id) values
  ('ea000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002'),
  ('ea000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000003'),
  ('ea000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000004'),
  ('ea000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000005'),
  ('ea000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000006');

insert into auth.mfa_factors
  (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values
  ('0f000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002',
   'ativo', 'totp', 'verified', now(), now());

insert into public.user_roles (user_id, role) values
  ('0a000000-0000-4000-8000-000000000001', 'operacional'),
  ('0a000000-0000-4000-8000-000000000002', 'operacional'),
  ('0a000000-0000-4000-8000-000000000003', 'admin'),
  ('0a000000-0000-4000-8000-000000000005', 'operacional'),
  ('0a000000-0000-4000-8000-000000000006', 'admin'),
  ('0a000000-0000-4000-8000-000000000006', 'operacional');

insert into public.clients (id, name) values
  ('0c000000-0000-4000-8000-000000000001', 'Cliente Alfa');

insert into public.contracts
  (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from)
values
  ('0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   'Contrato Alfa', 150.00, 8, 1.5, 10, '2026-01-01');

insert into public.operations (id, client_id, contract_id, name, site, type, operation_date)
values
  ('0e000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao Atribuida', 'Galpao 1',
   'fixed', '2026-09-10'),
  ('0e000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000001', 'Operacao Alheia', 'Galpao 2',
   'fixed', '2026-09-10');

insert into public.shifts
  (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight)
values
  ('0b000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   'Turno A', '08:00', '17:00', 60, false);

insert into public.employees (id, name, role, daily_cost) values
  ('05000000-0000-4000-8000-000000000001', 'Colab Um', 'ajudante', 90.00);

insert into public.operation_team (operation_id, shift_id, employee_id, active) values
  ('0e000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001',
   '05000000-0000-4000-8000-000000000001', true);

-- Todos recebem a atribuição, inclusive os que devem ser recusados: é o que
-- prova que a recusa vem do PAPEL ou do AAL, e não de faltar atribuição.
insert into public.user_operation_access (user_id, operation_id) values
  ('0a000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000002', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000003', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000004', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000005', '0e000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000006', '0e000000-0000-4000-8000-000000000001');


-- ---------------------------------------------------------------------------
-- A. O primitivo da exceção AAL1 NÃO foi adulterado
--
-- Este bloco é o contrato antigo, medido caso a caso. Se a 015 tivesse feito a
-- coisa preguiçosa — trocar `aal1` por `aal1 or aal2` dentro dele —, A3 e A4
-- falhariam aqui, e é exatamente para isso que existem.
-- ---------------------------------------------------------------------------

do $bloco_a$
declare _sql text := 'select public.operador_elegivel_aal1()::text';
begin
  perform pg_temp.registrar('A1. operacional aal1 SEM fator continua elegivel a AAL1', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1', _sql));

  perform pg_temp.registrar('A2. operacional aal1 COM fator continua recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal1', _sql));

  perform pg_temp.registrar('A3. operacional aal2 continua FORA da excecao AAL1', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal2', _sql));

  perform pg_temp.registrar('A4. operacional sem fator em aal2 tambem fica fora', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal2', _sql));

  perform pg_temp.registrar('A5. admin aal1 continua recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal1', _sql));

  perform pg_temp.registrar('A6. sem papel continua recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000004', 'aal1', _sql));

  perform pg_temp.registrar('A7. sem claim aal continua recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', null, _sql));
end;
$bloco_a$;


-- ---------------------------------------------------------------------------
-- B. A elegibilidade GERAL da superfície
-- ---------------------------------------------------------------------------

do $bloco_b$
declare _sql text := 'select public.operador_elegivel_operacional()::text';
begin
  perform pg_temp.registrar('B1. operacional aal1 sem fator', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1', _sql));

  perform pg_temp.registrar('B2. operacional aal1 COM fator verificado e recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal1', _sql));

  -- O caso que motivou a 015.
  perform pg_temp.registrar('B3. operacional aal2 COM fator e ACEITO', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal2', _sql));

  perform pg_temp.registrar('B4. operacional aal2 sem fator tambem e aceito', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal2', _sql));

  perform pg_temp.registrar('B5. admin aal1 recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal1', _sql));

  perform pg_temp.registrar('B6. admin aal2 recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal2', _sql));

  perform pg_temp.registrar('B7. admin+operacional aal1 recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000006', 'aal1', _sql));

  perform pg_temp.registrar('B8. admin+operacional aal2 recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000006', 'aal2', _sql));

  perform pg_temp.registrar('B9. sem papel recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000004', 'aal2', _sql));

  perform pg_temp.registrar('B10. sem claim aal recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', null, _sql));

  perform pg_temp.registrar('B11. claim aal desconhecida recusada', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal3', _sql));

  perform pg_temp.registrar('B12. sem sessao recusado', 'false',
    pg_temp.medir_helper(null, null, _sql));
end;
$bloco_b$;

-- Conta apagada com token ainda vivo. A ordem importa: a leitura de antes é o
-- que prova que a recusa veio do DELETE, e não de a conta nunca ter servido.
do $bloco_b2$
declare _antes text; _depois text;
declare _sql text := 'select public.operador_elegivel_operacional()::text';
begin
  _antes := pg_temp.medir_helper('0a000000-0000-4000-8000-000000000005', 'aal2', _sql);
  delete from auth.users where id = '0a000000-0000-4000-8000-000000000005';
  _depois := pg_temp.medir_helper('0a000000-0000-4000-8000-000000000005', 'aal2', _sql);

  perform pg_temp.registrar('B13. a conta era elegivel antes de ser apagada', 'true', _antes);
  perform pg_temp.registrar('B14. e deixa de ser com o token ainda valido', 'false', _depois);
  perform pg_temp.registrar('B15. o papel orfao em user_roles nao salva a conta apagada',
    'true|false', _antes || '|' || _depois);
end;
$bloco_b2$;


-- ---------------------------------------------------------------------------
-- C. A atribuição por operação continua valendo nos dois níveis
-- ---------------------------------------------------------------------------

do $bloco_c$
declare
  _atribuida text := 'select public.operador_autorizado(''0e000000-0000-4000-8000-000000000001'')::text';
  _alheia    text := 'select public.operador_autorizado(''0e000000-0000-4000-8000-000000000002'')::text';
begin
  perform pg_temp.registrar('C1. aal1: operacao atribuida autoriza', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1', _atribuida));

  perform pg_temp.registrar('C2. aal1: operacao alheia nao autoriza', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1', _alheia));

  perform pg_temp.registrar('C3. aal2: operacao atribuida autoriza', 'true',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal2', _atribuida));

  perform pg_temp.registrar('C4. aal2: operacao alheia continua nao autorizando', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal2', _alheia));

  perform pg_temp.registrar('C5. admin em aal2 com atribuicao continua recusado', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal2', _atribuida));

  perform pg_temp.registrar('C6. operacao nula nao autoriza', 'false',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1',
      'select public.operador_autorizado(null)::text'));
end;
$bloco_c$;


-- ---------------------------------------------------------------------------
-- D. A identidade
-- ---------------------------------------------------------------------------

do $bloco_d$
declare _sql text := 'select coalesce(public.uid_do_operador()::text, ''nulo'')';
begin
  perform pg_temp.registrar('D1. operacional aal1 sem fator tem identidade',
    '0a000000-0000-4000-8000-000000000001',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000001', 'aal1', _sql));

  perform pg_temp.registrar('D2. operacional aal2 tem identidade',
    '0a000000-0000-4000-8000-000000000002',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal2', _sql));

  perform pg_temp.registrar('D3. operacional aal1 COM fator nao tem', 'nulo',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000002', 'aal1', _sql));

  perform pg_temp.registrar('D4. admin nao tem, em aal1', 'nulo',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal1', _sql));

  perform pg_temp.registrar('D5. admin nao tem, em aal2', 'nulo',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000003', 'aal2', _sql));

  perform pg_temp.registrar('D6. admin+operacional nao tem, em aal2', 'nulo',
    pg_temp.medir_helper('0a000000-0000-4000-8000-000000000006', 'aal2', _sql));
end;
$bloco_d$;


-- ---------------------------------------------------------------------------
-- E. As cinco RPCs, em AAL2
--
-- É o caso que a 013 recusava. Cada uma é chamada como `authenticated`, pelo
-- caminho real.
-- ---------------------------------------------------------------------------

do $bloco_e$
declare _op text := '0a000000-0000-4000-8000-000000000002';  -- operacional COM fator
begin
  perform pg_temp.registrar('E1. listar_operacoes_do_operador em aal2', '1',
    pg_temp.medir_rpc(_op, 'aal2',
      'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('E2. e devolve a operacao atribuida, com o nome do cliente',
    'Operacao Atribuida|Cliente Alfa',
    pg_temp.medir_rpc(_op, 'aal2',
      'select name || ''|'' || cliente_nome from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('E3. listar_turnos_do_operador em aal2', '1',
    pg_temp.medir_rpc(_op, 'aal2',
      'select count(*)::text from public.listar_turnos_do_operador(''0e000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('E4. listar_equipe_do_operador em aal2', '1',
    pg_temp.medir_rpc(_op, 'aal2',
      'select count(*)::text from public.listar_equipe_do_operador(''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('E5. listar_apontamentos_do_operador em aal2', '0',
    pg_temp.medir_rpc(_op, 'aal2',
      'select count(*)::text from public.listar_apontamentos_do_operador(''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'', ''2026-09-10'')'));

  perform pg_temp.registrar('E6. salvar_apontamento_operacional em aal2 grava', 'true',
    pg_temp.medir_rpc(_op, 'aal2', $sql$
      select (public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-10',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present",
           "check_in":"08:00","check_out":"17:00","break_minutes":60}]'::jsonb)
        is not null)::text
    $sql$));

  perform pg_temp.registrar('E7. e a linha chegou a tabela', '1',
    (select count(*)::text from public.timesheet_entries));

  -- A derivação da 010 rodou igual: 540 brutos menos 60 de intervalo = 480,
  -- que e a jornada prevista do turno, entao sem hora extra.
  perform pg_temp.registrar('E8. com a derivacao financeira de sempre', '480|0|150.00',
    (select worked_minutes || '|' || overtime_minutes || '|' || billed_amount
       from public.timesheet_entries));

  perform pg_temp.registrar('E9. e a leitura passa a enxergar a linha', '1',
    pg_temp.medir_rpc(_op, 'aal2',
      'select count(*) filter (where employee_id is not null)::text from public.listar_apontamentos_do_operador(''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'', ''2026-09-10'')'));
end;
$bloco_e$;


-- ---------------------------------------------------------------------------
-- F. AAL1 com MFA verificado continua recusado — a 015 não afrouxou isso
-- ---------------------------------------------------------------------------

do $bloco_f$
declare _op text := '0a000000-0000-4000-8000-000000000002';
begin
  perform pg_temp.registrar('F1. listar_operacoes recusa aal1 com fator', 'erro 42501',
    pg_temp.medir_rpc(_op, 'aal1',
      'select count(*)::text from public.listar_operacoes_do_operador()'));

  perform pg_temp.registrar('F2. listar_turnos recusa', 'erro 42501',
    pg_temp.medir_rpc(_op, 'aal1',
      'select count(*)::text from public.listar_turnos_do_operador(''0e000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('F3. listar_equipe recusa', 'erro 42501',
    pg_temp.medir_rpc(_op, 'aal1',
      'select count(*)::text from public.listar_equipe_do_operador(''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'')'));

  perform pg_temp.registrar('F4. listar_apontamentos recusa', 'erro 42501',
    pg_temp.medir_rpc(_op, 'aal1',
      'select count(*)::text from public.listar_apontamentos_do_operador(''0e000000-0000-4000-8000-000000000001'', ''0b000000-0000-4000-8000-000000000001'', ''2026-09-10'')'));

  perform pg_temp.registrar('F5. salvar recusa', 'erro 42501',
    pg_temp.medir_rpc(_op, 'aal1', $sql$
      select public.salvar_apontamento_operacional(
        '0e000000-0000-4000-8000-000000000001',
        '0b000000-0000-4000-8000-000000000001',
        '2026-09-11',
        '[{"employee_id":"05000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb)::text
    $sql$));
end;
$bloco_f$;


-- ---------------------------------------------------------------------------
-- G. Admin continua fora da superfície, nos dois níveis
-- ---------------------------------------------------------------------------

do $bloco_g$
declare _lista text := 'select count(*)::text from public.listar_operacoes_do_operador()';
declare _turnos text := 'select count(*)::text from public.listar_turnos_do_operador(''0e000000-0000-4000-8000-000000000001'')';
begin
  perform pg_temp.registrar('G1. admin aal1 recusado na listagem', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000003', 'aal1', _lista));

  perform pg_temp.registrar('G2. admin aal2 recusado na listagem', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000003', 'aal2', _lista));

  perform pg_temp.registrar('G3. admin aal2 recusado nos turnos', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000003', 'aal2', _turnos));

  perform pg_temp.registrar('G4. admin+operacional aal1 recusado', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000006', 'aal1', _lista));

  perform pg_temp.registrar('G5. admin+operacional aal2 recusado', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000006', 'aal2', _lista));

  perform pg_temp.registrar('G6. sem papel recusado em aal2', 'erro 42501',
    pg_temp.medir_rpc('0a000000-0000-4000-8000-000000000004', 'aal2', _lista));
end;
$bloco_g$;


-- ---------------------------------------------------------------------------
-- H. Aceitar um nível MAIOR não ampliou dado nenhum
--
-- O bloco que responde à pergunta incômoda: a 015 mexeu em quem entra, não no
-- que se vê. O privilégio por coluna do papel dono é o que garante isso, e ele
-- não foi tocado.
-- ---------------------------------------------------------------------------

do $bloco_h$
declare
  _colunas text[] := array['billed_amount', 'cost_amount', 'invoice_id',
                           'daily_rate_snapshot', 'ot_hour_rate_snapshot',
                           'daily_cost_snapshot', 'worked_minutes', 'overtime_minutes'];
  _coluna text;
  _achou int := 0;
begin
  foreach _coluna in array _colunas
  loop
    if has_column_privilege('bslog_rpc_operacional', 'public.timesheet_entries',
                            _coluna, 'SELECT, INSERT, UPDATE') then
      _achou := _achou + 1;
    end if;
  end loop;
  perform pg_temp.registrar('H1. nenhum privilegio em coluna financeira', '0', _achou::text);

  perform pg_temp.registrar('H2. employees.daily_cost segue fora de alcance', 'false',
    has_column_privilege('bslog_rpc_operacional', 'public.employees',
                         'daily_cost', 'SELECT, INSERT, UPDATE')::text);

  perform pg_temp.registrar('H3. operations.agreed_amount segue fora', 'false',
    has_column_privilege('bslog_rpc_operacional', 'public.operations',
                         'agreed_amount', 'SELECT, INSERT, UPDATE')::text);

  perform pg_temp.registrar('H4. contracts segue inalcancavel', 'false',
    has_table_privilege('bslog_rpc_operacional', 'public.contracts', 'SELECT')::text);

  perform pg_temp.registrar('H5. e sem DELETE em timesheet_entries', 'false',
    has_table_privilege('bslog_rpc_operacional', 'public.timesheet_entries', 'DELETE')::text);

  -- O contrato das leituras nao ganhou coluna: as assinaturas seguem as da 013.
  perform pg_temp.registrar('H6. listar_apontamentos nao devolve invoice_id nem valor', 'false',
    (select (pg_get_function_result(p.oid) ~* 'invoice_id|billed_amount|cost_amount|snapshot')::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'listar_apontamentos_do_operador'));

  perform pg_temp.registrar('H7. listar_equipe nao devolve custo', 'false',
    (select (pg_get_function_result(p.oid) ~* 'daily_cost|doc|phone')::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'listar_equipe_do_operador'));

  perform pg_temp.registrar('H8. listar_operacoes nao devolve client_id nem valor acordado', 'false',
    (select (pg_get_function_result(p.oid) ~* 'client_id|agreed_amount|contract_id')::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'listar_operacoes_do_operador'));
end;
$bloco_h$;


-- ---------------------------------------------------------------------------
-- I. O que a 015 não podia ter tocado
-- ---------------------------------------------------------------------------

do $bloco_i$
begin
  perform pg_temp.registrar('I1. as 11 policies *_exige_aal2 seguem RESTRICTIVE', '11',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and policyname like '%\_exige\_aal2'
        and permissive = 'RESTRICTIVE'));

  perform pg_temp.registrar('I2. as 5 RPCs seguem SECURITY DEFINER do papel dedicado', '5',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')
        and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('I3. authenticated executa as 5', '5',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

  perform pg_temp.registrar('I4. anon e service_role nao executam nenhuma', '0',
    (select count(*)::text from pg_proc p, unnest(array['anon','service_role']) as papel
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('listar_operacoes_do_operador', 'listar_turnos_do_operador',
                          'listar_equipe_do_operador', 'listar_apontamentos_do_operador',
                          'salvar_apontamento_operacional')
        and has_function_privilege(papel, p.oid, 'EXECUTE')));

  perform pg_temp.registrar('I5. o helper novo e interno', '0',
    (select count(*)::text from pg_proc p, unnest(array['anon','authenticated','service_role']) as papel
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'operador_elegivel_operacional'
        and has_function_privilege(papel, p.oid, 'EXECUTE')));

  perform pg_temp.registrar('I6. e executavel pelo papel dono das RPCs', 'true',
    (select has_function_privilege('bslog_rpc_operacional', p.oid, 'EXECUTE')::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'operador_elegivel_operacional'));

  perform pg_temp.registrar('I7. os seis helpers seguem com dono postgres', '6',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('operador_elegivel_aal1', 'operador_elegivel_operacional',
                          'operador_autorizado', 'uid_do_operador',
                          'travar_turno_da_operacao', 'apontamento_faturado')
        and pg_get_userbyid(p.proowner) = 'postgres'));

  perform pg_temp.registrar('I8. o papel dedicado segue sem nada no schema auth', 'false',
    has_schema_privilege('bslog_rpc_operacional', 'auth', 'USAGE')::text);

  perform pg_temp.registrar('I9. e sem CREATE em public', 'false',
    has_schema_privilege('bslog_rpc_operacional', 'public', 'CREATE')::text);

  perform pg_temp.registrar('I10. BYPASSRLS do papel inalterado', 'true',
    (select rolbypassrls::text from pg_roles where rolname = 'bslog_rpc_operacional'));

  perform pg_temp.registrar('I11. nenhuma membership com os papeis da API', '0',
    (select count(*)::text from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles g on g.oid = m.member
     where (r.rolname = 'bslog_rpc_operacional' and g.rolname in ('anon','authenticated','service_role'))
        or (g.rolname = 'bslog_rpc_operacional' and r.rolname in ('anon','authenticated','service_role'))));

  perform pg_temp.registrar('I12. as constraints da 014 seguem de pe', '2',
    (select count(*)::text from pg_constraint
      where conname in ('timesheet_entries_break_minutes_nao_negativo',
                        'shifts_break_minutes_nao_negativo')));
end;
$bloco_i$;


-- ---------------------------------------------------------------------------
-- J. AAL1 continua sem alcançar tabela direto
--
-- O nível maior não abriu porta nova: o operador em aal2 é `authenticated` como
-- qualquer outro, e as policies RESTRICTIVE seguem valendo.
--
-- ATUALIZADO PELA MIGRATION 016. Quando este bloco foi escrito, o comentário
-- registrava aqui que em aal2 o operador passava a ver as tabelas que o PAPEL
-- dele sempre permitiu — pela permissiva por `public.is_staff()`, que é
-- verdadeira para qualquer papel atribuído. Aquilo era verdade, era anterior à
-- 013 e à 015, e **deixou de ser**: a `016` acrescentou uma RESTRICTIVE por
-- tabela exigindo `admin`, então acesso direto passou a ser `aal2` E `admin`.
--
-- Os casos deste bloco medem o aal1 e seguem valendo palavra por palavra — eles
-- nunca dependeram daquele comportamento. Quem mede o contrato novo, nos dois
-- níveis e com PII e dinheiro, é `012_restringir_postgrest_operacional.sql`.
-- ---------------------------------------------------------------------------

do $bloco_j$
declare _op text := '0a000000-0000-4000-8000-000000000002';
begin
  perform pg_temp.registrar('J1. aal1 continua lendo zero linha de operations', '0',
    pg_temp.medir_rpc(_op, 'aal1', 'select count(*)::text from public.operations'));

  perform pg_temp.registrar('J2. aal1 continua lendo zero linha de timesheet_entries', '0',
    pg_temp.medir_rpc(_op, 'aal1', 'select count(*)::text from public.timesheet_entries'));

  perform pg_temp.registrar('J3. aal1 continua lendo zero linha de employees', '0',
    pg_temp.medir_rpc(_op, 'aal1', 'select count(*)::text from public.employees'));

  perform pg_temp.registrar('J4. aal1 continua lendo zero linha de contracts', '0',
    pg_temp.medir_rpc(_op, 'aal1', 'select count(*)::text from public.contracts'));

  perform pg_temp.registrar('J5. user_operation_access segue fechada ao operador, em aal1', '0',
    pg_temp.medir_rpc(_op, 'aal1', 'select count(*)::text from public.user_operation_access'));

  perform pg_temp.registrar('J6. e em aal2 tambem', '0',
    pg_temp.medir_rpc(_op, 'aal2', 'select count(*)::text from public.user_operation_access'));
end;
$bloco_j$;


-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado order by ordem;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '011_operacional_aal2: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
