import { exigirAdmin } from "../../_exigir-admin";
import { FormularioContainer } from "../formulario-container";

export default async function NovoContainer({
  searchParams,
}: {
  searchParams?: Promise<{ operacao?: string | string[] }>;
}) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  const origem = (await searchParams)?.operacao;
  if (origem === undefined) return <FormularioContainer key="geral" />;
  return <FormularioContainer key={JSON.stringify(origem ?? null)} operacaoInicialId={origem} />;
}
