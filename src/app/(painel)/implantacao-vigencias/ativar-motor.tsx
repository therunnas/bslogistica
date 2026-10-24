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
  FRASE_DE_CONFIRMACAO,
  MOTIVO_MAXIMO,
  validarEntradaDeAtivacao,
  type ResultadoDaAtivacao,
} from "@/lib/ativacao-motor";
import { CHAVE_DA_IMPLANTACAO, CHAVE_DO_MOTOR, useEstadoDoMotor } from "@/lib/vigencias-dados";
import { ligarMotorAction } from "./_acoes";

/**
 * Controle de ativação do motor por vigência (C05-B8.6).
 *
 * Não liga nada ao carregar: só o clique de confirmação, com motivo e a frase exata, dispara a
 * Server Action. Quem decide é o servidor (admin em AAL2) e o banco; esta tela só pede e mostra o
 * resultado real. Não existe botão de desligar, e nunca se aceita pendência.
 */
export function AtivarMotor({ semBloqueios }: { semBloqueios: boolean }) {
  const estado = useEstadoDoMotor();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Extract<ResultadoDaAtivacao, { ok: true }> | null>(
    null,
  );

  const ativar = useMutation({
    mutationFn: (entrada: { motivo: string; confirmacao: string }) => ligarMotorAction(entrada),
    onSuccess: (r) => {
      if (r.ok) {
        setResultado(r);
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
        "Não foi possível concluir a ativação. Confira o estado do motor antes de tentar de novo.",
      );
      void queryClient.invalidateQueries({ queryKey: CHAVE_DO_MOTOR });
    },
  });

  const entrada = validarEntradaDeAtivacao({ motivo, confirmacao });

  function fechar(abrir: boolean) {
    if (ativar.isPending) return;
    setAberto(abrir);
    if (!abrir) {
      setMotivo("");
      setConfirmacao("");
      setRecusa(null);
    }
  }

  if (resultado) {
    return (
      <Alert className="mb-6">
        <AlertTitle>Motor por vigência ligado</AlertTitle>
        <AlertDescription>
          O banco confirmou a ativação
          {resultado.ativadaEm ? ` em ${resultado.ativadaEm}` : ""} com {resultado.pendencias}{" "}
          pendência(s). A ativação ficou registrada na trilha. Esta tela não desliga o motor.
        </AlertDescription>
      </Alert>
    );
  }

  if (estado.tag === "carregando") {
    return <p className="mb-6 text-sm text-muted-foreground">Verificando o estado do motor…</p>;
  }

  if (estado.tag === "ligado") {
    return (
      <Alert className="mb-6">
        <AlertTitle>Motor por vigência ligado</AlertTitle>
        <AlertDescription>
          {estado.ativadaEm ? `Ligado em ${estado.ativadaEm}. ` : ""}
          Cada apontamento novo usa as vigências cadastradas; sem vigência na data, o apontamento é
          recusado.
        </AlertDescription>
      </Alert>
    );
  }

  if (estado.tag === "desconhecido") {
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertTitle>Estado do motor desconhecido</AlertTitle>
        <AlertDescription>{estado.motivo} Não é seguro ligar nesta situação.</AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="mb-8 rounded-lg border p-4">
      <h2 className="mb-1 text-base font-semibold">Ligar o motor por vigência</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Hoje os cálculos usam as taxas do cadastro. Ligado, cada apontamento passa a fixar os preços
        da vigência da data trabalhada, as taxas deixam de ser editadas direto no cadastro e apontar
        sem vigência na data é recusado. Exige administrador com segundo fator, motivo e
        confirmação. Nunca aceita pendências.
      </p>
      {!semBloqueios && (
        <p className="mb-3 text-sm text-muted-foreground">
          Indisponível enquanto houver cadastro sem vigência ou divergência.
        </p>
      )}
      <Button type="button" disabled={!semBloqueios} onClick={() => fechar(true)}>
        Ligar o motor…
      </Button>

      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar a ativação do motor</DialogTitle>
            <DialogDescription>
              Esta ação é registrada com o seu usuário e o motivo. Desligar depois exige
              procedimento próprio, fora desta tela.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="motor-motivo">Motivo (obrigatório)</Label>
              <Textarea
                id="motor-motivo"
                value={motivo}
                maxLength={MOTIVO_MAXIMO}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={ativar.isPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="motor-confirmacao">
                Digite {FRASE_DE_CONFIRMACAO} para confirmar
              </Label>
              <Input
                id="motor-confirmacao"
                value={confirmacao}
                autoComplete="off"
                onChange={(e) => setConfirmacao(e.target.value)}
                disabled={ativar.isPending}
              />
            </div>
            {recusa && (
              <Alert variant="destructive">
                <AlertTitle>A ativação não foi feita</AlertTitle>
                <AlertDescription>{recusa}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={ativar.isPending}
              onClick={() => fechar(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!entrada.ok || ativar.isPending}
              onClick={() => {
                if (!entrada.ok) return;
                setRecusa(null);
                ativar.mutate({ motivo, confirmacao });
              }}
            >
              {ativar.isPending ? "Ligando…" : "Ligar o motor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
