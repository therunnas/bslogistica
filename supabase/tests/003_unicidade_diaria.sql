-- Invariável de diária: um colaborador gera no máximo UMA diária faturável por
-- operação e data. Verifica também o fechamento do P1-1 (folha sem turno).
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor e execute de uma vez. Tudo
-- acontece dentro de uma transação que termina em `rollback`; nada persiste.
--
-- Diferente do 002, este arquivo NÃO aborta no primeiro problema: cada teste
-- mede e registra numa tabela temporária, e o resultado sai como tabela no
-- final. Abortar esconde os testes seguintes, e foi exatamente o que atrasou o
-- diagnóstico da suíte anterior.
--
-- Os testes rodam como o papel da sessão (postgres, no SQL Editor). Aqui isso é
-- proposital e não invalida nada: o que está sob teste é índice e trigger, que
-- valem para todos os papéis — inclusive o dono da tabela. RLS é assunto do
-- 002_autorizacao.sql.

begin;

create temp table res (
  n        int,
  teste    text,
  esperado text,
  obtido   text,
  status   text
);

-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------

insert into public.clients (id, name) values
  ('aaaa1111-0000-4000-8000-000000000001', 'Cliente Teste Diária');

insert into public.operations (id, client_id, name) values
  ('aaaa2222-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000001', 'Operação A'),
  ('aaaa2222-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000001', 'Operação B');

insert into public.shifts (id, operation_id, name, start_time, end_time) values
  ('aaaa3333-0000-4000-8000-000000000001', 'aaaa2222-0000-4000-8000-000000000001', 'Matutino', '06:00', '14:00'),
  ('aaaa3333-0000-4000-8000-000000000002', 'aaaa2222-0000-4000-8000-000000000001', 'Noturno',  '22:00', '06:00');

insert into public.employees (id, name, daily_cost) values
  ('aaaa4444-0000-4000-8000-000000000001', 'Colaborador Um',  100),
  ('aaaa4444-0000-4000-8000-000000000002', 'Colaborador Dois', 100);

-- duas folhas da MESMA operação e data, em turnos diferentes: cenário legítimo
insert into public.timesheets (id, operation_id, shift_id, work_date) values
  ('aaaa5555-0000-4000-8000-000000000001', 'aaaa2222-0000-4000-8000-000000000001', 'aaaa3333-0000-4000-8000-000000000001', '2026-10-01'),
  ('aaaa5555-0000-4000-8000-000000000002', 'aaaa2222-0000-4000-8000-000000000001', 'aaaa3333-0000-4000-8000-000000000002', '2026-10-01'),
  -- outra data, mesma operação
  ('aaaa5555-0000-4000-8000-000000000003', 'aaaa2222-0000-4000-8000-000000000001', 'aaaa3333-0000-4000-8000-000000000001', '2026-10-02'),
  -- outra operação, mesma data
  ('aaaa5555-0000-4000-8000-000000000004', 'aaaa2222-0000-4000-8000-000000000002', null, '2026-10-01');


-- ---------------------------------------------------------------------------
-- 1. Primeira diária entra
-- ---------------------------------------------------------------------------
do $t1$
declare _err text := '-';
begin
  begin
    insert into public.timesheet_entries (id, timesheet_id, employee_id, status)
    values ('aaaa6666-0000-4000-8000-000000000001', 'aaaa5555-0000-4000-8000-000000000001',
            'aaaa4444-0000-4000-8000-000000000001', 'present');
  exception when others then _err := sqlstate;
  end;
  insert into res values (1, 'primeira diária', 'sem erro', 'sqlstate=' || _err,
                          case when _err = '-' then 'PASS' else 'FAIL' end);
end
$t1$;

-- ---------------------------------------------------------------------------
-- 2. Mesma pessoa, mesma operação e data, OUTRO turno -> bloqueado
-- ---------------------------------------------------------------------------
do $t2$
declare _err text := '-';
begin
  begin
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000002', 'aaaa4444-0000-4000-8000-000000000001', 'present');
  exception when others then _err := sqlstate;
  end;
  insert into res values (2, 'segunda diária em outro turno', '23505', 'sqlstate=' || _err,
                          case when _err = '23505' then 'PASS' else 'FAIL' end);
end
$t2$;

