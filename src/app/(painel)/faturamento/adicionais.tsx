"use client";

import { useState } from "react";
import { PackagePlus, Plus } from "lucide-react";

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
  ROTULO_DA_SITUACAO_DO_ADICIONAL,
  adicionalForaDoPeriodo,
  janelaDeCobrancaDoAdicional,
  situacaoDoAdicional,
  temCompetencia,
  validarAdicional,
  type Adicional,
} from "@/lib/adicionais";
import { useCancelarAdicional, useRegistrarAdicional } from "@/lib/adicionais-dados";
import { competenciasDoMes, type FrequenciaDeFechamento } from "@/lib/fechamento/periodo";
import { brl, dateBR } from "@/lib/format";
import { useCompetenciaDeCobranca } from "@/lib/vigencias-dados";
import { ROTULO_DA_FREQUENCIA } from "@/lib/vigencias-ui";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SEM_OPERACAO = "__sem_operacao__";

const MES_ISO = /^(\d{4})-(\d{2})$/;

/** Competências do mês escolhido (`YYYY-MM`) na frequência do cliente; vazio se faltar algo. */
function competenciasDaEscolha(frequencia: FrequenciaDeFechamento | null, mes: string) {
  const m = MES_ISO.exec(mes);
  if (frequencia === null || m === null) return [];
  const numeroDoMes = Number(m[2]);
  if (numeroDoMes < 1 || numeroDoMes > 12) return [];
  return competenciasDoMes(frequencia, Number(m[1]), numeroDoMes);
}

export interface AdicionaisDoPeriodoProps {
  clienteId: string;
  inicio: string;
  fim: string;
  operacoes: readonly { id: string; name: string }[];
  adicionais: readonly Adicional[];
  /** Consulta desabilitada (sem cliente ou sem período válido): orienta, não "carrega". */
  aguardando: boolean;
  carregando: boolean;
  erro: boolean;
  /** O banco tem a migration 038: o adicional nasce com a competência de cobrança escolhida. */
  periodoContratual?: boolean;
}

/**
 * Adicionais de serviço do cliente (migration 029): valores extras do período, separados da
 * diária. Entram na fatura os não cancelados com a janela de cobrança inteira dentro do período da
 * fatura: a competência escolhida (038) ou, sem ela, o período de execução.
 */
