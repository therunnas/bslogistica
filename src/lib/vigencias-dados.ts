import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";
import { RPC_VIGENCIAS } from "@/lib/vigencias";
import {
  interpretarEstadoDoMotor,
  montarRegistro,
  PARAM_DO_ID,
  type EstadoDoMotorUI,
  type FormularioDeVigencia,
  type TermoDeContrato,
  type TermoDeCusto,
  type TermoDeOperacao,
  type TipoDeVigencia,
  type VersaoBase,
} from "@/lib/vigencias-ui";

/**
 * Camada de dados das condições financeiras versionadas (C05-B4.6).
 *
 * As tabelas de versões e as RPCs desta migration ainda não estão em `types.ts` (gerado), por
 * isso as chamadas passam por um tipo mínimo local. Tudo aqui é leitura ou RPC de administrador
 * (AAL2): quem não é admin recebe `42501` do banco, e a tela nem chega a este ponto (o painel
 * é protegido pelo guard). Nenhuma escrita direta em tabela de versões.
 */

interface ErroPostgrest {
  code?: string;
  message?: string;
}

interface Resposta<T> {
  data: T | null;
  error: ErroPostgrest | null;
}

interface ClienteMinimo {
  rpc(nome: string, parametros?: Record<string, unknown>): PromiseLike<Resposta<unknown>>;
  from(tabela: string): {
    select(colunas: string): {
      eq(
        coluna: string,
        valor: unknown,
      ): { eq(coluna: string, valor: unknown): PromiseLike<Resposta<unknown[]>> } & PromiseLike<
        Resposta<unknown[]>
      >;
      in(
        coluna: string,
        valores: readonly string[],
      ): { eq(coluna: string, valor: unknown): PromiseLike<Resposta<unknown[]>> };
    };
    insert(linha: Record<string, unknown>): {
      select(colunas: string): { single(): PromiseLike<Resposta<{ id: string }>> };
    };
  };
}

const cliente = () => criarClienteNavegador() as unknown as ClienteMinimo;

const TABELA_DE_VERSOES: Readonly<Record<TipoDeVigencia, { tabela: string; chave: string }>> = {
  contrato: { tabela: "contract_terms", chave: "contract_id" },
  colaborador: { tabela: "employee_cost_terms", chave: "employee_id" },
  operacao: { tabela: "operation_terms", chave: "operation_id" },
};

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

export function useVersoes<T extends VersaoBase>(tipo: TipoDeVigencia, entidadeId: string | null) {
  const alvo = TABELA_DE_VERSOES[tipo];
  return useQuery({
    queryKey: ["vigencias", tipo, entidadeId],
    enabled: Boolean(entidadeId),
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await cliente()
        .from(alvo.tabela)
        .select("*")
        .eq(alvo.chave, entidadeId as string);
      if (error) throw error;
      return ((data ?? []) as T[])
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
      return (data ?? []) as TermoDeContrato[];
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
      return (data ?? []) as TermoDeOperacao[];
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
      return (data ?? []) as (TermoDeCusto & { employee_id: string })[];
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

async function chamar(rpc: string, params: Record<string, unknown>) {
  const { error } = await cliente().rpc(rpc, params);
  if (error) throw error;
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
 * Cadastro novo com o motor LIGADO: grava a entidade e, em seguida, a vigência inicial. Os dois
 * passos não são atômicos: se o segundo falhar, a entidade existe sem vigência (aparece nas
 * pendências do motor) e o erro diz isso. Nada de valor financeiro é inferido.
 */
export function useCriarComVigencia(
  tipo: TipoDeVigencia,
  tabela: "contracts" | "employees" | "operations",
  invalidar: string[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { linha: Record<string, unknown>; form: FormularioDeVigencia }) => {
      const { rpc, params } = montarRegistro(tipo, "pendente", v.form); // valida antes de gravar a entidade
      const criada = await cliente().from(tabela).insert(v.linha).select("id").single();
      if (criada.error) throw criada.error;
      const id = criada.data?.id;
      if (!id) throw new Error("Não foi possível confirmar o cadastro criado.");
      try {
        await chamar(rpc, { ...params, [PARAM_DO_ID[tipo]]: id });
      } catch (erro) {
        throw new Error(
          `O cadastro foi criado, mas a vigência inicial não foi registrada: ${erro instanceof Error ? erro.message : mensagemDoErro(erro)} Registre a vigência no histórico antes de usar este cadastro.`,
        );
      }
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
