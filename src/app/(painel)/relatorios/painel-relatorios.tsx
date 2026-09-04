"use client";

// Portado de src/routes/_authenticated/relatorios.tsx sem alteração de
// comportamento. É client component porque usa estado, React Query e
// gera o CSV no navegador.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "../_components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { brl, dateBR, minutesToLabel, monthRange, num, pct } from "@/lib/format";
import { attendanceLabel, marginPct } from "@/lib/billing";

export function PainelRelatorios() {
  const initial = monthRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const { rows } = useLedger();

  const period = useMemo(
    () => rows.filter((r) => inPeriod(r.date, start, end)),
    [rows, start, end],
  );

  const byEmployee = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        dailies: number;
        absences: number;
        otMinutes: number;
        cost: number;
        billed: number;
      }
    >();
    period.forEach((r) => {
      const item = map.get(r.employeeId) ?? {
        name: r.employeeName,
        dailies: 0,
        absences: 0,
        otMinutes: 0,
        cost: 0,
        billed: 0,
      };
      item.dailies += r.dailies;
      if (r.status === "absent") item.absences += 1;
      item.otMinutes += r.overtimeMinutes;
      item.cost += r.cost;
      item.billed += r.billed;
      map.set(r.employeeId, item);
    });
    return [...map.values()].sort((a, b) => b.dailies - a.dailies);
  }, [period]);

  const byOperation = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        client: string;
        dailies: number;
        otMinutes: number;
        billed: number;
        cost: number;
      }
    >();
    period.forEach((r) => {
      const item = map.get(r.operationId) ?? {
        name: r.operationName,
        client: r.clientName,
        dailies: 0,
        otMinutes: 0,
        billed: 0,
        cost: 0,
      };
      item.dailies += r.dailies;
      item.otMinutes += r.overtimeMinutes;
      item.billed += r.billed;
      item.cost += r.cost;
      map.set(r.operationId, item);
    });
    return [...map.values()].sort((a, b) => b.billed - a.billed);
  }, [period]);

  function exportCsv() {
    const header = [
      "Data",
      "Cliente",
      "Operação",
      "Turno",
      "Colaborador",
      "Presença",
      "Trabalhado (min)",
      "Hora extra (min)",
      "Receita",
      "Custo",
    ];
    const lines = period.map((r) =>
      [
        r.date,
        r.clientName,
        r.operationName,
        r.shiftName,
        r.employeeName,
        attendanceLabel[r.status],
        r.workedMinutes,
        r.overtimeMinutes,
        r.billed.toFixed(2),
        r.cost.toFixed(2),
      ].join(";"),
    );
    const csv = [header.join(";"), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-${start}-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Consolidação de diárias, faltas, horas extras, receita, custo e margem do período."
        action={
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!period.length}>
              <Download className="size-4" /> CSV
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Por colaborador</TabsTrigger>
          <TabsTrigger value="operations">Por operação</TabsTrigger>
          <TabsTrigger value="entries">Lançamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Diárias e custo por colaborador — total {brl(sumBy(byEmployee, (e) => e.cost))}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="text-right">Diárias</TableHead>
                    <TableHead className="text-right">Faltas</TableHead>
                    <TableHead className="text-right">Horas extras</TableHead>
                    <TableHead className="text-right">Receita gerada</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byEmployee.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        Sem lançamentos no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    byEmployee.map((e) => (
                      <TableRow key={e.name}>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell className="text-right">{num(e.dailies, 0)}</TableCell>
                        <TableCell className="text-right">{num(e.absences, 0)}</TableCell>
                        <TableCell className="text-right">{minutesToLabel(e.otMinutes)}</TableCell>
                        <TableCell className="text-right">{brl(e.billed)}</TableCell>
                        <TableCell className="text-right">{brl(e.cost)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operations" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operação</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Diárias</TableHead>
                    <TableHead className="text-right">Horas extras</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOperation.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        Sem lançamentos no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    byOperation.map((o) => (
                      <TableRow key={o.name}>
                        <TableCell className="font-medium">{o.name}</TableCell>
                        <TableCell>{o.client}</TableCell>
                        <TableCell className="text-right">{num(o.dailies, 0)}</TableCell>
                        <TableCell className="text-right">{minutesToLabel(o.otMinutes)}</TableCell>
                        <TableCell className="text-right">{brl(o.billed)}</TableCell>
                        <TableCell className="text-right">{brl(o.cost)}</TableCell>
                        <TableCell className="text-right">
                          {brl(o.billed - o.cost)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {pct(marginPct(o.billed, o.cost))}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entries" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Operação</TableHead>
                    <TableHead>Turno</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Presença</TableHead>
                    <TableHead className="text-right">Hora extra</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead>Faturado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {period.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-muted-foreground">
                        Sem lançamentos no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    period.map((r) => (
                      <TableRow key={r.entryId}>
                        <TableCell>{dateBR(r.date)}</TableCell>
                        <TableCell>{r.clientName}</TableCell>
                        <TableCell>{r.operationName}</TableCell>
                        <TableCell>{r.shiftName}</TableCell>
                        <TableCell>{r.employeeName}</TableCell>
                        <TableCell>{attendanceLabel[r.status]}</TableCell>
                        <TableCell className="text-right">
                          {minutesToLabel(r.overtimeMinutes)}
                        </TableCell>
                        <TableCell className="text-right">{brl(r.billed)}</TableCell>
                        <TableCell>
                          <Badge variant={r.invoiceId ? "default" : "secondary"}>
                            {r.invoiceId ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
