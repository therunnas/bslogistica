import { decidirDisponibilidade } from "./fechamento/disponibilidade";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { lerConsultaPaginada } from "@/lib/paginacao";
import { toast } from "@/lib/notificacoes";
import { RPC_VIGENCIAS } from "@/lib/vigencias";
import { lerDivergencias, lerPendencias } from "@/lib/vigencias-implantacao";
import {
  interpretarEstadoDoMotor,
  interpretarRegrasDaBs,
  interpretarNucleoV2,
  interpretarRegrasDefinitivas,
  montarCadastroAtomico,
  montarRegistro,
  type EstadoDoMotorUI,
  type FormularioDeVigencia,
  type TipoDeVigencia,
  type VersaoBase,
} from "@/lib/vigencias-ui";

/**
 * Camada de dados das condições financeiras versionadas (C05-B4.6).
 *
 * Usa o cliente tipado pelo `Database` gerado (tabelas de versões, RPCs e a chave do motor vêm
 * das migrations 021 a 026). Tudo aqui é leitura ou RPC de administrador: quem não é admin
 * recebe `42501` do banco, e a tela nem chega a este ponto (o painel é protegido pelo guard).
 * Nenhuma escrita direta em tabela de versões.
 */

const cliente = () => criarClienteNavegador();

type Cliente = ReturnType<typeof criarClienteNavegador>;

/**
 * Leituras das versões, SEMPRE completas (C05-B7.4). O PostgREST corta toda resposta em 1000
 * linhas, em silêncio, e versão encerrada continua `active`: um conjunto cortado faria a tela
 * tratar versão existente como "sem condição financeira" e bloquear o salvamento da folha. Cada
 * leitura é paginada por `id` e conferida por contagem (`lerConsultaPaginada`); qualquer falha
 * lança, e resultado parcial nunca é devolvido. O filtro é aplicado igual em toda página e na
 * contagem.
 */
export function lerVersoesDoContrato(db: Cliente, contratoId: string, somenteAtivas: boolean) {
  return lerConsultaPaginada(
    ({ depoisDe, limite }) => {
      let q = db.from("contract_terms").select("*").eq("contract_id", contratoId);
      if (somenteAtivas) q = q.eq("active", true);
      if (depoisDe !== null) q = q.gt("id", depoisDe);
      return q.order("id", { ascending: true }).limit(limite);
    },
    () => {
      let q = db
        .from("contract_terms")
        .select("*", { count: "exact", head: true })
        .eq("contract_id", contratoId);
      if (somenteAtivas) q = q.eq("active", true);
      return q;
    },
  );
}

export function lerVersoesDaOperacao(db: Cliente, operacaoId: string, somenteAtivas: boolean) {
  return lerConsultaPaginada(
    ({ depoisDe, limite }) => {
      let q = db.from("operation_terms").select("*").eq("operation_id", operacaoId);
      if (somenteAtivas) q = q.eq("active", true);
      if (depoisDe !== null) q = q.gt("id", depoisDe);
      return q.order("id", { ascending: true }).limit(limite);
    },
    () => {
      let q = db
        .from("operation_terms")
        .select("*", { count: "exact", head: true })
        .eq("operation_id", operacaoId);
      if (somenteAtivas) q = q.eq("active", true);
      return q;
    },
  );
}

export function lerCustosDosColaboradores(
  db: Cliente,
  colaboradores: readonly string[],
  somenteAtivas: boolean,
) {
  return lerConsultaPaginada(
    ({ depoisDe, limite }) => {
      let q = db.from("employee_cost_terms").select("*").in("employee_id", colaboradores);
      if (somenteAtivas) q = q.eq("active", true);
      if (depoisDe !== null) q = q.gt("id", depoisDe);
      return q.order("id", { ascending: true }).limit(limite);
    },
    () => {
      let q = db
        .from("employee_cost_terms")
        .select("*", { count: "exact", head: true })
        .in("employee_id", colaboradores);
      if (somenteAtivas) q = q.eq("active", true);
      return q;
    },
  );
}

/** Versão de qualquer fonte de preço: os campos comuns tipados, os valores lidos por chave. */
export type VersaoDeVigencia = VersaoBase & Record<string, unknown>;

export const CHAVE_DO_MOTOR = ["motor-estado"] as const;

/**
 * Estado do motor. Erro técnico, permissão negada, resposta inválida ou gatilhos inconsistentes
 * viram `desconhecido` — nunca `desligado`. Relê ao voltar para a janela, para que a tela não
 * fique presa a um estado antigo depois de o motor ser ligado ou desligado.
 */
