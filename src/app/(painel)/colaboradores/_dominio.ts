/**
 * Regras puras da tela de colaboradores (QA-BS-01, CP-03). Import relativo: o teste Node
 * (`npm run test:colaboradores-custos`) importa este arquivo direto.
 */
export { nomeLimpo, nomeValido } from "../clientes/_dominio";

export const MENSAGEM_CUSTO_NEGATIVO = "O custo por diária não pode ser negativo.";
export const MENSAGEM_CUSTO_INVALIDO = "Informe o custo por diária em reais (ex.: 150,00).";

/**
 * Custo por diária digitado no cadastro. O campo é numérico, mas o navegador entrega `-10` (o
 * `min="0"` não impede digitar) e o valor ia para o banco, que recusava com um erro genérico. Zero
 * é aceito: não há regra de negócio que o proíba.
 */
export function errosDoCusto(custo: number): string[] {
  if (!Number.isFinite(custo)) return [MENSAGEM_CUSTO_INVALIDO];
  if (custo < 0) return [MENSAGEM_CUSTO_NEGATIVO];
  return [];
}
