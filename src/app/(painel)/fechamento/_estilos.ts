/**
 * Classes compartilhadas pelos blocos da tela de Fechamento — as mesmas das
 * demais telas administrativas (Faturamento, Relatórios), para a tela parecer
 * parte do sistema e não uma ilha.
 */

export const CARTAO =
  "overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]";

export const CABECALHO_DA_TABELA = "border-border bg-secondary/30 hover:bg-secondary/30";

export const TITULO_DA_COLUNA =
  "h-12 whitespace-nowrap text-xs font-semibold text-muted-foreground";

export const TITULO_DA_COLUNA_NUMERICA = `${TITULO_DA_COLUNA} text-right`;

export const CELULA_NUMERICA = "whitespace-nowrap text-right text-sm tabular-nums";

export const SELECT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

export const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";
