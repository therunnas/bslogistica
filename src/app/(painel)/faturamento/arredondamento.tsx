"use client";

import { Clock3 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { brl, minutesToLabel } from "@/lib/format";
import type { AjusteDeArredondamento } from "@/lib/regras-definitivas-dados";

/**
 * Arredondamento acumulado da hora extra cobrada (contratos em modo acumulado, migration 030).
 * Os valores vêm da mesma função que `gerar_fatura` usa: aqui é só a prévia, por colaborador, do
 * item que a fatura vai trazer. Os apontamentos não mudam.
 */
export function ArredondamentoAcumulado({
  ajustes,
  carregando,
  erro,
}: {
  ajustes: readonly AjusteDeArredondamento[];
  carregando: boolean;
  erro: boolean;
}) {
  if (!carregando && !erro && ajustes.length === 0) return null;

  return (
    <Card className="mb-6 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
            <Clock3 className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold tracking-tight">
              Arredondamento acumulado de horas extras
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Contratos que acumulam os minutos do período antes de arredondar. Entra na fatura como
              item próprio por colaborador.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {erro ? (
          <p className="p-5 text-sm text-destructive">
            Não foi possível calcular o arredondamento acumulado.
          </p>
        ) : carregando ? (
          <p className="p-5 text-sm text-muted-foreground">Calculando o arredondamento…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead>Colaborador</TableHead>
                  <TableHead className="text-right">Minutos no período</TableHead>
                  <TableHead className="text-right">Arredondado</TableHead>
                  <TableHead className="text-right">Valor-hora</TableHead>
                  <TableHead className="text-right">Ajuste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ajustes.map((a) => (
                  <TableRow key={`${a.employee_id}-${a.valor_hora}`} className="border-border">
                    <TableCell className="text-sm">{a.colaborador}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {minutesToLabel(a.minutos_brutos)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {minutesToLabel(a.minutos_arredondados)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {brl(a.valor_hora)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {brl(a.ajuste)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
