/**
 * Leitura do que o Fechamento pede ao BANCO além dos lançamentos (migration 030).
 *
 * Quatro fontes oficiais, todas por funções e tabelas que o banco já protege com `admin` e o piso de MFA da conta:
 *
 *   resumo_financeiro_periodo               receita, adicionais, ajustes, a faturar e faturado
 *   ajustes_de_arredondamento_acumulado     o ajuste da hora extra acumulada, por colaborador
 *   saldo_de_horas_do_periodo               compensação entre dias — INFORMATIVO
 *   billing_additionals / invoice_items     os adicionais e os itens de arredondamento já faturados
 *
 * Nada aqui calcula regra financeira. Cada número é convertido para centavos ou minutos por
 * análise estrita do texto, sem passar por ponto flutuante como autoridade, e uma resposta fora do
 * formato levanta erro: o Fechamento nunca completa um total com um valor inventado.
 *
 * As funções `ler*` são puras (a suíte as exercita sem banco). `buscarDadosDoBanco` é a versão
 * real, com o cliente Supabase da SESSÃO do admin — a RLS segue sendo a fronteira.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { centavosDeNumeric } from "./centavos";
import { ErroDeDadoDoFechamento } from "./erros";
import { ErroDeLeituraDoFechamento, type FiltroDoFechamento } from "./leitura";
import { ehFrequenciaDeFechamento, type FrequenciaDeFechamento } from "./periodo";
import type {
  AdicionalDoFechamento,
  AjusteAcumulado,
  AjusteFaturado,
  DadosDoBanco,
  ResumoDoBanco,
  SaldoDeHoras,
} from "./tipos";

/** Teto de linhas por consulta auxiliar. Acima disso a leitura falha em vez de truncar. */
export const TETO_DE_LINHAS_AUXILIARES = 1000;

function registro(valor: unknown, campo: string): Record<string, unknown> {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErroDeDadoDoFechamento(`${campo}: linha ausente ou em formato inesperado.`);
  }
  return valor as Record<string, unknown>;
}

/**
 * `numeric` devolvido por uma RPC chega como número JSON (ou texto, nas consultas com `::text`).
 * A representação mais curta do número (`503.13`, `-3.13`, `100`) é analisada como texto, com o
 * mesmo rigor de duas casas das demais leituras.
 */
export function centavosDeValor(valor: unknown, campo: string): number {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new ErroDeDadoDoFechamento(`${campo}: número inválido.`);
    }
    return centavosDeNumeric(String(valor), campo);
  }
  return centavosDeNumeric(valor, campo);
}

function inteiro(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor)) {
    throw new ErroDeDadoDoFechamento(`${campo}: esperado um inteiro.`);
  }
  return valor;
}

function inteiroNaoNegativo(valor: unknown, campo: string): number {
  const n = inteiro(valor, campo);
  if (n < 0) throw new ErroDeDadoDoFechamento(`${campo}: não pode ser negativo.`);
  return n;
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor === "") {
    throw new ErroDeDadoDoFechamento(`${campo}: texto obrigatório ausente.`);
  }
  return valor;
}

function textoOuNulo(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ErroDeDadoDoFechamento(`${campo}: esperado texto ou null.`);
  }
  return valor;
}

