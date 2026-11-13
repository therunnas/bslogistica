import { redirect } from "next/navigation";

import { caminhoDoAvulsoAntigo } from "@/lib/container-servico-ui";

import { exigirAdmin } from "../../_exigir-admin";

/** CP-06B: a URL antiga de um registro leva à consulta dentro de Operações. */
export default async function Container({ params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  redirect(caminhoDoAvulsoAntigo(id));
}
