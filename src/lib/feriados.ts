/**
 * Calendário de feriados do motor financeiro (C05-B8.15, migration 030).
 *
 * O feriado muda o PAGAMENTO do dia quando o contrato define o fator (2 = adicional de 100%). O
 * banco é a barreira: `registrar_feriado` e `aposentar_feriado` (admin, motivo, trilha), um
 * feriado ativo por data, nada se apaga, e o tipo do dia fica congelado no apontamento já
 * precificado. Este módulo só valida o formulário e monta os parâmetros.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export interface Feriado {
  id: string;
  holiday_date: string;
  name: string;
  active: boolean;
  reason: string;
  created_at: string;
  retired_at: string | null;
  retire_reason: string | null;
}

export interface FormularioDeFeriado {
  data: string;
  nome: string;
  motivo: string;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validarFeriado(f: FormularioDeFeriado, ativos: readonly string[]): string[] {
  const erros: string[] = [];
  if (!DATA_ISO.test(f.data) || Number.isNaN(Date.parse(`${f.data}T00:00:00Z`))) {
    erros.push("Informe a data do feriado.");
  } else if (ativos.includes(f.data)) {
    erros.push("Já existe feriado ativo nesta data.");
  }
  const nome = f.nome.trim();
  if (nome === "") erros.push("O nome do feriado é obrigatório.");
  if (nome.length > 120) erros.push("O nome deve ter no máximo 120 caracteres.");
  if (f.motivo.trim() === "") erros.push("O motivo é obrigatório.");
  return erros;
}

export function montarRegistroDeFeriado(
  f: FormularioDeFeriado,
  ativos: readonly string[],
): { p_data: string; p_nome: string; p_reason: string } {
  const erros = validarFeriado(f, ativos);
  if (erros.length > 0) throw new Error(erros[0]);
  return { p_data: f.data, p_nome: f.nome.trim(), p_reason: f.motivo.trim() };
}

/** Datas dos feriados ATIVOS, para o tipo do dia da prévia. */
export function datasAtivas(lista: readonly Feriado[]): string[] {
  return lista.filter((f) => f.active).map((f) => f.holiday_date);
}
