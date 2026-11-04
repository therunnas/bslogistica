/** Contratos de UI da 044. Nenhuma fórmula financeira ou carga automática de feriados. */
export const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
/** Prefixo oficial dos códigos municipais do IBGE por UF. */
const PREFIXO_IBGE: Readonly<Record<string, string>> = {
  AC: "12",
  AL: "27",
  AP: "16",
  AM: "13",
  BA: "29",
  CE: "23",
  DF: "53",
  ES: "32",
  GO: "52",
  MA: "21",
  MT: "51",
  MS: "50",
  MG: "31",
  PA: "15",
  PB: "25",
  PR: "41",
  PE: "26",
  PI: "22",
  RJ: "33",
  RN: "24",
  RS: "43",
  RO: "11",
  RR: "14",
  SC: "42",
  SP: "35",
  SE: "28",
  TO: "17",
};
function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}
function valorNaRota(valor: unknown, rota: readonly string[]): unknown {
  return rota.reduce<unknown>((atual, chave) => objeto(atual)?.[chave], valor);
}
export function codigoMunicipalDaUf(codigo: unknown, uf: unknown): boolean {
  return (
    typeof codigo === "string" &&
    typeof uf === "string" &&
    /^\d{7}$/.test(codigo) &&
    PREFIXO_IBGE[uf] === codigo.slice(0, 2)
  );
}
export type Ambito = "nacional" | "estadual" | "municipal" | "distrital";
export interface Municipio {
  codigo: string;
  nome: string;
  uf: string;
  fonteUrl: string;
}
export type CapacidadeCalendario = "disponivel" | "indisponivel" | "desconhecida";
export function capacidadeCalendario(dados: unknown, erro: unknown): CapacidadeCalendario {
  if (erro || !dados || typeof dados !== "object" || Array.isArray(dados)) return "desconhecida";
  const r = dados as Record<string, unknown>;
  if (typeof r["ativo"] !== "boolean" || r["consistente"] !== true) return "desconhecida";
  return r["calendario_territorial"] === true ? "disponivel" : "indisponivel";
}
/** Presença da 044 não ativa o regime: resolução OFF confirmada continua no calendário 030. */
export function regimeCalendario(
  dados: unknown,
  erro: unknown,
): "territorial" | "legado" | "desconhecido" {
  const capacidade = capacidadeCalendario(dados, erro);
  if (capacidade === "desconhecida") return "desconhecido";
  if (capacidade === "indisponivel") return "legado";
  const r = dados as { ativo: boolean; resolucao_tarifas?: unknown };
  if (typeof r.resolucao_tarifas !== "boolean") return "desconhecido";
  if (r.resolucao_tarifas && !r.ativo) return "desconhecido";
  return r.resolucao_tarifas ? "territorial" : "legado";
}
export function urlOficial(valor: string): boolean {
  try {
    const u = new URL(valor);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname.endsWith(".gov.br") ||
        u.hostname.endsWith(".jus.br") ||
        u.hostname.endsWith(".leg.br"))
    );
  } catch {
    return false;
  }
}
export function dataValida(data: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    Number.isFinite(Date.parse(`${data}T00:00:00Z`)) &&
    new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) === data
  );
}
export function interpretarMunicipios(dados: unknown, uf: string): Municipio[] {
  if (!UFS.includes(uf as (typeof UFS)[number]) || !Array.isArray(dados) || dados.length === 0)
    throw new Error("Resposta inválida do IBGE.");
  const vistos = new Set<string>();
  return dados.map((d: unknown) => {
    if (!d || typeof d !== "object") throw new Error("Município inválido no IBGE.");
    const m = d as Record<string, unknown>;
    const codigo = String(m["id"]);
    const ufsOficiais = [
      valorNaRota(m, ["microrregiao", "mesorregiao", "UF", "sigla"]),
      valorNaRota(m, ["regiao-imediata", "regiao-intermediaria", "UF", "sigla"]),
    ].filter((v) => v !== undefined && v !== null);
    if (
      !codigoMunicipalDaUf(codigo, uf) ||
      ufsOficiais.length === 0 ||
      ufsOficiais.some((sigla) => sigla !== uf) ||
      typeof m["nome"] !== "string" ||
      !m["nome"].trim() ||
      vistos.has(codigo)
    )
      throw new Error("Município inválido no IBGE.");
    vistos.add(codigo);
    return {
      codigo,
      nome: m["nome"],
      uf,
      fonteUrl: `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigo}`,
    };
  });
}
export interface FormularioTerritorial {
  data: string;
  nome: string;
  motivo: string;
  ambito: Ambito;
  uf: string;
  municipio: string;
  norma: string;
  fonte: string;
  confirmado: boolean;
  tipo: "feriado" | "ponto_facultativo";
  movel: boolean;
}
export function validarTerritorio(
  f: Pick<FormularioTerritorial, "ambito" | "uf" | "municipio" | "norma" | "fonte" | "motivo">,
): string[] {
  const erros: string[] = [];
  if (!["nacional", "estadual", "municipal", "distrital"].includes(f.ambito))
    erros.push("Selecione o âmbito.");
  if (f.ambito !== "nacional" && !UFS.includes(f.uf as (typeof UFS)[number]))
    erros.push("Selecione a UF.");
  if (f.ambito === "distrital" && (f.uf !== "DF" || f.municipio !== ""))
    erros.push("O âmbito distrital exige DF e nenhuma localidade municipal.");
  if ((f.ambito === "estadual" || f.ambito === "municipal") && f.uf === "DF")
    erros.push("No Distrito Federal, use o âmbito distrital.");
  if (f.ambito === "municipal" && !codigoMunicipalDaUf(f.municipio, f.uf))
    erros.push("Selecione um município do IBGE.");
  if (!f.norma.trim()) erros.push("Informe a norma ou ato oficial conferido.");
  if (!urlOficial(f.fonte)) erros.push("Informe uma URL HTTPS oficial (gov.br, leg.br ou jus.br).");
  if (!f.motivo.trim()) erros.push("O motivo é obrigatório.");
  return erros;
}
export function validarFeriadoTerritorial(f: FormularioTerritorial): string[] {
  const erros = validarTerritorio(f);
  if (!dataValida(f.data)) erros.push("Informe uma data válida.");
  if (!f.nome.trim() || f.nome.trim().length > 120)
    erros.push("Informe um nome com até 120 caracteres.");
  if (f.tipo === "ponto_facultativo" && f.confirmado)
    erros.push("Ponto facultativo não pode ser confirmado como feriado.");
  return erros;
}
export function dadosTerritoriais(
  f: Pick<FormularioTerritorial, "ambito" | "uf" | "municipio" | "norma" | "fonte" | "confirmado">,
) {
  return {
    territory_scope: f.ambito,
    state_code: f.ambito === "nacional" ? null : f.uf,
    municipality_code: f.ambito === "municipal" ? f.municipio : null,
    legal_act: f.norma.trim(),
    official_url: f.fonte.trim(),
    client_confirmed: f.confirmado,
  };
}
export interface CalendarioDaOperacao {
  status: "localidade_ausente" | "pendente" | "confirmado";
  municipality_code: string | null;
  state_code: string | null;
  location_term_id: string | null;
  holiday_ids: string[];
  coverage_ids: string[];
  day_kind: "util" | "sabado" | "domingo" | "feriado" | null;
}
export function lerCalendarioDaOperacao(dados: unknown): CalendarioDaOperacao {
  if (!dados || typeof dados !== "object" || Array.isArray(dados))
    throw new Error("Calendário inválido.");
  const r = dados as CalendarioDaOperacao;
  if (
    !["localidade_ausente", "pendente", "confirmado"].includes(r.status) ||
    !Array.isArray(r.holiday_ids) ||
    !Array.isArray(r.coverage_ids) ||
    !r.holiday_ids.every((v) => typeof v === "string") ||
    !r.coverage_ids.every((v) => typeof v === "string")
  )
    throw new Error("Calendário inválido.");
  if (
    r.status === "confirmado" &&
    (!codigoMunicipalDaUf(r.municipality_code, r.state_code) ||
      !r.location_term_id ||
      !UFS.includes(r.state_code as (typeof UFS)[number]) ||
      !["util", "sabado", "domingo", "feriado"].includes(r.day_kind ?? ""))
  )
    throw new Error("Calendário confirmado incompleto.");
  return r;
}

