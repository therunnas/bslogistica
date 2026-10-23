-- Integridade cliente-contrato-operação (C05-A).
--
-- Invariante: uma operação só pode referenciar um contrato do MESMO cliente.
-- Contrato nulo continua permitido (a operação cobra pelo `agreed_amount`).
--
-- O QUE FOI MEDIDO (C05.1, PostgreSQL 17.6 local, papel `authenticated` com
-- sessão AAL2 de admin, RLS e triggers ativos), antes desta migration
--
--   - INSERT de operação do cliente A com o contrato do cliente B: ACEITO. O
--     apontamento derivado nela saiu com a taxa do cliente B (R$ 300,00 onde o
--     contrato do cliente A daria R$ 137,50), e a seleção do `gerar_fatura`
--     somaria esse valor na fatura do cliente A.
--   - UPDATE do cliente de uma operação, mantendo o contrato do cliente antigo:
--     ACEITO.
--   - UPDATE do cliente de um contrato já referenciado por operações: ACEITO.
--
-- Nenhum trigger, constraint ou RPC conferia a relação. A interface filtra os
-- contratos pelo cliente no formulário de operação, mas a tela de contratos
-- deixava trocar o cliente de um contrato existente, e o CRUD genérico fala
-- direto com o PostgREST: a tela nunca foi a defesa.
--
-- COMO FECHA
--
--   1. `contracts (id, client_id)` ganha UNIQUE. `id` já é a chave primária,
--      então o par é trivialmente único e a constraint nunca falha; ela existe
--      só para ser ALVO da chave estrangeira composta.
--   2. `operations (contract_id, client_id)` referencia `contracts (id, client_id)`.
--        MATCH SIMPLE (padrão): se `contract_id` é NULL, a constraint não é
--          conferida. Operação sem contrato segue válida. `client_id` já é
--          NOT NULL.
--        ON DELETE SET NULL (contract_id): apagar o contrato desvincula a
--          operação e PRESERVA o `client_id` dela. Um `SET NULL` sem lista de
--          colunas tentaria anular `client_id` (NOT NULL) e falharia. A lista de
--          colunas exige PostgreSQL 15 ou mais; a homologação e Production usam o 17.
--        ON UPDATE NO ACTION (padrão): mudar `contracts.client_id` enquanto
--          existir operação referenciando o par é recusado (23503); mudar
--          `operations.client_id` ou `contract_id` para um par inexistente também.
--   3. A chave `operations_contract_id_fkey` (só `contract_id`, ON DELETE SET NULL)
--      FICA. Ela cobre as linhas legadas inválidas, que a composta não alcança:
--      sem ela, apagar um contrato deixaria de desvincular as operações legadas
--      cujo par não bate.
--
-- DADOS LEGADOS: esta migration NÃO corrige, desvincula, apaga nem reescreve
-- nenhuma linha. A chave composta entra como NOT VALID: vale para todo INSERT e
-- todo UPDATE que toque `client_id` ou `contract_id` a partir de agora, e não
-- examina o que já existe. Em seguida, UM bloco conta as operações cujo
-- cliente difere do cliente do contrato:
--
--   - ZERO: valida a constraint (leitura das duas tabelas; o par já está
--     protegido contra novas linhas).
--   - MAIS DE ZERO: não valida, não altera nada e emite um WARNING com a
--     contagem. As linhas inválidas continuam editáveis nos campos que não
--     envolvem a relação; qualquer UPDATE de `client_id` ou `contract_id`
--     nelas passa pela conferência e só aceita um par válido. A decisão de
--     corrigir cada uma é empresarial (um apontamento já pode ter sido gravado
--     com a taxa do contrato errado) e acontece fora desta migration, seguida
--     de:
--
--       ALTER TABLE public.operations
--         VALIDATE CONSTRAINT operations_contrato_do_cliente_fkey;
--
-- Diagnóstico das linhas legadas (somente leitura):
--
--   select o.id, o.name, o.client_id as cliente_da_operacao,
--          c.id as contrato, c.client_id as cliente_do_contrato
--     from public.operations o
--     join public.contracts c on c.id = o.contract_id
--    where o.client_id <> c.client_id;
--
-- LOCKS: `ADD CONSTRAINT UNIQUE` em `contracts` e as duas `ADD CONSTRAINT` pedem
-- bloqueios fortes (ACCESS EXCLUSIVE na criação do índice de `contracts`,
-- SHARE ROW EXCLUSIVE em `operations` e `contracts` por causa da chave
-- estrangeira), mantidos até o COMMIT. `NOT VALID` evita o escaneamento de
-- `operations` na criação; a validação condicional lê as duas tabelas e
-- segura SHARE UPDATE EXCLUSIVE. As tabelas são pequenas (centenas de linhas
-- em Production, ordem de milissegundos); em volume grande a validação deveria ir
-- numa migration à parte.
--
-- O QUE NÃO MUDA: nenhuma policy, grant, trigger ou função; nenhum valor
-- financeiro; as proteções de apontamento faturado; o comportamento de apagar
-- cliente (CASCADE) ou contrato usado em apontamento (trigger 011).

