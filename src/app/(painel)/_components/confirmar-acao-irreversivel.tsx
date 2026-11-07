import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirmação explícita antes de uma ação que não se desfaz pela interface (emitir fatura,
 * excluir cadastro). Só `onConfirmar` executa a ação; Cancelar, Esc e clique fora apenas fecham.
 * Não substitui nenhuma validação: quem decide se a ação é permitida continua sendo o banco.
 */
export function ConfirmarAcaoIrreversivel({
  open,
  onOpenChange,
  titulo,
  descricao,
  rotuloConfirmar,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descricao: ReactNode;
  rotuloConfirmar: string;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmar}>{rotuloConfirmar}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