/** A linha única de `resumo_financeiro_periodo`. */
export function lerResumoDoBanco(linhas: unknown): ResumoDoBanco {
  if (!Array.isArray(linhas) || linhas.length !== 1) {
    throw new ErroDeDadoDoFechamento("resumo financeiro: esperada exatamente uma linha.");
  }
  const r = registro(linhas[0], "resumo financeiro");
  if (typeof r["ajuste_aplicavel"] !== "boolean") {
    throw new ErroDeDadoDoFechamento("resumo financeiro: ajuste_aplicavel ausente.");
  }
  return {
    receitaApontamentosCentavos: centavosDeValor(r["receita_apontamentos"], "resumo: apontamentos"),
    adicionaisCentavos: centavosDeValor(r["adicionais"], "resumo: adicionais"),
    ajusteFaturadoCentavos: centavosDeValor(r["ajuste_faturado"], "resumo: ajuste faturado"),
    ajustePrevistoCentavos: centavosDeValor(r["ajuste_previsto"], "resumo: ajuste previsto"),
    receitaTotalCentavos: centavosDeValor(r["receita_total"], "resumo: receita"),
    aFaturarCentavos: centavosDeValor(r["a_faturar"], "resumo: a faturar"),
    faturadoCentavos: centavosDeValor(r["faturado"], "resumo: faturado"),
    ajusteAplicavel: r["ajuste_aplicavel"],
  };
}

export function lerAjustesAcumulados(linhas: unknown): AjusteAcumulado[] {
  if (!Array.isArray(linhas)) {
    throw new ErroDeDadoDoFechamento("ajustes acumulados: esperada uma lista.");
  }
  return linhas.map((linha, i) => {
    const r = registro(linha, `ajuste acumulado ${i}`);
    return {
      employeeId: texto(r["employee_id"], `ajuste ${i}: colaborador`),
      colaborador: texto(r["colaborador"], `ajuste ${i}: nome`),
      valorHoraCentavos: centavosDeValor(r["valor_hora"], `ajuste ${i}: valor-hora`),
      minutosBrutos: inteiroNaoNegativo(r["minutos_brutos"], `ajuste ${i}: minutos brutos`),
      minutosArredondados: inteiroNaoNegativo(
        r["minutos_arredondados"],
        `ajuste ${i}: minutos arredondados`,
      ),
      valorBrutoCentavos: centavosDeValor(r["valor_bruto"], `ajuste ${i}: valor bruto`),
      valorArredondadoCentavos: centavosDeValor(
        r["valor_arredondado"],
        `ajuste ${i}: valor arredondado`,
      ),
      ajusteCentavos: centavosDeValor(r["ajuste"], `ajuste ${i}: ajuste`),
    };
  });
}

export function lerSaldoDeHoras(linhas: unknown): SaldoDeHoras[] {
  if (!Array.isArray(linhas)) {
    throw new ErroDeDadoDoFechamento("saldo de horas: esperada uma lista.");
  }
  return linhas.map((linha, i) => {
    const r = registro(linha, `saldo de horas ${i}`);
    return {
      employeeId: texto(r["employee_id"], `saldo ${i}: colaborador`),
      colaborador: texto(r["colaborador"], `saldo ${i}: nome`),
      apontamentos: inteiroNaoNegativo(r["apontamentos"], `saldo ${i}: apontamentos`),
      minutosExcedentes: inteiroNaoNegativo(r["minutos_excedentes"], `saldo ${i}: excedentes`),
      minutosFaltantes: inteiroNaoNegativo(r["minutos_faltantes"], `saldo ${i}: faltantes`),
      saldoMinutos: inteiro(r["saldo"], `saldo ${i}: saldo`),
    };
  });
}

export function lerAdicionais(linhas: unknown): AdicionalDoFechamento[] {
  if (!Array.isArray(linhas)) {
    throw new ErroDeDadoDoFechamento("adicionais: esperada uma lista.");
  }
  return linhas.map((linha, i) => {
    const r = registro(linha, `adicional ${i}`);
    return {
      id: texto(r["id"], `adicional ${i}: id`),
      descricao: texto(r["description"], `adicional ${i}: descrição`),
      referencia: textoOuNulo(r["reference"], `adicional ${i}: referência`),
      operacaoId: textoOuNulo(r["operation_id"], `adicional ${i}: operação`),
      inicio: texto(r["period_start"], `adicional ${i}: início`),
      fim: texto(r["period_end"], `adicional ${i}: fim`),
      valorCentavos: centavosDeValor(r["valor"], `adicional ${i}: valor`),
      faturaId: textoOuNulo(r["invoice_id"], `adicional ${i}: fatura`),
      // Só com a 038 (a consulta pede as colunas): sem elas a forma é a de antes.
      ...("billing_period_start" in r
        ? {
            competenciaInicio: textoOuNulo(
              r["billing_period_start"],
              `adicional ${i}: competência`,
            ),
            competenciaFim: textoOuNulo(r["billing_period_end"], `adicional ${i}: competência`),
          }
        : {}),
    };
  });
}

