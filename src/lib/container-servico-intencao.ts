import {
  prepararLoteDeContainers,
  type LoteDeContainers,
  type LoteNormalizado,
} from "./container-servico";

export type IntencaoContainer = {
  versao: 1;
  userId: string;
  chave: string;
  lote: LoteDeContainers;
  payload: LoteNormalizado;
  motivo: string;
  estado: "preparada" | "enviando" | "indeterminada" | "confirmada" | "recusada";
  servicoId?: string;
};

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(valor: unknown): string {
  if (typeof valor !== "string" || !UUID.test(valor)) {
    throw new Error("A intenção exige uma identidade e identificadores UUID válidos.");
  }
  return valor.toLowerCase();
}

function motivoValido(valor: unknown): string {
  if (typeof valor !== "string" || !valor.trim() || valor.trim().length > 1000) {
    throw new Error("Informe um motivo de até 1000 caracteres.");
  }
  return valor.trim();
}

function objeto(valor: unknown, permitidas: string[]): Record<string, unknown> {
  if (
    valor === null ||
    typeof valor !== "object" ||
    Array.isArray(valor) ||
    Object.keys(valor).some((key) => !permitidas.includes(key))
  ) {
    throw new Error("Intenção de container inválida ou com campos desconhecidos.");
  }
  return valor as Record<string, unknown>;
}

/** Valida a forma antes de chamar o domínio tipado, inclusive ao ler JSON adulterado. */
function loteValidado(valor: unknown): LoteDeContainers {
  const item = objeto(valor, [
    "clienteId",
    "operacaoId",
    "solicitadoEm",
    "executadoEm",
    "descricao",
    "quantidade",
    "totalCobrado",
    "referencia",
    "participantes",
    "modalidadeCusto",
    "totalDistribuido",
    "competenciaCobranca",
  ]);
  for (const campo of [
    "clienteId",
    "solicitadoEm",
    "executadoEm",
    "descricao",
    "totalCobrado",
    "modalidadeCusto",
  ]) {
    if (typeof item[campo] !== "string") throw new Error("Campo de container inválido.");
  }
  for (const campo of ["operacaoId", "referencia", "totalDistribuido"]) {
    if (item[campo] != null && typeof item[campo] !== "string") {
      throw new Error("Campo opcional de container inválido.");
    }
  }
  if (typeof item["quantidade"] !== "number" || !Array.isArray(item["participantes"])) {
    throw new Error("Quantidade ou participantes inválidos.");
  }
  for (const participante of item["participantes"]) {
    const pessoa = objeto(participante, ["colaboradorId", "valorDevido"]);
    uuid(pessoa["colaboradorId"]);
    if (typeof pessoa["valorDevido"] !== "string") throw new Error("Custo inválido.");
  }
  uuid(item["clienteId"]);
  if (item["operacaoId"] != null) uuid(item["operacaoId"]);
  if (item["competenciaCobranca"] !== undefined) {
    const competencia = objeto(item["competenciaCobranca"], ["inicio", "fim"]);
    if (typeof competencia["inicio"] !== "string" || typeof competencia["fim"] !== "string") {
      throw new Error("Competência inválida.");
    }
  }
  const lote = JSON.parse(JSON.stringify(item)) as LoteDeContainers;
  prepararLoteDeContainers(lote);
  return lote;
}

function canonico(lote: LoteDeContainers): LoteNormalizado {
  const payload = prepararLoteDeContainers(lote);
  payload.clienteId = uuid(payload.clienteId);
  payload.operacaoId = payload.operacaoId === null ? null : uuid(payload.operacaoId);
  payload.participantes = payload.participantes
    .map((pessoa) => ({ ...pessoa, colaboradorId: uuid(pessoa.colaboradorId) }))
    .sort((a, b) => a.colaboradorId.localeCompare(b.colaboradorId));
  if (
    new Set(payload.participantes.map((pessoa) => pessoa.colaboradorId)).size !==
    payload.participantes.length
  ) {
    throw new Error("O colaborador não pode aparecer duas vezes no serviço.");
  }
  return payload;
}