-- ---------------------------------------------------------------------------
-- 3. Mesma pessoa, outra data e outra operação -> permitido
-- ---------------------------------------------------------------------------
do $t3$
declare _err_data text := '-'; _err_op text := '-';
begin
  begin
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000003', 'aaaa4444-0000-4000-8000-000000000001', 'present');
  exception when others then _err_data := sqlstate;
  end;
  begin
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000004', 'aaaa4444-0000-4000-8000-000000000001', 'present');
  exception when others then _err_op := sqlstate;
  end;
  insert into res values (3, 'mesma pessoa, outra data / outra operação', 'sem erro nos dois',
                          format('data=%s operacao=%s', _err_data, _err_op),
                          case when _err_data = '-' and _err_op = '-' then 'PASS' else 'FAIL' end);
end
$t3$;

-- ---------------------------------------------------------------------------
-- 4. Pessoas diferentes nos dois turnos do mesmo dia -> permitido
-- ---------------------------------------------------------------------------
do $t4$
declare _err text := '-';
begin
  begin
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000002', 'aaaa4444-0000-4000-8000-000000000002', 'present');
  exception when others then _err := sqlstate;
  end;
  insert into res values (4, 'outra pessoa no segundo turno', 'sem erro', 'sqlstate=' || _err,
                          case when _err = '-' then 'PASS' else 'FAIL' end);
end
$t4$;

-- ---------------------------------------------------------------------------
-- 5. Falta num turno e presença em outro -> permitido (falta não é diária)
-- ---------------------------------------------------------------------------
do $t5$
declare _err text := '-'; _n int;
begin
  begin
    -- Colaborador Dois já está presente no Noturno (teste 4); marcar falta no
    -- Matutino do mesmo dia não pode colidir.
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000001', 'aaaa4444-0000-4000-8000-000000000002', 'absent');
  exception when others then _err := sqlstate;
  end;
  select count(*) into _n from public.timesheet_entries
   where employee_id = 'aaaa4444-0000-4000-8000-000000000002'
     and operation_id = 'aaaa2222-0000-4000-8000-000000000001'
     and work_date = '2026-10-01';
  insert into res values (5, 'absent + present da mesma pessoa', 'sem erro, 2 linhas',
                          format('sqlstate=%s linhas=%s', _err, _n),
                          case when _err = '-' and _n = 2 then 'PASS' else 'FAIL' end);
end
$t5$;

-- ---------------------------------------------------------------------------
-- 6. present + replacement da MESMA pessoa -> bloqueado (ambos faturáveis)
-- ---------------------------------------------------------------------------
do $t6$
declare _err text := '-';
begin
  begin
    -- Colaborador Um já tem diária no Matutino de 01/10 (teste 1).
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values ('aaaa5555-0000-4000-8000-000000000002', 'aaaa4444-0000-4000-8000-000000000001', 'replacement');
  exception when others then _err := sqlstate;
  end;
  insert into res values (6, 'replacement por cima de present', '23505', 'sqlstate=' || _err,
                          case when _err = '23505' then 'PASS' else 'FAIL' end);
end
$t6$;

-- ---------------------------------------------------------------------------
-- 7. Segunda folha SEM TURNO na mesma operação e data -> bloqueada (P1-1)
-- ---------------------------------------------------------------------------
do $t7$
declare _err text := '-';
begin
  begin
    -- já existe a folha ...0004 (Operação B, sem turno, 01/10)
    insert into public.timesheets (operation_id, shift_id, work_date)
    values ('aaaa2222-0000-4000-8000-000000000002', null, '2026-10-01');
  exception when others then _err := sqlstate;
  end;
  insert into res values (7, 'segunda folha sem turno na mesma op/data', '23505', 'sqlstate=' || _err,
                          case when _err = '23505' then 'PASS' else 'FAIL' end);
end
$t7$;

-- ---------------------------------------------------------------------------
-- 8. Forjar operation_id no INSERT -> trigger sobrescreve com o do pai
-- ---------------------------------------------------------------------------
do $t8$
declare _gravado uuid;
begin
  insert into public.timesheet_entries (id, timesheet_id, employee_id, status, operation_id, work_date)
  values ('aaaa6666-0000-4000-8000-000000000008', 'aaaa5555-0000-4000-8000-000000000003',
          'aaaa4444-0000-4000-8000-000000000002', 'present',
          'aaaa2222-0000-4000-8000-000000000002',  -- operação ERRADA de propósito
          '2030-01-01');                            -- data ERRADA de propósito
  select operation_id into _gravado from public.timesheet_entries
   where id = 'aaaa6666-0000-4000-8000-000000000008';
  insert into res values (8, 'spoof de operation_id no INSERT',
                          'aaaa2222-...-0001 (do pai)', _gravado::text,
                          case when _gravado = 'aaaa2222-0000-4000-8000-000000000001' then 'PASS' else 'FAIL' end);