/** A linha única de `competencia_de_cobranca` (migration 038): a frequência do cliente no mês. */
export function lerFrequencia(linhas: unknown): FrequenciaDeFechamento {
  if (!Array.isArray(linhas) || linhas.length !== 1) {
    throw new ErroDeDadoDoFechamento("frequência de fechamento: esperada exatamente uma linha.");
  }
  const frequencia = registro(linhas[0], "frequência de fechamento")["frequencia"];
  if (!ehFrequenciaDeFechamento(frequencia)) {
    throw new ErroDeDadoDoFechamento("frequência de fechamento: valor desconhecido.");
  }
  return frequencia;
}

export function lerAjustesFaturados(linhas: unknown): AjusteFaturado[] {
  if (!Array.isArray(linhas)) {
    throw new ErroDeDadoDoFechamento("ajustes faturados: esperada uma lista.");
  }
  return linhas.map((linha, i) => {
    const r = registro(linha, `ajuste faturado ${i}`);
    return {
      faturaId: texto(r["invoice_id"], `ajuste faturado ${i}: fatura`),
      descricao: texto(r["description"], `ajuste faturado ${i}: descrição`),
      valorCentavos: centavosDeValor(r["valor"], `ajuste faturado ${i}: valor`),
    };
  });
}

/** O que `buscarDadosDoBanco` precisa de uma sessão: só as leituras. */
export interface FonteDoBanco {
  resumo(filtro: FiltroDoFechamento): Promise<unknown>;
  ajustesPrevistos(filtro: FiltroDoFechamento): Promise<unknown>;
  saldoDeHoras(filtro: FiltroDoFechamento): Promise<unknown>;
  adicionais(filtro: FiltroDoFechamento): Promise<unknown>;
  ajustesFaturados(filtro: FiltroDoFechamento): Promise<unknown>;
  /** Só num banco com a migration 038 (`competencia_de_cobranca`). */
  frequencia?(filtro: FiltroDoFechamento): Promise<unknown>;
}

/**
 * As leituras reais, pelo cliente Supabase da sessão. Qualquer erro do banco sobe como erro.
 * `periodoContratual` = o banco anunciou a 038: os adicionais entram pela competência de cobrança
 * (o mesmo recorte do resumo) e a frequência do cliente é lida. Sem ela, nada disso é consultado:
 * as colunas e a RPC não existem.
 */
