import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, unknown>;

/** Insert (sem id) ou update (com id) genérico em qualquer tabela. */
export function useSaveRow(table: string, invalidate: string[] = [table]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: Row) => {
      const { id, ...rest } = row as { id?: string };
      const query = id
        ? supabase
            .from(table as never)
            .update(rest as never)
            .eq("id", id)
        : supabase.from(table as never).insert(rest as never);
      const { error } = await query;
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
      const { error } = await supabase
        .from(table as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success("Registro removido.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
