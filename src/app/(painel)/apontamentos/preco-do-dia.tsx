"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  resumoDoDia,
  TEXTO_DO_BONUS,
  validarBonus,
  type ApontamentoParaResumo,
} from "@/lib/diaria-individual";
import { useDefinirBonus } from "@/lib/diaria-individual-dados";
import { brl } from "@/lib/format";

/**
 * Preço do dia no apontamento (FIN-PR-08). Mostra os componentes como o banco os gravou — diária
 * aplicada e de onde veio, hora extra, adicional diário e total cobrado — sem calcular nada. O
 * adicional diário é um valor extra e eventual; ele não aumenta a base da hora extra.
 */

export interface PrecoDoApontamentoProps {
  apontamento: ApontamentoParaResumo;
  /** Pode definir/alterar o adicional diário agora (a pré-checagem da lib já passou). */
  podeDefinirAdicional: boolean;
  onDefinirAdicional: () => void;
}

export function PrecoDoApontamento({
  apontamento,
  podeDefinirAdicional,
  onDefinirAdicional,
}: PrecoDoApontamentoProps) {
  const r = resumoDoDia(apontamento);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        Diária de referência: {brl(r.diaria)} · {r.fonte}
      </span>
      {r.especial > 0 ? <span>Horas especiais: {brl(r.especial)}</span> : null}
      {r.horaExtra > 0 ? <span>Hora extra: {brl(r.horaExtra)}</span> : null}
      {r.adicional > 0 ? <span>Adicional diário: {brl(r.adicional)}</span> : null}
      <span className="font-medium text-foreground">Total cobrado: {brl(r.total)}</span>
      {podeDefinirAdicional ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onDefinirAdicional}
        >
          {r.adicional > 0 ? "Alterar adicional" : "Adicional diário"}
        </Button>
      ) : null}
    </div>
  );
}

export interface AdicionalDiarioDialogProps {
  entrada: { id: string; colaborador: string; adicionalAtual: number } | null;
  aoFechar: () => void;
}

export function AdicionalDiarioDialog({ entrada, aoFechar }: AdicionalDiarioDialogProps) {
  const definir = useDefinirBonus();
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [substituir, setSubstituir] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  // Reinicia o formulário a cada apontamento aberto.
  if (entrada !== null && aberta !== entrada.id) {
    setAberta(entrada.id);
    setValor("");
    setMotivo("");
    setSubstituir(false);
  }
  if (entrada === null && aberta !== null) setAberta(null);

  const jaTem = entrada !== null && entrada.adicionalAtual > 0;
  const erros = entrada ? validarBonus({ entryId: entrada.id, valor, motivo }) : [];
  const precisaConfirmar = jaTem && !substituir;

  return (
    <Dialog open={entrada !== null} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicional diário</DialogTitle>
          <DialogDescription>
            {entrada?.colaborador}. {TEXTO_DO_BONUS} Só vale para apontamento ainda não faturado e
            fica na trilha.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {jaTem ? (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
              <p className="text-sm">
                Este dia já tem adicional de <strong>{brl(entrada.adicionalAtual)}</strong>. O novo
                valor <strong>substitui</strong> o atual (não soma). Use 0 para remover.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="adicional-substituir"
                  checked={substituir}
                  onCheckedChange={(v) => setSubstituir(Boolean(v))}
                />
                <Label htmlFor="adicional-substituir" className="cursor-pointer text-sm">
                  Confirmo a substituição
                </Label>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="adicional-valor">Valor do adicional (R$)</Label>
            <Input
              id="adicional-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Ex.: 30,00"
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adicional-motivo">Motivo (obrigatório)</Label>
            <Textarea
              id="adicional-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="rounded-xl"
            />
          </div>
          {(valor.trim() !== "" || motivo.trim() !== "") && erros.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {erros.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-xl" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={erros.length > 0 || precisaConfirmar || definir.isPending || entrada === null}
            onClick={() =>
              entrada &&
              definir.mutate(
                {
                  formulario: { entryId: entrada.id, valor, motivo },
                  substituir: jaTem && substituir,
                },
                { onSuccess: aoFechar },
              )
            }
          >
            Salvar adicional
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
