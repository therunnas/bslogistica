"use client";

import { useEffect, useState } from "react";

import { SECAO_DE_AVULSOS_ANTIGOS } from "@/lib/container-servico-ui";

import { ListaContainers } from "../containers/lista-containers";

/**
 * CP-06B: histórico legado de serviços avulsos de contêiner, DENTRO de Operações. Não há painel
 * próprio de Contêineres: os registros antigos ficam aqui, recolhidos, para consulta, correção e
 * cancelamento. Quem chega por `/containers` (URL antiga) é redirecionado para esta seção aberta.
 */
export function AvulsosAntigos() {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (window.location.hash === `#${SECAO_DE_AVULSOS_ANTIGOS}`) setAberto(true);
  }, []);
  return (
    <section
      id={SECAO_DE_AVULSOS_ANTIGOS}
      className="mt-8 rounded-2xl border border-border bg-card px-5 py-4"
    >
      <details open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Serviços avulsos antigos (registros do cadastro antigo de contêiner)
        </summary>
        {aberto ? (
          <div className="mt-4">
            <ListaContainers />
          </div>
        ) : null}
      </details>
    </section>
  );
}
