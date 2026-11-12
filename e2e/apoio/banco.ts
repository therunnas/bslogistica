import { consultar } from "./fixtures";

/**
 * Leituras do banco local para comparar com a tela. Tudo passa por `consultar`, que roda numa
 * transação somente leitura dentro do container do Supabase LOCAL (bs-e2e-…).
 */

/** Literal SQL seguro para os nomes sintéticos usados nos testes. */
export function lit(texto: string): string {
  return `'${texto.replace(/'/g, "''")}'`;
}

export type Lancamento = {
  data: string;
  colaborador: string;
  status: "present" | "absent" | "replacement";
  receita: string;
  custo: string;
  faturado: boolean;
  dia: string | null;
};

/** Lançamentos de uma operação (pelo nome), em ordem de data e colaborador. */
export function lancamentosDaOperacao(operacao: string): Lancamento[] {
  return consultar<Lancamento>(`
    select to_char(te.work_date, 'YYYY-MM-DD') as data,
           e.name as colaborador,
           te.status::text as status,
           te.billed_amount::numeric(12,2)::text as receita,
           te.cost_amount::numeric(12,2)::text as custo,
           te.invoice_id is not null as faturado,
           te.day_kind_snapshot as dia
      from public.timesheet_entries te
      join public.employees e on e.id = te.employee_id
      join public.operations o on o.id = te.operation_id
     where o.name = ${lit(operacao)}
     order by te.work_date, e.name`);
}

/** Um lançamento (operação, colaborador, data) ou `undefined`. */
export function lancamento(operacao: string, colaborador: string, data: string) {
  return lancamentosDaOperacao(operacao).find(
    (l) => l.colaborador === colaborador && l.data === data,
  );
}

export type Fatura = {
  id: string;
  inicio: string;
  fim: string;
  total: string;
  custo: string;
  itens: number;
  lancamentos: number;
};

/** Faturas de um cliente (pelo nome). */
export function faturasDoCliente(cliente: string): Fatura[] {
  return consultar<Fatura>(`
    select i.id,
           to_char(i.period_start, 'YYYY-MM-DD') as inicio,
           to_char(i.period_end, 'YYYY-MM-DD') as fim,
           i.total_amount::numeric(12,2)::text as total,
           i.total_cost::numeric(12,2)::text as custo,
           (select count(*)::int from public.invoice_items it where it.invoice_id = i.id) as itens,
           (select count(*)::int from public.timesheet_entries te where te.invoice_id = i.id)
             as lancamentos
      from public.invoices i
      join public.clients c on c.id = i.client_id
     where c.name = ${lit(cliente)}
     order by i.created_at`);
}

export type VersaoDeCusto = {
  inicio: string;
  fim: string | null;
  custo: string;
  ativa: boolean;
  origem: string;
};

/** Versões de custo de um colaborador (pelo nome), da mais antiga para a mais nova. */
export function versoesDeCusto(colaborador: string): VersaoDeCusto[] {
  return consultar<VersaoDeCusto>(`
    select to_char(t.valid_from, 'YYYY-MM-DD') as inicio,
           to_char(t.valid_to, 'YYYY-MM-DD') as fim,
           t.daily_cost::numeric(12,2)::text as custo,
           t.active as ativa,
           t.origin as origem
      from public.employee_cost_terms t
      join public.employees e on e.id = t.employee_id
     where e.name = ${lit(colaborador)}
     order by t.created_at, t.valid_from`);
}

/** Quantas linhas de uma tabela têm `name` igual ao texto. */
export function contarPorNome(tabela: "clients" | "shifts" | "employees", nome: string): number {
  return Number(
    consultar<{ n: number }>(
      `select count(*)::int as n from public.${tabela} where name = ${lit(nome)}`,
    )[0]?.n ?? 0,
  );
}

/** Soma em reais (texto com 2 casas) de uma lista de valores em texto. */
export function somar(valores: string[]): string {
  const centavos = valores.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
  return (centavos / 100).toFixed(2);
}
