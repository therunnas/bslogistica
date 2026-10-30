/**
 * Carregamento do Fechamento: o ÚNICO ponto que compõe o resultado.
 *
 *   filtros (cliente, período)
 *     → validação
 *     → cliente (só o pedido, pela sessão)
 *     → leitura paginada e provada completa     (leitura.ts)
 *     → normalização, centavos, decomposição     (normalizar.ts)
 *     → funções oficiais do banco (030)          (banco.ts)
 *     → assinatura do snapshot                   (assinatura.ts)
 *     → agregação, alertas, meta                 (agregar.ts)
 *     → FechamentoData
 *
 * Aqui não há regra financeira: este arquivo só encadeia os módulos que a têm.
 * A API e, mais adiante, o XLSX chamam `carregarFechamento` e nada mais, de modo
 * que tela e arquivo nascem do mesmo cálculo.
 *
 * **Nunca devolve resultado parcial.** Qualquer falha — filtro inválido, cliente
 * inacessível, erro de consulta, truncamento, dado inconsistente — sobe como
 * erro. Nada é convertido em lista vazia.
 *
 * As dependências são injetáveis: a suíte troca a fonte de linhas, a busca do
 * cliente e o relógio por falsos. A versão real usa o cliente Supabase da
 * SESSÃO do admin, então a RLS (`admin` e o piso de MFA da conta, `mfa_cotidiano_ok()`) segue sendo a fronteira.
 * Nenhum `service_role` aqui.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { agregarFechamento } from "./agregar";
import { assinarFechamento } from "./assinatura";
import { buscarDadosDoBanco, criarFonteDoBancoSupabase, type FonteDoBanco } from "./banco";
import { ErroDeClienteInacessivel, ErroDeFiltroDoFechamento } from "./erros";
import {
  criarFonteSupabase,
  ErroDeLeituraDoFechamento,
  lerFechamento,
  type FiltroDoFechamento,
  type FonteDeLinhas,
  type OpcoesDeLeitura,
} from "./leitura";
import { normalizarLinhas } from "./normalizar";
import { validarPeriodo } from "./periodo";
import type { FechamentoData } from "./tipos";

/** O que o carregamento recebe de fora: texto bruto, ainda por validar. */
export interface FiltrosBrutos {
  clienteId: unknown;
  inicio: unknown;
  fim: unknown;
}

export interface ClienteDoFechamento {
  id: string;
  name: string;
}

export interface DependenciasDoCarregamento {
  /** Só o cliente pedido. `null` = não existe OU a sessão não o enxerga. */
  buscarCliente(clienteId: string): Promise<ClienteDoFechamento | null>;
  criarFonte(filtro: FiltroDoFechamento): FonteDeLinhas;
  /** As funções e tabelas do banco que completam o Fechamento (adicionais, ajuste acumulado…). */
  criarFonteDoBanco(): FonteDoBanco;
  agora(): Date;
  opcoesDeLeitura?: OpcoesDeLeitura;
}

/** UUID em qualquer versão: o filtro é de formato, não de origem. */
const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida e normaliza os filtros. Lança `ErroDeFiltroDoFechamento`. */
export function validarFiltros(filtros: FiltrosBrutos): FiltroDoFechamento {
  if (typeof filtros.clienteId !== "string" || !FORMATO_DE_UUID.test(filtros.clienteId)) {
    throw new ErroDeFiltroDoFechamento("cliente-invalido", "Informe um cliente válido.");
  }

  const periodo = validarPeriodo(filtros.inicio, filtros.fim);
  if (!periodo.ok) {
    throw new ErroDeFiltroDoFechamento("periodo-invalido", periodo.mensagem);
  }

  return {
    clienteId: filtros.clienteId.toLowerCase(),
    inicio: periodo.periodo.inicio,
    fim: periodo.periodo.fim,
  };
}

export async function carregarFechamento(
  filtrosBrutos: FiltrosBrutos,
  dependencias: DependenciasDoCarregamento,
): Promise<FechamentoData> {
  const filtro = validarFiltros(filtrosBrutos);

  const cliente = await dependencias.buscarCliente(filtro.clienteId);
  if (cliente === null) throw new ErroDeClienteInacessivel();

  const brutas = await lerFechamento(
    dependencias.criarFonte(filtro),
    dependencias.opcoesDeLeitura ?? {},
  );
  const linhas = normalizarLinhas(brutas);
  const banco = await buscarDadosDoBanco(dependencias.criarFonteDoBanco(), filtro);

  return agregarFechamento(linhas, {
    clienteId: filtro.clienteId,
    clienteNome: cliente.name,
    inicio: filtro.inicio,
    fim: filtro.fim,
    geradoEm: dependencias.agora().toISOString(),
    banco,
    assinatura: assinarFechamento({
      banco,
      clienteId: filtro.clienteId,
      clienteNome: cliente.name,
      inicio: filtro.inicio,
      fim: filtro.fim,
      linhas,
    }),
  });
}

/** As dependências reais: o cliente Supabase da sessão. */
export function dependenciasComSupabase(
  supabase: SupabaseClient<Database>,
): DependenciasDoCarregamento {
  return {
    async buscarCliente(clienteId) {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("id", clienteId)
        .maybeSingle();

      if (error) {
        throw new ErroDeLeituraDoFechamento(
          "consulta",
          `Falha ao buscar o cliente: ${error.message}`,
        );
      }
      return data;
    },
    criarFonte: (filtro) => criarFonteSupabase(supabase, filtro),
    criarFonteDoBanco: () => criarFonteDoBancoSupabase(supabase),
    agora: () => new Date(),
  };
}
