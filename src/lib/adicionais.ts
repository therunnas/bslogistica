/**
 * Adicionais de serviço do período (C05-B8.10, migration 029; competência na 038).
 *
 * Regra da BS: serviços adicionais (etiquetagem, separação, contêiner, truck ou carreta...) geram
 * valores extras no período SEM alterar a diária padrão e sem criar outra diária. Cada adicional
 * tem motivo, valor, referência, período, cliente e, opcionalmente, a operação.
 *
 * Com a migration 038 (FIN-PR-05) o adicional tem DOIS períodos: o de EXECUÇÃO (`period_*`) e a
 * competência de COBRANÇA (`billing_period_*`), uma janela da frequência do cliente. Pode ser
 * cobrado antes da execução (executado em novembro, cobrado na 2ª quinzena de outubro). Adicional
 * sem competência (registrado antes da 038, ou num banco sem ela) segue a regra antiga: a execução
 * inteira dentro da fatura.
 *
 * O banco é a barreira: `registrar_adicional` e `cancelar_adicional` (admin, trilha),
 * tabela sem escrita direta, adicional faturado imutável, e `gerar_fatura` que soma os adicionais
 * do período. Este módulo só valida o formulário, monta os parâmetros e reproduz, para a prévia,
 * o mesmo critério de elegibilidade da fatura.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export const RPC_ADICIONAIS = {
  registrar: "registrar_adicional",
  cancelar: "cancelar_adicional",
} as const;

export interface Adicional {
  id: string;
  client_id: string;
  operation_id: string | null;
  period_start: string;
  period_end: string;
  description: string;
  reference: string | null;
  amount: number | string;
  invoice_id: string | null;
  created_at: string;
  canceled_at: string | null;
  cancel_reason: string | null;
  /** Migration 038; ausentes antes dela, nulos = sem competência (regra antiga). */
  billing_period_start?: string | null;
  billing_period_end?: string | null;
}

