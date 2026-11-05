import {
  dataCivilValida,
  prepararLoteDeContainers,
  type LoteDeContainers,
  type LoteNormalizado,
} from "./container-servico";

export type ResultadoContainer<T> =
  { ok: true; data: T } | { ok: false; codigo: string; mensagem: string; schemaLegado?: boolean };
export interface RespostaContainer {
  data: unknown;
  error: unknown;
  count?: number | null;
}
export interface ConsultaContainer extends PromiseLike<RespostaContainer> {
  select(colunas: string, opcoes?: { count?: "exact"; head?: boolean }): ConsultaContainer;
  eq(coluna: string, valor: unknown): ConsultaContainer;
  gt(coluna: string, valor: string): ConsultaContainer;
  gte(coluna: string, valor: string): ConsultaContainer;
  lte(coluna: string, valor: string): ConsultaContainer;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaContainer;
  limit(limite: number): ConsultaContainer;
}
export interface ClienteContainer {
  from(tabela: string): ConsultaContainer;
  rpc(nome: string, parametros: Record<string, unknown>): PromiseLike<RespostaContainer>;
}
export interface FiltroContainer {
  clienteId?: string;
  inicio?: string;
  fim?: string;
  situacao?: "todos" | "disponivel" | "faturado" | "cancelado";
}
export interface ServicoContainerLista {
  id: string;
  client_id: string;
  operation_id: string | null;
  requested_on: string;
  executed_on: string;
  description: string;
  quantity: number;
  revenue_cents: number;
  cost_total_cents: number;
  reference: string | null;
  cost_mode: "por_pessoa" | "total_distribuido";
  billing_additional_id: string;
  canceled_at: string | null;
  invoice_id: string | null;
  cliente_nome: string;
  operacao_nome: string | null;
  situacao: "disponivel" | "faturado" | "cancelado";
}
export interface DetalheContainer {
  servico: ServicoContainerLista;
  participantes: { employee_id: string; nome: string; cost_cents: number }[];
  auditoria: {
    id: string;
    action: "registered" | "canceled";
    reason: string;
    created_at: string;
  }[];
  competencia: { inicio: string; fim: string };
}
export interface CatalogosContainer {
  userId: string;
  clientes: { id: string; name: string }[];
  operacoes: { id: string; name: string; client_id: string }[];
  colaboradores: { id: string; name: string }[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function exigirIdContainer(v: unknown): asserts v is string {
  if (typeof v !== "string" || !UUID.test(v)) throw { code: "22023" };
}
function inconsistente(): never {
  throw { code: "INCONSISTENTE" };
}
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return inconsistente();
  return v as Record<string, unknown>;
}
function texto(v: unknown): string {
  if (typeof v !== "string" || !v) return inconsistente();
  return v;
}
function nuloTexto(v: unknown): string | null {
  return v === null ? null : texto(v);
}
function inteiro(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) return inconsistente();
  return n;
}
function data(v: unknown): string {
  const s = texto(v);
  if (!dataCivilValida(s)) return inconsistente();
  return s;
}
function id(v: unknown): string {
  const s = texto(v);
  if (!UUID.test(s)) return inconsistente();
  return s;
}

