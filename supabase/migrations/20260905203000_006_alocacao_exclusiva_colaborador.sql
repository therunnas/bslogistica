-- Regra operacional: um colaborador ocupa no máximo UMA operação e UM turno por
-- vez. Enquanto a alocação estiver ativa, ele não pode estar em outro turno da
-- mesma operação nem em qualquer turno de outra operação, mesmo que os horários
-- não se sobreponham. Mover alguém exige desalocar antes.
--
-- A constraint que já existe não garante isso:
--
--   UNIQUE (operation_id, shift_id, employee_id)
--
-- Ela impede repetir a mesma trinca, mas permite todas estas combinações:
--
--   empregado X -> operação A -> turno 1
--   empregado X -> operação A -> turno 2
--   empregado X -> operação B -> turno 1
--
-- O índice abaixo fecha isso no banco, e não só na interface: duas sessões
-- tentando alocar o mesmo colaborador ao mesmo tempo terminam com uma delas
-- recebendo 23505, porque a checagem de unicidade acontece no commit e não
-- depende de quem leu primeiro.
--
-- É um índice PARCIAL, condicionado a `active`. `operation_team.active` tem
-- default `true` e hoje a aplicação só grava `true`, desalocando por DELETE —
-- ou seja, a coluna ainda não tem função histórica real. O índice parcial é
-- escrito assim mesmo para que, no dia em que a desalocação passar a ser
-- `active = false` em vez de DELETE, o histórico continue possível sem que
-- linhas inativas bloqueiem novas alocações.
--
-- `shift_id` nulo continua sendo alocação válida e também ocupa o colaborador:
-- a condição do índice é apenas `active`, sem mencionar o turno.
--
-- ATENÇÃO — pré-requisito de dados: a criação falha se já existir qualquer
-- colaborador com mais de uma linha ativa. Rode antes:
--
--   SELECT employee_id, count(*)
--   FROM public.operation_team
--   WHERE active
--   GROUP BY employee_id
--   HAVING count(*) > 1;
--
-- Auditado em 05/09/2026: zero ocorrências, 6 vínculos ativos, um por
-- colaborador. Se o resultado vier diferente no momento da aplicação, PARE: o
-- saneamento é decisão humana, não automática. Esta migration de propósito não
-- apaga nem escolhe qual vínculo preservar.

CREATE UNIQUE INDEX IF NOT EXISTS operation_team_um_ativo_por_colaborador
  ON public.operation_team (employee_id)
  WHERE active;

COMMENT ON INDEX public.operation_team_um_ativo_por_colaborador IS
  'Exclusividade operacional: no máximo uma alocação ativa por colaborador, '
  'em qualquer operação ou turno. Desalocar antes de mover.';
