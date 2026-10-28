import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ReceiptText,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { horas, margem, moeda } from "@/lib/fechamento/apresentacao";
import type { FechamentoData, Valores } from "@/lib/fechamento/tipos";
import { cn } from "@/lib/utils";

/**
 * Resumo do período. Só exibe: cada número já vem pronto de `FechamentoData`
 * (centavos, minutos e milésimos do núcleo). Nada aqui soma, subtrai ou
 * arredonda dinheiro.
 */

function CartaoResumo({
  rotulo,
  valor,
  descricao,
  icon: Icon,
}: {
  rotulo: string;
  valor: string;
  descricao: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>

            <p className="mt-2 truncate text-2xl font-semibold tracking-[-0.035em] text-foreground">
              {valor}
            </p>

            <p className="mt-1 text-[11px] text-muted-foreground">{descricao}</p>
          </div>

          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary"
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PainelDeFaturamento({
  titulo,
  explicacao,
  valores,
  totalCentavos,
  icon: Icon,
  tom,
}: {
  titulo: string;
  explicacao: string;
  valores: Valores;
  /** Lançamentos + adicionais + ajuste de arredondamento desta situação (`financeiro`). */
  totalCentavos: number;
  icon: LucideIcon;
  tom: "pendente" | "faturado";
}) {
  const itens: [string, string][] = [
    ["Total com adicionais e ajuste", moeda(totalCentavos)],
    ["Apontamentos", moeda(valores.faturadoCentavos)],
    ["Diárias", String(valores.diarias)],
    ["Horas extras cobradas", horas(valores.minutosExtrasCobrados)],
    ["Custo previsto", moeda(valores.custoCentavos)],
    ["Resultado", moeda(valores.resultadoCentavos)],
    ["Margem", margem(valores.margemPermil)],
  ];

  return (
    <section
      aria-label={titulo}
      className={cn(
        "rounded-2xl border p-5",
        tom === "pendente"
          ? "border-primary/25 bg-primary/[0.04]"
          : "border-emerald-500/25 bg-emerald-500/[0.05]",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            tom === "pendente"
              ? "border-primary/20 bg-primary/10 text-primary"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>

        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{titulo}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{explicacao}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted-foreground">{rotulo}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
              {valor}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ResumoDoFechamento({ dados }: { dados: FechamentoData }) {
  const c = dados.consolidado;
  const f = dados.financeiro;

  return (
    <section aria-labelledby="titulo-resumo" className="mb-6">
      <h2 id="titulo-resumo" className="sr-only">
        Resumo do período
      </h2>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CartaoResumo
          rotulo="Diárias"
          valor={String(c.diarias)}
          descricao={
            dados.faltas > 0
              ? `${dados.faltas} ${dados.faltas === 1 ? "falta" : "faltas"}, sem valor`
              : "Presenças e substitutos"
          }
          icon={CalendarDays}
        />

        <CartaoResumo
          rotulo="Horas extras cobradas"
          valor={horas(c.minutosExtrasCobrados)}
          descricao={`${moeda(c.extraCentavos)} cobrados · excedente do custo ${horas(c.minutosExtras)}`}
          icon={Clock3}
        />

        <CartaoResumo
          rotulo="Receita total"
          valor={moeda(f.receitaCentavos)}
          descricao={`Apontamentos ${moeda(f.apontamentosCentavos)} + adicionais ${moeda(f.adicionaisCentavos)} + ajuste ${moeda(f.ajusteCentavos)}`}
          icon={ReceiptText}
        />

        <CartaoResumo
          rotulo="Custo previsto"
          valor={moeda(c.custoCentavos)}
          descricao="Valor devido aos colaboradores (previsto)"
          icon={WalletCards}
        />

        <CartaoResumo
          rotulo="Resultado"
          valor={moeda(f.resultadoCentavos)}
          descricao="Receita total menos custo previsto"
          icon={TrendingUp}
        />

        <CartaoResumo
          rotulo="Margem"
          valor={margem(f.margemPermil)}
          descricao={
            f.margemPermil === null ? "Sem receita no período" : "Resultado sobre a receita total"
          }
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PainelDeFaturamento
          titulo="A faturar"
          explicacao="Lançamentos, adicionais e ajuste de arredondamento que ainda não entraram em fatura."
          valores={dados.aFaturar}
          totalCentavos={f.aFaturarCentavos}
          icon={ReceiptText}
          tom="pendente"
        />

        <PainelDeFaturamento
          titulo="Já faturado"
          explicacao="O que já faz parte de uma fatura gerada."
          valores={dados.jaFaturado}
          totalCentavos={f.jaFaturadoCentavos}
          icon={CheckCircle2}
          tom="faturado"
        />
      </div>
    </section>
  );
}
