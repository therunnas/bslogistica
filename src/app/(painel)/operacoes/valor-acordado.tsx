"use client";

import { useMemo, useState } from "react";
import { History } from "lucide-react";

import { HistoricoDeVigencias } from "../_components/vigencias";
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
import { brl, dateBR } from "@/lib/format";
import {
  usePeriodoContratual,
  useRegistrarVigencia,
  useRegrasDaBs,
  useRegrasDefinitivas,
  useVersoes,
} from "@/lib/vigencias-dados";
import {
  hojeEmSaoPaulo,
  podeRegistrarVigencia,
  situacaoDaVersao,
  validarNovaVigencia,
  type EstadoDoMotorUI,
  type VersaoBase,
} from "@/lib/vigencias-ui";

/** Motivo gravado na trilha quando o valor é alterado por esta tela. */
export const MOTIVO_ALTERACAO_VALOR = "Alteração do valor acordado pela tela da operação";

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

type VersaoDoValor = VersaoBase & { agreed_amount?: number | string | null };

/**
 * Valor acordado da operação sem contrato, em forma simples: o valor que vale hoje e um
 * "Alterar valor" que só pede o novo valor e a partir de quando. Por trás continua a mesma
 * vigência (RPC registrar_valor_acordado_operacao), com a versão anterior encerrada no dia
 * anterior: apontamentos já gravados mantêm o valor congelado. O histórico completo, com
 * encerrar e aposentar, fica recolhido em "Ver histórico".
 */
export function ValorAcordadoDaOperacao({
  operacaoId,
  estado,
}: {
  operacaoId: string;
  estado: EstadoDoMotorUI;
}) {
  const versoes = useVersoes("operacao", operacaoId);
  const registrar = useRegistrarVigencia("operacao");
  const regrasBs = useRegrasDaBs();
  const regrasDefinitivas = useRegrasDefinitivas();
  const periodoContratual = usePeriodoContratual();
  const hoje = hojeEmSaoPaulo();
  const liberado = podeRegistrarVigencia(estado);

  const [aberto, setAberto] = useState(false);
  const [novoValor, setNovoValor] = useState("");
  const [inicio, setInicio] = useState(hoje);

  const vigente = useMemo(
    () =>
      ((versoes.data ?? []) as VersaoDoValor[]).find(
        (v) => v.active && situacaoDaVersao(v, hoje) === "vigente",
      ) ?? null,
    [versoes.data, hoje],
  );

  const form = {
    inicio,
    motivo: MOTIVO_ALTERACAO_VALOR,
    valores: { agreed_amount: novoValor },
    encerrarAnterior: true,
    fim: "",
    regrasBs,
    regrasDefinitivas,
    periodoContratual,
  };
  const erros = validarNovaVigencia("operacao", form);

  function abrir() {
    setNovoValor(vigente?.agreed_amount != null ? String(vigente.agreed_amount) : "");
    setInicio(hoje);
    setAberto(true);
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Valor acordado por diária</p>
          {versoes.isError ? (
            <p className="mt-1 text-sm text-destructive">Não foi possível carregar o valor.</p>
          ) : versoes.isPending ? (
            <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
          ) : vigente ? (
            <p className="mt-1 text-sm text-foreground">
              Valor atual: <strong>{brl(Number(vigente.agreed_amount ?? 0))}</strong>{" "}
              <span className="text-muted-foreground">desde {dateBR(vigente.valid_from)}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Sem valor vigente hoje.</p>
          )}
        </div>
        <Button type="button" className="h-9 rounded-xl" onClick={abrir} disabled={!liberado}>
          Alterar valor
        </Button>
      </div>

      <details className="text-sm">
        <summary className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden /> Ver histórico
        </summary>
        <div className="mt-3">
          <HistoricoDeVigencias
            tipo="operacao"
            entidadeId={operacaoId}
            estado={estado}
            valoresIniciais={{
              agreed_amount: vigente?.agreed_amount != null ? String(vigente.agreed_amount) : "",
            }}
          />
        </div>
      </details>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar valor acordado</DialogTitle>
            <DialogDescription>
              O novo valor vale a partir da data escolhida. Apontamentos já lançados continuam com o
              valor que tinham.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="valor-acordado-novo">Novo valor por diária (R$)</Label>
              <Input
                id="valor-acordado-novo"
                type="number"
                step="0.01"
                min="0"
                className={INPUT_CLASS}
                value={novoValor}
                onChange={(e) => setNovoValor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valor-acordado-inicio">A partir de</Label>
              <Input
                id="valor-acordado-inicio"
                type="date"
                className={INPUT_CLASS}
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            {erros.length > 0 && novoValor !== "" ? (
              <ul className="space-y-1 text-xs text-destructive">
                {erros.map((erro) => (
                  <li key={erro}>{erro}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={erros.length > 0 || registrar.isPending || !liberado}
              onClick={() =>
                registrar.mutate(
                  { entidadeId: operacaoId, form },
                  { onSuccess: () => setAberto(false) },
                )
              }
            >
              {registrar.isPending ? "Salvando..." : "Salvar novo valor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