export function classificarErroContainer(erro: unknown): {
  codigo: string;
  mensagem: string;
  schemaLegado?: boolean;
} {
  const c = erro && typeof erro === "object" ? (erro as { code?: unknown }).code : null;
  if (c === "SEM_045")
    return {
      codigo: "indisponivel",
      schemaLegado: true,
      mensagem: "O schema de containers 045 não está disponível neste banco.",
    };
  if (["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(String(c)))
    return {
      codigo: "indisponivel",
      mensagem:
        "O backend de containers não está disponível neste banco. Nenhuma migration será executada pela tela.",
    };
  if (["42501", "28000", "PGRST301", "PGRST302"].includes(String(c)))
    return {
      codigo: "nao-autorizado",
      mensagem:
        "A sessão precisa estar liberada para administrador. Confira o login e o MFA, quando ativado.",
    };
  if (c === "23505")
    return {
      codigo: "conflito",
      mensagem:
        "Esta intenção já foi usada com outro conteúdo. Confira o serviço registrado antes de prosseguir.",
    };
  if (c === "55000")
    return {
      codigo: "estado-incompativel",
      mensagem: "O serviço já foi cancelado ou faturado. Recarregue os detalhes.",
    };
  if (c === "22023" || c === "23503")
    return {
      codigo: "validacao",
      mensagem:
        "Confira datas, competência, cliente, operação, participantes e valores informados.",
    };
  if (c === "P0002")
    return { codigo: "nao-encontrado", mensagem: "O registro solicitado não foi encontrado." };
  if (c === "INCONSISTENTE")
    return {
      codigo: "inconsistente",
      mensagem: "A leitura não está completa ou consistente. Recarregue antes de continuar.",
    };
  return {
    codigo: "indeterminado",
    mensagem:
      "Não foi possível confirmar o resultado. Preserve a intenção e reconcilie antes de tentar novamente.",
  };
}
export function validarFiltroContainer(f: FiltroContainer): void {
  if (!f || typeof f !== "object") throw { code: "22023" };
  if (f.clienteId) exigirIdContainer(f.clienteId);
  if (
    (f.inicio && !dataCivilValida(f.inicio)) ||
    (f.fim && !dataCivilValida(f.fim)) ||
    (f.inicio && f.fim && f.inicio > f.fim) ||
    (f.situacao && !["todos", "disponivel", "faturado", "cancelado"].includes(f.situacao))
  )
    throw { code: "22023" };
}
async function paginas(
  db: ClienteContainer,
  tabela: string,
  colunas: string,
  chave = "id",
  filtros: [string, unknown][] = [],
  faixa?: FiltroContainer,
): Promise<Record<string, unknown>[]> {
  const montar = (contar: boolean) => {
    let q = db.from(tabela).select(colunas, contar ? { count: "exact", head: true } : undefined);
    for (const [k, v] of filtros) q = q.eq(k, v);
    if (faixa?.inicio) q = q.gte("executed_on", faixa.inicio);
    if (faixa?.fim) q = q.lte("executed_on", faixa.fim);
    return q;
  };
  const contar = async () => {
    const r = await montar(true);
    if (r["error"]) throw r["error"];
    if (!Number.isSafeInteger(r["count"]) || (r["count"] as number) < 0) return inconsistente();
    return r["count"] as number;
  };
  // Primeiro lê a página: erro/schema ausente não é uma contagem zero.
  const linhas: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let total: number | null = null;
  for (let p = 0; p < 1000; p++) {
    let q = montar(false);
    if (cursor) q = q.gt(chave, cursor);
    const r = await q.order(chave, { ascending: true }).limit(200);
    if (r["error"]) throw r["error"];
    if (!Array.isArray(r["data"])) return inconsistente();
    if (total === null) total = await contar();
    for (const item of r["data"]) {
      const row = objeto(item);
      const valor = id(row[chave]);
      if (cursor && valor <= cursor) return inconsistente();
      cursor = valor;
      linhas.push(row);
    }
    if (r["data"].length < 200) {
      if (linhas.length !== total || total !== (await contar())) return inconsistente();
      return linhas;
    }
  }
  return inconsistente();
}
export async function lerCapacidadeContainers(db: ClienteContainer): Promise<void> {
  for (const [t, cols] of [
    ["container_services", "id,billing_additional_id,idempotency_key,request_payload"],
    ["container_service_participants", "service_id,employee_id,cost_cents"],
    ["container_service_audit", "id,service_id,action,reason,created_at"],
  ] as const) {
    const r = await db.from(t).select(cols).limit(0);
    if (r["error"]) {
      const code = (r["error"] as { code?: string }).code;
      if (t === "container_services" && ["42P01", "PGRST205"].includes(code ?? ""))
        throw { code: "SEM_045" };
      throw r["error"];
    }
    if (!Array.isArray(r["data"])) return inconsistente();
  }
}
const COLUNAS =
  "id,client_id,operation_id,requested_on,executed_on,description,quantity,revenue_cents,cost_total_cents,reference,cost_mode,billing_additional_id,canceled_at,clients(name),operations(name),billing_additionals(id,client_id,operation_id,amount,period_start,period_end,billing_period_start,billing_period_end,invoice_id,canceled_at)";
function servico(row: Record<string, unknown>): ServicoContainerLista {
  const adicional = objeto(row["billing_additionals"]);
  const clientId = id(row["client_id"]);
  const operacao = row["operation_id"] === null ? null : id(row["operation_id"]);
  const canceled = nuloTexto(row["canceled_at"]);
  const invoice = adicional["invoice_id"] === null ? null : id(adicional["invoice_id"]);
  if (
    adicional["id"] !== row["billing_additional_id"] ||
    adicional["client_id"] !== clientId ||
    adicional["operation_id"] !== operacao ||
    adicional["canceled_at"] !== canceled ||
    (canceled && invoice)
  )
    return inconsistente();
  const revenue = inteiro(row["revenue_cents"]);
  const cost = inteiro(row["cost_total_cents"]);
  const quantity = inteiro(row["quantity"]);
  if (
    quantity < 1 ||
    revenue < 1 ||
    !["por_pessoa", "total_distribuido"].includes(String(row["cost_mode"]))
  )
    return inconsistente();
  // amount é NUMERIC(12,2); validar em centavos sem arredondar valor financeiro.
  const amount = String(adicional["amount"]);
  const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!parts || Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) !== revenue)
    return inconsistente();
  return {
    id: id(row["id"]),
    client_id: clientId,
    operation_id: operacao,
    requested_on: data(row["requested_on"]),
    executed_on: data(row["executed_on"]),
    description: texto(row["description"]),
    quantity,
    revenue_cents: revenue,
    cost_total_cents: cost,
    reference: nuloTexto(row["reference"]),
    cost_mode: row["cost_mode"] as ServicoContainerLista["cost_mode"],
    billing_additional_id: id(row["billing_additional_id"]),
    canceled_at: canceled,
    invoice_id: invoice,
    cliente_nome: texto(objeto(row["clients"])["name"]),
    operacao_nome: operacao ? texto(objeto(row["operations"])["name"]) : null,
    situacao: canceled ? "cancelado" : invoice ? "faturado" : "disponivel",
  };
}
export async function listarContainers(
  db: ClienteContainer,
  filtro: FiltroContainer,
): Promise<{ servicos: ServicoContainerLista[] }> {
  validarFiltroContainer(filtro);
  await lerCapacidadeContainers(db);
  const rows = await paginas(
    db,
    "container_services",
    COLUNAS,
    "id",
    filtro.clienteId ? [["client_id", filtro.clienteId]] : [],
    filtro,
  );
  const servicos = rows
    .map(servico)
    .filter(
      (s) => !filtro.situacao || filtro.situacao === "todos" || s.situacao === filtro.situacao,
    );
  servicos.sort(
    (a, b) => b.executed_on.localeCompare(a["executed_on"]) || a["id"].localeCompare(b.id),
  );
  return { servicos };
}