export interface SnapshotCalendario {
  readonly version: 1;
  readonly location: {
    readonly location_term_id: string;
    readonly municipality_code: string;
    readonly municipality_name: string;
    readonly state_code: string;
  };
  readonly days: readonly {
    readonly date: string;
    readonly status: "confirmado";
    readonly municipality_code: string;
    readonly state_code: string;
    readonly location_term_id: string;
    readonly holiday_ids: readonly string[];
    readonly coverage_ids: readonly string[];
    readonly day_kind: "util" | "sabado" | "domingo" | "feriado";
  }[];
  readonly segments: {
    readonly status: "confirmado" | "intervalo_sem_horario" | "incompleta";
    readonly worked_minutes: number;
    readonly segments: readonly {
      readonly date: string;
      readonly gross_minutes: number;
      readonly worked_minutes: number | null;
    }[];
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const minutosValidos = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const idsValidos = (v: unknown): boolean => Array.isArray(v) && v.every(uuid);

/** Valida só a proveniência gravada; nunca consulta ou reconstitui o calendário atual. */
export function lerSnapshotCalendario(dados: unknown): SnapshotCalendario | null {
  const r = objeto(dados);
  const local = objeto(r?.["location"]);
  const parcelas = objeto(r?.["segments"]);
  const dias = r?.["days"];
  const segmentos = parcelas?.["segments"];
  if (
    r?.["version"] !== 1 ||
    !local ||
    !uuid(local["location_term_id"]) ||
    !codigoMunicipalDaUf(local["municipality_code"], local["state_code"]) ||
    typeof local["municipality_name"] !== "string" ||
    !local["municipality_name"].trim() ||
    !Array.isArray(dias) ||
    dias.length === 0 ||
    !parcelas ||
    typeof parcelas["status"] !== "string" ||
    !["confirmado", "intervalo_sem_horario", "incompleta"].includes(parcelas["status"]) ||
    !minutosValidos(parcelas["worked_minutes"]) ||
    !Array.isArray(segmentos)
  )
    return null;
  for (const d of dias) {
    const dia = objeto(d);
    if (
      !dia ||
      typeof dia["date"] !== "string" ||
      !dataValida(dia["date"]) ||
      dia["status"] !== "confirmado" ||
      !codigoMunicipalDaUf(dia["municipality_code"], dia["state_code"]) ||
      !uuid(dia["location_term_id"]) ||
      !idsValidos(dia["holiday_ids"]) ||
      !idsValidos(dia["coverage_ids"]) ||
      typeof dia["day_kind"] !== "string" ||
      !["util", "sabado", "domingo", "feriado"].includes(dia["day_kind"])
    )
      return null;
  }
  for (const s of segmentos) {
    const segmento = objeto(s);
    if (
      !segmento ||
      typeof segmento["date"] !== "string" ||
      !dataValida(segmento["date"]) ||
      !minutosValidos(segmento["gross_minutes"]) ||
      (segmento["worked_minutes"] !== null && !minutosValidos(segmento["worked_minutes"]))
    )
      return null;
  }
  return dados as SnapshotCalendario;
}

/** O contexto herdado vem somente de snapshot válido, na própria data gravada. */
export function calendarioCongeladoNaData(valor: unknown, data: string) {
  return lerSnapshotCalendario(valor)?.days.find((dia) => dia.date === data) ?? null;
}

export function situacaoCobertura(cobertura: {
  active: boolean;
  territory_scope: string;
  client_confirmed: boolean;
}): "confirmado" | "pendente" | "aposentado" {
  if (!cobertura.active) return "aposentado";
  return cobertura.territory_scope === "municipal" && !cobertura.client_confirmed
    ? "pendente"
    : "confirmado";
}

/** Mesmo intervalo [início, fim) do banco; fim vazio representa vigência aberta. */
export function periodoLocalValido(inicio: string, fim: string): boolean {
  return dataValida(inicio) && (fim === "" || (dataValida(fim) && fim > inicio));
}

export function validarCoberturaTerritorial(f: FormularioTerritorial, ano: number): string[] {
  const erros = validarTerritorio(f);
  if (!Number.isInteger(ano) || ano < 1900 || ano > 9999) erros.push("Informe um ano válido.");
  if (f.ambito === "municipal" && !f.confirmado)
    erros.push("Confirme a conferência do calendário municipal com o cliente.");
  return erros;
}
