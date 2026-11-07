/**
 * Regra aprovada para a operação avulsa (S19E): a data da operação é obrigatória; sem contrato
 * (regra de cobrança), o valor acordado por diária é obrigatório e não negativo; zero só quando
 * informado explicitamente e justificado em Observações. Com contrato, o valor vem do contrato.
 * Na edição com o valor travado pela vigência, o valor não é exigido aqui (muda por vigência).
 * Operação fixa não passa por estas regras. Validação de interface; o banco não muda.
 */
export interface FormularioDeOperacao {
  type: string;
  contract_id: string;
  agreed_amount: string;
  operation_date: string;
  notes: string;
}

export function validarOperacaoAvulsa(
  form: FormularioDeOperacao,
  { valorTravado }: { valorTravado: boolean },
): string[] {
  if (form.type !== "spot") return [];
  const erros: string[] = [];
  if (form.operation_date.trim() === "") erros.push("Informe a data da operação avulsa.");
  if (form.contract_id || valorTravado) return erros;

  const texto = form.agreed_amount.trim().replace(",", ".");
  if (texto === "") {
    erros.push("Informe o valor acordado por diária (zero só com justificativa em Observações).");
    return erros;
  }
  const valor = /^\d+(\.\d+)?$/.test(texto) ? Number(texto) : Number.NaN;
  if (!Number.isFinite(valor)) {
    erros.push("Informe um valor acordado válido, sem negativo.");
  } else if (valor === 0 && form.notes.trim() === "") {
    erros.push("Valor zero exige justificativa em Observações.");
  }
  return erros;
}
