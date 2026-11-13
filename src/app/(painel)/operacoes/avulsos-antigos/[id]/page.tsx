import type { Metadata } from "next";

import { exigirAdmin } from "../../../_exigir-admin";
import { DetalheDoContainer } from "../../../containers/detalhe-container";

export const metadata: Metadata = { title: "Serviço avulso antigo" };

/**
 * CP-06B: consulta de um registro antigo de contêiner DENTRO de Operações (histórico legado de
 * serviços avulsos). Não é um painel próprio: não há lista nem cadastro aqui; a lista fica na seção
 * "Serviços avulsos antigos" de Operações.
 */
export default async function AvulsoAntigo({ params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  return <DetalheDoContainer id={id} />;
}
