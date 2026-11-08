import {
  cancelarServicoContainer,
  corrigirServicoContainer,
  registrarServicoContainer,
} from "./container-servico-backend";
import {
  prepararLoteDeContainers,
  type LoteDeContainers,
  type LoteNormalizado,
} from "./container-servico";
import {
  classificarErroContainer,
  detalharContainer,
  listarContainers,
  lerCatalogosContainer,
  lerCapacidadeContainers,
  lerCapacidadeCorrecaoContainer,
  recuperarRegistroContainer,
  recuperarMarcadorContainer,
  lerVinculoAdicionalContainer,
  exigirIdContainer,
  type ClienteContainer,
  type FiltroContainer,
  type ResultadoContainer,
} from "./container-servico-dados";

export function criarAcoesContainer(deps: {
  autorizar: () => Promise<{ id: string }>;
  cliente: () => Promise<ClienteContainer>;
}) {
  async function executar<T>(
    acao: (db: ClienteContainer, userId: string) => Promise<T>,
  ): Promise<ResultadoContainer<T>> {
    let ator: { id: string };
    try {
      ator = await deps.autorizar();
    } catch {
      return { ok: false, ...classificarErroContainer({ code: "42501" }) };
    }
    try {
      return { ok: true, data: await acao(await deps.cliente(), ator.id) };
    } catch (erro) {
      return { ok: false, ...classificarErroContainer(erro) };
    }
  }
  return {
    listar: (filtro: FiltroContainer) => executar((db) => listarContainers(db, filtro)),
    formulario: () => executar((db, userId) => lerCatalogosContainer(db, userId)),
    detalhar: (id: string) => executar((db) => detalharContainer(db, id)),
    vinculo: (adicionalId: string) =>
      executar((db) => lerVinculoAdicionalContainer(db, adicionalId)),
    recuperar: (clienteId: string, chave: string, payload: LoteNormalizado) =>
      executar((db) => recuperarRegistroContainer(db, clienteId, chave, payload)),
    marcador: (chave: string) => executar((db) => recuperarMarcadorContainer(db, chave)),
    registrar: (entrada: { lote: LoteDeContainers; chave: string; motivo: string }) =>
      executar(async (db) => {
        let payload: LoteNormalizado;
        try {
          exigirIdContainer(entrada.chave);
          if (
            typeof entrada.motivo !== "string" ||
            !entrada.motivo.trim() ||
            entrada.motivo.trim().length > 1000
          )
            throw new Error();
          payload = prepararLoteDeContainers(entrada.lote);
        } catch {
          throw { code: "22023" };
        }
        await lerCapacidadeContainers(db);
        const recuperado = await recuperarRegistroContainer(
          db,
          payload.clienteId,
          entrada.chave,
          payload,
        );
        if (recuperado.estado === "registrado") return { id: recuperado.id };
        return {
          id: await registrarServicoContainer(db, entrada.lote, entrada.chave, entrada.motivo),
        };
      }),
    capacidadeCorrecao: () => executar((db) => lerCapacidadeCorrecaoContainer(db)),
    corrigir: (entrada: { id: string; lote: LoteDeContainers; chave: string; motivo: string }) =>
      executar(async (db) => {
        let payload: LoteNormalizado;
        try {
          exigirIdContainer(entrada.id);
          exigirIdContainer(entrada.chave);
          if (
            typeof entrada.motivo !== "string" ||
            !entrada.motivo.trim() ||
            entrada.motivo.trim().length > 1000
          )
            throw new Error();
          payload = prepararLoteDeContainers(entrada.lote);
        } catch {
          throw { code: "22023" };
        }
        // Resposta perdida: a mesma chave já registrou o substituto -> devolve-o, sem novo envio.
        const recuperado = await recuperarRegistroContainer(
          db,
          payload.clienteId,
          entrada.chave,
          payload,
        );
        if (recuperado.estado === "registrado") return { id: recuperado.id };
        const detalhe = await detalharContainer(db, entrada.id);
        if (detalhe.servico.situacao !== "disponivel") throw { code: "55000" };
        if (detalhe.servico.client_id !== payload.clienteId) throw { code: "22023" };
        return {
          id: await corrigirServicoContainer(
            db,
            entrada.id,
            entrada.lote,
            entrada.chave,
            entrada.motivo,
          ),
        };
      }),
    cancelar: (entrada: { id: string; motivo: string }) =>
      executar(async (db) => {
        const detalhe = await detalharContainer(db, entrada.id);
        if (detalhe.servico.situacao !== "disponivel") throw { code: "55000" };
        await cancelarServicoContainer(db, entrada.id, entrada.motivo);
        return { id: entrada.id };
      }),
  };
}
