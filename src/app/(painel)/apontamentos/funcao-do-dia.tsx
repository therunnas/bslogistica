"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  nomeDaFuncao,
  opcoesDeFuncao,
  ROTULO_DO_PERIODO,
  SEM_FUNCAO,
  type FuncaoDoCatalogo,
  type PeriodoDoTurno,
} from "@/lib/funcoes";
import { pendenteDeClassificacao } from "@/lib/tarifas";
import { useCorrigirSnapshotsDoApontamento } from "@/lib/tarifas-dados";

/**
 * Função trabalhada no dia (FIN-PR-07). Na linha NOVA o administrador confere a função (sugestão: a
 * da alocação; sem ela, a padrão do colaborador) e ela é gravada como snapshot do lançamento. Na
 * linha GRAVADA o snapshot só se mostra e, se o apontamento ainda não foi faturado, se corrige com
 * motivo e trilha. Nada aqui calcula preço.
 */

export interface SeletorDeFuncaoDoDiaProps {
  catalogo: readonly FuncaoDoCatalogo[];
  /** Função escolhida (vazio = sem função). */
  valor: string;
  onChange: (funcaoId: string) => void;
  periodo: PeriodoDoTurno | null;
  /** Com a resolução por função ligada, faltar função ou período recusa o apontamento. */
  resolucaoLigada: boolean;
  nomeDoColaborador: string;
}

export function SeletorDeFuncaoDoDia({
  catalogo,
  valor,
  onChange,
  periodo,
  resolucaoLigada,
  nomeDoColaborador,
}: SeletorDeFuncaoDoDiaProps) {
  const pendente = pendenteDeClassificacao(
    { job_function_id_snapshot: valor === "" ? null : valor, shift_period_snapshot: periodo },
    resolucaoLigada,
  );
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={valor === "" ? SEM_FUNCAO : valor}
          onValueChange={(v) => onChange(v === SEM_FUNCAO ? "" : v)}
        >
          <SelectTrigger
            className="h-8 w-52 rounded-lg text-xs"
            aria-label={`Função de ${nomeDoColaborador} neste dia`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_FUNCAO}>Sem função</SelectItem>
            {opcoesDeFuncao(catalogo, valor === "" ? null : valor).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {periodo ? (
          <Badge variant="secondary">Turno {ROTULO_DO_PERIODO[periodo].toLowerCase()}</Badge>
        ) : (
          <Badge variant="outline">Turno sem classificação</Badge>
        )}
      </div>
      {pendente.funcao || pendente.periodo ? (
        <p className="text-xs text-destructive">
          {pendente.funcao
            ? "Sem função: com as tarifas por função ligadas este apontamento será recusado."
            : "Turno sem período: classifique o turno em Operações antes de apontar."}
        </p>
      ) : null}
    </div>
  );
}

export interface SnapshotDoApontamentoProps {
  catalogo: readonly FuncaoDoCatalogo[];
  funcaoId: string | null;
  periodo: string | null;
  origem: string | null;
  resolucaoLigada: boolean;
  /** Apontamento não faturado e com presença: pode ser corrigido. */
  corrigivel: boolean;
  onCorrigir: () => void;
}

const ROTULO_DA_ORIGEM: Readonly<Record<string, string>> = {
  alocacao: "da alocação",
  informada: "informada no apontamento",
  corrigida: "corrigida",
};

export function SnapshotDoApontamento({
  catalogo,
  funcaoId,
  periodo,
  origem,
  resolucaoLigada,
  corrigivel,
  onCorrigir,
}: SnapshotDoApontamentoProps) {
  const pendente = pendenteDeClassificacao(
    { job_function_id_snapshot: funcaoId, shift_period_snapshot: periodo },
    resolucaoLigada,
  );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        Função do dia: {funcaoId ? nomeDaFuncao(catalogo, funcaoId) : "não registrada"}
        {origem ? ` (${ROTULO_DA_ORIGEM[origem] ?? origem})` : ""}
        {periodo === "diurno" || periodo === "noturno"
          ? ` · turno ${ROTULO_DO_PERIODO[periodo].toLowerCase()}`
          : " · turno sem classificação"}
      </span>
      {pendente.funcao || pendente.periodo ? <Badge variant="destructive">Pendente</Badge> : null}
      {corrigivel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onCorrigir}
        >
          Corrigir
        </Button>
      ) : null}
    </div>
  );
}

export interface CorrigirApontamentoProps {
  entrada: { id: string; colaborador: string; funcaoId: string | null } | null;
  aoFechar: () => void;
  catalogo: readonly FuncaoDoCatalogo[];
}

export function CorrigirApontamentoDialog({
  entrada,
  aoFechar,
  catalogo,
}: CorrigirApontamentoProps) {
  const corrigir = useCorrigirSnapshotsDoApontamento();
  const [funcaoId, setFuncaoId] = useState("");
  const [periodo, setPeriodo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);

  // Reinicia o formulário a cada apontamento aberto.
  if (entrada !== null && aberta !== entrada.id) {
    setAberta(entrada.id);
    setFuncaoId(entrada.funcaoId ?? "");
    setPeriodo(false);
    setMotivo("");
  }
  if (entrada === null && aberta !== null) setAberta(null);

  const mudouFuncao = entrada !== null && funcaoId !== "" && funcaoId !== (entrada.funcaoId ?? "");
  const nada = !mudouFuncao && !periodo;

  return (
    <Dialog open={entrada !== null} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir função do dia</DialogTitle>
          <DialogDescription>
            {entrada?.colaborador}. Só vale para apontamento ainda não faturado, fica na trilha e,
            com as tarifas por função ligadas, o valor do dia é recalculado pela combinação
            corrigida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="corrigir-funcao">Função trabalhada neste dia</Label>
            <Select
              value={funcaoId === "" ? SEM_FUNCAO : funcaoId}
              onValueChange={(v) => setFuncaoId(v === SEM_FUNCAO ? "" : v)}
            >
              <SelectTrigger id="corrigir-funcao" className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_FUNCAO} disabled>
                  Escolha a função
                </SelectItem>
                {opcoesDeFuncao(catalogo, entrada?.funcaoId ?? null).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="corrigir-periodo"
              checked={periodo}
              onCheckedChange={(v) => setPeriodo(Boolean(v))}
            />
            <Label htmlFor="corrigir-periodo" className="cursor-pointer text-sm">
              Atualizar o período pelo turno (já classificado)
            </Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="corrigir-motivo">Motivo (obrigatório)</Label>
            <Textarea
              id="corrigir-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="rounded-xl"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-xl" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={nada || motivo.trim() === "" || corrigir.isPending || entrada === null}
            onClick={() =>
              entrada &&
              corrigir.mutate(
                {
                  entryId: entrada.id,
                  funcaoId: mudouFuncao ? funcaoId : null,
                  atualizarPeriodo: periodo,
                  motivo,
                },
                { onSuccess: aoFechar },
              )
            }
          >
            Corrigir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
