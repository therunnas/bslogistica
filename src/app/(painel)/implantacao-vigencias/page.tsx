import type { Metadata } from "next";

import { exigirAdmin } from "../_exigir-admin";
import { PainelImplantacaoVigencias } from "./painel-implantacao";

export const metadata: Metadata = {
  title: "Implantação das vigências",
  description: "Cadastros sem vigência ou com taxa diferente da vigência de hoje.",
};

export default async function ImplantacaoVigencias() {
  // Bloqueio server-side, como nas demais telas administrativas.
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  return <PainelImplantacaoVigencias />;
}
