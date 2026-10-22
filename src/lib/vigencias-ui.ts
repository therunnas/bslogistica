/**
 * Regras puras das telas de condições financeiras versionadas (C05-B4.6, U3 a U7).
 *
 * Nada aqui fala com o banco nem importa módulo em tempo de execução: a suíte
 * `test:interfaces-vigencia` executa este arquivo de verdade. O banco continua sendo a
 * barreira (RLS, triggers e RPCs com admin AAL2); este módulo só decide O QUE A TELA OFERECE
 * e COMO ELA EXPLICA, sempre do lado seguro.
 *
 * O ponto central é o ESTADO DO MOTOR. Ele tem quatro valores, e só `desligado` libera a
 * edição direta das taxas:
 *
 *   carregando    ainda não respondeu: nada financeiro é oferecido;
 *   desligado     motor antigo ativo: a edição tradicional das taxas segue valendo;
 *   ligado        o preço vem das versões: taxa só muda por RPC (nova vigência);
 *   desconhecido  a consulta falhou, a resposta é inválida ou os gatilhos estão
 *                 inconsistentes: tratado como "não sei" e NUNCA como desligado.
 */

import type { CondicaoDoDia } from "./apontamentos-financeiro";
import type {
  ParametrosRegistrarCondicaoContrato,
  ParametrosRegistrarCustoColaborador,
  ParametrosRegistrarValorAcordadoOperacao,
} from "./vigencias";

export type TipoDeVigencia = "contrato" | "colaborador" | "operacao";

export type EstadoDoMotorUI =
  | { tag: "carregando" }
  | { tag: "desligado" }
  | { tag: "ligado"; ativadaEm: string | null }
  | { tag: "desconhecido"; motivo: string };

