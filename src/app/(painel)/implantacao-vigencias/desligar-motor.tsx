"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FRASE_DE_REVERSAO,
  MENSAGEM_REVERSAO_DESABILITADA,
  MOTIVO_MAXIMO,
  validarEntradaDeReversao,
} from "@/lib/ativacao-motor";
import { CHAVE_DA_IMPLANTACAO, CHAVE_DO_MOTOR } from "@/lib/vigencias-dados";
import { desligarMotorAction } from "./_acoes";

/**
 * Controle de reversão do motor por vigência (RB-01). Só é montado com o motor comprovadamente
 * LIGADO (`AtivarMotor` o renderiza no ramo "ligado").
 *
 * Não desliga nada ao carregar: só o clique de confirmação, com motivo e a frase exata, dispara a
 * Server Action. Quem decide é o servidor (admin em AAL2, trava própria da reversão) e o banco.
 * Esta tela só pede e mostra o resultado real, e relê o estado em qualquer desfecho.
 */
export function DesligarMotor({ habilitada }: { habilitada: boolean }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);

  const desligar = useMutation({
    mutationFn: (entrada: { motivo: string; confirmacao: string }) => desligarMotorAction(entrada),
    onSuccess: (r) => {
      if (r.ok) {
        setAberto(false);
        setRecusa(null);
      } else {
        setRecusa(r.mensagem);
      }
      // Em qualquer desfecho a tela relê o estado real, em vez de presumir.
      void queryClient.invalidateQueries({ queryKey: CHAVE_DO_MOTOR });
      void queryClient.invalidateQueries({ queryKey: CHAVE_DA_IMPLANTACAO });
      void queryClient.invalidateQueries({ queryKey: ["vigencias"] });
    },
    onError: () => {
      setRecusa(
        "Não foi possível concluir o desligamento. Confira o estado do motor antes de tentar de novo.",
      );
      void queryClient.invalidateQueries({ queryKey: CHAVE_DO_MOTOR });
    },
  });

  const entrada = validarEntradaDeReversao({ motivo, confirmacao });

  function fechar(abrir: boolean) {
    if (desligar.isPending) return;
    setAberto(abrir);
    if (!abrir) {
      setMotivo("");
      setConfirmacao("");
      setRecusa(null);
    }
  }

  // Janela de reversão fechada (padrão): nem botão nem diálogo. A Server Action também recusa.
  if (!habilitada) {
    return (
      <Alert className="mb-6">
        <AlertTitle>Desligar o motor: desabilitado neste ambiente</AlertTitle>
        <AlertDescription>{MENSAGEM_REVERSAO_DESABILITADA}</AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="mb-8 rounded-lg border border-destructive/40 p-4">
      <h2 className="mb-1 text-base font-semibold">Desligar o motor por vigência</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Volta ao cálculo pelas taxas do cadastro: as colunas de taxa são ressincronizadas com a
        vigência de hoje e as travas de edição direta são desfeitas. Apontamentos já precificados
        mantêm os valores gravados; os próximos passam a usar o cálculo antigo, sem as regras das
        migrations 029 e 030. Exige administrador com segundo fator, motivo e confirmação.
      </p>
      <Button type="button" variant="destructive" onClick={() => fechar(true)}>
        Desligar o motor…
      </Button>

      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar o desligamento do motor</DialogTitle>
            <DialogDescription>
              Esta ação é registrada com o seu usuário e o motivo, e pode ser desfeita ligando o
              motor de novo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reversao-motivo">Motivo (obrigatório)</Label>
              <Textarea
                id="reversao-motivo"
                value={motivo}
                maxLength={MOTIVO_MAXIMO}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={desligar.isPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reversao-confirmacao">
                Digite {FRASE_DE_REVERSAO} para confirmar
              </Label>
              <Input
                id="reversao-confirmacao"
                value={confirmacao}
                autoComplete="off"
                onChange={(e) => setConfirmacao(e.target.value)}
                disabled={desligar.isPending}
              />
            </div>
            {recusa && (
              <Alert variant="destructive">
                <AlertTitle>O desligamento não foi feito</AlertTitle>
                <AlertDescription>{recusa}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={desligar.isPending}
              onClick={() => fechar(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!entrada.ok || desligar.isPending}
              onClick={() => {
                if (!entrada.ok) return;
                setRecusa(null);
                desligar.mutate({ motivo, confirmacao });
              }}
            >
              {desligar.isPending ? "Desligando…" : "Desligar o motor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