export function criarFonteDoBancoSupabase(
  supabase: SupabaseClient<Database>,
  periodoContratual = false,
): FonteDoBanco {
  const falha = (o: string, mensagem: string) =>
    new ErroDeLeituraDoFechamento("consulta", `Falha ao ler ${o}: ${mensagem}`);

  const fonte: FonteDoBanco = {
    async resumo({ clienteId, inicio, fim }) {
      const { data, error } = await supabase.rpc("resumo_financeiro_periodo", {
        p_inicio: inicio,
        p_fim: fim,
        p_client_id: clienteId,
      });
      if (error) throw falha("o resumo financeiro", error.message);
      return data;
    },

    async ajustesPrevistos({ clienteId, inicio, fim }) {
      const { data, error } = await supabase.rpc("ajustes_de_arredondamento_acumulado", {
        p_client_id: clienteId,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw falha("o arredondamento acumulado", error.message);
      return data;
    },

    async saldoDeHoras({ clienteId, inicio, fim }) {
      const { data, error } = await supabase.rpc("saldo_de_horas_do_periodo", {
        p_client_id: clienteId,
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw falha("o saldo de horas", error.message);
      return data;
    },

    async adicionais({ clienteId, inicio, fim }) {
      // Mesmo recorte de `resumo_financeiro_periodo`: não cancelados, janela de cobrança inteira
      // dentro — a competência (038) ou, sem ela, a execução.
      const colunas =
        "id, description, reference, operation_id, period_start, period_end, invoice_id, valor:amount::text";
      const base = supabase
        .from("billing_additionals")
        .select(
          periodoContratual ? `${colunas}, billing_period_start, billing_period_end` : colunas,
          {
            count: "exact",
          },
        )
        .eq("client_id", clienteId)
        .is("canceled_at", null);
      const recorte = periodoContratual
        ? base.or(
            `and(billing_period_start.not.is.null,billing_period_start.gte.${inicio},billing_period_end.lte.${fim}),` +
              `and(billing_period_start.is.null,period_start.gte.${inicio},period_end.lte.${fim})`,
          )
        : base.gte("period_start", inicio).lte("period_end", fim);
      const { data, error, count } = await recorte
        .order("period_start", { ascending: true })
        .order("id", { ascending: true })
        .limit(TETO_DE_LINHAS_AUXILIARES);
      if (error) throw falha("os adicionais", error.message);
      if (count === null || (data ?? []).length !== count) {
        throw falha("os adicionais", "a leitura não pôde ser provada completa.");
      }
      return data;
    },

    async ajustesFaturados({ clienteId, inicio, fim }) {
      const { data, error, count } = await supabase
        .from("invoice_items")
        .select(
          "invoice_id, description, valor:amount::text, invoices!inner(client_id, period_start, period_end)",
          {
            count: "exact",
          },
        )
        .eq("kind", "arredondamento")
        .eq("invoices.client_id", clienteId)
        .gte("invoices.period_start", inicio)
        .lte("invoices.period_end", fim)
        .order("invoice_id", { ascending: true })
        .order("description", { ascending: true })
        .limit(TETO_DE_LINHAS_AUXILIARES);
      if (error) throw falha("os ajustes faturados", error.message);
      if (count === null || (data ?? []).length !== count) {
        throw falha("os ajustes faturados", "a leitura não pôde ser provada completa.");
      }
      return data;
    },
  };

  if (periodoContratual) {
    fonte.frequencia = async ({ clienteId, inicio }) => {
      const { data, error } = await supabase.rpc("competencia_de_cobranca", {
        p_client_id: clienteId,
        p_data: inicio,
      });
      if (error) throw falha("a frequência de fechamento", error.message);
      return data;
    };
  }
  return fonte;
}

/** Lê e valida as cinco fontes. Qualquer uma fora do formato derruba o carregamento. */
export async function buscarDadosDoBanco(
  fonte: FonteDoBanco,
  filtro: FiltroDoFechamento,
): Promise<DadosDoBanco> {
  const [resumo, ajustes, saldo, adicionais, faturados, frequencia] = await Promise.all([
    fonte.resumo(filtro),
    fonte.ajustesPrevistos(filtro),
    fonte.saldoDeHoras(filtro),
    fonte.adicionais(filtro),
    fonte.ajustesFaturados(filtro),
    fonte.frequencia ? fonte.frequencia(filtro) : Promise.resolve(undefined),
  ]);

  return {
    resumo: lerResumoDoBanco(resumo),
    ajustesPrevistos: lerAjustesAcumulados(ajustes),
    saldoDeHoras: lerSaldoDeHoras(saldo),
    adicionais: lerAdicionais(adicionais),
    ajustesFaturados: lerAjustesFaturados(faturados),
    ...(fonte.frequencia ? { frequencia: lerFrequencia(frequencia) } : {}),
  };
}
