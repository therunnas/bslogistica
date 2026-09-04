"use client";

// Portado de src/routes/_authenticated/dashboard.tsx sem alteração de
// comportamento: mesmos cálculos, mesmos gráficos, mesmo layout. É client
// component porque usa estado, React Query e recharts.
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "../_components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { brl, dateBR, minutesToHours, monthRange, num, pct } from "@/lib/format";
import { marginPct } from "@/lib/billing";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
export function PainelDashboard() {
  const initial = monthRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const { rows, isLoading } = useLedger();

  const period = useMemo(
    () => rows.filter((r) => inPeriod(r.date, start, end)),
    [rows, start, end],
  );

  const kpis = useMemo(() => {
    const revenue = sumBy(period, (r) => r.billed);
    const cost = sumBy(period, (r) => r.cost);
    return {
      dailies: sumBy(period, (r) => r.dailies),
      absences: period.filter((r) => r.status === "absent").length,
      otHours: minutesToHours(sumBy(period, (r) => r.overtimeMinutes)),
      revenue,
      cost,
      margin: revenue - cost,
      marginPct: marginPct(revenue, cost),
    };
  }, [period]);

  const byClient = useMemo(() => {
    const map = new Map<
      string,
      { name: string; receita: number; custo: number; diarias: number }
    >();
    period.forEach((r) => {
      const item = map.get(r.clientId) ?? {
        name: r.clientName,
        receita: 0,
        custo: 0,
        diarias: 0,
      };
      item.receita += r.billed;
      item.custo += r.cost;
      item.diarias += r.dailies;
      map.set(r.clientId, item);
    });
    return [...map.values()].sort((a, b) => b.receita - a.receita);
  }, [period]);

  const byDay = useMemo(() => {
    const map = new Map<string, { data: string; diarias: number; receita: number }>();
    period.forEach((r) => {
      const item = map.get(r.date) ?? { data: dateBR(r.date).slice(0, 5), diarias: 0, receita: 0 };
      item.diarias += r.dailies;
      item.receita += r.billed;
      map.set(r.date, item);
    });
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  }, [period]);

  const byType = useMemo(() => {
    const fixed = sumBy(
      period.filter((r) => r.operationType === "fixed"),
      (r) => r.billed,
    );
    const spot = sumBy(
      period.filter((r) => r.operationType === "spot"),
      (r) => r.billed,
    );
    return [
      { name: "Operações fixas", value: fixed },
      { name: "Avulsas (carga/descarga)", value: spot },
    ].filter((d) => d.value > 0);
  }, [period]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Resultado operacional e financeiro do período selecionado."
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
          </div>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Diárias faturáveis" value={num(kpis.dailies, 0)} />
            <Kpi label="Horas extras" value={`${num(kpis.otHours, 1)} h`} />
            <Kpi label="Faltas" value={num(kpis.absences, 0)} />
            <Kpi label="Receita" value={brl(kpis.revenue)} />
            <Kpi label="Custo de mão de obra" value={brl(kpis.cost)} />
            <Kpi label="Margem" value={brl(kpis.margin)} />
            <Kpi label="Margem %" value={pct(kpis.marginPct)} />
            <Kpi
              label="Colaboradores ativos no período"
              value={num(
                new Set(period.filter((r) => r.status !== "absent").map((r) => r.employeeId)).size,
                0,
              )}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receita x custo por cliente</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byClient}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => brl(v)} />
                    <Legend />
                    <Bar dataKey="receita" name="Receita" fill="var(--chart-1)" radius={4} />
                    <Bar dataKey="custo" name="Custo" fill="var(--chart-2)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Diárias por dia</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byDay}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="data" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="diarias"
                      name="Diárias"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receita por tipo de operação</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {byType.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byType} dataKey="value" nameKey="name" outerRadius={90} label>
                        {byType.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "var(--chart-1)" : "var(--chart-2)"} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => brl(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem lançamentos no período.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Margem por cliente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {byClient.length ? (
                  byClient.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {num(c.diarias, 0)} diárias · receita {brl(c.receita)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{brl(c.receita - c.custo)}</p>
                        <p className="text-xs text-muted-foreground">
                          {pct(marginPct(c.receita, c.custo))}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Sem lançamentos no período.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
