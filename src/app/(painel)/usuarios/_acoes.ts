"use server";

/**
 * Server Actions do backend administrativo de usuários (PR D).
 *
 * Toda ação começa chamando `exigirAdminAal2()` — nenhuma lógica de
 * autorização vive aqui, e nenhuma tabela é tocada antes dessa checagem
 * passar. `service_role` só é instanciado DEPOIS dela, e só dentro de cada
 * função — nunca como módulo compartilhado no topo do arquivo, para que uma
 * falha de autorização nem chegue a criar o cliente privilegiado.
 *
 * A tela (`PR E — /usuarios`) ainda não existe. Este arquivo é o backend
 * completo, exercitado por `scripts/testar-admin-usuarios.mjs` (a lógica, sem
 * rede) e pronto para a UI consumir sem que nenhuma decisão de segurança
 * precise ser adicionada na tela.
 */

import { exigirAdminAal2 } from "@/lib/admin-usuarios/autorizacao";
import { criarClienteAdministrativo } from "@/lib/admin-usuarios/cliente";
import { criarClienteDeOperacoes } from "@/lib/admin-usuarios/operacoes";
import * as operacoes from "@/lib/admin-usuarios/operacoes";
import type { OperacaoResumo } from "@/lib/admin-usuarios/operacoes";
import * as servico from "@/lib/admin-usuarios/servico";
import type {
  AtribuicaoDeOperacao,
  ResultadoAlteracaoDePapel,
  ResultadoAtribuicaoDeOperacao,
  ResultadoConvite,
  ResultadoReativacao,
  ResultadoRemocaoDeOperacao,
  ResultadoRevogacaoDeAcesso,
  UsuarioAdministrativo,
} from "@/lib/admin-usuarios/tipos";
import { criarClienteAdmin } from "@/integrations/supabase/admin";
import { criarClienteServidor } from "@/integrations/supabase/server";

export async function listarUsuariosAction(): Promise<UsuarioAdministrativo[]> {
  const ator = await exigirAdminAal2();
  void ator; // só a autorização importa aqui; ninguém carimba leitura.
  const cliente = criarClienteAdministrativo(criarClienteAdmin());
  return servico.listarUsuarios(cliente);
}

export async function convidarUsuarioAction(entrada: {
  email: unknown;
  papel: unknown;
  nomeCompleto?: unknown;
}): Promise<ResultadoConvite> {
  const ator = await exigirAdminAal2();
  const cliente = criarClienteAdministrativo(criarClienteAdmin());
  return servico.convidarUsuario(cliente, entrada, ator);
}

export async function alterarPapelAction(entrada: {
  userId: unknown;
  papel: unknown;
  acao: unknown;
}): Promise<ResultadoAlteracaoDePapel> {
  const ator = await exigirAdminAal2();
  const cliente = criarClienteAdministrativo(criarClienteAdmin());
  return servico.alterarPapel(cliente, entrada, ator);
}

export async function revogarAcessoAction(entrada: {
  userId: unknown;
}): Promise<ResultadoRevogacaoDeAcesso> {
  const ator = await exigirAdminAal2();
  const supabase = await criarClienteServidor();
  const cliente = criarClienteAdministrativo(criarClienteAdmin());
  return servico.revogarAcesso(cliente, criarClienteDeOperacoes(supabase), entrada, ator);
}

export async function reativarUsuarioAction(entrada: {
  userId: unknown;
  papel: unknown;
}): Promise<ResultadoReativacao> {
  const ator = await exigirAdminAal2();
  const cliente = criarClienteAdministrativo(criarClienteAdmin());
  return servico.reativarUsuario(cliente, entrada, ator);
}

export async function atribuirOperacaoAction(entrada: {
  userId: unknown;
  operationId: unknown;
}): Promise<ResultadoAtribuicaoDeOperacao> {
  const ator = await exigirAdminAal2();
  const supabase = await criarClienteServidor();
  const registrador = criarClienteAdministrativo(criarClienteAdmin());
  return operacoes.atribuirOperacao(criarClienteDeOperacoes(supabase), registrador, entrada, ator);
}

export async function removerOperacaoAction(entrada: {
  userId: unknown;
  operationId: unknown;
}): Promise<ResultadoRemocaoDeOperacao> {
  const ator = await exigirAdminAal2();
  const supabase = await criarClienteServidor();
  const registrador = criarClienteAdministrativo(criarClienteAdmin());
  return operacoes.removerOperacao(criarClienteDeOperacoes(supabase), registrador, entrada, ator);
}

export async function listarOperacoesAtribuidasAction(entrada: {
  userId: unknown;
}): Promise<AtribuicaoDeOperacao[]> {
  await exigirAdminAal2();
  const supabase = await criarClienteServidor();
  return operacoes.listarOperacoesAtribuidas(criarClienteDeOperacoes(supabase), entrada);
}

/**
 * Todas as operações existentes, para o picker de atribuição da tela.
 *
 * Sessão real do admin (RLS), não `service_role` — a leitura de `operations`
 * já é liberada por policy para admin em AAL2, e não há motivo para esta tela
 * ampliar superfície com o cliente privilegiado só para ler duas colunas.
 */
export async function listarOperacoesDisponiveisAction(): Promise<OperacaoResumo[]> {
  await exigirAdminAal2();
  const supabase = await criarClienteServidor();
  return operacoes.listarOperacoesDisponiveis(supabase);
}
