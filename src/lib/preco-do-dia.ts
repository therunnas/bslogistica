/**
 * Prévia do apontamento com a resolução de tarifas LIGADA (FUNC-READY-01).
 *
 * A prévia de linha nova partia sempre do preço-base do contrato, mas com a resolução ligada o banco cobra
 * a diária individual do colaborador ou a tarifa da função e do período: a tela mostrava um número e o
 * banco gravava outro. Esta função aplica à condição do dia a MESMA precedência de
 * `derivar_valores_por_vigencia` (041/042/048): 1º diária individual vigente na data, 2º tarifa da função e
 * do período, 3º preço-base (só com o recuo da 048). Quando o banco recusaria, a prévia diz por quê em vez
 * de mostrar um valor. Só apresentação: o banco continua decidindo e revalidando ao salvar.
 */
import type { CondicaoDoDia } from "./apontamentos-financeiro";
import type { DiariaIndividual } from "./diaria-individual";
import type { TarifaDoContrato } from "./tarifas";

type Versao = Pick<DiariaIndividual, "valid_from" | "valid_to" | "daily_rate" | "active">;

/** Mesma convenção do banco: [início, fim), só versões ativas. */
const vigenteNaData = (v: Versao, data: string) =>
  v.active && v.valid_from <= data && (v.valid_to === null || data < v.valid_to);

export type FonteDoPreco = "individual" | "funcao_periodo" | "preco_base";

export function aplicarPrecedenciaDoPreco(
  condicao: CondicaoDoDia,
  p: {
    resolucaoLigada: boolean;
    recuoNoPrecoBase: boolean;
    contratoId: string | null;
    colaboradorId: string;
    data: string;
    funcaoId: string | null;
    periodo: "diurno" | "noturno" | null;
    /** Nulo = ainda carregando ou erro de leitura: nunca vira "sem tarifa". */
    individuais: readonly DiariaIndividual[] | null;
    tarifas: readonly TarifaDoContrato[] | null;
  },
): CondicaoDoDia & { fonte?: FonteDoPreco } {
  if (!condicao.ok || !p.resolucaoLigada || !p.contratoId) return condicao;
  if (p.individuais === null || p.tarifas === null) {
    return { ok: false, motivo: "Prévia indisponível: consultando as tarifas do contrato." };
  }
  if (!p.funcaoId) {
    return {
      ok: false,
      motivo:
        "Informe a função do dia: com as tarifas ligadas, o banco exige a função para cobrar.",
    };
  }
  if (!p.periodo) {
    return {
      ok: false,
      motivo:
        "Classifique o turno como diurno ou noturno: com as tarifas ligadas, o banco exige o período.",
    };
  }
  const individual = p.individuais.find(
    (v) =>
      v.contract_id === p.contratoId &&
      v.employee_id === p.colaboradorId &&
      vigenteNaData(v, p.data),
  );
  const tarifa = individual
    ? undefined
    : p.tarifas.find(
        (t) =>
          t.contract_id === p.contratoId &&
          t.job_function_id === p.funcaoId &&
          t.shift_period === p.periodo &&
          vigenteNaData(t, p.data),
      );
  const escolhida = individual ?? tarifa;
  if (escolhida) {
    return {
      ...condicao,
      regras: { ...condicao.regras, daily_rate: Number(escolhida.daily_rate) },
      fonte: individual ? "individual" : "funcao_periodo",
    };
  }
  if (p.recuoNoPrecoBase) return { ...condicao, fonte: "preco_base" };
  return {
    ok: false,
    motivo:
      "Sem diária individual nem tarifa desta função e período na data: o banco recusa o lançamento.",
  };
}