end
$t8$;

-- ---------------------------------------------------------------------------
-- 9. Forjar work_date -> trigger sobrescreve com a do pai
-- ---------------------------------------------------------------------------
do $t9$
declare _gravado date;
begin
  select work_date into _gravado from public.timesheet_entries
   where id = 'aaaa6666-0000-4000-8000-000000000008';
  insert into res values (9, 'spoof de work_date no INSERT', '2026-10-02 (do pai)', _gravado::text,
                          case when _gravado = date '2026-10-02' then 'PASS' else 'FAIL' end);
end
$t9$;

-- 9b. o mesmo vale para UPDATE
do $t9b$
declare _op uuid; _wd date;
begin
  update public.timesheet_entries
     set operation_id = 'aaaa2222-0000-4000-8000-000000000002',
         work_date    = '2030-01-01'
   where id = 'aaaa6666-0000-4000-8000-000000000008';
  select operation_id, work_date into _op, _wd
    from public.timesheet_entries where id = 'aaaa6666-0000-4000-8000-000000000008';
  insert into res values (10, 'spoof de chave no UPDATE', 'valores do pai preservados',
                          format('op=%s data=%s', right(_op::text, 4), _wd),
                          case when _op = 'aaaa2222-0000-4000-8000-000000000001'
                                and _wd = date '2026-10-02' then 'PASS' else 'FAIL' end);
end
$t9b$;

-- ---------------------------------------------------------------------------
-- 10. Mover a folha pai criando colisão -> recusado atomicamente
-- ---------------------------------------------------------------------------
do $t10$
declare _err text := '-'; _wd date;
begin
  begin
    -- A folha ...0003 (02/10) tem diária do Colaborador Um, que também tem
    -- diária em 01/10. Puxar a folha para 01/10 colidiria.
    update public.timesheets set work_date = '2026-10-01'
     where id = 'aaaa5555-0000-4000-8000-000000000003';
  exception when others then _err := sqlstate;
  end;
  select work_date into _wd from public.timesheets where id = 'aaaa5555-0000-4000-8000-000000000003';
  insert into res values (11, 'mover folha pai gerando colisão', '23505 e folha intacta',
                          format('sqlstate=%s work_date=%s', _err, _wd),
                          case when _err = '23505' and _wd = date '2026-10-02' then 'PASS' else 'FAIL' end);
end
$t10$;

-- 10b. movimentação que NÃO colide continua funcionando, e propaga aos filhos
do $t10b$
declare _err text := '-'; _n int;
begin
  begin
    update public.timesheets set work_date = '2026-10-03'
     where id = 'aaaa5555-0000-4000-8000-000000000003';
  exception when others then _err := sqlstate;
  end;
  select count(*) into _n from public.timesheet_entries
   where timesheet_id = 'aaaa5555-0000-4000-8000-000000000003' and work_date = '2026-10-03';
  insert into res values (12, 'mover folha sem colisão propaga aos filhos', 'sem erro, filhos em 03/10',
                          format('sqlstate=%s filhos=%s', _err, _n),
                          case when _err = '-' and _n > 0 then 'PASS' else 'FAIL' end);
end
$t10b$;

-- ---------------------------------------------------------------------------
-- 11. Registro histórico legado continua existente e intacto
-- ---------------------------------------------------------------------------
do $t11$
declare _b numeric; _s text; _inv uuid; _existe boolean;
begin
  select true, billed_amount, status::text, invoice_id
    into _existe, _b, _s, _inv
    from public.timesheet_entries
   where id = 'a453c848-3478-4388-858a-12546103d10b';

  insert into res values (13, 'lançamento legado preservado',
                          'existe, 180.00, present, faturado',
                          format('existe=%s billed=%s status=%s faturado=%s',
                                 coalesce(_existe, false), _b, _s, _inv is not null),
                          case when coalesce(_existe, false)
                                and _b = 180.00 and _s = 'present' and _inv is not null
                               then 'PASS' else 'FAIL' end);

  -- e o par dele continua sob o índice, como diária canônica
  insert into res
  select 14, 'par do legado sob o índice', 'existe, 450.00',
         format('billed=%s', billed_amount),
         case when billed_amount = 450.00 then 'PASS' else 'FAIL' end
    from public.timesheet_entries where id = '5ebf2a8b-cf39-4862-869f-030e7f49377d';
