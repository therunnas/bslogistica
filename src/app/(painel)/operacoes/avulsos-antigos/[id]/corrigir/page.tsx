import type { Metadata } from "next";

import { exigirAdmin } from "../../../../_exigir-admin";
import { CorrecaoDoContainer } from "../../../../containers/correcao-container";

export const metadata: Metadata = { title: "Corrigir serviço avulso antigo" };

/** CP-06B: correção auditada (049) de um registro antigo, dentro de Operações. */
export default async function CorrigirAvulsoAntigo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  return <CorrecaoDoContainer id={id} />;
}
