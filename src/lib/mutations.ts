import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notificacoes";
import { criarClienteNavegador } from "@/integrations/supabase/browser";

type Row = Record<string, unknown>;

/**
 * Um UPDATE ou DELETE recusado pela RLS não levanta erro: a cláusula USING
 * remove a linha do conjunto alvo e o comando termina com sucesso afetando zero
 * linhas. O mesmo acontece com um id inexistente. Sem conferir a contagem, a
 * tela confirmaria "Registro salvo." sem ter salvo nada.
 *
 * `count === 0` explicitamente, e não `!count`: `null` significa "não medido",
 * e tratá-lo como zero quebraria qualquer chamada que não peça a contagem.
 *
 * A mensagem não distingue "não existe" de "sem permissão" de propósito —
 * separar os dois revelaria a existência de registros que o usuário não pode
 * enxergar.
 */
export function exigirLinhaAfetada(count: number | null, acao: string) {
  if (count === 0) {
    throw new Error(
      `Não foi possível ${acao}. O registro não existe ou você não tem permissão para alterá-lo.`,
    );
  }
}

/** Insert (sem id) ou update (com id) genérico em qualquer tabela. */
export function useSaveRow(table: string, invalidate: string[] = [table]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: Row) => {
      const { id, ...rest } = row as { id?: string };
      if (id) {
        const { error, count } = await criarClienteNavegador()
          .from(table as never)
          .update(rest as never, { count: "exact" })
          .eq("id", id);
        if (error) throw error;
        exigirLinhaAfetada(count, "salvar o registro");
        return;
      }
      // INSERT não precisa da contagem: quando a RLS recusa, a WITH CHECK é
      // violada e o Postgres levanta 42501.
      const { error } = await criarClienteNavegador()
        .from(table as never)
        .insert(rest as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success("Registro salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteRow(table: string, invalidate: string[] = [table]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, count } = await criarClienteNavegador()
        .from(table as never)
        .delete({ count: "exact" })
        .eq("id", id);
      if (error) throw error;
      exigirLinhaAfetada(count, "remover o registro");
    },
    onSuccess: () => {
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success("Registro removido.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