/** Compara objetos JSON sem depender da ordem de suas propriedades. */
function assinatura(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(assinatura).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    return `{${Object.entries(valor)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${assinatura(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === "object") {
    for (const item of Object.values(valor)) congelar(item);
    Object.freeze(valor);
  }
  return valor;
}

export function criarIntencao(
  userId: string,
  lote: LoteDeContainers,
  motivo: string,
  chave: string,
): IntencaoContainer {
  const snapshot = loteValidado(lote);
  return congelar({
    versao: 1,
    userId: uuid(userId),
    chave: uuid(chave),
    lote: snapshot,
    payload: canonico(snapshot),
    motivo: motivoValido(motivo),
    estado: "preparada",
  });
}

function validarIntencao(valor: unknown, userId: string): IntencaoContainer {
  const item = objeto(valor, [
    "versao",
    "userId",
    "chave",
    "lote",
    "payload",
    "motivo",
    "estado",
    "servicoId",
  ]);
  if (item["versao"] !== 1 || item["userId"] !== userId) {
    throw new Error("A intenção pertence a outra identidade ou versão.");
  }
  const base = criarIntencao(
    userId,
    item["lote"] as LoteDeContainers,
    item["motivo"] as string,
    item["chave"] as string,
  );
  if (assinatura(item["payload"]) !== assinatura(base.payload)) {
    throw new Error("O payload salvo diverge da intenção original.");
  }
  const estado = item["estado"];
  if (
    !["preparada", "enviando", "indeterminada", "confirmada", "recusada"].includes(estado as string)
  ) {
    throw new Error("Estado da intenção inválido.");
  }
  if (estado === "confirmada") {
    return congelar({ ...base, estado, servicoId: uuid(item["servicoId"]) });
  }
  if (item["servicoId"] !== undefined) throw new Error("Serviço não confirmado.");
  return congelar({ ...base, estado: estado as IntencaoContainer["estado"] });
}

export function assertPayloadDaIntencao(
  intent: IntencaoContainer,
  lote: LoteDeContainers,
  motivo: string,
): void {
  const original = validarIntencao(intent, uuid(intent.userId));
  if (
    assinatura(original.payload) !== assinatura(canonico(loteValidado(lote))) ||
    original.motivo !== motivoValido(motivo)
  ) {
    throw new Error("A intenção pendente tem outros dados ou motivo. Reconcilie antes de alterar.");
  }
}

/** O chamador deve reconciliar no backend antes de reenviar uma intenção indeterminada. */
export function marcarIntencao(
  intent: IntencaoContainer,
  estado: IntencaoContainer["estado"],
  servicoId?: string,
): IntencaoContainer {
  const original = validarIntencao(intent, uuid(intent.userId));
  const permitidas: Record<IntencaoContainer["estado"], IntencaoContainer["estado"][]> = {
    preparada: ["enviando", "indeterminada", "confirmada"],
    enviando: ["indeterminada", "confirmada", "recusada"],
    indeterminada: ["enviando", "confirmada"],
    confirmada: [],
    recusada: ["enviando", "confirmada"],
  };
  if (!permitidas[original.estado].includes(estado)) {
    throw new Error("Transição da intenção inválida ou envio já em andamento.");
  }
  if (estado === "confirmada") {
    return congelar({ ...original, estado, servicoId: uuid(servicoId) });
  }
  if (servicoId !== undefined) throw new Error("Identificador exige confirmação.");
  return congelar({ ...original, estado });
}

/**
 * Somente rejeição explícita sem commit pode corrigir conteúdo, depois de o
 * chamador reconciliar a ausência no backend. A chave composta inclui o cliente.
 */
export function corrigirIntencaoRecusada(
  intent: IntencaoContainer,
  lote: LoteDeContainers,
  motivo: string,
): IntencaoContainer {
  const original = validarIntencao(intent, uuid(intent.userId));
  if (original.estado !== "recusada") {
    throw new Error("Somente uma intenção explicitamente recusada permite corrigir os dados.");
  }
  const corrigida = criarIntencao(original.userId, lote, motivo, original.chave);
  if (corrigida.payload.clienteId !== original.payload.clienteId) {
    throw new Error("A correção deve preservar o cliente e a chave da intenção recusada.");
  }
  return corrigida;
}

function chaveDoUsuario(userId: string): string {
  return `bs:container:intencao:v1:${uuid(userId)}`;
}

/** Somente identificadores opacos sobrevivem à navegação; valores ficam na memória da tela. */
export type MarcadorIntencaoContainer = { versao: 2; userId: string; chave: string };

function marcador(valor: unknown, userId: string): MarcadorIntencaoContainer {
  const item = objeto(valor, ["versao", "userId", "chave"]);
  if (item["versao"] !== 2 || item["userId"] !== userId) {
    throw new Error("Marcador de intenção inválido. Reconciliação administrativa necessária.");
  }
  return { versao: 2, userId, chave: uuid(item["chave"]) };
}

export function salvarIntencao(storage: Armazenamento, intent: IntencaoContainer): void {
  const userId = uuid(intent.userId);
  const validada = validarIntencao(intent, userId);
  storage.setItem(
    chaveDoUsuario(userId),
    JSON.stringify({ versao: 2, userId, chave: validada.chave }),
  );
}

/** Nunca devolve o payload legado. JSON inválido continua bloqueando uma chave nova. */
export function recuperarIntencao(
  storage: Armazenamento,
  userId: string,
): MarcadorIntencaoContainer | null {
  const identidade = uuid(userId);
  const key = chaveDoUsuario(identidade);
  const bruto = storage.getItem(key);
  if (bruto === null) return null;
  return marcador(JSON.parse(bruto), identidade);
}

/** Atualiza envelopes antigos de TODAS as identidades, sem apagar a chave de reconciliação. */
export function sanearIntencoes(storage: Armazenamento & Pick<Storage, "length" | "key">): void {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith("bs:container:intencao:v1:")) continue;
    let seguro: unknown = { versao: 2, bloqueada: true };
    try {
      const userId = uuid(key.slice("bs:container:intencao:v1:".length));
      const item = JSON.parse(storage.getItem(key) ?? "null");
      if (item?.versao === 1) {
        if (item.userId !== userId) throw new Error("Identidade inválida.");
        seguro = { versao: 2, userId, chave: uuid(item.chave) };
      } else {
        seguro = marcador(item, userId);
      }
    } catch {
      // Retira também texto sensível corrompido, mantendo um bloqueio persistente.
    }
    const texto = JSON.stringify(seguro);
    if (storage.getItem(key) !== texto) storage.setItem(key, texto);
  }
}

export function limparIntencao(storage: Armazenamento, userId: string): void {
  storage.removeItem(chaveDoUsuario(userId));
}
