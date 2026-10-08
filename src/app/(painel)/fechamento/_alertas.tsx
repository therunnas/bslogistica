import { Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import { ROTULO_DA_SEVERIDADE, textoDoAlerta } from "@/lib/fechamento/apresentacao";
import type { Alerta, SeveridadeDoAlerta } from "@/lib/fechamento/tipos";
import { cn } from "@/lib/utils";

/**
 * Avisos sobre o que o fechamento encontrou. Só sinalizam: nenhum altera um
 * valor nem oferece "corrigir". A severidade vem em TEXTO e em ícone, nunca só
 * em cor.
 */

const ESTILO: Record<SeveridadeDoAlerta, { icone: LucideIcon; classes: string }> = {
  critico: {
    icone: OctagonAlert,
    classes: "border-destructive/40 bg-destructive/[0.06] text-foreground",
  },
  atencao: {
    icone: TriangleAlert,
    classes: "border-amber-500/40 bg-amber-500/[0.07] text-foreground",
  },
  informacao: {
    icone: Info,
    classes: "border-border bg-secondary/40 text-foreground",
  },
};

export function AlertasDoFechamento({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null;

  return (
    <section aria-labelledby="titulo-avisos" className="mb-6">
      <h2 id="titulo-avisos" className="mb-3 text-sm font-semibold tracking-tight text-foreground">
        Avisos
      </h2>

      <ul className="space-y-2">
        {alertas.map((alerta) => {
          const { icone: Icone, classes } = ESTILO[alerta.severidade];

          return (
            <li
              key={alerta.codigo}
              role={alerta.severidade === "critico" ? "alert" : undefined}
              className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", classes)}
            >
              <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />

              <p className="text-sm leading-6">
                <span className="mr-2 inline-block rounded-md border border-current/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                  {ROTULO_DA_SEVERIDADE[alerta.severidade]}
                </span>
                {textoDoAlerta(alerta)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