/** Quem chama `estado_motor_vigencia` passa a resposta e o erro tal como vieram. */
export function interpretarEstadoDoMotor(data: unknown, erro: unknown): EstadoDoMotorUI {
  if (erro !== null && erro !== undefined) {
    const codigo =
      typeof erro === "object" && erro !== null && "code" in erro
        ? String((erro as { code: unknown }).code)
        : "";
    if (codigo === "42501" || codigo === "28000") {
      return { tag: "desconhecido", motivo: "Sem permissão para consultar o estado do motor." };
    }
    return { tag: "desconhecido", motivo: "Não foi possível consultar o estado do motor." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { tag: "desconhecido", motivo: "Resposta inválida do estado do motor." };
  }
  const r = data as { ativo?: unknown; consistente?: unknown; ativada_em?: unknown };
  if (typeof r.ativo !== "boolean") {
    return { tag: "desconhecido", motivo: "Resposta inválida do estado do motor." };
  }
  if (r.consistente !== true) {
    return {
      tag: "desconhecido",
      motivo:
        "Os gatilhos do motor não correspondem à configuração. Chame o administrador do banco.",
    };
  }
  return r.ativo
    ? { tag: "ligado", ativadaEm: typeof r.ativada_em === "string" ? r.ativada_em : null }
    : { tag: "desligado" };
}

export type ModoDeEdicaoDeTaxa = "direta" | "por-vigencia" | "bloqueada";

/**
 * Como a tela deixa mexer em taxa/custo/valor acordado.
 * `direta` só com o motor comprovadamente desligado; `por-vigencia` com ele ligado; qualquer
 * outro estado bloqueia (e a tela não envia a coluna financeira no salvamento).
 */
export function modoDeEdicaoDeTaxa(estado: EstadoDoMotorUI): ModoDeEdicaoDeTaxa {
  if (estado.tag === "desligado") return "direta";
  if (estado.tag === "ligado") return "por-vigencia";
  return "bloqueada";
}

/** O cadastro de uma entidade nova só avança com o estado conhecido. */
export function podeCadastrarComTaxa(estado: EstadoDoMotorUI): boolean {
  return estado.tag === "desligado" || estado.tag === "ligado";
}

/** Registrar vigência (preparar ou aplicar) exige estado conhecido. */
export function podeRegistrarVigencia(estado: EstadoDoMotorUI): boolean {
  return estado.tag === "desligado" || estado.tag === "ligado";
}

export function avisoDoMotor(estado: EstadoDoMotorUI): {
  titulo: string;
  texto: string;
  nivel: "info" | "alerta";
} {
  switch (estado.tag) {
    case "carregando":
      return {
        titulo: "Verificando o motor financeiro…",
        texto: "As condições financeiras ficam bloqueadas até a resposta.",
        nivel: "info",
      };
    case "desligado":
      return {
        titulo: "Motor por vigência desligado",
        texto:
          "Os cálculos usam as taxas atuais do cadastro, como sempre. As vigências cadastradas aqui ficam preparadas e só passam a valer quando o motor for ligado.",
        nivel: "info",
      };
    case "ligado":
      return {
        titulo: "Motor por vigência ligado",
        texto:
          "O preço de cada apontamento vem da vigência da data trabalhada. Taxas só mudam registrando uma nova vigência, com motivo.",
        nivel: "info",
      };
    default:
      return {
        titulo: "Estado do motor financeiro desconhecido",
        texto: `${estado.motivo} Por segurança, as condições financeiras ficam somente para leitura até a verificação funcionar.`,
        nivel: "alerta",
      };
  }
}

// ---------------------------------------------------------------------------
// Datas e versões
// ---------------------------------------------------------------------------

/** Data de hoje em America/Sao_Paulo, `YYYY-MM-DD` (a mesma regra do banco). */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export interface VersaoBase {
  id: string;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  origin: string;
  reason: string;
  created_at: string;
  retired_at: string | null;
}

/** A versão ATIVA que cobre a data: o intervalo é [início, fim). */
export function versaoNaData<T extends VersaoBase>(versoes: readonly T[], data: string): T | null {
  const achadas = versoes.filter(
    (v) => v.active && v.valid_from <= data && (v.valid_to === null || data < v.valid_to),
  );
  return achadas.length === 1 ? (achadas[0] ?? null) : null;
}

/** Duas versões ativas cobrindo a mesma data nunca deveria ocorrer; a tela não escolhe uma. */
export function versoesAmbiguasNaData<T extends VersaoBase>(
  versoes: readonly T[],
  data: string,
): boolean {
  return (
    versoes.filter(
      (v) => v.active && v.valid_from <= data && (v.valid_to === null || data < v.valid_to),
    ).length > 1
  );
}

export type SituacaoDaVersao = "aposentada" | "futura" | "vigente" | "encerrada";

export function situacaoDaVersao(v: VersaoBase, hoje: string): SituacaoDaVersao {
  if (!v.active) return "aposentada";
  if (v.valid_from > hoje) return "futura";
  if (v.valid_to !== null && v.valid_to <= hoje) return "encerrada";
  return "vigente";
}

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDaVersao, string>> = {
  aposentada: "Aposentada",
  futura: "Futura",
  vigente: "Vigente",
  encerrada: "Encerrada",
};

export const ROTULO_DA_ORIGEM: Readonly<Record<string, string>> = {
  informada: "Informada",
  migrada_por_prova: "Migrada com prova",
  correcao: "Correção",
};

export type ClasseDoInicio = "passada" | "hoje" | "futura";

/** Distingue uma alteração IMEDIATA (início hoje ou antes) de uma vigência FUTURA preparada. */
export function classificarInicio(inicio: string, hoje: string): ClasseDoInicio {
  if (inicio > hoje) return "futura";
  return inicio === hoje ? "hoje" : "passada";
}

// ---------------------------------------------------------------------------
// Formulário de nova vigência
// ---------------------------------------------------------------------------

export interface CampoDeVigencia {
  chave: string;
  param: string;
  rotulo: string;
  tipo: "dinheiro" | "horas" | "fator" | "minutos";
}

export const CAMPOS_DA_VIGENCIA: Readonly<Record<TipoDeVigencia, readonly CampoDeVigencia[]>> = {
  contrato: [
    {
      chave: "daily_rate",
      param: "p_daily_rate",
      rotulo: "Valor da diária (R$)",
      tipo: "dinheiro",
    },
    { chave: "shift_hours", param: "p_shift_hours", rotulo: "Jornada (horas)", tipo: "horas" },
    { chave: "ot_factor", param: "p_ot_factor", rotulo: "Fator de hora extra", tipo: "fator" },
    {
      chave: "ot_tolerance_min",
      param: "p_ot_tolerance_min",
      rotulo: "Tolerância (min)",
      tipo: "minutos",
    },
  ],
  colaborador: [
    { chave: "daily_cost", param: "p_daily_cost", rotulo: "Custo diário (R$)", tipo: "dinheiro" },
  ],
  operacao: [
    {
      chave: "agreed_amount",
      param: "p_agreed_amount",
      rotulo: "Valor acordado (R$)",
      tipo: "dinheiro",
    },
  ],
};

export const RPC_DE_REGISTRO: Readonly<Record<TipoDeVigencia, string>> = {
  contrato: "registrar_condicao_contrato",
  colaborador: "registrar_custo_colaborador",
  operacao: "registrar_valor_acordado_operacao",
};

export const PARAM_DO_ID: Readonly<Record<TipoDeVigencia, string>> = {
  contrato: "p_contract_id",
  colaborador: "p_employee_id",
  operacao: "p_operation_id",
};

export interface FormularioDeVigencia {
  inicio: string;
  motivo: string;
  /** Valores digitados, por `chave` (texto, aceita vírgula). */
  valores: Readonly<Record<string, string>>;
  encerrarAnterior: boolean;
  /** Fim da vigência (exclusive), opcional: vazio = em aberto. */
  fim?: string;
}

/** "1.234,56" não é aceito de propósito: só dígitos, ponto ou vírgula decimal. */
export function lerNumero(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function casasDecimais(texto: string): number {
  const t = texto.trim().replace(",", ".");
  const i = t.indexOf(".");
  return i < 0 ? 0 : t.length - i - 1;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Mensagens para o usuário; lista vazia = pode enviar. O banco revalida tudo. */
export function validarNovaVigencia(tipo: TipoDeVigencia, f: FormularioDeVigencia): string[] {
  const erros: string[] = [];
  if (!DATA_ISO.test(f.inicio) || Number.isNaN(Date.parse(`${f.inicio}T00:00:00Z`))) {
    erros.push("Informe a data de início da vigência.");
  }
  if (f.motivo.trim() === "") {
    erros.push("O motivo é obrigatório.");
  }
  const fim = (f.fim ?? "").trim();
  if (fim !== "") {
    if (!DATA_ISO.test(fim) || Number.isNaN(Date.parse(`${fim}T00:00:00Z`))) {
      erros.push("Fim da vigência inválido.");
    } else if (DATA_ISO.test(f.inicio) && fim <= f.inicio) {
      erros.push("O fim da vigência deve ser posterior ao início.");
    }
  }
  for (const campo of CAMPOS_DA_VIGENCIA[tipo]) {
    const texto = f.valores[campo.chave] ?? "";
    const n = lerNumero(texto);
    if (n === null) {
      erros.push(`${campo.rotulo}: informe um número válido (sem negativo).`);
      continue;
    }
    if (campo.tipo === "minutos") {
      if (!Number.isInteger(n)) erros.push(`${campo.rotulo}: use minutos inteiros.`);
    } else if (casasDecimais(texto) > 2) {
      erros.push(`${campo.rotulo}: no máximo duas casas decimais.`);
    }
    if (campo.tipo === "horas" && n <= 0) {
      erros.push(`${campo.rotulo}: a jornada deve ser maior que zero.`);
    }
  }
  return erros;
}

export type ParametrosDeRegistro =
  | ParametrosRegistrarCondicaoContrato
  | ParametrosRegistrarCustoColaborador
  | ParametrosRegistrarValorAcordadoOperacao;

/**
 * Nome da RPC e parâmetros nomeados (PostgREST). Lança se o formulário for inválido: a tela
 * valida antes, e esta é a segunda barreira contra um envio incompleto.
 */
export function montarRegistro(
  tipo: TipoDeVigencia,
  entidadeId: string,
  f: FormularioDeVigencia,
): { rpc: string; params: Record<string, string | number | boolean | null> } {
  const erros = validarNovaVigencia(tipo, f);
  if (erros.length > 0 || entidadeId === "") {
    throw new Error(erros[0] ?? "Entidade não informada.");
  }
  const params: Record<string, string | number | boolean | null> = {
    [PARAM_DO_ID[tipo]]: entidadeId,
    p_valid_from: f.inicio,
    p_reason: f.motivo.trim(),
    p_valid_to: (f.fim ?? "").trim() === "" ? null : (f.fim as string).trim(),
    p_encerrar_anterior: f.encerrarAnterior,
  };
  for (const campo of CAMPOS_DA_VIGENCIA[tipo]) {
    params[campo.param] = lerNumero(f.valores[campo.chave] ?? "") as number;
  }
  return { rpc: RPC_DE_REGISTRO[tipo], params };
}

// ---------------------------------------------------------------------------
// Turnos (U7)
// ---------------------------------------------------------------------------

export interface TurnoBase {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
  operation_id: string;
}

/** O turno tem algum apontamento (folha com ao menos uma linha)? */
export function turnoTemApontamentos(
  turnoId: string,
  folhas: readonly { id: string; shift_id: string | null }[],
  linhas: readonly { timesheet_id: string }[],
): boolean {
  const folhasDoTurno = new Set(folhas.filter((f) => f.shift_id === turnoId).map((f) => f.id));
  return linhas.some((l) => folhasDoTurno.has(l.timesheet_id));
}

/**
 * Quando a jornada do turno é intocável: motor ligado ou estado desconhecido (o congelamento
 * é habilitado junto com o motor) E o turno já tem apontamento. Com o motor comprovadamente
 * desligado o formulário tradicional segue como era.
 */
export function jornadaDoTurnoProtegida(estado: EstadoDoMotorUI, turnoUsado: boolean): boolean {
  return turnoUsado && estado.tag !== "desligado";
}

/** Valores iniciais do formulário de "novo turno a partir deste". Não herda id nem status. */
export function novoTurnoAPartir(t: TurnoBase) {
  return {
    id: "",
    operation_id: t.operation_id,
    name: `${t.name} (novo)`,
    start_time: t.start_time.slice(0, 5),
    end_time: t.end_time.slice(0, 5),
    break_minutes: t.break_minutes,
    crosses_midnight: t.crosses_midnight,
    status: "active" as const,
  };
}

// ---------------------------------------------------------------------------
// Condição financeira aplicável à data trabalhada (U3)
// ---------------------------------------------------------------------------

export interface TermoDeContrato extends VersaoBase {
  daily_rate: number | string;
  shift_hours: number | string;
  ot_factor: number | string;
  ot_tolerance_min: number | string;
}

export interface TermoDeOperacao extends VersaoBase {
  agreed_amount: number | string;
}

export interface TermoDeCusto extends VersaoBase {
  daily_cost: number | string;
}

const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const periodoDe = (v: VersaoBase) =>
  `vigência ${dataBR(v.valid_from)} → ${v.valid_to ? dataBR(v.valid_to) : "em aberto"}`;

/**
 * Espelha `motor_fonte_do_dia` + `motor_custo_do_dia` (migration 025), SÓ para a prévia da
 * tela: contrato e valor acordado cobrindo a mesma data é ambíguo; nenhum dos dois é falta de
 * vigência; a taxa atual do cadastro NUNCA entra como substituta. O banco continua decidindo.
 */
export function resolverCondicaoDoDia(p: {
  data: string;
  contratoId: string | null;
  termosContrato: readonly TermoDeContrato[];
  termosOperacao: readonly TermoDeOperacao[];
  termosCusto: readonly TermoDeCusto[];
}): CondicaoDoDia {
  const doContrato = p.contratoId ? versaoNaData(p.termosContrato, p.data) : null;
  const daOperacao = versaoNaData(p.termosOperacao, p.data);
  const quando = dataBR(p.data);

  if (
    versoesAmbiguasNaData(p.termosContrato, p.data) ||
    versoesAmbiguasNaData(p.termosOperacao, p.data) ||
    (doContrato && daOperacao)
  ) {
    return {
      ok: false,
      motivo: `Fonte do preço ambígua em ${quando}: há vigência de contrato e de valor acordado da operação para a mesma data.`,
    };
  }

  let regras: {
    daily_rate: number;
    shift_hours: number;
    ot_factor: number;
    ot_tolerance_min: number;
  };
  let origem: string;
  if (doContrato) {
    regras = {
      daily_rate: Number(doContrato.daily_rate),
      shift_hours: Number(doContrato.shift_hours),
      ot_factor: Number(doContrato.ot_factor),
      ot_tolerance_min: Number(doContrato.ot_tolerance_min),
    };
    origem = `Contrato · ${periodoDe(doContrato)}`;
  } else if (daOperacao) {
    regras = {
      daily_rate: Number(daOperacao.agreed_amount),
      shift_hours: 8,
      ot_factor: 1,
      ot_tolerance_min: 10,
    };
    origem = `Valor acordado da operação · ${periodoDe(daOperacao)}`;
  } else {
    return {
      ok: false,
      motivo: `Sem condição financeira vigente em ${quando} para ${p.contratoId ? "o contrato da operação" : "a operação"}. Registre a vigência antes de apontar nesta data; a taxa atual do cadastro não é usada.`,
    };
  }

  const custo = versaoNaData(p.termosCusto, p.data);
  if (!custo || versoesAmbiguasNaData(p.termosCusto, p.data)) {
    return {
      ok: false,
      motivo: `Sem custo vigente em ${quando} para o colaborador. Registre a vigência de custo antes de apontar nesta data.`,
    };
  }
  return { ok: true, regras, custoDiario: Number(custo.daily_cost), origem };
}
