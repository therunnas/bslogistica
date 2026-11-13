import type { Route } from "next";

import type { ResultadoContainer, ServicoContainerLista } from "./container-servico-dados";

/**
 * D7 (QA-BS-01, CP-06). Contêiner é um TIPO de serviço avulso, não uma terceira modalidade. O
 * fluxo canônico do serviço avulso é a operação avulsa (decisão do #121: "serviço pontual vira
 * operação avulsa"). O cadastro separado de containers (045–050) saiu do menu no #121, mas seguia
 * aberto por URL: um mesmo contêiner podia ser cobrado pela operação avulsa (apontamentos) e de
 * novo pelo adicional que o cadastro antigo gera. O cadastro NOVO por esse caminho está
 * encerrado; os registros antigos continuam para consulta, correção e cancelamento.
 */
/**
 * CP-09: o que a operação cobra hoje, dito na Nova operação. Toda operação — fixa ou avulsa — cobra
 * por diária de cada participante; cobrar por quantidade executada (ex.: R$ 300 por contêiner) é
 * lacuna funcional (NEGOCIO.md §3A; DEC-PROD-01/02), não um campo escondido.
 */
export const MENSAGEM_COBRANCA_POR_DIARIA =
  "A cobrança é por diária de cada participante; cobrar por quantidade executada (ex.: por contêiner) ainda não existe no sistema.";

export const MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO =
  "Contêiner é um tipo de serviço avulso: cadastre em Operações → Nova operação → tipo Avulsa. Não existe mais painel nem cadastro separado de containers; os registros antigos ficam em Operações, na seção “Serviços avulsos antigos”, para consulta, correção e cancelamento.";

/**
 * CP-06B (decisão do responsável: "O painel Container não é para mais existir"). Os registros
 * antigos de contêiner são consultados DENTRO de Operações, como histórico legado de serviços
 * avulsos. As URLs antigas (`/containers…`) só redirecionam para estes caminhos.
 */
export const SECAO_DE_AVULSOS_ANTIGOS = "servicos-avulsos-antigos";
export const CAMINHO_DOS_AVULSOS_ANTIGOS = `/operacoes#${SECAO_DE_AVULSOS_ANTIGOS}` as Route;
export const CAMINHO_DO_CADASTRO_CANONICO = "/operacoes?origem=conteiner" as Route;

export function caminhoDoAvulsoAntigo(id: string): Route {
  return `/operacoes/avulsos-antigos/${encodeURIComponent(id)}` as Route;
}

export function caminhoDaCorrecaoDoAvulsoAntigo(id: string): Route {
  return `${caminhoDoAvulsoAntigo(id)}/corrigir` as Route;
}

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
