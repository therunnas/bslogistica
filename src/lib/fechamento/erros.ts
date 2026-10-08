/**
 * Erros do núcleo do Fechamento.
 *
 * Dois tipos, e a diferença importa para quem trata:
 *
 *  - `ErroDeDadoFinanceiro`: um valor de dinheiro (ou o resultado de uma conta
 *    com dinheiro) que não pode ser aceito — texto fora do formato do `numeric`,
 *    mais de duas casas, fora do intervalo seguro, valor negativo onde o
 *    domínio não admite;
 *  - `ErroDeDadoDoFechamento`: qualquer outro dado do lançamento que o núcleo
 *    não aceita — status desconhecido, minutos inválidos, data que não existe,
 *    relação ausente, linha fora do cliente ou do período pedidos.
 *
 *  - `ErroDeFiltroDoFechamento`: cliente ou período pedidos de forma inválida
 *    (quem chamou errou; vira 400);
 *  - `ErroDeClienteInacessivel`: o cliente não existe OU a sessão não o enxerga.
 *    As duas situações são o mesmo erro de propósito, para não revelar a
 *    existência de um cliente a quem não pode vê-lo (vira 404).
 *
 * Nos erros de dado o carregamento INTEIRO falha. O Fechamento nunca esconde um
 * dado inválido para entregar um relatório "quase certo".
 */

export class ErroDeDadoFinanceiro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeDadoFinanceiro";
  }
}

export class ErroDeDadoDoFechamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeDadoDoFechamento";
  }
}

export type CodigoDeFiltroInvalido = "cliente-invalido" | "periodo-invalido" | "parametro-invalido";

export class ErroDeFiltroDoFechamento extends Error {
  readonly codigo: CodigoDeFiltroInvalido;

  constructor(codigo: CodigoDeFiltroInvalido, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeFiltroDoFechamento";
    this.codigo = codigo;
  }
}

export class ErroDeClienteInacessivel extends Error {
  constructor() {
    super("Cliente não encontrado.");
    this.name = "ErroDeClienteInacessivel";
  }
}
