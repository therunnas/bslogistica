import type { Metadata } from "next";

import { PainelRelatorios } from "./painel-relatorios";

export const metadata: Metadata = {
  title: "Relatórios de diárias e resultado",
  description:
    "Relatórios por colaborador, operação e lançamento: diárias, faltas, horas extras, receita, custo e margem.",
  openGraph: {
    title: "Relatórios de diárias e resultado | BS Logística",
    description: "Diárias, faltas, horas extras, custo e margem por colaborador e operação.",
  },
};

export default function Relatorios() {
  return <PainelRelatorios />;
}
