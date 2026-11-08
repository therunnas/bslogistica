import { exigirAdmin } from "../../../_exigir-admin";
import { CorrecaoDoContainer } from "../../correcao-container";

export default async function CorrigirContainer({ params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const { id } = await params;
  return <CorrecaoDoContainer id={id} />;
}
