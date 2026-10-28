"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Download,
  FileText,
  ReceiptText,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";
import { AdicionaisDoPeriodo } from "./adicionais";
import { ArredondamentoAcumulado } from "./arredondamento";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { adicionalElegivel, somarAdicionais } from "@/lib/adicionais";
import { CHAVE_DOS_ADICIONAIS, useAdicionais } from "@/lib/adicionais-dados";
import { CHAVE_DOS_AJUSTES, useAjustesDeArredondamento } from "@/lib/regras-definitivas-dados";
import { marginPct, round2 } from "@/lib/billing";
import { montarCsv } from "@/lib/csv";
import { brl, dateBR, minutesToLabel, monthRange, num } from "@/lib/format";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { decidirExibicao, linhasParaExibicao } from "@/lib/ledger-estado";
import type { AvisoDoLedger } from "@/lib/ledger-estado";
import { toast } from "@/lib/notificacoes";
import { useClients, useInvoices, useOperations } from "@/lib/queries";
import { useRegrasDaBs, useRegrasDefinitivas } from "@/lib/vigencias-dados";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

export function PainelFaturamento() {
  const initial = monthRange();
  const queryClient = useQueryClient();

  const clients = useClients();
  const invoices = useInvoices();
  const ledger = useLedger();
  const operations = useOperations();
  // Adicionais de serviço só existem com a migration 029 (o banco anuncia `regras_bs`).
  const regrasBs = useRegrasDaBs();
  // Arredondamento acumulado (030): mesma função que gerar_fatura usa.
  const regrasDefinitivas = useRegrasDefinitivas();
  const exibicao = decidirExibicao(ledger);
  const rows = linhasParaExibicao(ledger);

  const [clientId, setClientId] = useState("");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const selectedClient = clientId || clients.data?.[0]?.id || "";

  /**
   * Mesma regra de elegibilidade da RPC `gerar_fatura`: cliente, período,
   * presença e `invoice_id` ainda nulo.
   *
   * O `invoiceId === null` existe para a prévia não oferecer como faturável um
   * lançamento que o banco vai recusar. A autoridade continua sendo a RPC —
   * isto aqui é só coerência de tela.
   */
  const period = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.clientId === selectedClient &&
          inPeriod(row.date, start, end) &&
          row.status !== "absent" &&
          row.invoiceId === null,
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

    period.forEach((row) => {
      const item = map.get(row.operationId) ?? {
        name: row.operationName,
        dailies: 0,
        otMinutes: 0,
        billed: 0,
        otValue: 0,
        cost: 0,
      };

      item.dailies += row.dailies;
      item.otMinutes += row.overtimeMinutes;
      item.billed += row.billed;
      item.otValue += row.otValue;
      item.cost += row.cost;

      map.set(row.operationId, item);
    });

    return [...map.entries()].map(([id, value]) => ({
      id,
      ...value,
    }));
  }, [period]);

  const totals = useMemo(() => {
    const billed = sumBy(period, (row) => row.billed);

    return {
      billed,
      cost: sumBy(period, (row) => row.cost),
      otMinutes: sumBy(period, (row) => row.overtimeMinutes),
      dailies: sumBy(period, (row) => row.dailies),
      otValue: round2(sumBy(period, (row) => row.otValue)),
    };
  }, [period]);

  const adicionais = useAdicionais(selectedClient, regrasBs);
  /** O mesmo critério de `gerar_fatura`: período do adicional inteiro dentro do da fatura. */
  const adicionaisElegiveis = useMemo(
    () => (adicionais.data ?? []).filter((a) => adicionalElegivel(a, selectedClient, start, end)),
    [adicionais.data, selectedClient, start, end],
  );
  const totalAdicionais = somarAdicionais(adicionaisElegiveis);
  // Com a 029, gerar exige saber o que entra: leitura dos adicionais pendente ou falha bloqueia.
  const adicionaisProntos = !regrasBs || adicionais.isSuccess;
  const ajustes = useAjustesDeArredondamento(selectedClient, start, end, regrasDefinitivas);
  const totalAjustes =
    Math.round((ajustes.data ?? []).reduce((acc, a) => acc + Math.round(a.ajuste * 100), 0)) / 100;
  const ajustesProntos = !regrasDefinitivas || ajustes.isSuccess;
  const totalAFaturar = round2(totals.billed + totalAdicionais + totalAjustes);
  const semNadaParaGerar =
    (!period.length && !adicionaisElegiveis.length) || !adicionaisProntos || !ajustesProntos;

  const dailiesValue = round2(totals.billed - totals.otValue);

  const overtimeValue = totals.otValue;

  /**
   * Uma única chamada transacional. Os totais não são enviados pelo browser:
   * a função soma no servidor os snapshots gravados no apontamento.
   */
  const generate = useMutation({
    mutationFn: async () => {
      if (!selectedClient) {
        throw new Error("Selecione um cliente.");
      }

      // A prévia é só informativa, mas gerar sobre uma leitura incompleta ou em
      // andamento esconderia do usuário o que será faturado.
      if (!exibicao.podeAgir) {
        throw new Error("Aguarde a conclusão da leitura dos dados antes de gerar a fatura.");
      }

      if (!ajustesProntos) {
        throw new Error("Aguarde o cálculo do arredondamento acumulado antes de gerar a fatura.");
      }

      if (!adicionaisProntos) {
        throw new Error("Aguarde a leitura dos adicionais de serviço antes de gerar a fatura.");
      }

      const { data, error } = await criarClienteNavegador().rpc("gerar_fatura", {
        _client_id: selectedClient,
        _period_start: start,
        _period_end: end,
      });

      if (error) {
        throw error;
      }

      return data;
    },

    onSuccess: async (invoice) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["invoices"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["timesheet_entries"],
        }),
        queryClient.invalidateQueries({
          queryKey: CHAVE_DOS_ADICIONAIS,
        }),
        queryClient.invalidateQueries({
          queryKey: CHAVE_DOS_AJUSTES,
        }),
      ]);

      toast.success(
        invoice
          ? `Fatura gerada: ${brl(invoice.total_amount)} em ${num(
              invoice.total_dailies,
              0,
            )} diárias.`
          : "Fatura gerada.",
      );
    },

    onError: (error: unknown) => {
      const mensagem =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "Não foi possível gerar a fatura.";

      toast.error(mensagem);
    },
  });

  function exportCsv() {
    if (!exibicao.podeAgir) return;

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

    const lines = period.map((row) => [
      row.date,
      row.operationName,
      row.shiftName,
      row.employeeName,
      row.status,
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
    link.download = `faturamento-${start}-${end}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  const clientName = (id: string) => clients.data?.find((client) => client.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Faturamento"
        description="Revise lançamentos faturáveis, valores consolidados e faturas geradas por cliente e período."
        action={
          <div className="flex flex-wrap gap-2">
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

            <Button
              type="button"
              className="h-10 rounded-xl"
              onClick={() => generate.mutate()}
              disabled={semNadaParaGerar || !exibicao.podeAgir || generate.isPending}
            >
              <FileText className="h-4 w-4" />

              {generate.isPending ? "Gerando..." : "Gerar fatura"}
            </Button>
          </div>
        }
      />

      <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Cliente</Label>

            <Select value={selectedClient} onValueChange={setClientId}>
              <SelectTrigger className={SELECT_CLASS}>
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
              description={brl(dailiesValue)}
              icon={CalendarDays}
            />

            <Resumo
              label="Horas extras"
              value={minutesToLabel(totals.otMinutes)}
              description={brl(overtimeValue)}
              icon={Clock3}
            />

            <Resumo
              label="Total a faturar"
              value={brl(totalAFaturar)}
              description={
                regrasBs
                  ? `Lançamentos ${brl(totals.billed)} + adicionais ${brl(totalAdicionais)}${
                      regrasDefinitivas ? ` + arredondamento ${brl(totalAjustes)}` : ""
                    }`
                  : "Lançamentos elegíveis"
              }
              icon={ReceiptText}
            />

            <Resumo
              label="Margem"
              value={brl(totalAFaturar - totals.cost)}
              description={`${num(
                marginPct(totalAFaturar, totals.cost),
                1,
              )}% · custo ${brl(totals.cost)}`}
              icon={TrendingUp}
            />
          </div>

          <Card className="mb-6 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
            <CardHeader className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                  <WalletCards className="h-4 w-4" />
                </div>

                <div>
                  <CardTitle className="text-sm font-semibold tracking-tight">
                    Prévia por operação
                  </CardTitle>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Valores ainda disponíveis para faturamento no período selecionado.
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

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Diárias
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Horas extras
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Total
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
                        <TableCell colSpan={6}>
                          <EstadoVazio
                            title="Nenhum lançamento faturável"
                            description="Não existem apontamentos elegíveis para faturamento neste cliente e período."
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      byOperation.map((operation) => {
                        const margem = operation.billed - operation.cost;

                        return (
                          <TableRow
                            key={operation.id}
                            className="border-border transition-colors hover:bg-secondary/20"
                          >
                            <TableCell className="py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                                  <ReceiptText className="h-4 w-4" />
                                </div>

                                <p className="text-sm font-medium text-foreground">
                                  {operation.name}
                                </p>
                              </div>
                            </TableCell>

                            <TableCell className="text-right text-sm text-muted-foreground">
                              {num(operation.dailies, 0)}
                            </TableCell>

                            <TableCell className="text-right text-sm text-muted-foreground">
                              {minutesToLabel(operation.otMinutes)}
                            </TableCell>

                            <TableCell className="text-right text-sm font-semibold text-foreground">
                              {brl(operation.billed)}
                            </TableCell>

                            <TableCell className="text-right text-sm text-muted-foreground">
                              {brl(operation.cost)}
                            </TableCell>

                            <TableCell className="text-right text-sm font-medium text-foreground">
                              {brl(margem)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {regrasDefinitivas ? (
            <ArredondamentoAcumulado
              ajustes={ajustes.data ?? []}
              carregando={ajustes.isPending}
              erro={ajustes.isError}
            />
          ) : null}

          {regrasBs ? (
            <AdicionaisDoPeriodo
              clienteId={selectedClient}
              inicio={start}
              fim={end}
              operacoes={(operations.data ?? []).filter(
                (operation) => operation.client_id === selectedClient,
              )}
              adicionais={adicionais.data ?? []}
              carregando={adicionais.isPending}
              erro={adicionais.isError}
            />
          ) : null}
        </>
      )}

      <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
              <FileText className="h-4 w-4" />
            </div>

            <div>
              <CardTitle className="text-sm font-semibold tracking-tight">
                Faturas geradas
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Histórico das faturas criadas pelo sistema.
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
                    Cliente
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Período
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Diárias
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Horas extras
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Total
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Custo
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {invoices.isError || invoices.data === undefined ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EstadoVazio
                        title={
                          invoices.isError
                            ? "Não foi possível carregar as faturas"
                            : "Carregando faturas…"
                        }
                        description={
                          invoices.isError
                            ? "A lista não é exibida como vazia porque a leitura falhou. Recarregue a página para tentar de novo."
                            : "A lista aparece quando a leitura terminar."
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : invoices.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EstadoVazio
                        title="Nenhuma fatura gerada"
                        description="As faturas criadas pelo fechamento financeiro aparecerão aqui."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.data.map((invoice) => (
                    <TableRow
                      key={invoice.id}
                      className="border-border transition-colors hover:bg-secondary/20"
                    >
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/40">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </div>

                          <span className="text-sm font-medium text-foreground">
                            {clientName(invoice.client_id)}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {dateBR(invoice.period_start)} – {dateBR(invoice.period_end)}
                      </TableCell>

                      <TableCell className="text-right text-sm text-muted-foreground">
                        {num(invoice.total_dailies, 0)}
                      </TableCell>

                      <TableCell className="text-right text-sm text-muted-foreground">
                        {num(invoice.total_overtime, 1)} h
                      </TableCell>

                      <TableCell className="text-right text-sm font-semibold text-foreground">
                        {brl(invoice.total_amount)}
                      </TableCell>

                      <TableCell className="text-right text-sm text-muted-foreground">
                        {brl(invoice.total_cost)}
                      </TableCell>

                      <TableCell>
                        <StatusFatura status={invoice.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
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

function StatusFatura({ status }: { status: string }) {
  const label = status === "draft" ? "Rascunho" : status === "closed" ? "Fechada" : "Emitida";

  const emitida = status === "issued";
  const fechada = status === "closed";

  return (
    <Badge
      variant="secondary"
      className={
        emitida
          ? "border border-primary/15 bg-primary/10 font-medium text-primary shadow-none"
          : fechada
            ? "border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
            : "border border-border bg-secondary font-medium text-muted-foreground shadow-none"
      }
    >
      <span
        className={
          emitida
            ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-primary"
            : fechada
              ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
              : "mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground"
        }
      />

      {label}
    </Badge>
  );
}

function EstadoVazio({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
        <ReceiptText className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>

      <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
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