/** Conferência fresca por ID; um mapa de listagem em cache não autoriza cancelamento. */
export async function lerVinculoAdicionalContainer(
  db: ClienteContainer,
  adicionalId: string,
): Promise<{ tipo: "container"; id: string } | { tipo: "legado" }> {
  exigirIdContainer(adicionalId);
  try {
    await lerCapacidadeContainers(db);
  } catch (erro) {
    if (erro && typeof erro === "object" && (erro as { code?: string }).code === "SEM_045")
      return { tipo: "legado" };
    throw erro;
  }
  const rows = await paginas(db, "container_services", "id", "id", [
    ["billing_additional_id", adicionalId],
  ]);
  if (rows.length > 1) return inconsistente();
  return rows.length ? { tipo: "container", id: id(rows[0]!["id"]) } : { tipo: "legado" };
}
export async function lerParticipantesContainer(
  db: ClienteContainer,
  serviceId: string,
): Promise<DetalheContainer["participantes"]> {
  const rows = await paginas(
    db,
    "container_service_participants",
    "employee_id,cost_cents,employees(name)",
    "employee_id",
    [["service_id", serviceId]],
  );
  return rows.map((r) => ({
    employee_id: id(r["employee_id"]),
    nome: texto(objeto(r["employees"])["name"]),
    cost_cents: inteiro(r["cost_cents"]),
  }));
}
export async function detalharContainer(
  db: ClienteContainer,
  serviceId: string,
): Promise<DetalheContainer> {
  exigirIdContainer(serviceId);
  await lerCapacidadeContainers(db);
  const rows = await paginas(db, "container_services", COLUNAS, "id", [["id", serviceId]]);
  if (rows.length !== 1) throw { code: "P0002" };
  const s = servico(rows[0]!);
  const adicional = objeto(rows[0]!["billing_additionals"]);
  const participantes = await lerParticipantesContainer(db, serviceId);
  if (
    !participantes.length ||
    participantes.reduce((n, p) => n + p.cost_cents, 0) !== s.cost_total_cents
  )
    return inconsistente();
  const audit = await paginas(db, "container_service_audit", "id,action,reason,created_at", "id", [
    ["service_id", serviceId],
  ]);
  const auditoria = audit.map((a) => {
    if (!["registered", "canceled"].includes(String(a["action"]))) return inconsistente();
    return {
      id: id(a["id"]),
      action: a["action"] as "registered" | "canceled",
      reason: texto(a["reason"]),
      created_at: texto(a["created_at"]),
    };
  });
  if (
    auditoria.filter((a) => a["action"] === "registered").length !== 1 ||
    auditoria.filter((a) => a["action"] === "canceled").length !== (s.canceled_at ? 1 : 0)
  )
    return inconsistente();
  auditoria.sort(
    (a, b) => a["created_at"].localeCompare(b.created_at) || a["id"].localeCompare(b.id),
  );
  return {
    servico: s,
    participantes,
    auditoria,
    competencia: {
      inicio: data(adicional["billing_period_start"] ?? adicional["period_start"]),
      fim: data(adicional["billing_period_end"] ?? adicional["period_end"]),
    },
  };
}
export async function lerCatalogosContainer(
  db: ClienteContainer,
  userId: string,
): Promise<CatalogosContainer> {
  await lerCapacidadeContainers(db);
  const catalogo = async (t: string, op = false) =>
    (await paginas(db, t, op ? "id,name,client_id" : "id,name"))
      .map((r) => ({
        id: id(r["id"]),
        name: texto(r["name"]),
        ...(op ? { client_id: id(r["client_id"]) } : {}),
      }))
      .sort((a, b) => a["name"].localeCompare(b.name) || a["id"].localeCompare(b.id));
  return {
    userId,
    clientes: await catalogo("clients"),
    operacoes: (await catalogo("operations", true)) as CatalogosContainer["operacoes"],
    colaboradores: await catalogo("employees"),
  };
}
export function canonicoPayload(payload: unknown): string {
  const ordenar = (v: unknown, campo = ""): unknown =>
    Array.isArray(v)
      ? v.map((x) => ordenar(x)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a["localeCompare"](b))
              .map(([k, x]) => [k, ordenar(x, k)]),
          )
        : ["clienteId", "operacaoId", "colaboradorId"].includes(campo) &&
            typeof v === "string" &&
            UUID.test(v)
          ? v.toLowerCase()
          : v;
  return JSON.stringify(ordenar(payload));
}
export function validarPayloadContainer(payload: LoteNormalizado): void {
  const dinheiro = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0) throw { code: "22023" };
    return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
  };
  const lote: LoteDeContainers = {
    clienteId: payload.clienteId,
    operacaoId: payload.operacaoId,
    solicitadoEm: payload.solicitadoEm,
    executadoEm: payload.executadoEm,
    descricao: payload.descricao,
    quantidade: payload.quantidade,
    totalCobrado: dinheiro(payload.receitaCentavos),
    referencia: payload.referencia,
    modalidadeCusto: payload.modalidadeCusto,
    participantes: payload.participantes.map((p) => ({
      colaboradorId: p.colaboradorId,
      valorDevido: dinheiro(p.custoCentavos),
    })),
    ...(payload.modalidadeCusto === "total_distribuido"
      ? { totalDistribuido: dinheiro(payload.custoTotalCentavos) }
      : {}),
    ...(payload.competenciaCobranca ? { competenciaCobranca: payload.competenciaCobranca } : {}),
  };
  if (canonicoPayload(prepararLoteDeContainers(lote)) !== canonicoPayload(payload))
    throw { code: "22023" };
}
export async function recuperarRegistroContainer(
  db: ClienteContainer,
  clientId: string,
  chave: string,
  payload: LoteNormalizado,
): Promise<{ estado: "ausente" } | { estado: "registrado"; id: string }> {
  exigirIdContainer(clientId);
  exigirIdContainer(chave);
  validarPayloadContainer(payload);
  if (payload.clienteId.toLowerCase() !== clientId.toLowerCase()) throw { code: "22023" };
  await lerCapacidadeContainers(db);
  const rows = await paginas(db, "container_services", "id,request_payload", "id", [
    ["client_id", clientId],
    ["idempotency_key", chave],
  ]);
  if (!rows.length) return { estado: "ausente" };
  if (rows.length !== 1) return inconsistente();
  if (canonicoPayload(rows[0]!["request_payload"]) !== canonicoPayload(payload))
    throw { code: "23505" };
  return { estado: "registrado", id: id(rows[0]!["id"]) };
}

/** Recupera apenas o identificador persistido; marcador sem payload nunca autoriza reenvio. */
export async function recuperarMarcadorContainer(
  db: ClienteContainer,
  chave: string,
): Promise<{ estado: "ausente" } | { estado: "registrado"; id: string }> {
  exigirIdContainer(chave);
  await lerCapacidadeContainers(db);
  const rows = await paginas(db, "container_services", "id", "id", [["idempotency_key", chave]]);
  if (!rows.length) return { estado: "ausente" };
  if (rows.length !== 1) return inconsistente();
  return { estado: "registrado", id: id(rows[0]!["id"]) };
}
