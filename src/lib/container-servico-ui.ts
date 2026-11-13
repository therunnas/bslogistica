import type { ResultadoContainer, ServicoContainerLista } from "./container-servico-dados";

/**
 * D7 (QA-BS-01, CP-06). Contêiner é um TIPO de serviço avulso, não uma terceira modalidade. O
 * fluxo canônico do serviço avulso é a operação avulsa (decisão do #121: "serviço pontual vira
 * operação avulsa"). O cadastro separado de containers (045–050) saiu do menu no #121, mas seguia
 * aberto por URL: um mesmo contêiner podia ser cobrado pela operação avulsa (apontamentos) e de
 * novo pelo adicional que o cadastro antigo gera. O cadastro NOVO por esse caminho está
 * encerrado; os registros antigos continuam para consulta, correção e cancelamento.
 */
export const MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO =
  "O cadastro separado de containers foi encerrado. Contêiner é um tipo de serviço avulso: cadastre em Operações → Nova operação → tipo Avulsa. Os registros antigos continuam aqui para consulta, correção e cancelamento.";

export function cadastroDeContainerEncerrado(): {
  ok: false;
  codigo: "encerrado";
  mensagem: string;
} {
  return { ok: false, codigo: "encerrado", mensagem: MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO };
}

/**
 * Adicionais gerados por registro antigo de contêiner ligado a uma operação que TAMBÉM tem
 * apontamentos a faturar no período: o mesmo serviço pode estar sendo cobrado duas vezes. A tela
 * avisa; não decide sozinha que é duplicado (pode ser um serviço diferente na mesma operação).
 */
export function adicionaisDeContainerEmDuplicidade(
  adicionais: readonly { id: string; operation_id: string | null }[],
  servicos: readonly Pick<ServicoContainerLista, "id" | "billing_additional_id" | "situacao">[],
  operacoesComApontamento: ReadonlySet<string>,
): { adicionalId: string; servicoId: string; operacaoId: string }[] {
  const porAdicional = new Map(servicos.map((s) => [s.billing_additional_id, s]));
  return adicionais.flatMap((a) => {
    const servico = porAdicional.get(a.id);
    if (!servico || servico.situacao !== "disponivel" || a.operation_id === null) return [];
    if (!operacoesComApontamento.has(a.operation_id)) return [];
    return [{ adicionalId: a.id, servicoId: servico.id, operacaoId: a.operation_id }];
  });
}

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
