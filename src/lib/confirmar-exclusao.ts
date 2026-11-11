/**
 * Pergunta antes de excluir um cadastro (cliente, contrato, operação, turno, colaborador). Antes um
 * clique na lixeira apagava na hora. O banco continua recusando o que tem lançamento vinculado.
 */
export function confirmarExclusao(oQue: string): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(`Excluir ${oQue}? Esta ação não pode ser desfeita.`);
}
