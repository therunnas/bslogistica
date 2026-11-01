"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  montarQuadroDeDiarias,
  rotuloDaVigenciaIndividual,
  validarDiariaIndividual,
  type DiariaIndividual,
} from "@/lib/diaria-individual";
import { useDiariasDoContrato, useRegistrarDiariaIndividual } from "@/lib/diaria-individual-dados";
import { brl } from "@/lib/format";
import { dataBr } from "@/lib/tarifas";
import { hojeEmSaoPaulo } from "@/lib/vigencias-ui";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

export interface DiariasIndividuaisProps {
  contratoId: string;
  colaboradores: readonly { id: string; name: string }[];
  /** A resolução por função e período está ligada? `null` = a leitura do estado falhou. */
  resolucaoLigada: boolean | null;
}

/**
 * Diária individual do colaborador neste contrato (migration 042). É o preço cobrado do CLIENTE por
 * um colaborador específico (nunca o custo pago a ele) e, quando existe e a resolução está ligada,
 * vale no lugar da tarifa da função e do período. Mudança comercial cria uma versão nova com data de
 * início; as faturas já emitidas não mudam. Sem diária individual aparece o texto de que vale a
 * tarifa da função — nunca um valor padrão inventado.
 */
export function DiariasIndividuais({
  contratoId,
  colaboradores,
  resolucaoLigada,
}: DiariasIndividuaisProps) {
  const consulta = useDiariasDoContrato(contratoId, true);
  const registrar = useRegistrarDiariaIndividual();
  const hoje = hojeEmSaoPaulo();

  const dados = consulta.data;
  const lista: readonly DiariaIndividual[] = useMemo(() => dados ?? [], [dados]);
  const quadro = useMemo(() => montarQuadroDeDiarias(lista, hoje), [lista, hoje]);
  const nomes = useMemo(() => new Map(colaboradores.map((c) => [c.id, c.name])), [colaboradores]);
  const linhas = useMemo(
    () =>
      [...quadro].sort((a, b) =>
        (nomes.get(a.colaboradorId) ?? "").localeCompare(nomes.get(b.colaboradorId) ?? "", "pt-BR"),
      ),
    [quadro, nomes],
  );

  const [aberto, setAberto] = useState(false);
  const [colaboradorId, setColaboradorId] = useState("");
  const [inicio, setInicio] = useState(hoje);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");

  const erros = aberto
    ? validarDiariaIndividual({ contratoId, colaboradorId, inicio, valor, motivo })
    : [];

  function abrir(id: string) {
    setColaboradorId(id);
    setInicio(hoje);
    setValor("");
    setMotivo("");
    setAberto(true);
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-labelledby="diarias-individuais"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="diarias-individuais" className="text-sm font-semibold">
            Diária individual por colaborador
          </h3>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Valor cobrado do cliente por este colaborador, neste contrato. Quando existe, vale no
            lugar da tarifa da função e do período. Sem diária individual, vale a tarifa da função.
            Não é o custo do colaborador.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => abrir("")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Nova diária individual
        </Button>
      </div>

      {resolucaoLigada === false ? (
        <p className="text-xs text-muted-foreground">
          Enquanto o preço por função e período estiver desligado, cadastrar diária individual não
          muda nenhum valor.
        </p>
      ) : null}

      {consulta.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar as diárias individuais.
        </p>
      ) : consulta.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando diárias individuais…</p>
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma diária individual neste contrato. Todos os colaboradores seguem a tarifa da função
          e do período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                <TableHead>Colaborador</TableHead>
                <TableHead>Diária cobrada</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.colaboradorId} className="border-border">
                  <TableCell className="align-top text-sm font-medium">
                    {nomes.get(l.colaboradorId) ?? "Colaborador removido"}
                  </TableCell>
                  <TableCell className="align-top">
                    {l.vigente ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {brl(Number(l.vigente.daily_rate))}
                        </span>
                        <Badge variant="secondary">Prevalece sobre a tarifa da função</Badge>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Sem diária individual hoje: vale a tarifa da função.
                      </p>
                    )}
                    {l.proxima ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        A partir de {dataBr(l.proxima.valid_from)}:{" "}
                        {brl(Number(l.proxima.daily_rate))}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-xs text-muted-foreground">
                    {l.vigente ? rotuloDaVigenciaIndividual(l.vigente) : "—"}
                    {l.anteriores > 0 ? (
                      <p className="mt-1">
                        {l.anteriores === 1
                          ? "1 versão anterior"
                          : `${l.anteriores} versões anteriores`}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => abrir(l.colaboradorId)}
                      aria-label={`Alterar diária individual de ${nomes.get(l.colaboradorId) ?? "colaborador"}`}
                    >
                      Alterar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {aberto ? (
        <form
          className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (erros.length > 0) return;
            registrar.mutate(
              { contratoId, colaboradorId, inicio, valor, motivo },
              { onSuccess: () => setAberto(false) },
            );
          }}
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="diaria-colaborador">Colaborador</Label>
            <Select value={colaboradorId} onValueChange={setColaboradorId}>
              <SelectTrigger id="diaria-colaborador" className="rounded-xl">
                <SelectValue placeholder="Escolha o colaborador" />
              </SelectTrigger>
              <SelectContent>
                {[...colaboradores]
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="diaria-inicio">Vigente a partir de</Label>
            <Input
              id="diaria-inicio"
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="diaria-valor">Diária cobrada (R$)</Label>
            <Input
              id="diaria-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Ex.: 260,00"
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="diaria-motivo">Motivo (obrigatório)</Label>
            <Textarea
              id="diaria-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="rounded-xl"
            />
          </div>
          {valor.trim() !== "" || motivo.trim() !== "" ? (
            erros.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-destructive sm:col-span-2">
                {erros.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={erros.length > 0 || registrar.isPending}
            >
              Registrar diária individual
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
