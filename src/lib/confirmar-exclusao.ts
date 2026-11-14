/**
 * Texto da confirmação de exclusão de um cadastro (cliente, contrato, operação, turno,
 * colaborador). Antes um clique na lixeira apagava na hora; depois houve um `window.confirm`
 * nativo (D8). Desde o CP-09 a pergunta é feita pelo diálogo da tela
 * (`_components/confirmacao-de-exclusao.tsx`) com este mesmo texto. O banco continua recusando o
 * que tem lançamento vinculado. `consequencias` diz o que mais some junto (ex.: cliente leva
 * contratos e operações em cascata).
 */
export function mensagemDaExclusao(
  oQue: string,
  consequencias = "",
): { titulo: string; descricao: string } {
  const extra = consequencias.trim() ? `${consequencias.trim()} ` : "";
  return {
    titulo: `Excluir ${oQue}?`,
    descricao: `${extra}Esta ação não pode ser desfeita.`,
  };
}
