"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
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
import { carregarContainersAction } from "../containers/_acoes";
import { AdicionaisDoPeriodo } from "./adicionais";
import { ArredondamentoAcumulado } from "./arredondamento";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { adicionaisDeContainerEmDuplicidade } from "@/lib/container-servico-ui";
import { somarCustoDosAdicionais } from "@/lib/custo-containers";
import {
  CHAVE_DO_CUSTO_DE_CONTAINERS,
  useCustoDeContainersDoCliente,
} from "@/lib/custo-containers-dados";
import { CHAVE_DOS_AJUSTES, useAjustesDeArredondamento } from "@/lib/regras-definitivas-dados";
import { round2 } from "@/lib/billing";
import { montarCsv } from "@/lib/csv";
import {
  ROTULO_DA_PRESENCA,
  divergenciaDaEmissao,
  faturasQueCobremOPeriodo,
  mensagemDaEmissao,
  resumoDosDias,
  rotuloDosDiasComApontamento,
  type Conferido,
} from "@/lib/faturamento-conferencia";
import { sanitizarParaArquivo } from "@/lib/fechamento/exportacao";
import { competenciasDoMes, ehCompetencia } from "@/lib/fechamento/periodo";
import { brl, dateBR, minutesToLabel, monthRange, num } from "@/lib/format";
import { inPeriod, sumBy, useLedger } from "@/lib/ledger";
import { decidirExibicao, linhasParaExibicao } from "@/lib/ledger-estado";
import type { AvisoDoLedger } from "@/lib/ledger-estado";
import { toast } from "@/lib/notificacoes";
import { useClients, useInvoices, useOperations } from "@/lib/queries";
import {
  useCompetenciaDeCobranca,
  usePeriodoContratual,
  useRegrasDaBs,
  useRegrasDefinitivas,
} from "@/lib/vigencias-dados";
import { ROTULO_DA_FREQUENCIA } from "@/lib/vigencias-ui";
import {
  descricaoDasDiarias,
  diariasDeDomingoOuFeriado,
  percentualDaMargem,
  reaisNoCsv,
} from "@/lib/apresentacao-indicadores";

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
  // Período contratual (038): a fatura é uma competência inteira da frequência do cliente.
  const periodoContratual = usePeriodoContratual();
  const exibicao = decidirExibicao(ledger);
  const rows = linhasParaExibicao(ledger);

  const [clientId, setClientId] = useState("");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const selectedClient = clientId || clients.data?.[0]?.id || "";

  const competencia = useCompetenciaDeCobranca(selectedClient, start, periodoContratual);
  const frequencia = competencia.data?.frequencia ?? null;
  const competenciasDoMesDoInicio =
    frequencia !== null && /^\d{4}-\d{2}-\d{2}$/.test(start)
      ? competenciasDoMes(frequencia, Number(start.slice(0, 4)), Number(start.slice(5, 7)))
      : [];
  // Sem a 038 o banco aceita o período livre, como antes.
  const periodoEhCompetencia =
    !periodoContratual || (frequencia !== null && ehCompetencia(frequencia, start, end));

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

  // D7 (CP-06): operações com apontamentos a faturar no período (para o aviso de duplicidade com
  // registro antigo de contêiner ligado à mesma operação).
  const operacoesComApontamento = useMemo(
    () => new Set(period.map((row) => row.operationId)),
    [period],
  );

  const byOperation = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        dailies: number;
        otMinutes: number;
        billed: number;
        dailyValue: number;
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
        dailyValue: 0,
        otValue: 0,
        cost: 0,
      };

      item.dailies += row.dailies;
      item.otMinutes += row.overtimeMinutes;
      item.billed += row.billed;
      item.dailyValue += row.dailyValue;
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
      dailiesDeDomingoOuFeriado: diariasDeDomingoOuFeriado(period),
      dailyValue: round2(sumBy(period, (row) => row.dailyValue)),
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
  // Custo dos serviços de Containers dos adicionais que entram nesta fatura (o mesmo da fatura emitida).
  const containers = useCustoDeContainersDoCliente(selectedClient, true);
  const custoContainers = somarCustoDosAdicionais(
    containers.data ?? [],
    adicionaisElegiveis.map((a) => a.id),
  );
  const custoTotal = round2(totals.cost + custoContainers);

  // CP-07 — conferência na confirmação. D4: dias da competência pelo estado do apontamento (o banco
  // fatura dia aberto ou fechado; a tela só avisa). Fatura já emitida que cobre o período (a nova
  // será complementar). Registro antigo de contêiner ligado à operação com apontamentos (CP-06),
  // repetido aqui para não depender de rolar até o bloco de adicionais.
  const dias = useMemo(
    () => resumoDosDias(rows, selectedClient, start, end),
    [rows, selectedClient, start, end],
  );
  const faturasDoPeriodo = useMemo(
    () => faturasQueCobremOPeriodo(invoices.data ?? [], selectedClient, start, end),
    [invoices.data, selectedClient, start, end],
  );
  const vinculosContainer = useQuery({
    queryKey: ["containers", "adicionais", selectedClient],
    enabled: regrasBs && selectedClient !== "",
    queryFn: () => carregarContainersAction({ clienteId: selectedClient }),
  });
  const duplicidades =
    vinculosContainer.data && vinculosContainer.data.ok
      ? adicionaisDeContainerEmDuplicidade(
          adicionaisElegiveis,
          vinculosContainer.data.data.servicos,
          operacoesComApontamento,
        )
      : [];
  const nomeDaOperacao = (id: string) =>
    (operations.data ?? []).find((operation) => operation.id === id)?.name ?? "—";

  const semNadaParaGerar =
    (!period.length && !adicionaisElegiveis.length) ||
    !adicionaisProntos ||
    !ajustesProntos ||
    !periodoEhCompetencia;

  // Diárias pelo componente (FIN-PR-03): adicional e horas especiais não entram aqui nem na HE.
  const dailiesValue = totals.dailyValue;

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

      if (!periodoEhCompetencia) {
        throw new Error("Escolha uma competência inteira da frequência do cliente.");
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
      // CP-07 (ED1): a fatura leva o que estava a faturar NO MOMENTO da emissão. Se alguém lançou,
      // corrigiu ou cancelou algo depois da conferência, o total difere — e a tela diz.
      const conferido = conferidoRef.current;
      setDivergencia(conferido && invoice ? divergenciaDaEmissao(conferido, invoice) : null);

      await atualizarDadosDaFatura();

      toast.success(
        invoice
          ? `Fatura gerada: ${brl(invoice.total_amount)} em ${num(
              invoice.total_dailies,
              0,
            )} diárias.`
          : "Fatura gerada.",
      );
    },

    onError: async (error: unknown) => {
      // CP-07 (CC1, RD1, RD2): outra aba pode ter faturado antes, e numa falha de rede a fatura
      // pode ter sido gravada com a resposta perdida. Relê tudo antes de qualquer nova tentativa.
      toast.error(mensagemDaEmissao(error));
      await atualizarDadosDaFatura();
    },
  });

  /** Relê tudo o que a fatura usa: lançamentos, folhas, faturas, adicionais e registros antigos. */
  async function atualizarDadosDaFatura() {
    await Promise.all(
      [
        ["invoices"],
        ["timesheet_entries"],
        ["timesheets"],
        CHAVE_DOS_ADICIONAIS,
        CHAVE_DOS_AJUSTES,
        CHAVE_DO_CUSTO_DE_CONTAINERS,
        ["containers", "adicionais"],
      ].map((queryKey) => queryClient.refetchQueries({ queryKey: [...queryKey] })),
    );
  }

  const conferidoRef = useRef<Conferido | null>(null);
  const [divergencia, setDivergencia] = useState<{ conferido: number; emitido: number } | null>(
    null,
  );

  // A fatura emitida é imutável: "Gerar fatura" só abre a confirmação. A emissão acontece em
  // "Emitir fatura", uma vez; a trava cobre dois cliques no mesmo instante, antes de isPending.
  const [confirmarFatura, setConfirmarFatura] = useState(false);
  const cancelarFaturaRef = useRef<HTMLButtonElement>(null);
  const emitindoRef = useRef(false);
  // D4: a confirmação mostra o estado ATUAL (outra aba pode ter fechado um dia, lançado ou
  // faturado): relê antes de abrir.
  const [conferindo, setConferindo] = useState(false);

  async function abrirConfirmacao() {
    if (conferindo) return;
    setConferindo(true);
    try {
      await atualizarDadosDaFatura();
    } finally {
      setConferindo(false);
    }
    setConfirmarFatura(true);
  }

  function emitirFatura() {
    if (emitindoRef.current || generate.isPending) return;
    emitindoRef.current = true;
    conferidoRef.current = {
      total: totalAFaturar,
      apontamentos: period.length,
      adicionais: adicionaisElegiveis.length,
    };
    setDivergencia(null);
    generate.mutate(undefined, {
      onSettled: () => {
        emitindoRef.current = false;
        setConfirmarFatura(false);
      },
    });
  }

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
      ROTULO_DA_PRESENCA[row.status] ?? row.status,
      row.workedMinutes,
      row.overtimeMinutes,
      reaisNoCsv(row.billed),
      reaisNoCsv(row.cost),
    ]);

    const csv = montarCsv(header, lines);

    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8",
      }),
    );

    const link = document.createElement("a");

    link.href = url;
    // CP-07: o nome identifica o cliente, como no Fechamento (dois clientes no mesmo período não
    // geram arquivos com o mesmo nome).
    link.download = `faturamento-${sanitizarParaArquivo(clientName(selectedClient))}-${start}-${end}.csv`;
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
              title="Extrato dos lançamentos (apontamentos) a faturar. Adicionais, serviços antigos de contêiner e arredondamento acumulado não entram: o espelho completo é o Excel do Fechamento."
            >
              <Download className="h-4 w-4" />
              Exportar lançamentos (CSV)
            </Button>

            <Button
              type="button"
              className="h-10 rounded-xl"
              onClick={() => void abrirConfirmacao()}
              disabled={semNadaParaGerar || !exibicao.podeAgir || generate.isPending || conferindo}
            >
              <FileText className="h-4 w-4" />

              {generate.isPending ? "Gerando..." : conferindo ? "Conferindo..." : "Gerar fatura"}
            </Button>
          </div>
        }
      />

      <AlertDialog
        open={confirmarFatura}
        onOpenChange={(aberto) => {
          if (!generate.isPending) setConfirmarFatura(aberto);
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelarFaturaRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Emitir fatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Confira os dados antes de emitir. A fatura emitida não pode ser alterada nem apagada.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{clientName(selectedClient)}</dd>
            <dt className="text-muted-foreground">Período</dt>
            <dd className="font-medium">
              {dateBR(start)} a {dateBR(end)}
            </dd>
            <dt className="text-muted-foreground">Apontamentos</dt>
            <dd className="font-medium">{period.length}</dd>
            <dt className="text-muted-foreground">Adicionais</dt>
            <dd className="font-medium">{adicionaisElegiveis.length}</dd>
            <dt className="text-muted-foreground">Total a faturar</dt>
            <dd className="font-semibold">{brl(totalAFaturar)}</dd>
            <dt className="text-muted-foreground">Dias com apontamento</dt>
            <dd className="font-medium">{rotuloDosDiasComApontamento(dias)}</dd>
            {dias.jaFaturados > 0 ? (
              <>
                <dt className="text-muted-foreground">Dias já faturados</dt>
                <dd className="font-medium">{dias.jaFaturados}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Dias sem apontamento</dt>
            <dd className="font-medium">
              {dias.semApontamento}{" "}
              <span className="text-xs font-normal text-muted-foreground">(não são pendência)</span>
            </dd>
          </dl>

          {dias.folhasAbertas.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
            >
              <p className="font-medium">
                {dias.abertos === 1
                  ? "1 dia com apontamento ainda aberto:"
                  : `${dias.abertos} dias com apontamento ainda aberto:`}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs leading-5">
                {dias.folhasAbertas.map((f) => (
                  <li key={`${f.data}-${f.operacao}-${f.turno}`}>
                    {dateBR(f.data)} — {f.operacao} · {f.turno}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs leading-5">
                Os lançamentos desses dias entram na fatura mesmo com o dia aberto, e o que for
                alterado depois não muda a fatura emitida. Se ainda houver conferência, feche o dia
                em Apontamentos antes de emitir.
              </p>
            </div>
          ) : null}

          {faturasDoPeriodo.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground"
            >
              <p className="font-medium">Já existe fatura deste cliente neste período:</p>
              <ul className="mt-1 list-disc pl-5 text-xs leading-5">
                {faturasDoPeriodo.map((f) => (
                  <li key={f.id}>
                    {dateBR(f.period_start)} a {dateBR(f.period_end)} — {brl(f.total_amount)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs leading-5">
                Esta será uma fatura complementar: leva só os lançamentos e adicionais ainda não
                faturados. O que já foi faturado não é cobrado de novo.
              </p>
            </div>
          ) : null}

          {duplicidades.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">
                Possível cobrança em duplicidade: o mesmo contêiner pode ser cobrado duas vezes (
                {[...new Set(duplicidades.map((d) => nomeDaOperacao(d.operacaoId)))].join(", ")}).
              </p>
              <p className="mt-1 text-xs leading-5">
                {duplicidades.length} registro(s) antigo(s) de contêiner ligado(s) a uma operação
                que também tem apontamentos nesta fatura. A emissão não é bloqueada: se for o mesmo
                serviço, cancele o registro antigo antes de emitir.
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelarFaturaRef} disabled={generate.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={generate.isPending}
              onClick={(event) => {
                event.preventDefault();
                emitirFatura();
              }}
            >
              {generate.isPending ? "Emitindo..." : "Emitir fatura"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="faturamento-cliente">Cliente</Label>

            <Select value={selectedClient} onValueChange={setClientId}>
              <SelectTrigger id="faturamento-cliente" className={SELECT_CLASS}>
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
            <Label htmlFor="faturamento-inicio">De</Label>

            <Input
              id="faturamento-inicio"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="faturamento-fim">Até</Label>

            <Input
              id="faturamento-fim"
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {periodoContratual ? (
            <div className="flex flex-wrap items-center gap-2 md:col-span-3">
              {competencia.isError ? (
                <p className="text-sm text-destructive">
                  Não foi possível ler a frequência de fechamento do cliente.
                </p>
              ) : frequencia === null ? (
                <p className="text-sm text-muted-foreground">Lendo a frequência de fechamento…</p>
              ) : (
                <>
                  <Badge variant="secondary">
                    Fechamento {ROTULO_DA_FREQUENCIA[frequencia].toLowerCase()}
                  </Badge>
                  {competenciasDoMesDoInicio.map((c) => (
                    <Button
                      key={c.inicio}
                      type="button"
                      variant={c.inicio === start && c.fim === end ? "default" : "outline"}
                      size="sm"
                      className="h-8 rounded-xl"
                      onClick={() => {
                        setStart(c.inicio);
                        setEnd(c.fim);
                      }}
                    >
                      {dateBR(c.inicio)} a {dateBR(c.fim)}
                    </Button>
                  ))}
                  {!periodoEhCompetencia ? (
                    <p className="w-full text-xs text-destructive">
                      A fatura é uma competência inteira:{" "}
                      {frequencia === "mensal"
                        ? "do dia 1 ao último dia do mês."
                        : "1 a 15 ou 16 ao último dia do mês."}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {divergencia ? (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-5 text-amber-800 dark:text-amber-300"
        >
          <p className="text-sm font-semibold">
            A fatura foi emitida com {brl(divergencia.emitido)}, diferente do conferido na
            confirmação ({brl(divergencia.conferido)}).
          </p>
          <p className="mt-1 text-xs leading-5">
            Houve lançamento, correção ou cancelamento depois da conferência. A fatura leva o que
            estava a faturar no momento da emissão: confira-a na lista de faturas.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-9 rounded-xl"
            onClick={() => setDivergencia(null)}
          >
            Entendi
          </Button>
        </div>
      ) : null}

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
              description={descricaoDasDiarias(brl(dailiesValue), totals.dailiesDeDomingoOuFeriado)}
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
              value={brl(totalAFaturar - custoTotal)}
              description={`${percentualDaMargem(totalAFaturar, custoTotal)} · custo ${brl(custoTotal)}${
                custoContainers > 0
                  ? ` (apontamentos ${brl(totals.cost)} + serviços antigos de contêiner ${brl(custoContainers)})`
                  : ""
              }`}
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
              aguardando={ajustes.isPending && !ajustes.isFetching}
              carregando={ajustes.isLoading}
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
              aguardando={adicionais.isPending && !adicionais.isFetching}
              carregando={adicionais.isLoading}
              erro={adicionais.isError}
              periodoContratual={periodoContratual}
              operacoesComApontamento={operacoesComApontamento}
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
