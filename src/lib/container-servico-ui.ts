import type { ResultadoContainer, ServicoContainerLista } from "./container-servico-dados";

/** Uma falha de leitura nunca autoriza oferecer o cancelamento genérico. */
export function decidirAcaoAdicionalContainer(
  consulta:
    | ResultadoContainer<{
        servicos: Pick<ServicoContainerLista, "id" | "billing_additional_id">[];
      }>
    | undefined,
  adicionalId: string,
): { tipo: "container"; id: string } | { tipo: "legado" | "bloqueado" } {
  if (!consulta) return { tipo: "bloqueado" };
  if (!consulta.ok)
    return {
      tipo:
        consulta.codigo === "indisponivel" && consulta.schemaLegado === true
          ? "legado"
          : "bloqueado",
    };
  const vinculo = consulta.data.servicos.find((s) => s.billing_additional_id === adicionalId);
  return vinculo ? { tipo: "container", id: vinculo.id } : { tipo: "legado" };
}
