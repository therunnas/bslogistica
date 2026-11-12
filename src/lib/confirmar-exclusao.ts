/**
 * Pergunta antes de excluir um cadastro (cliente, contrato, operação, turno, colaborador). Antes um
 * clique na lixeira apagava na hora. O banco continua recusando o que tem lançamento vinculado.
 * `consequencias` diz o que mais some junto (ex.: cliente leva contratos e operações em cascata).
 */
export function confirmarExclusao(oQue: string, consequencias = ""): boolean {
  if (typeof window === "undefined") return false;
  const extra = consequencias ? ` ${consequencias}` : "";
  return window.confirm(`Excluir ${oQue}?${extra} Esta ação não pode ser desfeita.`);
}
