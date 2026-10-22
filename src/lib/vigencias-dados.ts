import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";
import { RPC_VIGENCIAS } from "@/lib/vigencias";
import { lerDivergencias, lerPendencias } from "@/lib/vigencias-implantacao";
import {
  interpretarEstadoDoMotor,
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
 * das migrations 021 a 026). Tudo aqui é leitura ou RPC de administrador (AAL2): quem não é admin
 * recebe `42501` do banco, e a tela nem chega a este ponto (o painel é protegido pelo guard).
 * Nenhuma escrita direta em tabela de versões.
 */

const cliente = () => criarClienteNavegador();

/** Versão de qualquer fonte de preço: os campos comuns tipados, os valores lidos por chave. */
export type VersaoDeVigencia = VersaoBase & Record<string, unknown>;

export const CHAVE_DO_MOTOR = ["motor-estado"] as const;

/**
 * Estado do motor. Erro técnico, permissão negada, resposta inválida ou gatilhos inconsistentes
 * viram `desconhecido` — nunca `desligado`. Relê ao voltar para a janela, para que a tela não
 * fique presa a um estado antigo depois de o motor ser ligado ou desligado.
 */
export function useEstadoDoMotor(): EstadoDoMotorUI {
  const consulta = useQuery({
    queryKey: CHAVE_DO_MOTOR,
    queryFn: async () => {
      const { data, error } = await cliente().rpc(RPC_VIGENCIAS.motor.estado);
      return { data, error };
    },
    staleTime: 10_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  if (consulta.isError) return interpretarEstadoDoMotor(null, consulta.error ?? { code: "?" });
  if (!consulta.data) return { tag: "carregando" };
  return interpretarEstadoDoMotor(consulta.data.data, consulta.data.error);
}

export function useVersoes(tipo: TipoDeVigencia, entidadeId: string | null) {
  return useQuery({
    queryKey: ["vigencias", tipo, entidadeId],
    enabled: Boolean(entidadeId),
    queryFn: async (): Promise<VersaoDeVigencia[]> => {
      const id = entidadeId as string;
      const db = cliente();
      const { data, error } =
        tipo === "contrato"
          ? await db.from("contract_terms").select("*").eq("contract_id", id)
          : tipo === "colaborador"
            ? await db.from("employee_cost_terms").select("*").eq("employee_id", id)
            : await db.from("operation_terms").select("*").eq("operation_id", id);
      if (error) throw error;
      return (data ?? [])
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
    queryFn: async () => {
      const { data, error } = await cliente()
        .from("contract_terms")
        .select("*")
        .eq("contract_id", p.contratoId as string)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const operacao = useQuery({
    queryKey: ["vigencias", "operacao", p.operacaoId],
    enabled: ativo && Boolean(p.operacaoId),
    queryFn: async () => {
      const { data, error } = await cliente()
        .from("operation_terms")
        .select("*")
        .eq("operation_id", p.operacaoId as string)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const chaveColaboradores = [...p.colaboradores].sort().join(",");
  const custos = useQuery({
    queryKey: ["vigencias", "custos", chaveColaboradores],
    enabled: ativo && p.colaboradores.length > 0,
    queryFn: async () => {
      const { data, error } = await cliente()
        .from("employee_cost_terms")
        .select("*")
        .in("employee_id", p.colaboradores)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
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
 * contagem dos apontamentos legados. Só leitura, admin AAL2; erro nunca vira "lista vazia".
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
