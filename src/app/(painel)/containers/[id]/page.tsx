import { exigirAdmin } from "../../_exigir-admin";
import { DetalheDoContainer } from "../detalhe-container";

export default async function Container({ params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  return <DetalheDoContainer id={id} />;
}
