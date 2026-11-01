"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import { brl } from "@/lib/format";
import { nomeDaFuncao, type FuncaoDoCatalogo } from "@/lib/funcoes";
import {
  dataBr,
  funcoesDoQuadro,
  montarQuadroDeTarifas,
  rotuloDaVigencia,
  validarTarifa,
  type CelulaDoQuadro,
  type PeriodoDaTarifa,
  type TarifaDoContrato,
} from "@/lib/tarifas";
import {
  useAlterarResolucaoDeTarifas,
  useRegistrarTarifa,
  useTarifasDoContrato,
} from "@/lib/tarifas-dados";
import { hojeEmSaoPaulo } from "@/lib/vigencias-ui";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

export interface TarifasDoContratoProps {
  contrato: { id: string; name: string } | null;
  aoFechar: () => void;
  funcoes: readonly FuncaoDoCatalogo[];
  /** A resolução por função e período está ligada? `null` = a leitura do estado falhou. */
  resolucaoLigada: boolean | null;
}

const ROTULO_DO_PERIODO = { diurno: "Diurno", noturno: "Noturno" } as const;

/**
 * Tarifas do contrato por função e período do turno (migration 041). É o preço cobrado do CLIENTE
 * (nunca o custo do colaborador). Mudança comercial cria uma versão nova com data de início: a
 * anterior é encerrada e as faturas já emitidas não mudam. Sem tarifa na célula, mostra "Não
 * configurada" — nunca zero.
 */
