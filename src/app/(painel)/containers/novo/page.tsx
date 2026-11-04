import { exigirAdmin } from "../../_exigir-admin";
import { FormularioContainer } from "../formulario-container";

export default async function NovoContainer() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  return <FormularioContainer />;
}
