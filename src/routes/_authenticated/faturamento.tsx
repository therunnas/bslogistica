import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useClients, useInvoices } from "@/lib/queries";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { brl, dateBR, minutesToHours, minutesToLabel, monthRange, num } from "@/lib/format";
import { marginPct, round2 } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/faturamento")({
  head: () => ({
    meta: [
      { title: "Faturamento por período | OpLog" },
      {
        name: "description",
        content:
          "Feche o período por cliente, some diárias e horas extras e gere a fatura com itens por operação.",
      },
      { property: "og:title", content: "Faturamento por período | OpLog" },
      {
        property: "og:description",
        content: "Fechamento de diárias e horas extras por cliente e período.",
      },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const initial = monthRange();
  const queryClient = useQueryClient();
  const clients = useClients();
  const invoices = useInvoices();
  const { rows } = useLedger();

  const [clientId, setClientId] = useState("");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const selectedClient = clientId || clients.data?.[0]?.id || "";

  const period = useMemo(
    () =>
      rows.filter(
        (r) => r.clientId === selectedClient && inPeriod(r.date, start, end) && r.status !== "absent",
      ),
    [rows, selectedClient, start, end],
  );

  const byOperation = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        dailies: number;
        otMinutes: number;
        billed: number;
        otValue: number;
        cost: number;
      }
    >();
    period.forEach((r) => {
      const item = map.get(r.operationId) ?? {
        name: r.operationName,
        dailies: 0,
        otMinutes: 0,
        billed: 0,
        otValue: 0,
        cost: 0,
      };
      item.dailies += r.dailies;
      item.otMinutes += r.overtimeMinutes;
      item.billed += r.billed;
      item.otValue += r.otValue;
      item.cost += r.cost;
      map.set(r.operationId, item);
    });
    return [...map.entries()].map(([id, value]) => ({ id, ...value }));
  }, [period]);

  const totals = useMemo(() => {
    const billed = sumBy(period, (r) => r.billed);
    return {
      billed,
      cost: sumBy(period, (r) => r.cost),
      otMinutes: sumBy(period, (r) => r.overtimeMinutes),
      dailies: sumBy(period, (r) => r.dailies),
      otValue: round2(sumBy(period, (r) => r.otValue)),
    };
  }, [period]);

  const dailiesValue = round2(totals.billed - totals.otValue);
  const overtimeValue = totals.otValue;

  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedClient) throw new Error("Selecione um cliente.");
      if (!period.length) throw new Error("Nenhum lançamento faturável no período.");
      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          client_id: selectedClient,
          period_start: start,
          period_end: end,
          status: "closed",
          total_dailies: totals.dailies,
          total_overtime: round2(minutesToHours(totals.otMinutes)),
          total_amount: round2(totals.billed),
          total_cost: round2(totals.cost),
        })
        .select("id")
        .single();
      if (error) throw error;

      const items = byOperation.flatMap((op) => {
        const opRows = period.filter((r) => r.operationId === op.id);
        const ot = round2(sumBy(opRows, (r) => r.otValue));
        const list = [
          {
            invoice_id: invoice.id,
            operation_id: op.id,
            description: `${op.name} — diárias`,
            quantity: op.dailies,
            unit_price: op.dailies ? round2((op.billed - ot) / op.dailies) : 0,
            amount: round2(op.billed - ot),
          },
        ];
        if (ot > 0) {
          list.push({
            invoice_id: invoice.id,
            operation_id: op.id,
            description: `${op.name} — horas extras`,
            quantity: round2(minutesToHours(op.otMinutes)),
            unit_price: op.otMinutes ? round2(ot / minutesToHours(op.otMinutes)) : 0,
            amount: round2(ot),
          });
        }
        return list;
      });
      const { error: itemsError } = await supabase.from("invoice_items").insert(items as never);
      if (itemsError) throw itemsError;

      const { error: linkError } = await supabase
        .from("timesheet_entries")
        .update({ invoice_id: invoice.id })
        .in(
          "id",
          period.map((r) => r.entryId),
        );
      if (linkError) throw linkError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
      toast.success("Fatura gerada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function exportCsv() {
    const header = [
      "Data",
      "Operação",
      "Turno",
      "Colaborador",
      "Presença",
      "Trabalhado (min)",
      "Hora extra (min)",
      "Valor faturado",
      "Custo",
    ];
    const lines = period.map((r) =>
      [
        r.date,
        r.operationName,
        r.shiftName,
        r.employeeName,
        r.status,
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
    link.download = `faturamento-${start}-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Faturamento"
        description="Fechamento por cliente e período com diárias e horas extras separadas."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!period.length}>
              <Download className="size-4" /> Exportar CSV
            </Button>
            <Button onClick={() => generate.mutate()} disabled={!period.length || generate.isPending}>
              <FileText className="size-4" /> Gerar fatura
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-5 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={selectedClient} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {(clients.data ?? []).map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>De</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Até</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Diárias" value={num(totals.dailies, 0)} hint={brl(dailiesValue)} />
        <Summary
          label="Horas extras"
          value={minutesToLabel(totals.otMinutes)}
          hint={brl(overtimeValue)}
        />
        <Summary label="Total a faturar" value={brl(totals.billed)} />
        <Summary
          label="Margem"
          value={brl(totals.billed - totals.cost)}
          hint={`${num(marginPct(totals.billed, totals.cost), 1)}% · custo ${brl(totals.cost)}`}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Prévia por operação</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operação</TableHead>
                <TableHead className="text-right">Diárias</TableHead>
                <TableHead className="text-right">Horas extras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byOperation.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Nenhum lançamento faturável no período.
                  </TableCell>
                </TableRow>
              ) : (
                byOperation.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="font-medium">{op.name}</TableCell>
                    <TableCell className="text-right">{num(op.dailies, 0)}</TableCell>
                    <TableCell className="text-right">{minutesToLabel(op.otMinutes)}</TableCell>
                    <TableCell className="text-right">{brl(op.billed)}</TableCell>
                    <TableCell className="text-right">{brl(op.cost)}</TableCell>
                    <TableCell className="text-right">{brl(op.billed - op.cost)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Faturas geradas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Diárias</TableHead>
                <TableHead className="text-right">Horas extras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Nenhuma fatura gerada.
                  </TableCell>
                </TableRow>
              ) : (
                (invoices.data ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{clientName(invoice.client_id)}</TableCell>
                    <TableCell>
                      {dateBR(invoice.period_start)} – {dateBR(invoice.period_end)}
                    </TableCell>
                    <TableCell className="text-right">{num(invoice.total_dailies, 0)}</TableCell>
                    <TableCell className="text-right">{num(invoice.total_overtime, 1)} h</TableCell>
                    <TableCell className="text-right">{brl(invoice.total_amount)}</TableCell>
                    <TableCell className="text-right">{brl(invoice.total_cost)}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === "issued" ? "default" : "secondary"}>
                        {invoice.status === "draft"
                          ? "Rascunho"
                          : invoice.status === "closed"
                            ? "Fechada"
                            : "Emitida"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
