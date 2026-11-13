import { exigirAdmin } from "../../_exigir-admin";
import { CadastroDeContainerEncerrado } from "../cadastro-encerrado";

/** D7 (CP-06): cadastro novo encerrado; ver `cadastro-encerrado.tsx`. */
export default async function NovoContainer() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  return <CadastroDeContainerEncerrado />;
}
