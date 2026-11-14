import { redirect } from "next/navigation";

import { CAMINHO_DOS_AVULSOS_ANTIGOS } from "@/lib/container-servico-ui";

import { exigirAdmin } from "../_exigir-admin";

/**
 * CP-06B: não existe mais painel de Contêineres ("O painel Container não é para mais existir").
 * A URL antiga só redireciona para a seção de serviços avulsos antigos, dentro de Operações. A
 * guarda vem antes: sem sessão de administrador, nada é revelado (nem o destino).
 */
export default async function Containers() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;
  redirect(CAMINHO_DOS_AVULSOS_ANTIGOS);
}
