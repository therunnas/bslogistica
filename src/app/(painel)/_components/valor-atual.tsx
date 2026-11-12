"use client";

import { useMemo, useState } from "react";
import { History } from "lucide-react";

import { HistoricoDeVigencias, valoresDaVersao } from "./vigencias";
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
import { dateBR } from "@/lib/format";
import {
  useCorrigirVigencia,
  usePeriodoContratual,
  useRegistrarVigencia,
  useRegrasDaBs,
  useRegrasDefinitivas,
  useResolucaoDeTarifas,
  useVersoes,
} from "@/lib/vigencias-dados";
import {
  camposDaVigencia,
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

type VersaoComValores = VersaoBase & Record<string, unknown>;

export interface ValorAtualProps {
  tipo: TipoDeVigencia;
  entidadeId: string;
  estado: EstadoDoMotorUI;
  /** Título do bloco, ex.: "Custo do colaborador". */
  titulo: string;
  /** Texto do botão, ex.: "Alterar custo". */
  rotuloDoBotao: string;
  /** Motivo gravado na trilha (a tela não pede motivo: a alteração é a rotina). */
  motivo: string;
}

/**
 * Valor que vale hoje em forma simples, com um "Alterar" que só pede os valores e a partir de quando.
 * Por trás é a mesma vigência (mesma RPC de registro), com a versão anterior terminando no dia
 * anterior: apontamentos já gravados mantêm o valor congelado. Os campos marcados `ocultoNaTela`
 * seguem com o valor de hoje. O histórico completo (data de fim, cancelar registro errado) fica
 * recolhido em "Ver histórico".
 */
export function ValorAtualComAlteracao({
  tipo,
  entidadeId,
  estado,
  titulo,
  rotuloDoBotao,
  motivo,
}: ValorAtualProps) {
  const versoes = useVersoes(tipo, entidadeId);
  const registrar = useRegistrarVigencia(tipo);
  const corrigir = useCorrigirVigencia(tipo);
  const regrasBs = useRegrasDaBs();
  const regrasDefinitivas = useRegrasDefinitivas();
  const periodoContratual = usePeriodoContratual();
  const resolucaoDeTarifas = useResolucaoDeTarifas();
  const hoje = hojeEmSaoPaulo();
  const liberado = podeRegistrarVigencia(estado);
  const campos = camposDaVigencia(tipo, regrasBs, regrasDefinitivas, periodoContratual);
  const visiveis = campos.filter(
    (campo) =>
      campo.ocultoNaTela !== true &&
      !(campo.ocultarComTarifas === true && resolucaoDeTarifas === true),
  );

  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(hoje);
  const [valores, setValores] = useState<Record<string, string>>({});

  const vigente = useMemo(
    () =>
      ((versoes.data ?? []) as VersaoComValores[]).find(
        (v) => v.active && situacaoDaVersao(v, hoje) === "vigente",
      ) ?? null,
    [versoes.data, hoje],
  );

  const form = {
    inicio,
    motivo,
    valores,
    encerrarAnterior: true,
    fim: "",
    regrasBs,
    regrasDefinitivas,
    periodoContratual,
  };
  const ativas = ((versoes.data ?? []) as VersaoComValores[]).filter((v) => v.active);
  // Já existe um valor começando nesta data: salvar CORRIGE esse valor (o banco não aceita dois
  // valores começando no mesmo dia).
  const mesmaData = ativas.find((v) => v.valid_from === inicio) ?? null;
  // Data ANTES do primeiro valor (ex.: o cadastro nasceu com início hoje e é preciso lançar dias
  // anteriores): salvar ANTECIPA o início do primeiro valor, pela mesma correção (o período só cresce,
  // então nenhum apontamento fica sem cobertura).
  const primeira = ativas.reduce<VersaoComValores | null>(
    (menor, v) => (menor === null || v.valid_from < menor.valid_from ? v : menor),
    null,
  );
  const antecipar =
    !mesmaData && primeira !== null && inicio !== "" && inicio < primeira.valid_from
      ? primeira
      : null;
  const alvo = mesmaData ?? antecipar;
  const erros = validarNovaVigencia(tipo, {
    ...form,
    fim: alvo?.valid_to ?? "",
    encerrarAnterior: alvo ? false : true,
  });
  const salvando = registrar.isPending || corrigir.isPending;

  function salvar() {
    const fechar = { onSuccess: () => setAberto(false) };
    if (alvo) {
      corrigir.mutate(
        {
          termoId: alvo.id,
          versao: { valid_from: antecipar ? inicio : alvo.valid_from, valid_to: alvo.valid_to },
          form,
        },
        fechar,
      );
      return;
    }
    registrar.mutate({ entidadeId, form }, fechar);
  }

  function valoresDe(versao: VersaoComValores | null): Record<string, string> {
    const atuais: Record<string, string> = {};
    for (const campo of campos) {
      const atual = versao?.[campo.chave];
      atuais[campo.chave] = atual === null || atual === undefined ? "" : String(atual);
    }
    return atuais;
  }

  function mudarInicio(data: string) {
    setInicio(data);
    // Corrigir ou antecipar parte dos valores do valor que será trocado, não dos de hoje.
    const igual = ativas.find((v) => v.valid_from === data) ?? null;
    const antes = !igual && primeira !== null && data !== "" && data < primeira.valid_from;
    setValores(valoresDe(igual ?? (antes ? primeira : vigente)));
  }

  function abrir() {
    // Todos os campos partem do valor de hoje; os ocultos seguem assim no envio.
    setValores(valoresDe(vigente));
    setInicio(hoje);
    setAberto(true);
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{titulo}</p>
          {versoes.isError ? (
            <p className="mt-1 text-sm text-destructive">Não foi possível carregar o valor.</p>
          ) : versoes.isPending ? (
            <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
          ) : vigente ? (
            <p className="mt-1 text-sm text-foreground">
              Valor atual: <strong>{valoresDaVersao(tipo, vigente)}</strong>{" "}
              <span className="text-muted-foreground">desde {dateBR(vigente.valid_from)}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Sem valor que valha hoje.</p>
          )}
        </div>
        <Button type="button" className="h-9 rounded-xl" onClick={abrir} disabled={!liberado}>
          {rotuloDoBotao}
        </Button>
      </div>

      <details className="text-sm">
        <summary className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden /> Ver histórico
        </summary>
        <div className="mt-3">
          <HistoricoDeVigencias
            tipo={tipo}
            entidadeId={entidadeId}
            estado={estado}
            valoresIniciais={{}}
            permitirNovo={false}
          />
        </div>
      </details>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{rotuloDoBotao}</DialogTitle>
            <DialogDescription>
              O novo valor vale a partir da data escolhida. Apontamentos já lançados continuam com o
              valor que tinham.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {visiveis.map((campo) => (
              <div key={campo.chave} className="space-y-2">
                <Label htmlFor={`valor-atual-${campo.chave}`}>{campo.rotulo}</Label>
                {campo.tipo === "escolha" ? (
                  <select
                    id={`valor-atual-${campo.chave}`}
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
                    id={`valor-atual-${campo.chave}`}
                    inputMode="decimal"
                    value={valores[campo.chave] ?? ""}
                    onChange={(e) => setValores({ ...valores, [campo.chave]: e.target.value })}
                    className={INPUT_CLASS}
                  />
                )}
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="valor-atual-inicio">A partir de</Label>
              <Input
                id="valor-atual-inicio"
                type="date"
                className={INPUT_CLASS}
                value={inicio}
                onChange={(e) => mudarInicio(e.target.value)}
              />
            </div>
            {mesmaData ? (
              <p className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                Já existe um valor começando nesta data ({valoresDaVersao(tipo, mesmaData)}). Salvar
                vai corrigir esse valor.
              </p>
            ) : antecipar ? (
              <p className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                O primeiro valor começa em {dateBR(antecipar.valid_from)}. Salvar vai fazer ele
                valer desde {dateBR(inicio)}, para poder lançar os dias anteriores.
              </p>
            ) : null}
            {erros.length > 0 ? (
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
              disabled={erros.length > 0 || salvando || !liberado}
              onClick={salvar}
            >
              {salvando
                ? "Salvando..."
                : mesmaData
                  ? "Corrigir valor"
                  : antecipar
                    ? "Antecipar início"
                    : "Salvar novo valor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