export function TarifasDoContrato({
  contrato,
  aoFechar,
  funcoes,
  resolucaoLigada,
}: TarifasDoContratoProps) {
  const contratoId = contrato?.id ?? "";
  const tarifas = useTarifasDoContrato(contratoId, contrato !== null);
  const registrar = useRegistrarTarifa();
  const alterarResolucao = useAlterarResolucaoDeTarifas();

  const hoje = hojeEmSaoPaulo();
  const dados = tarifas.data;
  const lista: readonly TarifaDoContrato[] = useMemo(() => dados ?? [], [dados]);
  const quadro = useMemo(
    () => montarQuadroDeTarifas(lista, funcoesDoQuadro(lista, funcoes), hoje),
    [lista, funcoes, hoje],
  );

  const [edicao, setEdicao] = useState<{
    funcaoId: string;
    periodo: PeriodoDaTarifa;
  } | null>(null);
  const [inicio, setInicio] = useState(hoje);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [motivoResolucao, setMotivoResolucao] = useState("");

  const erros = edicao
    ? validarTarifa({
        contratoId,
        funcaoId: edicao.funcaoId,
        periodo: edicao.periodo,
        inicio,
        valor,
        motivo,
      })
    : [];

  function abrir(funcaoId: string, periodo: PeriodoDaTarifa) {
    setEdicao({ funcaoId, periodo });
    setInicio(hoje);
    setValor("");
    setMotivo("");
  }

  function celula(funcaoId: string, c: CelulaDoQuadro) {
    return (
      <TableCell className="align-top">
        {c.tarifa ? (
          <div>
            <p className="text-sm font-semibold">{brl(Number(c.tarifa.daily_rate))}</p>
            <p className="text-xs text-muted-foreground">{rotuloDaVigencia(c.tarifa)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Não configurada</p>
        )}
        {c.proxima ? (
          <p className="mt-1 text-xs text-muted-foreground">
            A partir de {dataBr(c.proxima.valid_from)}: {brl(Number(c.proxima.daily_rate))}
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-xs"
          onClick={() => abrir(funcaoId, c.periodo)}
          aria-label={`${c.tarifa ? "Alterar" : "Definir"} tarifa ${ROTULO_DO_PERIODO[c.periodo].toLowerCase()} de ${nomeDaFuncao(funcoes, funcaoId)}`}
        >
          <Plus className="h-3 w-3" aria-hidden />
          {c.tarifa ? "Alterar" : "Definir"}
        </Button>
      </TableCell>
    );
  }

  return (
    <Dialog open={contrato !== null} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl tracking-[-0.025em]">
            Tarifas — {contrato?.name}
          </DialogTitle>
          <DialogDescription>
            Preço cobrado do cliente por função e período do turno. Uma mudança comercial cria uma
            versão nova com data de início; as faturas já emitidas não mudam. Diurno e noturno podem
            ter preços diferentes.
          </DialogDescription>
        </DialogHeader>

        <section
          className="rounded-xl border border-border bg-secondary/30 p-4"
          aria-labelledby="tarifas-resolucao"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="tarifas-resolucao" className="text-sm font-semibold">
              Preço por função e período
            </h3>
            {resolucaoLigada === null ? (
              <Badge variant="destructive">Estado desconhecido</Badge>
            ) : resolucaoLigada ? (
              <Badge>Ligado</Badge>
            ) : (
              <Badge variant="secondary">Desligado</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolucaoLigada === null
              ? "Não foi possível ler o estado. Nada é alterado sem a confirmação."
              : resolucaoLigada
                ? "Os apontamentos de contrato são cobrados pela tarifa da função e do período do turno do dia. Sem função, sem classificação do turno ou sem tarifa, o apontamento é recusado (nunca cobrado como zero)."
                : "Enquanto desligado, o preço continua sendo a diária genérica do contrato. Cadastrar tarifas aqui não muda nenhum valor até a resolução ser ligada."}
          </p>
          {resolucaoLigada !== null ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="motivo-resolucao" className="text-xs">
                  Motivo para {resolucaoLigada ? "desligar" : "ligar"}
                </Label>
                <Input
                  id="motivo-resolucao"
                  value={motivoResolucao}
                  onChange={(e) => setMotivoResolucao(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <Button
                type="button"
                variant={resolucaoLigada ? "outline" : "default"}
                className="rounded-xl"
                disabled={motivoResolucao.trim() === "" || alterarResolucao.isPending}
                onClick={() =>
                  alterarResolucao.mutate(
                    { ligar: !resolucaoLigada, motivo: motivoResolucao },
                    { onSuccess: () => setMotivoResolucao("") },
                  )
                }
              >
                {resolucaoLigada ? "Desligar" : "Ligar"}
              </Button>
            </div>
          ) : null}
        </section>

        {tarifas.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as tarifas.</p>
        ) : tarifas.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando tarifas…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead>Função</TableHead>
                  <TableHead>Diurno</TableHead>
                  <TableHead>Noturno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quadro.map((linha) => (
                  <TableRow key={linha.funcaoId} className="border-border">
                    <TableCell className="align-top text-sm font-medium">
                      {nomeDaFuncao(funcoes, linha.funcaoId)}
                    </TableCell>
                    {celula(linha.funcaoId, linha.celulas[0])}
                    {celula(linha.funcaoId, linha.celulas[1])}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {edicao ? (
          <form
            className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (erros.length > 0) return;
              registrar.mutate(
                {
                  contratoId,
                  funcaoId: edicao.funcaoId,
                  periodo: edicao.periodo,
                  inicio,
                  valor,
                  motivo,
                },
                { onSuccess: () => setEdicao(null) },
              );
            }}
          >
            <p className="text-sm font-semibold sm:col-span-2">
              {nomeDaFuncao(funcoes, edicao.funcaoId)} — {ROTULO_DO_PERIODO[edicao.periodo]}
            </p>
            <div className="space-y-1">
              <Label htmlFor="tarifa-inicio">Vigente a partir de</Label>
              <Input
                id="tarifa-inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tarifa-valor">Diária cobrada (R$)</Label>
              <Input
                id="tarifa-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="Ex.: 160,00"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="tarifa-motivo">Motivo (obrigatório)</Label>
              <Textarea
                id="tarifa-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="rounded-xl"
              />
            </div>
            {valor.trim() !== "" || motivo.trim() !== "" ? (
              erros.length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-destructive sm:col-span-2">
                  {erros.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null
            ) : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setEdicao(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="rounded-xl"
                disabled={erros.length > 0 || registrar.isPending}
              >
                Registrar tarifa
              </Button>
            </div>
          </form>
        ) : null}

        <DialogFooter>
          <Button type="button" className="rounded-xl" onClick={aoFechar}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
