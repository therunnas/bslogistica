/**
 * Montagem de CSV para as exportações do painel.
 *
 * Duas coisas separadas acontecem aqui, e vale distingui-las:
 *
 * 1. **Escape de CSV.** Nome de cliente, operação, turno e colaborador são texto
 *    livre digitado no painel. Um `;`, uma aspa ou uma quebra de linha dentro
 *    desses campos desalinhava as colunas do arquivo inteiro. Toda célula sai
 *    entre aspas e as aspas internas são duplicadas, conforme a RFC 4180.
 *
 * 2. **Neutralização de fórmula.** Excel e LibreOffice avaliam uma célula que
 *    comece com `=`, `+`, `-` ou `@` — e também com TAB ou CR, que reposicionam
 *    o cursor. Um colaborador cadastrado como `=SUM(1+1)` viraria fórmula na
 *    planilha de quem abrir o relatório; a família `=HYPERLINK`, `=WEBSERVICE` e
 *    `=cmd|...` chega a exfiltrar dados ou disparar processo. Aspas não protegem
 *    disso: o Excel remove as aspas antes de decidir se a célula é fórmula.
 *
 * A neutralização usa o apóstrofo inicial, marcador de texto que a planilha
 * consome ao exibir. É a recomendação da OWASP e mantém o valor legível.
 *
 * Número negativo NÃO é fórmula: `-123` é o número -123 em qualquer planilha.
 * Por isso um valor puramente numérico passa intacto, senão toda coluna de custo
 * negativo viraria texto e deixaria de somar. O que é neutralizado é `-` seguido
 * de conteúdo que não seja número — `-2+3+cmd|' /C calc'!A0`, por exemplo.
 */

const SEPARADOR = ";";

/** Fim de registro em CRLF, como manda a RFC 4180: célula com quebra de linha
 *  interna fica ambígua para vários leitores quando o registro termina em LF. */
const FIM_DE_LINHA = "\r\n";

/**
 * Prefixos que uma planilha interpreta como início de fórmula ou de comando:
 * `=`, `+`, `-` ou `@`, mesmo depois de espaços, TAB ou quebras de linha, e
 * também TAB, CR ou LF logo no início. Espaço antes do operador não protege:
 * alguns leitores o descartam antes de decidir.
 */
const INICIO_PERIGOSO = /^\s*[=+\-@]|^[\t\r\n]/;

/** Número puro, com sinal e com vírgula ou ponto decimal. */
const NUMERO_SIMPLES = /^[+-]?\d+(?:[.,]\d+)?$/;

function precisaNeutralizar(texto: string): boolean {
  if (!INICIO_PERIGOSO.test(texto)) return false;
  return !NUMERO_SIMPLES.test(texto);
}

/** Uma célula pronta: fórmula neutralizada, aspas duplicadas, tudo entre aspas. */
export function celulaCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const conteudo = precisaNeutralizar(texto) ? `'${texto}` : texto;
  return `"${conteudo.replace(/"/g, '""')}"`;
}

/** Uma linha de células já escapadas. */
export function linhaCsv(celulas: readonly unknown[]): string {
  return celulas.map(celulaCsv).join(SEPARADOR);
}

/** Cabeçalho mais linhas, pronto para virar Blob. */
export function montarCsv(
  cabecalho: readonly string[],
  linhas: readonly (readonly unknown[])[],
): string {
  return [linhaCsv(cabecalho), ...linhas.map(linhaCsv)].join(FIM_DE_LINHA);
}
