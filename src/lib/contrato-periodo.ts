/**
 * Período do cadastro de contrato (S19E-DEF-002): "Vigente até" é opcional, mas quando informado
 * precisa ser posterior a "Vigente de". O banco não tem restrição para isso; a tela recusa antes.
 */
export function erroDoPeriodoDoContrato(inicio: string, fim: string): string | null {
  if (inicio.trim() === "") return "Informe “Vigente de”.";
  if (fim.trim() !== "" && fim <= inicio) return "“Vigente até” deve ser posterior a “Vigente de”.";
  return null;
}
