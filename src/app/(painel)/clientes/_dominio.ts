/**
 * Regras puras da tela de clientes e contratos (QA-BS-01, CP-02). Sem import de `@/`: o teste
 * Node (`npm run test:clientes-contratos`) importa este arquivo direto.
 */

/** Nome de cliente ou de contrato: obrigatório, sem contar espaços; gravado sem as pontas. */
export function nomeLimpo(nome: string): string {
  return nome.trim();
}

export function nomeValido(nome: string): boolean {
  return nomeLimpo(nome) !== "";
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ANO_MINIMO = 1900;
export const ANO_MAXIMO = 2100;

export const MENSAGEM_INICIO_OBRIGATORIO = "Informe o início do contrato.";
export const MENSAGEM_INICIO_INVALIDO = `Início do contrato inválido: use uma data com ano entre ${ANO_MINIMO} e ${ANO_MAXIMO}.`;
export const MENSAGEM_FIM_INVALIDO = `Fim do contrato inválido: use uma data com ano entre ${ANO_MINIMO} e ${ANO_MAXIMO}.`;
export const MENSAGEM_FIM_ANTES_DO_INICIO = "O fim do contrato não pode ser antes do início.";

function dataPlausivel(data: string): boolean {
  const m = DATA_ISO.exec(data);
  if (!m) return false;
  const ano = Number(m[1]);
  return ano >= ANO_MINIMO && ano <= ANO_MAXIMO;
}

/**
 * Datas do contrato. O campo de data do navegador aceita o ano 0001 (é o que um ano digitado pela
 * metade produz), e nem a tela nem o banco conferiam fim antes do início: um contrato podia ser
 * gravado "de 01/10/2026 até 01/01/0001". A conferência fica na tela; o banco não ganhou CHECK
 * nesta etapa porque registros antigos assim existentes fariam a migration falhar (ver o
 * documento do CP-02).
 */
export function errosDasDatasDoContrato(inicio: string, fim: string): string[] {
  const erros: string[] = [];
  if (inicio === "") erros.push(MENSAGEM_INICIO_OBRIGATORIO);
  else if (!dataPlausivel(inicio)) erros.push(MENSAGEM_INICIO_INVALIDO);
  if (fim !== "") {
    if (!dataPlausivel(fim)) erros.push(MENSAGEM_FIM_INVALIDO);
    else if (inicio !== "" && dataPlausivel(inicio) && fim < inicio)
      erros.push(MENSAGEM_FIM_ANTES_DO_INICIO);
  }
  return erros;
}

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/**
 * O que a exclusão de um cliente leva junto. No banco, `contracts`, `operations` e `invoices`
 * referenciam `clients` com ON DELETE CASCADE, e operações levam turnos, equipe e apontamentos.
 * O banco só recusa quando há histórico faturado (ou contrato já usado em apontamento); fora
 * disso, tudo some. A confirmação precisa dizer isso — antes dizia apenas "Excluir o cliente X?".
 */
export function consequenciasDaExclusaoDoCliente(contratos: number, operacoes: number): string {
  if (contratos === 0 && operacoes === 0) return "";
  const partes: string[] = [];
  if (contratos > 0) partes.push(plural(contratos, "contrato", "contratos"));
  if (operacoes > 0) partes.push(plural(operacoes, "operação", "operações"));
  const lista = partes.join(" e ");
  return operacoes > 0
    ? `Também serão excluídos ${lista}, com os turnos, a equipe e os apontamentos ainda não faturados dessas operações.`
    : `Também será excluído o cadastro de ${lista}.`;
}
