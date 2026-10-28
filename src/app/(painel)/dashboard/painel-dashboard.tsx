"use client";

import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  Clock3,
  TrendingUp,
  UserCheck,
  UserX,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
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

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { marginPct } from "@/lib/billing";
import { brl, dateBR, minutesToHours, monthRange, num, pct } from "@/lib/format";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { decidirExibicao, linhasParaExibicao } from "@/lib/ledger-estado";
import type { AvisoDoLedger } from "@/lib/ledger-estado";
import { useRegrasDaBs } from "@/lib/vigencias-dados";
import { somarAdicionais } from "@/lib/adicionais";
import { useAdicionaisDoPeriodo } from "@/lib/adicionais-dados";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

export function PainelDashboard() {
  const initial = monthRange();

  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const ledger = useLedger();
  // Com a migration 029 existem adicionais de serviço: entram no total da receita e da margem
  // pelo mesmo critério da fatura. Os gráficos seguem por apontamento (data, cliente, tipo), e o
  // arredondamento acumulado só existe no fechamento (Faturamento).
  const regrasBs = useRegrasDaBs();
  const exibicao = decidirExibicao(ledger);
  const rows = linhasParaExibicao(ledger);

  const period = useMemo(
    () => rows.filter((row) => inPeriod(row.date, start, end)),
    [rows, start, end],
  );

  const adicionais = useAdicionaisDoPeriodo(start, end, regrasBs);
  const totalAdicionais = somarAdicionais(adicionais.data ?? []);

  const kpis = useMemo(() => {
    const apontamentos = sumBy(period, (row) => row.billed);
    const revenue = apontamentos + totalAdicionais;

    const cost = sumBy(period, (row) => row.cost);

    return {
      dailies: sumBy(period, (row) => row.dailies),
      absences: period.filter((row) => row.status === "absent").length,
      otHours: minutesToHours(sumBy(period, (row) => row.overtimeMinutes)),
      apontamentos,
      revenue,
      cost,
      margin: revenue - cost,
      marginPct: marginPct(revenue, cost),
    };
  }, [period, totalAdicionais]);

  const activeEmployees = useMemo(
    () =>
      new Set(period.filter((row) => row.status !== "absent").map((row) => row.employeeId)).size,
    [period],
  );

  const byClient = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        receita: number;
        custo: number;
        diarias: number;
      }
    >();

    period.forEach((row) => {
      const item = map.get(row.clientId) ?? {
        name: row.clientName,
        receita: 0,
        custo: 0,
        diarias: 0,
      };

      item.receita += row.billed;
      item.custo += row.cost;
      item.diarias += row.dailies;

      map.set(row.clientId, item);
    });

    return [...map.values()].sort((a, b) => b.receita - a.receita);
  }, [period]);

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      {
        data: string;
        diarias: number;
        receita: number;
      }
    >();

    period.forEach((row) => {
      const item = map.get(row.date) ?? {
        data: dateBR(row.date).slice(0, 5),
        diarias: 0,
        receita: 0,
      };

      item.diarias += row.dailies;
      item.receita += row.billed;

      map.set(row.date, item);
    });

    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, value]) => value);
  }, [period]);

  const byType = useMemo(() => {
    const fixed = sumBy(
      period.filter((row) => row.operationType === "fixed"),
      (row) => row.billed,
    );

    const spot = sumBy(
      period.filter((row) => row.operationType === "spot"),
      (row) => row.billed,
    );

    return [
      {
        name: "Operações fixas",
        value: fixed,
      },
      {
        name: "Avulsas",
        value: spot,
      },
    ].filter((item) => item.value > 0);
  }, [period]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visão consolidada do desempenho operacional e financeiro da BS no período selecionado."
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">De</Label>

              <Input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className={`${INPUT_CLASS} w-40`}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Até</Label>

              <Input
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className={`${INPUT_CLASS} w-40`}
              />
            </div>
          </div>
        }
      />

      {ledger.estado === "carregando" ? (
        <DashboardSkeleton />
      ) : !exibicao.mostrarValores ? (
        exibicao.aviso && (
          <AvisoLedger
            aviso={exibicao.aviso}
            onTentarNovamente={exibicao.podeTentarNovamente ? ledger.tentarNovamente : undefined}
          />
        )
      ) : (
        <>
          {exibicao.aviso && <AvisoLedger aviso={exibicao.aviso} />}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Receita"
              value={brl(kpis.revenue)}
              description={
                regrasBs
                  ? `Apontamentos ${brl(kpis.apontamentos)} + adicionais ${brl(totalAdicionais)}`
                  : "Receita gerada no período"
              }
              icon={BadgeDollarSign}
            />

            <Kpi
              label="Custo"
              value={brl(kpis.cost)}
              description="Custo de mão de obra"
              icon={WalletCards}
            />

            <Kpi
              label="Margem"
              value={brl(kpis.margin)}
              description={pct(kpis.marginPct)}
              icon={TrendingUp}
            />

            <Kpi
              label="Diárias"
              value={num(kpis.dailies, 0)}
              description="Diárias faturáveis"
              icon={CalendarDays}
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Horas extras"
              value={`${num(kpis.otHours, 1)} h`}
              description="Excedente acumulado"
              icon={Clock3}
              secondary
            />

            <Kpi
              label="Faltas"
              value={num(kpis.absences, 0)}
              description="Ausências registradas"
              icon={UserX}
              secondary
            />

            <Kpi
              label="Colaboradores"
              value={num(activeEmployees, 0)}
              description="Ativos no período"
              icon={UserCheck}
              secondary
            />

            <Kpi
              label="Lançamentos"
              value={num(period.length, 0)}
              description="Registros considerados"
              icon={Users}
              secondary
            />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <GraficoCard
              title="Receita x custo por cliente"
              description="Comparativo financeiro dos clientes no período."
            >
              {byClient.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byClient}
                    margin={{
                      top: 8,
                      right: 4,
                      left: 4,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 11,
                      }}
                    />

                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 11,
                      }}
                    />

                    <Tooltip
                      formatter={(value: number) => brl(value)}
                      cursor={{
                        fill: "var(--muted)",
                        opacity: 0.25,
                      }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        color: "var(--popover-foreground)",
                      }}
                    />

                    <Legend
                      wrapperStyle={{
                        fontSize: 12,
                      }}
                    />

                    <Bar
                      dataKey="receita"
                      name="Receita"
                      fill="var(--chart-1)"
                      radius={[5, 5, 0, 0]}
                    />

                    <Bar dataKey="custo" name="Custo" fill="var(--chart-2)" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EstadoVazio />
              )}
            </GraficoCard>

            <GraficoCard
              title="Diárias por dia"
              description="Evolução das diárias registradas ao longo do período."
            >
              {byDay.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={byDay}
                    margin={{
                      top: 8,
                      right: 8,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

                    <XAxis
                      dataKey="data"
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 11,
                      }}
                    />

                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{
                        fill: "var(--muted-foreground)",
                        fontSize: 11,
                      }}
                    />

                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        color: "var(--popover-foreground)",
                      }}
                    />

                    <Line
                      type="monotone"
                      dataKey="diarias"
                      name="Diárias"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      dot={{
                        r: 3,
                        fill: "var(--chart-1)",
                        strokeWidth: 0,
                      }}
                      activeDot={{
                        r: 5,
                        fill: "var(--chart-1)",
                        stroke: "var(--background)",
                        strokeWidth: 2,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EstadoVazio />
              )}
            </GraficoCard>

            <GraficoCard
              title="Receita por tipo de operação"
              description="Distribuição entre operações fixas e avulsas."
            >
              {byType.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byType}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={90}
                      paddingAngle={4}
                      label
                    >
                      {byType.map((item, index) => (
                        <Cell
                          key={item.name}
                          fill={index === 0 ? "var(--chart-1)" : "var(--chart-2)"}
                        />
                      ))}
                    </Pie>

                    <Tooltip
                      formatter={(value: number) => brl(value)}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        color: "var(--popover-foreground)",
                      }}
                    />

                    <Legend
                      wrapperStyle={{
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EstadoVazio />
              )}
            </GraficoCard>

            <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
              <CardHeader className="border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                      Margem por cliente
                    </CardTitle>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Resultado financeiro consolidado por cliente.
                    </p>
                  </div>

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {byClient.length ? (
                  <div className="divide-y divide-border">
                    {byClient.map((client) => {
                      const margin = client.receita - client.custo;

                      return (
                        <div
                          key={client.name}
                          className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/20"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {client.name}
                            </p>

                            <p className="mt-1 text-xs text-muted-foreground">
                              {num(client.diarias, 0)} diárias · receita {brl(client.receita)}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-foreground">{brl(margin)}</p>

                            <p className="mt-1 text-xs font-medium text-primary">
                              {pct(marginPct(client.receita, client.custo))}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="min-h-72">
                    <EstadoVazio />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  description,
  icon: Icon,
  secondary = false,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  secondary?: boolean;
}) {
  return (
    <Card
      className={
        secondary
          ? "border-border bg-card/70 text-card-foreground shadow-[0_8px_24px_rgba(0,0,0,0.035)]"
          : "border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]"
      }
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>

            <p
              className={
                secondary
                  ? "mt-2 truncate text-xl font-semibold tracking-[-0.03em] text-foreground"
                  : "mt-2 truncate text-2xl font-semibold tracking-[-0.035em] text-foreground"
              }
            >
              {value}
            </p>

            <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
          </div>

          <div
            className={
              secondary
                ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/50 text-muted-foreground"
                : "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary"
            }
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GraficoCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>

        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardHeader>

      <CardContent className="h-80 p-5">{children}</CardContent>
    </Card>
  );
}

function EstadoVazio() {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
        <TrendingUp className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">Sem dados no período</p>

      <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
        Ajuste as datas ou registre novos apontamentos para visualizar este indicador.
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({
          length: 8,
        }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {Array.from({
          length: 4,
        }).map((_, index) => (
          <Skeleton key={index} className="h-96 rounded-2xl" />
        ))}
      </div>
    </>
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
