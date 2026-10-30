/**
 * Regras puras da tela de implantação das vigências (C05-B5.7).
 *
 * Nada aqui fala com o banco nem inventa valor: a tela só LISTA o que as RPCs de implantação já
 * devolvem (`pendencias_implantacao_vigencias` e `divergencias_implantacao_vigencias`, admin) e aponta para a tela do cadastro, onde a vigência é registrada com data de início e
 * motivo informados por quem decide. Preço histórico nunca é presumido: sem vigência para hoje,
 * o cadastro continua pendente e a ativação do motor continua bloqueada pelo banco.
 */

export type TipoDePendencia = "contrato" | "colaborador" | "operacao_sem_contrato";

export interface LinhaDePendencia {
  tipo: TipoDePendencia;
  id: string;
  nome: string;
}

export interface LinhaDeDivergencia extends LinhaDePendencia {
  campos: string[];
}

export const ROTULO_DO_TIPO: Readonly<Record<TipoDePendencia, string>> = {
  contrato: "Contrato",
  colaborador: "Colaborador",
  operacao_sem_contrato: "Operação sem contrato",
};

/** Tela onde o cadastro é aberto para registrar a vigência (os formulários já existem lá). */
export const ROTA_DO_TIPO = {
  contrato: "/clientes",
  colaborador: "/colaboradores",
  operacao_sem_contrato: "/operacoes",
} as const satisfies Record<TipoDePendencia, string>;

export const ROTULO_DO_CAMPO: Readonly<Record<string, string>> = {
  daily_rate: "diária",
  shift_hours: "jornada",
  ot_factor: "fator de hora extra",
  ot_tolerance_min: "tolerância de hora extra",
  daily_cost: "custo diário",
  agreed_amount: "valor acordado",
};

const TIPOS: ReadonlySet<string> = new Set<TipoDePendencia>([
  "contrato",
  "colaborador",
  "operacao_sem_contrato",
]);

function lerLinha(x: unknown): LinhaDePendencia | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as { tipo?: unknown; id?: unknown; nome?: unknown };
  if (typeof r.tipo !== "string" || !TIPOS.has(r.tipo)) return null;
  if (typeof r.id !== "string" || r.id === "") return null;
  return {
    tipo: r.tipo as TipoDePendencia,
    id: r.id,
    nome: typeof r.nome === "string" ? r.nome : "",
  };
}

/** `null` = resposta inválida (a tela mostra erro e NUNCA "nenhuma pendência"). */
export function lerPendencias(data: unknown): LinhaDePendencia[] | null {
  if (!Array.isArray(data)) return null;
  const linhas = data.map(lerLinha);
  return linhas.every((l) => l !== null) ? (linhas as LinhaDePendencia[]) : null;
}

export function lerDivergencias(data: unknown): LinhaDeDivergencia[] | null {
  if (!Array.isArray(data)) return null;
  const saida: LinhaDeDivergencia[] = [];
  for (const item of data) {
    const base = lerLinha(item);
    const campos = (item as { campos?: unknown } | null)?.campos;
    if (base === null || !Array.isArray(campos) || !campos.every((c) => typeof c === "string")) {
      return null;
    }
    saida.push({ ...base, campos: campos as string[] });
  }
  return saida;
}

export function rotuloDosCampos(campos: readonly string[]): string {
  return campos.map((c) => ROTULO_DO_CAMPO[c] ?? c).join(", ");
}

export interface ResumoDaImplantacao {
  pendentes: number;
  divergentes: number;
  /** Só informativo: ligar o motor continua sendo ato do banco, com admin e motivo. */
  semBloqueios: boolean;
}

export function resumirImplantacao(
  pendencias: readonly LinhaDePendencia[],
  divergencias: readonly LinhaDeDivergencia[],
): ResumoDaImplantacao {
  return {
    pendentes: pendencias.length,
    divergentes: divergencias.length,
    semBloqueios: pendencias.length === 0 && divergencias.length === 0,
  };
}

/** Texto do motivo de cada lista: o que o banco constatou e o que falta decidir. */
export const MOTIVO_DA_PENDENCIA =
  "Em uso e sem vigência para hoje. Registre a vigência na tela do cadastro, com a data de início e o motivo que você conhece; nada é presumido.";

export function motivoDaDivergencia(campos: readonly string[]): string {
  return `A coluna do cadastro (${rotuloDosCampos(campos)}) difere da vigência de hoje. Decida qual vale: corrigir a coluna com o motor desligado ou registrar a vigência desejada.`;
}

export function textoDosApontamentosLegados(total: number | null): string {
  if (total === null) return "Não foi possível contar os apontamentos legados.";
  if (total === 0) return "Nenhum apontamento legado (sem origem de preço).";
  return `${total} apontamento(s) legado(s) sem origem de preço. Seguem com os valores gravados, nada é recalculado; a regularização é por apontamento, com o motor ligado, prévia e trilha.`;
}
