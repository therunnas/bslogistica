import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { RPC_FUNCOES, type FuncaoDoCatalogo } from "@/lib/funcoes";
import { toast } from "@/lib/notificacoes";

/**
 * Camada de dados do catálogo de funções (migration 039). Leitura direta (RLS: admin) e escrita só
 * pelas RPCs; o banco recusa qualquer escrita direta na tabela. Só consulta com o anúncio do banco
 * (`funcoes_turno`): sem a 039 a tabela não existe.
 */

const cliente = () => criarClienteNavegador();

export const CHAVE_DAS_FUNCOES = ["job_functions"] as const;

/** Catálogo completo (poucas linhas), ativas e inativas, em ordem alfabética. */
export function useFuncoes(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVE_DAS_FUNCOES,
    enabled: habilitado,
    queryFn: async (): Promise<FuncaoDoCatalogo[]> => {
      const { data, error } = await cliente()
        .from("job_functions")
        .select("id, code, name, active, created_at, updated_at")
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

function aoSalvar(queryClient: ReturnType<typeof useQueryClient>, mensagem: string) {
  void queryClient.invalidateQueries({ queryKey: CHAVE_DAS_FUNCOES });
  // A função aparece em colaboradores e equipes: relê o que a mostra.
  void queryClient.invalidateQueries({ queryKey: ["employees"] });
  void queryClient.invalidateQueries({ queryKey: ["operation_team"] });
  toast.success(mensagem);
}

const aoFalhar = (erro: unknown) =>
  toast.error(erro instanceof Error ? erro.message : mensagemDoErro(erro));

export function useCriarFuncao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await cliente().rpc(RPC_FUNCOES.criar, { p_name: nome.trim() });
      if (error) throw error;
    },
    onSuccess: () => aoSalvar(queryClient, "Função cadastrada."),
    onError: aoFalhar,
  });
}

export function useRenomearFuncao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; nome: string }) => {
      const { error } = await cliente().rpc(RPC_FUNCOES.renomear, {
        p_id: v.id,
        p_name: v.nome.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => aoSalvar(queryClient, "Função renomeada."),
    onError: aoFalhar,
  });
}

export function useAlterarSituacaoDaFuncao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; ativa: boolean }) => {
      const { error } = await cliente().rpc(RPC_FUNCOES.situacao, {
        p_id: v.id,
        p_active: v.ativa,
      });
      if (error) throw error;
      return v.ativa;
    },
    onSuccess: (ativa) => aoSalvar(queryClient, ativa ? "Função reativada." : "Função inativada."),
    onError: aoFalhar,
  });
}

/** Liga os colaboradores sem função cujo cargo, normalizado, é IGUAL ao nome de uma função ativa. */
export function useVincularFuncoesExatas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await cliente().rpc(RPC_FUNCOES.vincular);
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(
        n === 0
          ? "Nenhuma correspondência exata para vincular."
          : n === 1
            ? "1 colaborador vinculado."
            : `${n} colaboradores vinculados.`,
      );
    },
    onError: aoFalhar,
  });
}