export interface FormularioDeAdicional {
  clienteId: string;
  operacaoId: string;
  inicio: string;
  fim: string;
  motivo: string;
  referencia: string;
  /** Texto digitado, aceita vírgula decimal. */
  valor: string;
  /**
   * Competência de cobrança (038). Ausente = banco sem a 038: o registro é o de antes. Presente, é
   * obrigatória e vem da escolha da tela (uma janela da frequência do cliente); o banco revalida.
   */
  competencia?: { inicio: string; fim: string };
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const dataValida = (d: string) => DATA_ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Só dígitos com ponto ou vírgula decimal; "1.234,56" não é aceito de propósito. */
export function lerValor(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Mensagens para o usuário; lista vazia = pode enviar. O banco revalida tudo. */
export function validarAdicional(f: FormularioDeAdicional): string[] {
  const erros: string[] = [];
  if (f.clienteId.trim() === "") erros.push("Selecione o cliente.");
  if (!dataValida(f.inicio) || !dataValida(f.fim)) {
    erros.push("Informe o período do adicional.");
  } else if (f.fim < f.inicio) {
    erros.push("O fim do período deve ser igual ou posterior ao início.");
  }
  const motivo = f.motivo.trim();
  if (motivo === "") erros.push("O motivo do adicional é obrigatório.");
  if (motivo.length > 500) erros.push("O motivo deve ter no máximo 500 caracteres.");
  if (f.referencia.trim().length > 200)
    erros.push("A referência deve ter no máximo 200 caracteres.");
  if (f.competencia !== undefined) {
    const c = f.competencia;
    if (!dataValida(c.inicio) || !dataValida(c.fim) || c.fim < c.inicio) {
      erros.push("Escolha a competência de cobrança.");
    } else if (c.inicio.slice(0, 7) !== c.fim.slice(0, 7)) {
      erros.push("A competência de cobrança fica dentro de um único mês.");
    }
  }
  const valor = lerValor(f.valor);
  if (valor === null || valor <= 0) {
    erros.push("Informe um valor maior que zero.");
  } else {
    const t = f.valor.trim().replace(",", ".");
    const i = t.indexOf(".");
    if (i >= 0 && t.length - i - 1 > 2) erros.push("O valor aceita no máximo duas casas decimais.");
  }
  return erros;
}

/** Parâmetros nomeados de `registrar_adicional`. Lança se o formulário for inválido. */
export function montarRegistroDeAdicional(
  f: FormularioDeAdicional,
): Record<string, string | number | null> {
  const erros = validarAdicional(f);
  if (erros.length > 0) throw new Error(erros[0]);
  return {
    p_client_id: f.clienteId,
    p_period_start: f.inicio,
    p_period_end: f.fim,
    p_description: f.motivo.trim(),
    p_amount: lerValor(f.valor) as number,
    p_reference: f.referencia.trim() === "" ? null : f.referencia.trim(),
    p_operation_id: f.operacaoId === "" ? null : f.operacaoId,
    // Só com a 038: num banco sem ela os parâmetros não existem.
    ...(f.competencia !== undefined
      ? { p_billing_period_start: f.competencia.inicio, p_billing_period_end: f.competencia.fim }
      : {}),
  };
}

export type SituacaoDoAdicional = "a-faturar" | "faturado" | "cancelado";

export function situacaoDoAdicional(a: Adicional): SituacaoDoAdicional {
  if (a.invoice_id !== null) return "faturado";
  if (a.canceled_at !== null) return "cancelado";
  return "a-faturar";
}

export const ROTULO_DA_SITUACAO_DO_ADICIONAL: Readonly<Record<SituacaoDoAdicional, string>> = {
  "a-faturar": "A faturar",
  faturado: "Faturado",
  cancelado: "Cancelado",
};

/** O adicional tem competência de cobrança (038)? */
export function temCompetencia(a: Adicional): boolean {
  return (
    typeof a.billing_period_start === "string" &&
    a.billing_period_start !== "" &&
    typeof a.billing_period_end === "string" &&
    a.billing_period_end !== ""
  );
}

/**
 * A janela que decide a cobrança: a competência (038) ou, sem ela, a execução (regra antiga). É o
 * mesmo `coalesce(billing_period_*, period_*)` de `resumo_financeiro_periodo`.
 */
export function janelaDeCobrancaDoAdicional(a: Adicional): { inicio: string; fim: string } {
  return temCompetencia(a)
    ? { inicio: a.billing_period_start as string, fim: a.billing_period_end as string }
    : { inicio: a.period_start, fim: a.period_end };
}

/**
 * O mesmo critério de `gerar_fatura`: do cliente, não cancelado, não faturado e com a janela de
 * cobrança INTEIRA dentro do período da fatura. Sem competência, a janela é a execução: adicional
 * que cruza o fim do período (ex.: 10 a 20, fatura de 01 a 15) não entra nesta fatura.
 */
export function adicionalElegivel(
  a: Adicional,
  clienteId: string,
  inicio: string,
  fim: string,
): boolean {
  const janela = janelaDeCobrancaDoAdicional(a);
  return (
    a.client_id === clienteId &&
    situacaoDoAdicional(a) === "a-faturar" &&
    janela.inicio >= inicio &&
    janela.fim <= fim
  );
}

/** Adicional a faturar cuja janela de cobrança toca o período mas não cabe nele: a tela avisa. */
export function adicionalForaDoPeriodo(
  a: Adicional,
  clienteId: string,
  inicio: string,
  fim: string,
): boolean {
  const janela = janelaDeCobrancaDoAdicional(a);
  return (
    a.client_id === clienteId &&
    situacaoDoAdicional(a) === "a-faturar" &&
    janela.inicio <= fim &&
    janela.fim >= inicio &&
    !(janela.inicio >= inicio && janela.fim <= fim)
  );
}

/** Soma em centavos inteiros, para não acumular erro de ponto flutuante. */
export function somarAdicionais(lista: readonly Adicional[]): number {
  const centavos = lista.reduce((acc, a) => acc + Math.round(Number(a.amount) * 100), 0);
  return centavos / 100;
}
