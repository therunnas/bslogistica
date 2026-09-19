/**
 * Chaves de cache da superfície operacional.
 *
 * Ficam num módulo próprio porque são usadas dos dois lados: as leituras as
 * declaram e a escrita invalida exatamente a chave do contexto que acabou de
 * mudar. Escrever a chave à mão nos dois lugares é como se invalida a query
 * errada.
 *
 * Todas começam por `operacional`, então nada aqui colide com as chaves do
 * caminho administrativo, que são o nome da tabela.
 */

export const RAIZ_OPERACIONAL = "operacional" as const;

export const chavesOperacionais = {
  /** Todas as operações atribuídas à sessão. */
  operacoes: () => [RAIZ_OPERACIONAL, "operacoes"] as const,

  /** Turnos de uma operação. */
  turnos: (operationId: string | null) => [RAIZ_OPERACIONAL, "turnos", operationId] as const,

  /** Equipe alocada a um par operação/turno. */
  equipe: (operationId: string | null, shiftId: string | null) =>
    [RAIZ_OPERACIONAL, "equipe", operationId, shiftId] as const,

  /** Folha e linhas de um par operação/turno numa data. */
  apontamentos: (operationId: string | null, shiftId: string | null, workDate: string | null) =>
    [RAIZ_OPERACIONAL, "apontamentos", operationId, shiftId, workDate] as const,
};
