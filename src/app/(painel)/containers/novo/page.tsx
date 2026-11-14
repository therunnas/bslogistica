import { redirect } from "next/navigation";

import { CAMINHO_DO_CADASTRO_CANONICO } from "@/lib/container-servico-ui";

import { exigirAdmin } from "../../_exigir-admin";

/**
 * CP-06B: não existe cadastro separado de contêiner. A URL antiga leva ao cadastro canônico
 * (Operações → Nova operação → Avulsa), que explica a mudança. O servidor também recusa o
 * registro pelo caminho antigo (`registrarContainerAction`).
 */
export default async function NovoContainer() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  redirect(CAMINHO_DO_CADASTRO_CANONICO);
}
