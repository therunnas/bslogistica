"use client";

import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  Clock3,
  Download,
  FileSpreadsheet,
  ReceiptText,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { attendanceLabel, marginPct } from "@/lib/billing";
import { montarCsv } from "@/lib/csv";
import { brl, dateBR, minutesToLabel, monthRange, num, pct } from "@/lib/format";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { decidirExibicao, linhasParaExibicao } from "@/lib/ledger-estado";
import type { AvisoDoLedger } from "@/lib/ledger-estado";
import { somarAdicionais } from "@/lib/adicionais";
import { useAdicionaisDoPeriodo } from "@/lib/adicionais-dados";
import { useRegrasDaBs } from "@/lib/vigencias-dados";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

export function PainelRelatorios() {
  const initial = monthRange();

  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const ledger = useLedger();
  // Adicionais de serviço (029) entram no total da receita e da margem pelo critério da fatura; as
  // tabelas por colaborador, operação e lançamento seguem por apontamento.
  const regrasBs = useRegrasDaBs();
  const exibicao = decidirExibicao(ledger);
  const rows = linhasParaExibicao(ledger);

  const period = useMemo(
    () => rows.filter((row) => inPeriod(row.date, start, end)),
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

    period.forEach((row) => {
      const item = map.get(row.employeeId) ?? {
        name: row.employeeName,
        dailies: 0,
        absences: 0,
        otMinutes: 0,
        cost: 0,
        billed: 0,
      };

      item.dailies += row.dailies;

      if (row.status === "absent") {
        item.absences += 1;
      }

      item.otMinutes += row.overtimeMinutes;
      item.cost += row.cost;
      item.billed += row.billed;

      map.set(row.employeeId, item);
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

    period.forEach((row) => {
      const item = map.get(row.operationId) ?? {
        name: row.operationName,
        client: row.clientName,
        dailies: 0,
        otMinutes: 0,
        billed: 0,
        cost: 0,
      };

      item.dailies += row.dailies;
      item.otMinutes += row.overtimeMinutes;
      item.billed += row.billed;
      item.cost += row.cost;

      map.set(row.operationId, item);
    });

    return [...map.values()].sort((a, b) => b.billed - a.billed);
  }, [period]);

  const adicionais = useAdicionaisDoPeriodo(start, end, regrasBs);
  const totalAdicionais = somarAdicionais(adicionais.data ?? []);

  const totals = useMemo(() => {
    const apontamentos = sumBy(period, (row) => row.billed);
    const billed = apontamentos + totalAdicionais;

    const cost = sumBy(period, (row) => row.cost);

    return {
      dailies: sumBy(period, (row) => row.dailies),
      absences: period.filter((row) => row.status === "absent").length,
      overtime: sumBy(period, (row) => row.overtimeMinutes),
      apontamentos,
      billed,
      cost,
      margin: billed - cost,
    };
  }, [period, totalAdicionais]);

  function exportCsv() {
    if (!exibicao.podeAgir) return;

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

    const lines = period.map((row) => [
      row.date,
      row.clientName,
      row.operationName,
      row.shiftName,
      row.employeeName,
      attendanceLabel[row.status],
      row.workedMinutes,
      row.overtimeMinutes,
      row.billed.toFixed(2),
      row.cost.toFixed(2),
    ]);

    const csv = montarCsv(header, lines);

    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8",
      }),
    );

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
        description="Analise diárias, faltas, horas extras, receita, custo e margem do período selecionado."
        action={
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={exportCsv}
            disabled={!period.length || !exibicao.podeAgir}
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>De</Label>

            <Input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <Label>Até</Label>

            <Input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </CardContent>
      </Card>

      {exibicao.aviso && (
        <AvisoLedger
          aviso={exibicao.aviso}
          onTentarNovamente={exibicao.podeTentarNovamente ? ledger.tentarNovamente : undefined}
        />
      )}

      {exibicao.mostrarValores && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Resumo
              label="Diárias"
              value={num(totals.dailies, 0)}
              description={`${totals.absences} falta${totals.absences === 1 ? "" : "s"}`}
              icon={CalendarDays}
            />

            <Resumo
              label="Horas extras"
              value={minutesToLabel(totals.overtime)}
              description="Excedente acumulado"
              icon={Clock3}
            />

            <Resumo
              label="Receita"
              value={brl(totals.billed)}
              description={
                regrasBs
                  ? `Apontamentos ${brl(totals.apontamentos)} + adicionais ${brl(totalAdicionais)}`
                  : "Receita gerada"
              }
              icon={BadgeDollarSign}
            />

            <Resumo
              label="Margem"
              value={brl(totals.margin)}
              description={`${pct(marginPct(totals.billed, totals.cost))} · custo ${brl(totals.cost)}`}
              icon={TrendingUp}
            />
          </div>

          <Tabs defaultValue="employees">
            <TabsList className="mb-5 h-auto flex-wrap rounded-xl border border-border bg-secondary/50 p-1">
              <TabsTrigger
                value="employees"
                className="min-h-9 rounded-lg px-4 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Por colaborador
              </TabsTrigger>

              <TabsTrigger
                value="operations"
                className="min-h-9 rounded-lg px-4 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Por operação
              </TabsTrigger>

              <TabsTrigger
                value="entries"
                className="min-h-9 rounded-lg px-4 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Lançamentos
              </TabsTrigger>
            </TabsList>

            <TabsContent value="employees" className="mt-0">
              <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
                <CardHeader className="border-b border-border px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                      <Users className="h-4 w-4" />
                    </div>

                    <div>
                      <CardTitle className="text-sm font-semibold tracking-tight">
                        Desempenho por colaborador
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Diárias, faltas, horas extras e custo individual.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                          <TableHead className="h-12 min-w-52 text-xs font-semibold text-muted-foreground">
                            Colaborador
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Diárias
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Faltas
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Horas extras
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Receita gerada
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Custo
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {byEmployee.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <EstadoVazio />
                            </TableCell>
                          </TableRow>
                        ) : (
                          byEmployee.map((employee) => (
                            <TableRow
                              key={employee.name}
                              className="border-border transition-colors hover:bg-secondary/20"
                            >
                              <TableCell className="py-4">
                                <div className="flex items-center gap-3">
                                  <AvatarNome nome={employee.name} />

                                  <span className="text-sm font-medium text-foreground">
                                    {employee.name}
                                  </span>
                                </div>
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {num(employee.dailies, 0)}
                              </TableCell>

                              <TableCell className="text-right">
                                {employee.absences > 0 ? (
                                  <Badge
                                    variant="secondary"
                                    className="border border-destructive/15 bg-destructive/10 font-medium text-destructive shadow-none"
                                  >
                                    {num(employee.absences, 0)}
                                  </Badge>
                                ) : (
                                  <span className="text-sm text-muted-foreground">0</span>
                                )}
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {minutesToLabel(employee.otMinutes)}
                              </TableCell>

                              <TableCell className="text-right text-sm font-medium text-foreground">
                                {brl(employee.billed)}
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {brl(employee.cost)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="operations" className="mt-0">
              <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
                <CardHeader className="border-b border-border px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                      <ReceiptText className="h-4 w-4" />
                    </div>

                    <div>
                      <CardTitle className="text-sm font-semibold tracking-tight">
                        Resultado por operação
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Receita, custo e margem de cada operação no período.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                          <TableHead className="h-12 min-w-48 text-xs font-semibold text-muted-foreground">
                            Operação
                          </TableHead>

                          <TableHead className="min-w-40 text-xs font-semibold text-muted-foreground">
                            Cliente
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Diárias
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Horas extras
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Receita
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Custo
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Margem
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {byOperation.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7}>
                              <EstadoVazio />
                            </TableCell>
                          </TableRow>
                        ) : (
                          byOperation.map((operation) => (
                            <TableRow
                              key={operation.name}
                              className="border-border transition-colors hover:bg-secondary/20"
                            >
                              <TableCell className="py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                                    <ReceiptText className="h-4 w-4" />
                                  </div>

                                  <span className="text-sm font-medium text-foreground">
                                    {operation.name}
                                  </span>
                                </div>
                              </TableCell>

                              <TableCell className="text-sm text-muted-foreground">
                                {operation.client}
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {num(operation.dailies, 0)}
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {minutesToLabel(operation.otMinutes)}
                              </TableCell>

                              <TableCell className="text-right text-sm font-medium text-foreground">
                                {brl(operation.billed)}
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {brl(operation.cost)}
                              </TableCell>

                              <TableCell className="text-right">
                                <p className="text-sm font-medium text-foreground">
                                  {brl(operation.billed - operation.cost)}
                                </p>

                                <p className="mt-0.5 text-[11px] text-primary">
                                  {pct(marginPct(operation.billed, operation.cost))}
                                </p>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="entries" className="mt-0">
              <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
                <CardHeader className="border-b border-border px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                      <FileSpreadsheet className="h-4 w-4" />
                    </div>

                    <div>
                      <CardTitle className="text-sm font-semibold tracking-tight">
                        Lançamentos detalhados
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Histórico individual de apontamentos e faturamento.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                          <TableHead className="h-12 text-xs font-semibold text-muted-foreground">
                            Data
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Cliente
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Operação
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Turno
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Colaborador
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Presença
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Hora extra
                          </TableHead>

                          <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                            Receita
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Faturado
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {period.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9}>
                              <EstadoVazio />
                            </TableCell>
                          </TableRow>
                        ) : (
                          period.map((row) => (
                            <TableRow
                              key={row.entryId}
                              className="border-border transition-colors hover:bg-secondary/20"
                            >
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {dateBR(row.date)}
                              </TableCell>

                              <TableCell className="text-sm text-muted-foreground">
                                {row.clientName}
                              </TableCell>

                              <TableCell className="text-sm font-medium text-foreground">
                                {row.operationName}
                              </TableCell>

                              <TableCell className="text-sm text-muted-foreground">
                                {row.shiftName}
                              </TableCell>

                              <TableCell className="text-sm text-muted-foreground">
                                {row.employeeName}
                              </TableCell>

                              <TableCell>
                                <PresencaBadge status={row.status} />
                              </TableCell>

                              <TableCell className="text-right text-sm text-muted-foreground">
                                {minutesToLabel(row.overtimeMinutes)}
                              </TableCell>

                              <TableCell className="text-right text-sm font-medium text-foreground">
                                {brl(row.billed)}
                              </TableCell>

                              <TableCell>
                                <FaturadoBadge faturado={!!row.invoiceId} />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Resumo({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>

            <p className="mt-2 truncate text-2xl font-semibold tracking-[-0.035em] text-foreground">
              {value}
            </p>

            <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
          </div>

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AvatarNome({ nome }: { nome: string }) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-xs font-semibold text-primary">
      {iniciais || "—"}
    </div>
  );
}

function PresencaBadge({ status }: { status: keyof typeof attendanceLabel }) {
  const ausente = status === "absent";
  const substituicao = status === "replacement";

  return (
    <Badge
      variant="secondary"
      className={
        ausente
          ? "border border-destructive/15 bg-destructive/10 font-medium text-destructive shadow-none"
          : substituicao
            ? "border border-primary/15 bg-primary/10 font-medium text-primary shadow-none"
            : "border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
      }
    >
      {attendanceLabel[status]}
    </Badge>
  );
}

function FaturadoBadge({ faturado }: { faturado: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={
        faturado
          ? "border border-primary/15 bg-primary/10 font-medium text-primary shadow-none"
          : "border border-border bg-secondary font-medium text-muted-foreground shadow-none"
      }
    >
      <span
        className={
          faturado
            ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-primary"
            : "mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground"
        }
      />

      {faturado ? "Sim" : "Não"}
    </Badge>
  );
}

function EstadoVazio() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">Sem lançamentos no período</p>

      <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
        Ajuste o intervalo de datas ou registre novos apontamentos para visualizar os dados.
      </p>
    </div>
  );
}

function AvisoLedger({
  aviso,
  onTentarNovamente,
}: {
  aviso: AvisoDoLedger;
  onTentarNovamente?: (() => void) | undefined;
}) {
  return (
    <div role="alert" className="mb-5 rounded-2xl border border-border bg-secondary/40 p-5">
      <p className="text-sm font-semibold text-foreground">{aviso.titulo}</p>

      <p className="mt-1 text-xs leading-5 text-muted-foreground">{aviso.descricao}</p>

      {onTentarNovamente ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-9 rounded-xl"
          onClick={onTentarNovamente}
        >
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