export function AdicionaisDoPeriodo({
  clienteId,
  inicio,
  fim,
  operacoes,
  adicionais,
  aguardando,
  carregando,
  erro,
  periodoContratual = false,
}: AdicionaisDoPeriodoProps) {
  const registrar = useRegistrarAdicional();
  const cancelar = useCancelarAdicional();

  const [novoOpen, setNovoOpen] = useState(false);
  const [operacaoId, setOperacaoId] = useState("");
  const [inicioNovo, setInicioNovo] = useState(inicio);
  const [fimNovo, setFimNovo] = useState(fim);
  const [motivo, setMotivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [valor, setValor] = useState("");
  // Competência de cobrança (038): o mês e, na quinzenal, qual das duas quinzenas.
  const [mesCompetencia, setMesCompetencia] = useState(inicio.slice(0, 7));
  const [indiceCompetencia, setIndiceCompetencia] = useState(0);

  const [cancelando, setCancelando] = useState<Adicional | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");

  // A frequência é a do MÊS escolhido (pode mudar de um mês para outro): o banco informa.
  const frequenciaDoMes = useCompetenciaDeCobranca(
    clienteId,
    `${mesCompetencia}-01`,
    periodoContratual && novoOpen && MES_ISO.test(mesCompetencia),
  );
  const frequencia = frequenciaDoMes.data?.frequencia ?? null;
  const competencias = competenciasDaEscolha(frequencia, mesCompetencia);
  const competencia = competencias[Math.min(indiceCompetencia, competencias.length - 1)];

  const formulario = {
    clienteId,
    operacaoId,
    inicio: inicioNovo,
    fim: fimNovo,
    motivo,
    referencia,
    valor,
    ...(periodoContratual ? { competencia: competencia ?? { inicio: "", fim: "" } } : {}),
  };
  const erros = [
    ...(periodoContratual && frequenciaDoMes.isError
      ? ["Não foi possível ler a frequência de fechamento do cliente neste mês."]
      : periodoContratual && frequencia === null
        ? ["Aguarde a frequência de fechamento do cliente."]
        : []),
    ...validarAdicional(formulario),
  ];

  // Todo adicional do cliente que toca o período (pela execução ou pela cobrança), em qualquer situação.
  const doPeriodo = adicionais.filter((a) => {
    const janela = janelaDeCobrancaDoAdicional(a);
    return (
      a.client_id === clienteId &&
      ((a.period_start <= fim && a.period_end >= inicio) ||
        (janela.inicio <= fim && janela.fim >= inicio))
    );
  });
  const nomeDaOperacao = (id: string | null) =>
    id === null ? "—" : (operacoes.find((o) => o.id === id)?.name ?? "—");

  function abrirNovo() {
    setOperacaoId("");
    setInicioNovo(inicio);
    setFimNovo(fim);
    setMotivo("");
    setReferencia("");
    setValor("");
    setMesCompetencia(inicio.slice(0, 7));
    setIndiceCompetencia(Number(inicio.slice(8, 10)) > 15 ? 1 : 0);
    setNovoOpen(true);
  }

  return (
    <Card className="mb-6 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
              <PackagePlus className="h-4 w-4" />
            </div>

            <div>
              <CardTitle className="text-sm font-semibold tracking-tight">
                Adicionais de serviço
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Valores extras do período (etiquetagem, separação, contêiner…), separados da diária.
                {periodoContratual
                  ? " Entram na fatura da competência de cobrança escolhida, mesmo executados em outra data."
                  : " Entram na fatura os que estão inteiramente dentro do período."}
              </p>
            </div>
          </div>

          <Button
            type="button"
            className="h-9 rounded-xl"
            onClick={abrirNovo}
            disabled={clienteId === ""}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo adicional
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {erro ? (
          <p className="p-5 text-sm text-destructive">Não foi possível carregar os adicionais.</p>
        ) : aguardando ? (
          <p className="p-5 text-sm text-muted-foreground">
            Selecione um cliente e um período válido para ver os adicionais.
          </p>
        ) : carregando ? (
          <p className="p-5 text-sm text-muted-foreground">Carregando adicionais…</p>
        ) : doPeriodo.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            Nenhum adicional deste cliente no período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead>{periodoContratual ? "Execução" : "Período"}</TableHead>
                  {periodoContratual ? <TableHead>Competência</TableHead> : null}
                  <TableHead>Motivo · referência</TableHead>
                  <TableHead>Operação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doPeriodo.map((a) => {
                  const situacao = situacaoDoAdicional(a);
                  const fora = adicionalForaDoPeriodo(a, clienteId, inicio, fim);
                  return (
                    <TableRow key={a.id} className="border-border">
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateBR(a.period_start)} – {dateBR(a.period_end)}
                        {fora ? (
                          <p className="text-xs text-destructive">
                            Ultrapassa o período: não entra nesta fatura.
                          </p>
                        ) : null}
                      </TableCell>
                      {periodoContratual ? (
                        <TableCell className="whitespace-nowrap text-sm">
                          {temCompetencia(a) ? (
                            `${dateBR(a.billing_period_start as string)} – ${dateBR(a.billing_period_end as string)}`
                          ) : (
                            <span className="text-muted-foreground">Pela execução</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="max-w-[320px] text-sm">
                        {a.description}
                        {a.reference ? (
                          <span className="text-muted-foreground"> · ref. {a.reference}</span>
                        ) : null}
                        {a.cancel_reason ? (
                          <p className="text-xs text-muted-foreground">
                            Cancelado: {a.cancel_reason}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {nomeDaOperacao(a.operation_id)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {brl(Number(a.amount))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={situacao === "a-faturar" ? "default" : "secondary"}>
                          {ROTULO_DA_SITUACAO_DO_ADICIONAL[situacao]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={situacao !== "a-faturar"}
                          onClick={() => {
                            setCancelando(a);
                            setMotivoCancelamento("");
                          }}
                        >
                          Cancelar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo adicional de serviço</DialogTitle>
            <DialogDescription>
              Valor extra do período, sem alterar a diária. Fica na trilha e não pode ser editado:
              para corrigir, cancele com motivo e registre outro.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adicional-inicio">
                  {periodoContratual ? "Início da execução" : "Início do período"}
                </Label>
                <Input
                  id="adicional-inicio"
                  type="date"
                  value={inicioNovo}
                  onChange={(e) => setInicioNovo(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adicional-fim">
                  {periodoContratual ? "Fim da execução" : "Fim do período"}
                </Label>
                <Input
                  id="adicional-fim"
                  type="date"
                  value={fimNovo}
                  onChange={(e) => setFimNovo(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            {periodoContratual ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="adicional-competencia-mes">Competência de cobrança (mês)</Label>
                  <Input
                    id="adicional-competencia-mes"
                    type="month"
                    value={mesCompetencia}
                    onChange={(e) => setMesCompetencia(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adicional-competencia">
                    {frequencia === null
                      ? "Competência"
                      : `Competência (${ROTULO_DA_FREQUENCIA[frequencia].toLowerCase()})`}
                  </Label>
                  <select
                    id="adicional-competencia"
                    value={String(
                      Math.min(indiceCompetencia, Math.max(competencias.length - 1, 0)),
                    )}
                    onChange={(e) => setIndiceCompetencia(Number(e.target.value))}
                    disabled={competencias.length === 0}
                    className={`${INPUT_CLASS} w-full border px-3 text-sm`}
                  >
                    {competencias.map((c, i) => (
                      <option key={c.inicio} value={String(i)}>
                        {dateBR(c.inicio)} a {dateBR(c.fim)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  A competência é quando o adicional é cobrado; pode ser antes da execução.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Operação (opcional)</Label>
              <Select
                value={operacaoId === "" ? SEM_OPERACAO : operacaoId}
                onValueChange={(v) => setOperacaoId(v === SEM_OPERACAO ? "" : v)}
              >
                <SelectTrigger className={INPUT_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_OPERACAO}>Sem operação específica</SelectItem>
                  {operacoes.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adicional-motivo">Motivo / serviço (obrigatório)</Label>
              <Textarea
                id="adicional-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adicional-referencia">Referência (OS, contêiner…)</Label>
                <Input
                  id="adicional-referencia"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adicional-valor">Valor (R$)</Label>
                <Input
                  id="adicional-valor"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
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
              onClick={() => registrar.mutate(formulario, { onSuccess: () => setNovoOpen(false) })}
            >
              Registrar adicional
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelando !== null} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar adicional</DialogTitle>
            <DialogDescription>
              O adicional não é apagado: fica no histórico como cancelado, com o motivo. Adicional
              já faturado não pode ser cancelado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="adicional-motivo-cancelamento">Motivo (obrigatório)</Label>
            <Textarea
              id="adicional-motivo-cancelamento"
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setCancelando(null)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={motivoCancelamento.trim() === "" || cancelar.isPending}
              onClick={() =>
                cancelando &&
                cancelar.mutate(
                  { id: cancelando.id, motivo: motivoCancelamento },
                  { onSuccess: () => setCancelando(null) },
                )
              }
            >
              Cancelar adicional
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
