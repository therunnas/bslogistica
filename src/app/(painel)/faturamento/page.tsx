import type { Metadata } from "next";

import { PainelFaturamento } from "./painel-faturamento";

export const metadata: Metadata = {
  title: "Faturamento por período",
  description:
    "Feche o período por cliente, some diárias e horas extras e gere a fatura com itens por operação.",
  openGraph: {
    title: "Faturamento por período | BS Logística",
    description: "Fechamento de diárias e horas extras por cliente e período.",
  },
};

export default function Faturamento() {
  return <PainelFaturamento />;
}