alter table public.contracts
  add constraint contracts_id_client_id_key unique (id, client_id);

alter table public.operations
  add constraint operations_contrato_do_cliente_fkey
  foreign key (contract_id, client_id)
  references public.contracts (id, client_id)
  on delete set null (contract_id)
  not valid;

do $validar$
declare
  _inconsistentes bigint;
begin
  select count(*) into _inconsistentes
    from public.operations o
    join public.contracts c on c.id = o.contract_id
   where o.client_id <> c.client_id;

  if _inconsistentes = 0 then
    alter table public.operations
      validate constraint operations_contrato_do_cliente_fkey;
  else
    raise warning
      '021: % operação(ões) com contrato de OUTRO cliente. Nada foi alterado; a constraint operations_contrato_do_cliente_fkey ficou NOT VALID (vale para novas escritas). Corrija cada linha por decisão empresarial e rode VALIDATE CONSTRAINT.',
      _inconsistentes;
  end if;
end;
$validar$;

comment on constraint contracts_id_client_id_key on public.contracts is
  'Alvo da chave estrangeira composta de operations. id já é chave primária: o par é único por construção.';

comment on constraint operations_contrato_do_cliente_fkey on public.operations is
  'Uma operação só referencia contrato do mesmo cliente (C05-A). MATCH SIMPLE: contrato nulo é válido. ON DELETE SET NULL (contract_id) preserva o client_id. Pode estar NOT VALID enquanto houver linha legada inconsistente.';

-- ---------------------------------------------------------------------------
-- Autoverificação (estrutura; não depende de dados)
-- ---------------------------------------------------------------------------

do $verificacao$
declare
  _n int;
begin
  select count(*) into _n
    from pg_constraint
   where conrelid = 'public.contracts'::regclass
     and conname = 'contracts_id_client_id_key'
     and contype = 'u';
  if _n <> 1 then
    raise exception '021: UNIQUE (id, client_id) de contracts ausente';
  end if;

  select count(*) into _n
    from pg_constraint k
   where k.conrelid = 'public.operations'::regclass
     and k.conname = 'operations_contrato_do_cliente_fkey'
     and k.contype = 'f'
     and k.confrelid = 'public.contracts'::regclass
     and k.confmatchtype = 's'
     and k.confdeltype = 'n'
     and k.confupdtype = 'a'
     and array_length(k.conkey, 1) = 2
     and array_length(k.confkey, 1) = 2
     and k.confdelsetcols = array[
       (select attnum from pg_attribute where attrelid = 'public.operations'::regclass and attname = 'contract_id')
     ];
  if _n <> 1 then
    raise exception '021: chave composta de operations ausente ou com MATCH/ON DELETE/ON UPDATE inesperados';
  end if;

  select count(*) into _n
    from pg_constraint
   where conrelid = 'public.operations'::regclass
     and conname = 'operations_contract_id_fkey'
     and contype = 'f'
     and confdeltype = 'n';
  if _n <> 1 then
    raise exception '021: a chave original operations_contract_id_fkey deveria permanecer';
  end if;

  select count(*) into _n
    from pg_attribute
   where attrelid = 'public.operations'::regclass
     and attname in ('client_id')
     and attnotnull;
  if _n <> 1 then
    raise exception '021: operations.client_id deveria ser NOT NULL';
  end if;
end;
$verificacao$;
