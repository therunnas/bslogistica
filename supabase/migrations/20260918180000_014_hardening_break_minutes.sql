-- Intervalo não é negativo — invariante que faltava em `break_minutes`.
--
-- O PROBLEMA, MEDIDO E NÃO SUPOSTO
--
-- `public.timesheet_entries.break_minutes` e `public.shifts.break_minutes`
-- nasceram `integer NOT NULL DEFAULT 0` e nunca tiveram CHECK nenhum — a
-- consulta a `pg_constraint` com `contype = 'c'` devolve zero linhas nas duas
-- tabelas. Nada, em lugar nenhum, impedia um valor negativo.
--
-- E o valor negativo não fica parado: a derivação da migration 010 faz
--
--   _worked := GREATEST(0, _fim - _inicio - COALESCE(NEW.break_minutes, 0));
--
-- Subtrair um negativo SOMA. O `GREATEST(0, …)` protege o piso, não o teto, e
-- o excedente vira hora extra, que vira dinheiro. Medido em PostgreSQL local
-- com as 19 migrations aplicadas, turno 08:00–17:00 e contrato de R$ 150,00
-- por 8 h com fator 1,5 e tolerância de 10 min:
--
--   break_minutes =       0  ->  worked    540  ->  billed R$    178,13
--   break_minutes =    -120  ->  worked    660  ->  billed R$    234,38
--   break_minutes = -100000  ->  worked 100540  ->  billed R$ 47.053,13
--
-- Isso vale para OS DOIS caminhos de escrita, e é por isso que a correção mora
-- na tabela e não numa função: o admin em AAL2 grava direto em
-- `timesheet_entries` e foi medido aceitando os mesmos -120; a RPC
-- `salvar_apontamento_operacional` faz `coalesce(… , 0)`, que cobre chave
-- ausente e não sinal. Um CHECK de tabela fecha os dois de uma vez, e fecha
-- também qualquer caminho de escrita que venha a existir.
--
-- Em `shifts` o efeito é INVERSO e igualmente indesejado: intervalo negativo
-- aumenta a jornada prevista, o excedente encolhe e a hora extra some. Fatura a
-- MENOS. Mesma ausência de invariante, mesmo remédio.
--
-- POR QUE `ADD CONSTRAINT` SIMPLES, SEM `NOT VALID`
--
-- O preflight `supabase/preflight/014_break_minutes_preflight.sql` foi rodado
-- contra Production em 18/09/2026, em transação `READ ONLY`. As duas tabelas
-- estão VAZIAS — zero linhas, zero negativos, zero linha faturada afetada.
-- Sem legado não há o que validar em separado nem histórico a proteger, então
-- `NOT VALID` seguido de `VALIDATE CONSTRAINT` só acrescentaria cerimônia. Se
-- algum dia houver dados, esta migration já terá sido aplicada.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO
--
--   - não impõe teto. `break_minutes` maior que a jornada continua aceito, e é
--     absorvido pelo `GREATEST(0, …)` — distorce para R$ 0, não para mais.
--     Teto estrutural (maior que a duração bruta) precisaria de trigger, porque
--     um CHECK de `timesheet_entries` não enxerga o turno; teto comercial é
--     decisão humana. Ficam registrados como tarefa própria, não inventados
--     aqui;
--   - não toca em `salvar_apontamento_operacional`. Duplicar ~180 linhas de
--     função para acrescentar um `IF` criaria duas cópias para divergir, e
--     obrigaria a repetir a janela de `CREATE`/`REVOKE` no schema que derrubou
--     o primeiro deploy da 013. A violação sobe como `23514` e a camada de
--     dados do B2.1 já preserva `code`, `details` e `hint`;
--   - não altera policy, grant, ownership, trigger nem a fórmula financeira;
--   - não mexe nas migrations 010, 011, 012 e 013, que estão em Production e
--     são imutáveis.
--
-- A mensagem amigável pertence à interface. A autoridade da regra é o banco.

ALTER TABLE public.timesheet_entries
  ADD CONSTRAINT timesheet_entries_break_minutes_nao_negativo
  CHECK (break_minutes >= 0);

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_break_minutes_nao_negativo
  CHECK (break_minutes >= 0);

COMMENT ON CONSTRAINT timesheet_entries_break_minutes_nao_negativo
  ON public.timesheet_entries IS
  'Intervalo do apontamento nao pode ser negativo. Sem isto, break_minutes negativo AUMENTA worked_minutes na derivacao da migration 010 e infla hora extra, billed_amount e cost_amount. Vale para todos os caminhos de escrita: admin direto na tabela e RPC operacional.';

COMMENT ON CONSTRAINT shifts_break_minutes_nao_negativo
  ON public.shifts IS
  'Intervalo do turno nao pode ser negativo. Sem isto, break_minutes negativo aumenta a jornada prevista na derivacao da migration 010, encolhe o excedente e faz a hora extra desaparecer — fatura a menos.';


-- ---------------------------------------------------------------------------
-- Autoverificação
--
-- Recusa a migration se qualquer uma das duas constraints não tiver ficado de
-- pé com a definição pretendida. É o mesmo padrão da 013, no tamanho que esta
-- migration merece.
-- ---------------------------------------------------------------------------

DO $verificacao$
DECLARE
  _faltando text[] := '{}'::text[];
  _tabela   text;
  _nome     text;
  _def      text;
BEGIN
  FOREACH _tabela IN ARRAY ARRAY['timesheet_entries', 'shifts']
  LOOP
    _nome := _tabela || '_break_minutes_nao_negativo';

    SELECT pg_get_constraintdef(c.oid) INTO _def
      FROM pg_constraint c
     WHERE c.conname  = _nome
       AND c.contype  = 'c'
       AND c.conrelid = ('public.' || _tabela)::regclass;

    IF _def IS NULL THEN
      _faltando := _faltando || (_nome || ' ausente');
    ELSIF _def !~ 'break_minutes >= 0' THEN
      _faltando := _faltando || (_nome || ' com definicao inesperada: ' || _def);
    END IF;
  END LOOP;

  IF array_length(_faltando, 1) > 0 THEN
    RAISE EXCEPTION '014: verificacao final falhou -> %', array_to_string(_faltando, '; ');
  END IF;
END
$verificacao$;
