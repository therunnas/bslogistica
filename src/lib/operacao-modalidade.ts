/**
 * Como cada operação é cobrada, em texto para a lista de Operações (UX-SIMPLIFICACAO-01).
 * Só apresentação: o preço continua sendo decidido pelo banco. Fixa e avulsa seguem a classificação
 * gravada (`type`); com contrato, o preço é o do contrato; avulsa sem contrato usa o valor acordado
 * POR DIÁRIA. Sem contrato e sem valor é pendência visível, nunca "R$ 0" implícito.
 */
import { brl } from "./format";

export interface OperacaoParaModalidade {
  type: string;
  contract_id: string | null;
  agreed_amount: number | string | null;
}

export interface ModalidadeDaOperacao {
  tipo: "fixa" | "avulsa" | "outro";
  rotulo: string;
  cobranca: string;
  pendente: boolean;
}

export function modalidadeDaOperacao(
  op: OperacaoParaModalidade,
  nomeDoContrato: string | null,
): ModalidadeDaOperacao {
  const tipo = op.type === "fixed" ? "fixa" : op.type === "spot" ? "avulsa" : "outro";
  const rotulo = tipo === "fixa" ? "Fixa" : tipo === "avulsa" ? "Avulsa" : "Sem classificação";
  if (op.contract_id) {
    return {
      tipo,
      rotulo,
      cobranca: `Preço do contrato ${nomeDoContrato ?? ""}`.trim(),
      pendente: false,
    };
  }
  if (op.agreed_amount !== null && op.agreed_amount !== undefined && op.agreed_amount !== "") {
    return {
      tipo,
      rotulo,
      cobranca: `Valor acordado ${brl(Number(op.agreed_amount))} por diária`,
      pendente: false,
    };
  }
  return { tipo, rotulo, cobranca: "Sem regra de cobrança definida", pendente: true };
}
