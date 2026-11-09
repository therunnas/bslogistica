"use server";

import { exigirAdminAtor } from "@/lib/admin-usuarios/autorizacao";
import { criarClienteServidor } from "@/integrations/supabase/server";
import { criarAcoesContainer } from "@/lib/container-servico-servidor";
import type { ClienteContainer, FiltroContainer } from "@/lib/container-servico-dados";
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
export async function registrarContainerAction(entrada: {
  lote: LoteDeContainers;
  chave: string;
  motivo: string;
}) {
  return acoes().registrar(entrada);
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
