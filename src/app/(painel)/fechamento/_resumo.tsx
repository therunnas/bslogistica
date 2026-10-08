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
  icon: Icon,
  tom,
}: {
  titulo: string;
  explicacao: string;
  valores: Valores;
  icon: LucideIcon;
  tom: "pendente" | "faturado";
}) {
  const itens: [string, string][] = [
    ["Faturado", moeda(valores.faturadoCentavos)],
    ["Diárias", String(valores.diarias)],
    ["Horas extras", horas(valores.minutosExtras)],
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
          rotulo="Horas extras"
          valor={horas(c.minutosExtras)}
          descricao={`${moeda(c.extraCentavos)} faturados em horas extras`}
          icon={Clock3}
        />

        <CartaoResumo
          rotulo="Faturado total"
          valor={moeda(c.faturadoCentavos)}
          descricao={`Diárias ${moeda(c.diariaCentavos)} + extras ${moeda(c.extraCentavos)}`}
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
          valor={moeda(c.resultadoCentavos)}
          descricao="Faturado total menos custo previsto"
          icon={TrendingUp}
        />

        <CartaoResumo
          rotulo="Margem"
          valor={margem(c.margemPermil)}
          descricao={
            c.margemPermil === null ? "Sem faturamento no período" : "Resultado sobre o faturado"
          }
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PainelDeFaturamento
          titulo="A faturar"
          explicacao="Lançamentos que ainda não entraram em nenhuma fatura."
          valores={dados.aFaturar}
          icon={ReceiptText}
          tom="pendente"
        />

        <PainelDeFaturamento
          titulo="Já faturado"
          explicacao="Lançamentos que já fazem parte de uma fatura gerada."
          valores={dados.jaFaturado}
          icon={CheckCircle2}
          tom="faturado"
        />
      </div>
    </section>
  );
}
