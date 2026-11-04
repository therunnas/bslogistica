import { exigirAdmin } from "../_exigir-admin";
import { ListaContainers } from "./lista-containers";

export default async function Containers() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  return <ListaContainers />;
}