function useConsultaDoMotor(habilitado = true) {
  return useQuery({
    enabled: habilitado,
    queryKey: CHAVE_DO_MOTOR,
    queryFn: async () => {
      const { data, error } = await cliente().rpc(RPC_VIGENCIAS.motor.estado);
      return { data, error };
    },
    staleTime: 10_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

export function useEstadoDoMotor(): EstadoDoMotorUI {
  const consulta = useConsultaDoMotor();
  if (consulta.isError) return interpretarEstadoDoMotor(null, consulta.error ?? { code: "?" });
  if (!consulta.data) return { tag: "carregando" };
  return interpretarEstadoDoMotor(consulta.data.data, consulta.data.error);
}

/**
 * O banco já tem a migration 029 (valor-hora acordado, custo proporcional, adicionais)? Lê a
 * mesma consulta do estado do motor (mesma chave, sem chamada extra). Carregando, erro ou banco
 * anterior: `false`, e a tela não oferece nada que dependa da 029.
 */
export function useRegrasDaBs(): boolean {
  const consulta = useConsultaDoMotor();
  if (consulta.isError || !consulta.data) return false;
  return interpretarRegrasDaBs(consulta.data.data, consulta.data.error);
}

/**
 * O Fechamento está disponível (030 anunciada, motor novo ligado, estado confirmado)? Mesma
 * decisão do servidor, pela mesma consulta do motor. Só consulta se `habilitado` (admin).
 * Carregando, erro ou estado desconhecido: `false` — o menu esconde o link; quem barra de verdade
 * é o servidor (página e APIs).
 */
export function useFechamentoDisponivel(habilitado: boolean): boolean {
  const consulta = useConsultaDoMotor(habilitado);
  if (!habilitado || consulta.isError || !consulta.data) return false;
  return decidirDisponibilidade(consulta.data.data, consulta.data.error).disponivel;
}

/** O banco já tem a migration 030 (regras definitivas)? Mesma consulta do estado do motor. */
export function useRegrasDefinitivas(): boolean {
  const consulta = useConsultaDoMotor();
  if (consulta.isError || !consulta.data) return false;
  return interpretarRegrasDefinitivas(consulta.data.data, consulta.data.error);
}

/** O banco já tem a migration 036 (núcleo V2 no motor)? Mesma consulta do estado do motor. */
export function useNucleoV2(): boolean {
  const consulta = useConsultaDoMotor();
  if (consulta.isError || !consulta.data) return false;
  return interpretarNucleoV2(consulta.data.data, consulta.data.error);
}

export function useVersoes(tipo: TipoDeVigencia, entidadeId: string | null) {
  return useQuery({
    queryKey: ["vigencias", tipo, entidadeId],
    enabled: Boolean(entidadeId),
    queryFn: async (): Promise<VersaoDeVigencia[]> => {
      const id = entidadeId as string;
      const db = cliente();
      const data =
        tipo === "contrato"
          ? await lerVersoesDoContrato(db, id, false)
          : tipo === "colaborador"
            ? await lerCustosDosColaboradores(db, [id], false)
            : await lerVersoesDaOperacao(db, id, false);
      return data
        .slice()
        .sort((a, b) =>
          a.valid_from === b.valid_from
            ? b.created_at.localeCompare(a.created_at)
            : b.valid_from.localeCompare(a.valid_from),
        );
    },
  });
}

/** Versões necessárias para a prévia de uma data (só com o motor ligado e conhecido). */
export function useTermosDoApontamento(p: {
  habilitado: boolean;
  contratoId: string | null;
  operacaoId: string | null;
  colaboradores: readonly string[];
}) {
  const ativo = p.habilitado;
  const contrato = useQuery({
    queryKey: ["vigencias", "contrato", p.contratoId],
    enabled: ativo && Boolean(p.contratoId),
    queryFn: () => lerVersoesDoContrato(cliente(), p.contratoId as string, true),
  });
  const operacao = useQuery({
    queryKey: ["vigencias", "operacao", p.operacaoId],
    enabled: ativo && Boolean(p.operacaoId),
    queryFn: () => lerVersoesDaOperacao(cliente(), p.operacaoId as string, true),
  });
  const chaveColaboradores = [...p.colaboradores].sort().join(",");
  const custos = useQuery({
    queryKey: ["vigencias", "custos", chaveColaboradores],
    enabled: ativo && p.colaboradores.length > 0,
    queryFn: () => lerCustosDosColaboradores(cliente(), p.colaboradores, true),
  });
  return {
    carregando:
      ativo &&
      ((contrato.isPending && Boolean(p.contratoId)) ||
        (operacao.isPending && Boolean(p.operacaoId)) ||
        (custos.isPending && p.colaboradores.length > 0)),
    erro: Boolean(contrato.error || operacao.error || custos.error),
    termosContrato: contrato.data ?? [],
    termosOperacao: operacao.data ?? [],
    termosCusto: custos.data ?? [],
  };
}

function invalidarVigencias(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["vigencias"] });
  void queryClient.invalidateQueries({ queryKey: CHAVE_DO_MOTOR });
}

/**
 * Fronteira dinâmica: o nome e os parâmetros vêm de `RPC_VIGENCIAS`/`montarRegistro`/`montarCadastroAtomico`
 * (a suíte `test:motor-vigencia` confere cada nome e cada parâmetro contra as migrations). É o
 * único ponto sem checagem estática de nome e argumentos; o retorno não é usado.
 */
async function chamar(rpc: string, params: Record<string, unknown>) {
  const { data, error } = await cliente().rpc(rpc as never, params as never);
  if (error) throw error;
  return data as unknown;
}

export function useRegistrarVigencia(tipo: TipoDeVigencia) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { entidadeId: string; form: FormularioDeVigencia }) => {
      const { rpc, params } = montarRegistro(tipo, v.entidadeId, v.form);
      await chamar(rpc, params);
    },
    onSuccess: () => {
      invalidarVigencias(queryClient);
      toast.success("Vigência registrada.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

export function useEncerrarVigencia(tipo: TipoDeVigencia) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { termoId: string; validTo: string; motivo: string }) => {
      if (v.motivo.trim() === "" || !/^\d{4}-\d{2}-\d{2}$/.test(v.validTo)) {
        throw new Error("Informe a data final e o motivo.");
      }
      await chamar(RPC_VIGENCIAS[tipo].encerrar, {
        p_term_id: v.termoId,
        p_valid_to: v.validTo,
        p_reason: v.motivo.trim(),
      });
    },
    onSuccess: () => {
      invalidarVigencias(queryClient);
      toast.success("Vigência encerrada.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

export function useAposentarVigencia(tipo: TipoDeVigencia) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { termoId: string; motivo: string }) => {
      if (v.motivo.trim() === "") throw new Error("O motivo é obrigatório.");
      await chamar(RPC_VIGENCIAS[tipo].aposentar, {
        p_term_id: v.termoId,
        p_reason: v.motivo.trim(),
      });
    },
    onSuccess: () => {
      invalidarVigencias(queryClient);
      toast.success("Vigência aposentada.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

/**
 * Cadastro novo com o motor LIGADO: UMA chamada cria a entidade e a vigência inicial na mesma
 * transação (migration 026). Se a vigência falhar, a entidade também não fica. Nada de valor
 * financeiro é inferido: a vigência começa na data informada pelo formulário.
 */
export function useCriarComVigencia(tipo: TipoDeVigencia, invalidar: string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { linha: Record<string, unknown>; form: FormularioDeVigencia }) => {
      const { rpc, params } = montarCadastroAtomico(tipo, v.linha, v.form);
      await chamar(rpc, params);
    },
    onSuccess: () => {
      invalidar.forEach((chave) => void queryClient.invalidateQueries({ queryKey: [chave] }));
      invalidarVigencias(queryClient);
      toast.success("Cadastro e vigência inicial salvos.");
    },
    onError: (erro: unknown) =>
      toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro)),
  });
}

/**
 * Implantação (C05-B5.7): as duas listas que o banco já calcula (pendências e divergências) e a
 * contagem dos apontamentos legados. Só leitura, admin; erro nunca vira "lista vazia".
 */
export const CHAVE_DA_IMPLANTACAO = ["vigencias-implantacao"] as const;

export function useImplantacaoDasVigencias() {
  return useQuery({
    queryKey: CHAVE_DA_IMPLANTACAO,
    staleTime: 10_000,
    retry: 1,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const db = cliente();
      const [pend, div, legados] = await Promise.all([
        db.rpc(RPC_VIGENCIAS.motor.pendencias),
        db.rpc(RPC_VIGENCIAS.motor.divergencias),
        db
          .from("timesheet_entries")
          .select("id", { count: "exact", head: true })
          .is("terms_origin", null)
          .neq("status", "absent"),
      ]);
      if (pend.error) throw pend.error;
      if (div.error) throw div.error;
      const pendencias = lerPendencias(pend.data);
      const divergencias = lerDivergencias(div.data);
      if (pendencias === null || divergencias === null) {
        throw new Error("Resposta inválida da implantação das vigências.");
      }
      return { pendencias, divergencias, legados: legados.error ? null : (legados.count ?? 0) };
    },
  });
}
