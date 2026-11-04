/**
 * FIN-PR-11A: domínio puro de serviços avulsos de containers.
 *
 * Importante: não é um formulário RPC, migration nem motor financeiro. A receita
 * será registrada no backend por fluxo transacional que reaproveite
 * billing_additionals; os custos individuais não são diárias ou HE.
 * Estes validadores não são uma fronteira de segurança: o banco deve repetir
 * os invariantes antes de gravar qualquer dado.
 */

export interface ParticipanteDeContainer {
  colaboradorId: string;
  /** Valor de custo informado em reais, não o valor da diária. */
  valorDevido: string;
}

export interface CompetenciaDeContainer {
  inicio: string;
  fim: string;
}

export type ModalidadeDeCusto = "por_pessoa" | "total_distribuido";

export interface LoteDeContainers {
  clienteId: string;
  operacaoId?: string | null;
  /** Data da solicitação: a BS recebe o pedido no mínimo no dia anterior. */
  solicitadoEm: string;
  /** Data de execução do serviço, sem inferir horas ou apontamento. */
  executadoEm: string;
  descricao: string;
  /** Quantidade física de containers (nunca diária nem número de colaboradores). */
  quantidade: number;
  /** Preço TOTAL acordado com o cliente. Não calcular tarifa por unidade. */
  totalCobrado: string;
  /** Identificação operacional opcional; idempotência será imposta no backend. */
  referencia?: string | null;
  participantes: readonly ParticipanteDeContainer[];
  modalidadeCusto: ModalidadeDeCusto;
  /** Obrigatório apenas em total_distribuido; deve igualar a soma das partes. */
  totalDistribuido?: string | null;
  /** Pode ser diferente da data de execução (FIN-PR-05/migration 038). */
  competenciaCobranca?: CompetenciaDeContainer;
}

export interface ParticipanteNormalizado {
  colaboradorId: string;
  custoCentavos: number;
}

export interface LoteNormalizado {
  clienteId: string;
  operacaoId: string | null;
  solicitadoEm: string;
  executadoEm: string;
  descricao: string;
  quantidade: number;
  receitaCentavos: number;
  custoTotalCentavos: number;
  referencia: string | null;
  participantes: ParticipanteNormalizado[];
  modalidadeCusto: ModalidadeDeCusto;
  competenciaCobranca: CompetenciaDeContainer | null;
}

/** NUMERIC(12,2): 10 dígitos inteiros + dois decimais. Sem ponto de milhar. */
const LIMITE_CENTAVOS = 999_999_999_999;
const PADRAO_DINHEIRO = /^(\d+)(?:[.,](\d{1,2}))?$/;
const PADRAO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function reaisEmCentavos(valor: string): number | null {
  const partes = PADRAO_DINHEIRO.exec(valor.trim());
  if (partes === null) return null;
  const inteiro = Number(partes[1]);
  const fracao = Number((partes[2] ?? "").padEnd(2, "0"));
  const centavos = inteiro * 100 + fracao;
  return Number.isSafeInteger(centavos) && centavos <= LIMITE_CENTAVOS ? centavos : null;
}