end
$t11$;

-- ---------------------------------------------------------------------------
-- 12. A exceção é de um id só, e não uma porta aberta
-- ---------------------------------------------------------------------------
-- Uma diária NOVA para o mesmo colaborador/operação/data do caso legado tem de
-- ser recusada: a exclusão do índice vale para aquele id, não para a chave.
do $t12$
declare _err text := '-'; _ts uuid;
begin
  select id into _ts from public.timesheets
   where operation_id = 'f2cb1dfc-620f-4262-817f-3379590052bb' and work_date = '2026-09-05'
   limit 1;
  begin
    insert into public.timesheet_entries (timesheet_id, employee_id, status)
    values (_ts, '7f1e83f7-97e2-499e-ab7f-d69684740526', 'present');
  exception when others then _err := sqlstate;
  end;
  insert into res values (15, 'nova diária na chave do caso legado', '23505', 'sqlstate=' || _err,
                          case when _err = '23505' then 'PASS' else 'FAIL' end);
end
$t12$;

-- ---------------------------------------------------------------------------
-- Concorrência
-- ---------------------------------------------------------------------------
-- Duas sessões simultâneas não são reproduzíveis a partir de uma única conexão
-- sem dblink ou pg_background, e montar esse aparato só para o teste seria
-- criar mecanismo artificial. A garantia aqui é estrutural, não empírica: a
-- unicidade vem de um índice único, avaliado no commit pelo próprio Postgres.
-- Duas transações concorrentes inserindo a mesma chave terminam com uma delas
-- recebendo 23505, porque nenhuma das duas precisa ter enxergado a outra.

insert into res values (19, 'concorrência', 'garantida por índice único',
                        'não exercitada nesta suíte — ver comentário', 'INFO');

-- ---------------------------------------------------------------------------
-- 17. A exceção histórica está amarrada à chave inteira, não só ao id
-- ---------------------------------------------------------------------------
-- Trocar o colaborador do lançamento legado faz a linha deixar de casar com a
-- tupla isenta, e ela passa a ser coberta pelo índice. O alvo escolhido já tem
-- diária faturável nessa operação e data, então a colisão é imediata.
--
-- O UPDATE roda dentro de um bloco com EXCEPTION: a subtransação é desfeita em
-- qualquer desfecho, então o lançamento legado volta ao estado original ainda
-- dentro deste bloco — e não só no rollback do final. O teste 18 confere.
do $t17$
declare _err text := '-';
begin
  begin
    update public.timesheet_entries
       set employee_id = '90adc471-8b06-40ba-8182-ef1abcddeca8'
     where id = 'a453c848-3478-4388-858a-12546103d10b';
    -- Chegar aqui significa que o índice não cobriu a linha alterada.
    raise exception 'ROLLBACK_DO_TESTE' using errcode = 'P0001';
  exception
    when unique_violation then _err := '23505';
    when others then _err := case when sqlerrm = 'ROLLBACK_DO_TESTE' then 'sem erro' else sqlstate end;
  end;
  insert into res values (17, 'trocar colaborador do legado deixa de ser exceção', '23505',
                          'sqlstate=' || _err,
                          case when _err = '23505' then 'PASS' else 'FAIL' end);
end
$t17$;

-- ---------------------------------------------------------------------------
-- 18. E o legado continua intacto depois da tentativa
-- ---------------------------------------------------------------------------
do $t18$
declare _emp uuid; _b numeric; _inv uuid;
begin
  select employee_id, billed_amount, invoice_id into _emp, _b, _inv
    from public.timesheet_entries where id = 'a453c848-3478-4388-858a-12546103d10b';
  insert into res values (18, 'legado intacto após a tentativa', 'colaborador e valor originais',
                          format('emp=%s billed=%s faturado=%s', right(_emp::text, 4), _b, _inv is not null),
                          case when _emp = '7f1e83f7-97e2-499e-ab7f-d69684740526'
                                and _b = 180.00 and _inv is not null then 'PASS' else 'FAIL' end);
end
$t18$;


select n, teste, esperado, obtido, status from res order by n;

rollback;
