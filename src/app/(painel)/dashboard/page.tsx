import type { Metadata } from "next";

import { PageHeader } from "../_components/app-shell";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Espaço reservado. O conteúdo real do dashboard é migrado na próxima etapa;
 * por ora esta rota existe para exercitar o layout protegido.
 */
export default function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral de diárias, horas extras, custos e margem."
      />
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Tela ainda não migrada. O conteúdo entra na próxima etapa.
        </p>
      </div>
    </>
  );
}