/** Datas ISO civis válidas; Date.parse sozinho aceita dias inexistentes. */
export function dataCivilValida(valor: string): boolean {
  const partes = PADRAO_DATA.exec(valor);
  if (!partes) return false;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCFullYear(ano);
  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

/**
 * Rejeições de domínio antes de enviar qualquer payload.
 * A validação de competência contra a frequência real é responsabilidade
 * da RPC do banco, não de uma heurística no navegador.
 */
export function validarLoteDeContainers(lote: LoteDeContainers): string[] {
  const erros: string[] = [];
  if (lote.clienteId.trim() === "") erros.push("Selecione o cliente.");
  if (lote.operacaoId !== undefined && lote.operacaoId !== null && lote.operacaoId.trim() === "") {
    erros.push("A operação, quando informada, deve ser válida.");
  }
  const pedidoValido = dataCivilValida(lote.solicitadoEm);
  const execucaoValida = dataCivilValida(lote.executadoEm);
  if (!pedidoValido || !execucaoValida) {
    erros.push("Informe datas válidas de solicitação e execução.");
  } else if (lote.solicitadoEm >= lote.executadoEm) {
    erros.push("O serviço precisa ser solicitado até o dia anterior à execução.");
  }
  if (lote.descricao.trim().length < 1 || lote.descricao.trim().length > 500) {
    erros.push("Descreva o produto e o serviço (até 500 caracteres).");
  }
  if (!Number.isSafeInteger(lote.quantidade) || lote.quantidade <= 0) {
    erros.push("Informe uma quantidade inteira de containers maior que zero.");
  }
  const receita = reaisEmCentavos(lote.totalCobrado);
  if (receita === null || receita <= 0) {
    erros.push("Informe o valor total negociado, maior que zero e com até duas casas decimais.");
  }
  if ((lote.referencia ?? "").trim().length > 200) {
    erros.push("A referência aceita no máximo 200 caracteres.");
  }
  if (lote.modalidadeCusto !== "por_pessoa" && lote.modalidadeCusto !== "total_distribuido") {
    erros.push("Modalidade de custo desconhecida.");
  }
  if (lote.participantes.length === 0) {
    erros.push("Informe os colaboradores participantes.");
  }
  const ids = new Set<string>();
  let soma = 0;
  let valorInvalido = false;
  for (const participante of lote.participantes) {
    const id = participante.colaboradorId.trim();
    if (!id) erros.push("Informe o colaborador de cada participante.");
    else if (ids.has(id)) erros.push("O colaborador não pode aparecer duas vezes no serviço.");
    else ids.add(id);
    const custo = reaisEmCentavos(participante.valorDevido);
    if (custo === null) valorInvalido = true;
    else soma += custo;
  }
  if (valorInvalido || !Number.isSafeInteger(soma) || soma > LIMITE_CENTAVOS) {
    erros.push("Os custos individuais precisam ser valores válidos, em centavos.");
  }
  if (lote.modalidadeCusto === "total_distribuido") {
    const total = lote.totalDistribuido === null || lote.totalDistribuido === undefined
      ? null
      : reaisEmCentavos(lote.totalDistribuido);
    if (total === null || total !== soma || valorInvalido) {
      erros.push("A soma dos participantes precisa igualar o total a distribuir.");
    }
  } else if (lote.totalDistribuido !== null && lote.totalDistribuido !== undefined) {
    erros.push("O custo por pessoa não deve enviar outro total para distribuição.");
  }
  if (lote.competenciaCobranca !== undefined) {
    const { inicio, fim } = lote.competenciaCobranca;
    if (!dataCivilValida(inicio) || !dataCivilValida(fim) || inicio > fim) {
      erros.push("Informe uma competência de cobrança válida.");
    }
  }
  return erros;
}

/**
 * Preserva valores monetários como centavos exatos, sem rateio automático.
 * Nenhum campo de preço por container é inventado e nenhuma fatura é gravada.
 */
export function prepararLoteDeContainers(lote: LoteDeContainers): LoteNormalizado {
  const erros = validarLoteDeContainers(lote);
  if (erros.length) throw new Error(erros.join(" "));
  const participantes = lote.participantes.map((item) => ({
    colaboradorId: item.colaboradorId.trim(),
    custoCentavos: reaisEmCentavos(item.valorDevido) as number,
  }));
  return {
    clienteId: lote.clienteId.trim(),
    operacaoId: lote.operacaoId?.trim() ?? null,
    solicitadoEm: lote.solicitadoEm,
    executadoEm: lote.executadoEm,
    descricao: lote.descricao.trim(),
    quantidade: lote.quantidade,
    receitaCentavos: reaisEmCentavos(lote.totalCobrado) as number,
    custoTotalCentavos: participantes.reduce((soma, item) => soma + item.custoCentavos, 0),
    referencia: lote.referencia?.trim() || null,
    participantes,
    modalidadeCusto: lote.modalidadeCusto,
    competenciaCobranca: lote.competenciaCobranca ?? null,
  };
}
