"use client";

import { useMemo, useState } from "react";
import { History, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

import { brl, dateBR, num } from "@/lib/format";
import {
  useAposentarVigencia,
  useEncerrarVigencia,
  usePeriodoContratual,
  useRegistrarVigencia,
  useRegrasDaBs,
  useRegrasDefinitivas,
  useVersoes,
} from "@/lib/vigencias-dados";
import {
  ROTULO_DA_ORIGEM,
  ROTULO_DA_SITUACAO,
  avisoDoMotor,
  camposDaVigencia,
  classificarInicio,
  hojeEmSaoPaulo,
  podeRegistrarVigencia,
  situacaoDaVersao,
  validarNovaVigencia,
  type EstadoDoMotorUI,
  type TipoDeVigencia,
  type VersaoBase,
} from "@/lib/vigencias-ui";

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

/** Faixa que diz, em toda tela financeira, em que estado o motor está. */
export function AvisoDoMotor({ estado }: { estado: EstadoDoMotorUI }) {
  const aviso = avisoDoMotor(estado);
  return (
    <Alert
      variant={aviso.nivel === "alerta" ? "destructive" : "default"}
      className="mb-4 rounded-xl"
      data-estado-do-motor={estado.tag}
    >
      <AlertTitle>{aviso.titulo}</AlertTitle>
      <AlertDescription>{aviso.texto}</AlertDescription>
    </Alert>
  );
}

type VersaoComValores = VersaoBase & Record<string, unknown>;

function valoresDaVersao(tipo: TipoDeVigencia, v: VersaoComValores): string {
  if (tipo === "contrato") {
    const base = `${brl(Number(v["daily_rate"]))} · ${num(Number(v["shift_hours"]), 1)} h · HE ${num(Number(v["ot_factor"]), 2)}x · tol. ${Number(v["ot_tolerance_min"])} min`;
    // Parâmetros de horas só existem depois da migration 030.
    if (!("ot_rounding_mode" in v)) return base;
    const sabado = v["saturday_shift_hours"];
    const feriado = v["holiday_pay_factor"];
    return [
      base,
      v["ot_rounding_mode"] === "acumulado" ? "arred. acumulado" : "arred. diário",
      sabado === null || sabado === undefined ? null : `sáb. ${num(Number(sabado), 1)} h`,
      feriado === null || feriado === undefined ? null : `feriado ×${num(Number(feriado), 2)}`,
      // Frequência de fechamento só existe depois da migration 038.
      "closing_period" in v
        ? `fechamento ${v["closing_period"] === "mensal" ? "mensal" : "quinzenal"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (tipo === "colaborador") {
    // `ot_hourly_cost` só existe depois da migration 029.
    if (!("ot_hourly_cost" in v)) return brl(Number(v["daily_cost"]));
    const hora = v["ot_hourly_cost"];
    return `${brl(Number(v["daily_cost"]))} · HE paga ${
      hora === null || hora === undefined ? "sem valor-hora acordado" : `${brl(Number(hora))}/h`
    }`;
  }
  return brl(Number(v["agreed_amount"]));
}

const ROTULO_DO_TIPO: Readonly<Record<TipoDeVigencia, string>> = {
  contrato: "Condições do contrato",
  colaborador: "Custo diário do colaborador",
  operacao: "Valor acordado da operação",
};

export interface HistoricoDeVigenciasProps {
  tipo: TipoDeVigencia;
  entidadeId: string;
  estado: EstadoDoMotorUI;
  /** Valores sugeridos na nova vigência (os atuais do cadastro), por `chave` do campo. */
  valoresIniciais: Readonly<Record<string, string>>;
}

export function HistoricoDeVigencias({
  tipo,
  entidadeId,
  estado,
  valoresIniciais,
}: HistoricoDeVigenciasProps) {
  const versoes = useVersoes(tipo, entidadeId);
  const registrar = useRegistrarVigencia(tipo);
  const encerrar = useEncerrarVigencia(tipo);
  const aposentar = useAposentarVigencia(tipo);
  const regrasBs = useRegrasDaBs();
  const regrasDefinitivas = useRegrasDefinitivas();
  const periodoContratual = usePeriodoContratual();
  const campos = camposDaVigencia(tipo, regrasBs, regrasDefinitivas, periodoContratual);
  const hoje = hojeEmSaoPaulo();
  const liberado = podeRegistrarVigencia(estado);

  const [novaOpen, setNovaOpen] = useState(false);
  const [inicio, setInicio] = useState(hoje);
  const [motivo, setMotivo] = useState("");
  const [fimNova, setFimNova] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({ ...valoresIniciais });
  const [encerrarAnterior, setEncerrarAnterior] = useState(true);

  const [encerrando, setEncerrando] = useState<VersaoComValores | null>(null);
  const [fim, setFim] = useState(hoje);
  const [motivoFim, setMotivoFim] = useState("");

  const [aposentando, setAposentando] = useState<VersaoComValores | null>(null);
  const [motivoApos, setMotivoApos] = useState("");

  const erros = validarNovaVigencia(tipo, {
    inicio,
    motivo,
    valores,
    encerrarAnterior,
    fim: fimNova,
    regrasBs,
    regrasDefinitivas,
    periodoContratual,
  });
  const classe = classificarInicio(inicio, hoje);

  const linhas = useMemo(() => versoes.data ?? [], [versoes.data]);

  function abrirNova() {
    // Campo sem valor sugerido pelo cadastro (o valor-hora da 029) parte do da versão vigente,
    // para que um reajuste do custo não apague em silêncio o valor-hora acordado.
    const vigente = linhas.find((v) => v.active && situacaoDaVersao(v, hoje) === "vigente");
    const sugeridos: Record<string, string> = { ...valoresIniciais };
    for (const campo of campos) {
      const atual = vigente?.[campo.chave];
      if (!(campo.chave in sugeridos) && atual !== null && atual !== undefined) {
        sugeridos[campo.chave] = String(atual);
      }
    }
    setInicio(hoje);
    setMotivo("");
    setFimNova("");
    setValores(sugeridos);
    setEncerrarAnterior(true);
    setNovaOpen(true);
  }

  return (
    <section
      className="rounded-xl border border-border bg-secondary/20 p-4"
      aria-label={ROTULO_DO_TIPO[tipo]}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History className="h-4 w-4" aria-hidden /> {ROTULO_DO_TIPO[tipo]} — histórico de
            vigências
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada versão vale de uma data inicial até a final (exclusive). Todo reajuste exige motivo
            e fica na trilha.
          </p>
        </div>
        <Button type="button" className="h-9 rounded-xl" onClick={abrirNova} disabled={!liberado}>
          <Plus className="mr-2 h-4 w-4" aria-hidden /> Nova vigência
        </Button>
      </div>

      {versoes.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar o histórico de vigências.
        </p>
      ) : versoes.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando histórico…</p>
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma vigência cadastrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Valores</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Origem · motivo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((v) => {
                const situacao = situacaoDaVersao(v, hoje);
                const editavel = v.active && liberado;
                return (
                  <TableRow key={v.id} className="border-border">
                    <TableCell className="whitespace-nowrap">{dateBR(v.valid_from)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {v.valid_to ? dateBR(v.valid_to) : "em aberto"}
                    </TableCell>
                    <TableCell>{valoresDaVersao(tipo, v)}</TableCell>
                    <TableCell>
                      <Badge variant={situacao === "vigente" ? "default" : "secondary"}>
                        {ROTULO_DA_SITUACAO[situacao]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                      {ROTULO_DA_ORIGEM[v.origin] ?? v.origin} · {v.reason}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!editavel || v.valid_to !== null}
                        onClick={() => {
                          setEncerrando(v);
                          setFim(hoje);
                          setMotivoFim("");
                        }}
                      >
                        Encerrar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!editavel}
                        onClick={() => {
                          setAposentando(v);
                          setMotivoApos("");
                        }}
                      >
                        Aposentar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova vigência — {ROTULO_DO_TIPO[tipo].toLowerCase()}</DialogTitle>
            <DialogDescription>
              {classe === "futura"
                ? "Vigência FUTURA: fica preparada e passa a valer na data de início. Não altera nada hoje."
                : "Início hoje ou no passado: vale desde essa data para os apontamentos dela em diante."}
              {estado.tag === "desligado"
                ? " Enquanto as vigências não estiverem ativadas, os cálculos continuam usando as taxas do cadastro."
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="vigencia-inicio">Início da vigência</Label>
              <Input
                id="vigencia-inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className={INPUT_CLASS}
              />
              <Badge variant={classe === "futura" ? "default" : "secondary"}>
                {classe === "futura"
                  ? "Vigência futura"
                  : classe === "hoje"
                    ? "Alteração imediata (hoje)"
                    : "Retroativa"}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vigencia-fim-nova">Fim da vigência (opcional, exclusive)</Label>
              <Input
                id="vigencia-fim-nova"
                type="date"
                value={fimNova}
                onChange={(e) => setFimNova(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            {campos.map((campo) => (
              <div key={campo.chave} className="space-y-2">
                <Label htmlFor={`vigencia-${campo.chave}`}>{campo.rotulo}</Label>
                {campo.tipo === "escolha" ? (
                  <select
                    id={`vigencia-${campo.chave}`}
                    value={valores[campo.chave] || campo.padrao || ""}
                    onChange={(e) => setValores({ ...valores, [campo.chave]: e.target.value })}
                    className={`${INPUT_CLASS} w-full border px-3 text-sm`}
                  >
                    {(campo.opcoes ?? []).map((opcao) => (
                      <option key={opcao.valor} value={opcao.valor}>
                        {opcao.rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`vigencia-${campo.chave}`}
                    inputMode="decimal"
                    value={valores[campo.chave] ?? ""}
                    onChange={(e) => setValores({ ...valores, [campo.chave]: e.target.value })}
                    className={INPUT_CLASS}
                  />
                )}
              </div>
            ))}

            <div className="space-y-2">
              <Label htmlFor="vigencia-motivo">Motivo do reajuste (obrigatório)</Label>
              <Textarea
                id="vigencia-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={encerrarAnterior}
                onCheckedChange={(c) => setEncerrarAnterior(c === true)}
              />
              Encerrar a versão em aberto na data de início desta
            </label>

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
              onClick={() => setNovaOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={erros.length > 0 || registrar.isPending || !liberado}
              onClick={() =>
                registrar.mutate(
                  {
                    entidadeId,
                    form: {
                      inicio,
                      motivo,
                      valores,
                      encerrarAnterior,
                      fim: fimNova,
                      regrasBs,
                      regrasDefinitivas,
                      periodoContratual,
                    },
                  },
                  { onSuccess: () => setNovaOpen(false) },
                )
              }
            >
              Registrar vigência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={encerrando !== null} onOpenChange={(o) => !o && setEncerrando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Encerrar vigência</DialogTitle>
            <DialogDescription>
              A data final é exclusive. O banco recusa encerrar se algum apontamento ficar sem
              cobertura.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="vigencia-fim">Data final</Label>
              <Input
                id="vigencia-fim"
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vigencia-motivo-fim">Motivo (obrigatório)</Label>
              <Textarea
                id="vigencia-motivo-fim"
                value={motivoFim}
                onChange={(e) => setMotivoFim(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setEncerrando(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={motivoFim.trim() === "" || fim === "" || encerrar.isPending}
              onClick={() =>
                encerrando &&
                encerrar.mutate(
                  { termoId: encerrando.id, validTo: fim, motivo: motivoFim },
                  { onSuccess: () => setEncerrando(null) },
                )
              }
            >
              Encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aposentando !== null} onOpenChange={(o) => !o && setAposentando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aposentar vigência</DialogTitle>
            <DialogDescription>
              A versão deixa de valer e fica no histórico. O banco recusa aposentar uma versão já
              usada por apontamentos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vigencia-motivo-apos">Motivo (obrigatório)</Label>
            <Textarea
              id="vigencia-motivo-apos"
              value={motivoApos}
              onChange={(e) => setMotivoApos(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAposentando(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={motivoApos.trim() === "" || aposentar.isPending}
              onClick={() =>
                aposentando &&
                aposentar.mutate(
                  { termoId: aposentando.id, motivo: motivoApos },
                  { onSuccess: () => setAposentando(null) },
                )
              }
            >
              Aposentar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
