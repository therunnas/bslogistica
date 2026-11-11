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
import { Textarea } from "@/components/ui/textarea";

import { brl, dateBR, num } from "@/lib/format";
import {
  useAposentarVigencia,
  useEncerrarVigencia,
  usePeriodoContratual,
  useRegistrarVigencia,
  useRegrasDaBs,
  useRegrasDefinitivas,
  useResolucaoDeTarifas,
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

/** `YYYY-MM-DD` do dia anterior (o fim gravado é exclusivo; a tela mostra o último dia que vale). */
function diaAnterior(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

/**
 * Faixa que diz, nas telas financeiras, quando as regras financeiras NÃO estão no estado normal
 * (carregando, desligado ou não confirmado). No estado normal (motor ligado) não aparece: repetir o
 * mesmo aviso em toda tela só poluía (pedido do responsável, 11/11/2026).
 */
export function AvisoDoMotor({ estado }: { estado: EstadoDoMotorUI }) {
  if (estado.tag === "ligado") return null;
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

/** Os valores de uma versão em palavras simples (sem "HE", "tol." ou abreviações). */
export function valoresDaVersao(tipo: TipoDeVigencia, v: VersaoComValores): string {
  if (tipo === "contrato") {
    const partes = [
      `Diária ${brl(Number(v["daily_rate"]))}`,
      `hora extra ${num(Number(v["ot_factor"]), 2)}×`,
      `tolerância ${Number(v["ot_tolerance_min"])} min`,
    ];
    // Parâmetros de horas só existem depois da migration 030.
    if ("ot_rounding_mode" in v && v["ot_rounding_mode"] === "acumulado") {
      partes.push("hora extra somada no período");
    }
    // Frequência de fechamento só existe depois da migration 038.
    if ("closing_period" in v && v["closing_period"]) {
      partes.push(`fechamento ${v["closing_period"] === "mensal" ? "mensal" : "quinzenal"}`);
    }
    return partes.join(" · ");
  }
  if (tipo === "colaborador") {
    // `ot_hourly_cost` só existe depois da migration 029.
    if (!("ot_hourly_cost" in v)) return `${brl(Number(v["daily_cost"]))} por diária`;
    const hora = v["ot_hourly_cost"];
    return `${brl(Number(v["daily_cost"]))} por diária · hora extra ${
      hora === null || hora === undefined
        ? "calculada pela diária"
        : `${brl(Number(hora))} por hora`
    }`;
  }
  return `${brl(Number(v["agreed_amount"]))} por diária`;
}

const ROTULO_DO_TIPO: Readonly<Record<TipoDeVigencia, string>> = {
  contrato: "Condições do contrato",
  colaborador: "Custo do colaborador",
  operacao: "Valor da operação",
};

export interface HistoricoDeVigenciasProps {
  tipo: TipoDeVigencia;
  entidadeId: string;
  estado: EstadoDoMotorUI;
  /** Valores sugeridos na nova vigência (os atuais do cadastro), por `chave` do campo. */
  valoresIniciais: Readonly<Record<string, string>>;
  /**
   * `false` quando a tela já oferece o "Alterar" simples (valor atual + a partir de quando): o
   * histórico fica só para consultar, definir data de fim ou cancelar registro errado.
   */
  permitirNovo?: boolean;
}

export function HistoricoDeVigencias({
  tipo,
  entidadeId,
  estado,
  valoresIniciais,
  permitirNovo = true,
}: HistoricoDeVigenciasProps) {
  const versoes = useVersoes(tipo, entidadeId);
  const registrar = useRegistrarVigencia(tipo);
  const encerrar = useEncerrarVigencia(tipo);
  const aposentar = useAposentarVigencia(tipo);
  const regrasBs = useRegrasDaBs();
  const regrasDefinitivas = useRegrasDefinitivas();
  const periodoContratual = usePeriodoContratual();
  // Com a resolução por função ligada (041) a diária genérica não define o preço: o campo some e o
  // valor atual segue no envio, porque a RPC legada o exige.
  const resolucaoDeTarifas = useResolucaoDeTarifas();
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
            alterações
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada linha é um valor e o período em que vale. Mudar o valor não altera apontamentos já
            lançados.
          </p>
        </div>
        {permitirNovo ? (
          <Button type="button" className="h-9 rounded-xl" onClick={abrirNova} disabled={!liberado}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo valor
          </Button>
        ) : null}
      </div>

      {versoes.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
      ) : versoes.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando histórico…</p>
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum valor cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((v) => {
            const situacao = situacaoDaVersao(v, hoje);
            const editavel = v.active && liberado;
            return (
              <li
                key={v.id}
                className="rounded-xl border border-border bg-background/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{valoresDaVersao(tipo, v)}</p>
                  <Badge variant={situacao === "vigente" ? "default" : "secondary"}>
                    {ROTULO_DA_SITUACAO[situacao]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  A partir de {dateBR(v.valid_from)}
                  {v.valid_to
                    ? ` até ${dateBR(diaAnterior(v.valid_to))}`
                    : ", sem data de fim"} · {ROTULO_DA_ORIGEM[v.origin] ?? v.origin}: {v.reason}
                </p>
                {editavel ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {v.valid_to === null ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => {
                          setEncerrando(v);
                          setFim(hoje);
                          setMotivoFim("");
                        }}
                      >
                        Definir data de fim
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-muted-foreground"
                      onClick={() => {
                        setAposentando(v);
                        setMotivoApos("");
                      }}
                    >
                      Cancelar registro errado
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo valor — {ROTULO_DO_TIPO[tipo].toLowerCase()}</DialogTitle>
            <DialogDescription>
              {classe === "futura"
                ? "Data no futuro: o novo valor fica guardado e só começa a valer nesse dia."
                : "Vale a partir dessa data. Apontamentos de antes continuam com o valor que tinham."}
              {estado.tag === "desligado"
                ? " Enquanto as vigências não estiverem ativadas, os cálculos continuam usando as taxas do cadastro."
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="vigencia-inicio">A partir de</Label>
              <Input
                id="vigencia-inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className={INPUT_CLASS}
              />
              <Badge variant={classe === "futura" ? "default" : "secondary"}>
                {classe === "futura"
                  ? "Começa no futuro"
                  : classe === "hoje"
                    ? "Vale a partir de hoje"
                    : "Data no passado"}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vigencia-fim-nova">
                Termina em (opcional: vale até o dia anterior a esta data)
              </Label>
              <Input
                id="vigencia-fim-nova"
                type="date"
                value={fimNova}
                onChange={(e) => setFimNova(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            {campos
              .filter(
                (campo) =>
                  campo.ocultoNaTela !== true &&
                  !(campo.ocultarComTarifas === true && resolucaoDeTarifas === true),
              )
              .map((campo) => (
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
              <Label htmlFor="vigencia-motivo">Motivo da alteração (obrigatório)</Label>
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
              Terminar o valor anterior (ele vale até o dia anterior a esta data)
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
              Salvar novo valor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={encerrando !== null} onOpenChange={(o) => !o && setEncerrando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Definir data de fim</DialogTitle>
            <DialogDescription>
              O valor vale até o dia anterior a esta data. O sistema recusa se algum apontamento já
              lançado ficar sem valor.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="vigencia-fim">Termina em</Label>
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
              Definir data de fim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aposentando !== null} onOpenChange={(o) => !o && setAposentando(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar registro errado</DialogTitle>
            <DialogDescription>
              Use só para um valor lançado por engano. Ele deixa de valer e continua visível no
              histórico. O sistema recusa se ele já foi usado em algum apontamento.
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
              Voltar
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
              Cancelar registro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
