import { redirect } from "next/navigation";

import { caminhoDaCorrecaoDoAvulsoAntigo } from "@/lib/container-servico-ui";

import { exigirAdmin } from "../../../_exigir-admin";

/** CP-06B: a URL antiga de correção leva à correção dentro de Operações. */
export default async function CorrigirContainer({ params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  redirect(caminhoDaCorrecaoDoAvulsoAntigo(id));
}
