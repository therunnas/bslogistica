import { prepararLoteDeContainers, type LoteDeContainers } from "./container-servico";

/** Cliente da sessão atual; a autorização e os invariantes são repetidos pela RPC. */
export interface ClienteRpcDeContainer {
  rpc(
    nome: string,
    parametros: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirUuid(valor: string): string {
  if (!UUID.test(valor)) throw new Error("Informe um identificador UUID válido.");
  return valor;
}

function exigirMotivo(valor: string): string {
  const motivo = valor.trim();
  if (motivo.length < 1 || motivo.length > 1000) {
    throw new Error("Informe um motivo de até 1000 caracteres.");
  }
  return motivo;
}

/** Normaliza reais para centavos; não calcula fatura, diária ou quitação. */
export async function registrarServicoContainer(
  cliente: ClienteRpcDeContainer,
  lote: LoteDeContainers,
  chaveDeIdempotencia: string,
  motivo: string,
): Promise<string> {
  const parametros = {
    p_dados: prepararLoteDeContainers(lote),
    p_idempotency_key: exigirUuid(chaveDeIdempotencia),
    p_reason: exigirMotivo(motivo),
  };
  const { data, error } = await cliente.rpc("registrar_servico_container", parametros);
  if (error) throw error;
  if (typeof data !== "string" || !UUID.test(data)) {
    throw new Error("O banco não confirmou o identificador do serviço de container.");
  }
  return data;
}

/** O banco permite cancelamento somente antes do faturamento e preserva a trilha. */
export async function cancelarServicoContainer(
  cliente: ClienteRpcDeContainer,
  servicoId: string,
  motivo: string,
): Promise<void> {
  const parametros = { p_id: exigirUuid(servicoId), p_reason: exigirMotivo(motivo) };
  const { error } = await cliente.rpc("cancelar_servico_container", parametros);
  if (error) throw error;
}

/**
 * Correção atômica (049): o banco cancela o original e registra o substituto na MESMA transação, com a
 * chave da intenção (repetir devolve o mesmo substituto). Só serviço disponível e do mesmo cliente.
 */
export async function corrigirServicoContainer(
  cliente: ClienteRpcDeContainer,
  servicoId: string,
  lote: LoteDeContainers,
  chaveDeIdempotencia: string,
  motivo: string,
): Promise<string> {
  const parametros = {
    p_id: exigirUuid(servicoId),
    p_dados: prepararLoteDeContainers(lote),
    p_idempotency_key: exigirUuid(chaveDeIdempotencia),
    p_reason: exigirMotivo(motivo),
  };
  const { data, error } = await cliente.rpc("corrigir_servico_container", parametros);
  if (error) throw error;
  if (typeof data !== "string" || !UUID.test(data)) {
    throw new Error("O banco não confirmou o identificador do serviço corrigido.");
  }
  return data;
}
