"use server";

import { exigirAdminAtor } from "@/lib/admin-usuarios/autorizacao";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { criarAcoesContainer } from "@/lib/container-servico-servidor";
import { cadastroDeContainerEncerrado } from "@/lib/container-servico-ui";
import {
  classificarErroContainer,
  type ClienteContainer,
  type FiltroContainer,
} from "@/lib/container-servico-dados";
import type { LoteDeContainers, LoteNormalizado } from "@/lib/container-servico";

function acoes() {
  return criarAcoesContainer({
    autorizar: exigirAdminAtor,
    cliente: async () => (await criarClienteServidor()) as unknown as ClienteContainer,
  });
}
export async function carregarContainersAction(filtro: FiltroContainer) {
  return acoes().listar(filtro);
}
export async function carregarFormularioContainerAction() {
  return acoes().formulario();
}
export async function carregarContainerAction(id: string) {
  return acoes().detalhar(id);
}
export async function verificarVinculoAdicionalContainerAction(id: string) {
  return acoes().vinculo(id);
}
export async function recuperarIntencaoContainerAction(
  clienteId: string,
  chave: string,
  payload: LoteNormalizado,
) {
  return acoes().recuperar(clienteId, chave, payload);
}
/**
 * D7 (CP-06): o cadastro NOVO de containers por este caminho está encerrado no servidor, não só na
 * tela — contêiner é serviço avulso (Operações → tipo Avulsa). A autorização continua sendo
 * conferida antes da resposta. Correção e cancelamento de registros antigos seguem abaixo.
 */
export async function registrarContainerAction(entrada: {
  lote: LoteDeContainers;
  chave: string;
  motivo: string;
}) {
  void entrada;
  try {
    await exigirAdminAtor();
  } catch {
    return { ok: false as const, ...classificarErroContainer({ code: "42501" }) };
  }
  return cadastroDeContainerEncerrado();
}
export async function capacidadeCorrecaoContainerAction() {
  return acoes().capacidadeCorrecao();
}
export async function corrigirContainerAction(entrada: {
  id: string;
  lote: LoteDeContainers;
  chave: string;
  motivo: string;
}) {
  return acoes().corrigir(entrada);
}
export async function cancelarContainerAction(entrada: { id: string; motivo: string }) {
  return acoes().cancelar(entrada);
}

export async function recuperarMarcadorContainerAction(chave: string) {
  return acoes().marcador(chave);
}
