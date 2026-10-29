import type { Metadata } from "next";

import {
  VARIAVEL_DE_ATIVACAO,
  VARIAVEL_DE_REVERSAO,
  ativacaoHabilitada,
  reversaoHabilitada,
} from "@/lib/ativacao-motor";

import { exigirAdminAal2Tela } from "../_exigir-admin";
import { PainelImplantacaoVigencias } from "./painel-implantacao";

export const metadata: Metadata = {
  title: "Implantação das vigências",
  description: "Cadastros sem vigência ou com taxa diferente da vigência de hoje.",
};

export default async function ImplantacaoVigencias() {
  // Bloqueio server-side, como nas demais telas administrativas.
  const bloqueio = await exigirAdminAal2Tela();
  if (bloqueio) return bloqueio;

  // A trava é lida aqui, no servidor; o navegador só recebe o resultado. Quem recusa é a Server
  // Action, que repete a leitura: esta prop só decide o que a tela mostra.
  return (
    <PainelImplantacaoVigencias
      ativacaoHabilitada={ativacaoHabilitada(process.env[VARIAVEL_DE_ATIVACAO])}
      reversaoHabilitada={reversaoHabilitada(process.env[VARIAVEL_DE_REVERSAO])}
    />
  );
}
