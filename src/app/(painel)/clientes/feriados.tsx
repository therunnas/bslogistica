"use client";

import { useState } from "react";
import { CalendarX2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { datasAtivas, validarFeriado, type Feriado } from "@/lib/feriados";
import { dateBR } from "@/lib/format";
import {
  useAposentarFeriado,
  useFeriados,
  useRegistrarFeriado,
} from "@/lib/regras-definitivas-dados";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

/**
 * Calendário de feriados do motor financeiro (migration 030). O feriado só muda o PAGAMENTO dos
 * contratos que definem o fator de feriado; a cobrança no feriado não muda (regra não confirmada).
 * Apontamento já precificado mantém o tipo do dia congelado.
 */
export function FeriadosDoCalendario() {
  const feriados = useFeriados(true);
  const ativos = datasAtivas(feriados.data ?? []);
  const registrar = useRegistrarFeriado(ativos);
  const aposentar = useAposentarFeriado();

  const [novoOpen, setNovoOpen] = useState(false);
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aposentando, setAposentando] = useState<Feriado | null>(null);
  const [motivoApos, setMotivoApos] = useState("");

  const erros = validarFeriado({ data, nome, motivo }, ativos);

  return (
    <Card className="mt-6 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
              <CalendarX2 className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold tracking-tight">
                Calendário de feriados
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Usado pelo pagamento em feriado dos contratos com fator de feriado. Registre antes
                de apontar a data: o tipo do dia fica congelado no apontamento.
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="h-9 rounded-xl"
            onClick={() => {
              setData("");
              setNome("");
              setMotivo("");
              setNovoOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo feriado
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {feriados.isError ? (
          <p className="p-5 text-sm text-destructive">Não foi possível carregar os feriados.</p>
        ) : feriados.isPending ? (
          <p className="p-5 text-sm text-muted-foreground">Carregando feriados…</p>
        ) : (feriados.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhum feriado cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead>Data</TableHead>
                  <TableHead>Feriado</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(feriados.data ?? []).map((f) => (
                  <TableRow key={f.id} className="border-border">
                    <TableCell className="whitespace-nowrap text-sm">
                      {dateBR(f.holiday_date)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.name}
                      {f.retire_reason ? (
                        <p className="text-xs text-muted-foreground">
                          Aposentado: {f.retire_reason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.active ? "default" : "secondary"}>
                        {f.active ? "Ativo" : "Aposentado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!f.active}
                        onClick={() => {
                          setAposentando(f);
                          setMotivoApos("");
                        }}
                      >
                        Aposentar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo feriado</DialogTitle>
            <DialogDescription>
              Fica na trilha e não é apagado: para corrigir, aposente com motivo e registre outro.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="feriado-data">Data</Label>
              <Input
                id="feriado-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feriado-nome">Nome</Label>
              <Input
                id="feriado-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feriado-motivo">Motivo (obrigatório)</Label>
              <Textarea
                id="feriado-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="rounded-xl"
              />
            </div>
            {erros.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {erros.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setNovoOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={erros.length > 0 || registrar.isPending}
              onClick={() =>
                registrar.mutate({ data, nome, motivo }, { onSuccess: () => setNovoOpen(false) })
              }
            >
              Registrar feriado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aposentando !== null} onOpenChange={(o) => !o && setAposentando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aposentar feriado</DialogTitle>
            <DialogDescription>
              Deixa de valer para apontamentos novos. Os já precificados mantêm o tipo do dia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="feriado-motivo-apos">Motivo (obrigatório)</Label>
            <Textarea
              id="feriado-motivo-apos"
              value={motivoApos}
              onChange={(e) => setMotivoApos(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAposentando(null)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={motivoApos.trim() === "" || aposentar.isPending}
              onClick={() =>
                aposentando &&
                aposentar.mutate(
                  { id: aposentando.id, motivo: motivoApos },
                  { onSuccess: () => setAposentando(null) },
                )
              }
            >
              Aposentar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
