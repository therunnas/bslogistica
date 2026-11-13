"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

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
import { mensagemDaExclusao } from "@/lib/confirmar-exclusao";

interface Pedido {
  oQue: string;
  consequencias: string;
  aoConfirmar: () => void;
}

/**
 * D8 (QA-BS-01, CP-09): confirmação de exclusão pela tela, no lugar do `window.confirm` nativo — o
 * mesmo padrão de diálogo da emissão da fatura. Diz o que será removido e o que some junto; o foco
 * começa em "Cancelar" (Enter sem querer não apaga). O banco continua recusando o que tem lançamento
 * vinculado: este diálogo não libera nenhuma exclusão antes bloqueada.
 *
 * Uso: `const confirmacao = useConfirmacaoDeExclusao();` → `confirmacao.pedir(oQue, consequencias,
 * () => remover.mutate(id))` e `{confirmacao.dialogo}` uma vez no JSX da tela.
 */
export function useConfirmacaoDeExclusao(): {
  pedir: (oQue: string, consequencias: string, aoConfirmar: () => void) => void;
  dialogo: ReactNode;
} {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);

  const pedir = useCallback((oQue: string, consequencias: string, aoConfirmar: () => void) => {
    setPedido({ oQue, consequencias, aoConfirmar });
  }, []);

  const mensagem = pedido ? mensagemDaExclusao(pedido.oQue, pedido.consequencias) : null;

  const dialogo = (
    <AlertDialog
      open={pedido !== null}
      onOpenChange={(aberto) => {
        if (!aberto) setPedido(null);
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          cancelarRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{mensagem?.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{mensagem?.descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelarRef}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              const atual = pedido;
              setPedido(null);
              atual?.aoConfirmar();
            }}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pedir, dialogo };
}
