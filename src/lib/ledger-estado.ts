/**
 * Estado de completude do ledger (C03). Núcleo puro: sem React, sem React Query,
 * sem rede. `useLedger()` (em `ledger.ts`) só alimenta estas funções com o retrato
 * das seis consultas e executa o que elas mandam.
 *
 * POR QUE EXISTE. Antes, `useLedger()` devolvia `{ rows, isLoading }`. Uma consulta
 * que falhava deixava `data` indefinido, o `?? []` a transformava em lista vazia e
 * as telas somavam R$ 0,00 como se fosse resultado. `isLoading` só vale na primeira
 * carga sem dado: num refetch com cache, e num erro com dado antigo, ele é falso.
 *
 * O CONTRATO (união discriminada; `rows` só existe onde pode ser usado)
 *  - `carregando`: alguma consulta ainda sem dado e nenhuma falhou. Sem valores.
 *  - `erro`: alguma consulta falhou (mesmo com dado antigo em cache). Sem valores.
 *  - `inconsistente`: todas leram, mas há lançamento sem a relação necessária
 *    mesmo depois de UMA reconciliação. Sem valores.
 *  - `atualizando`: há leitura em andamento (ou a reconciliação). Só `rowsAnteriores`
 *    (o nome diz que não são os dados atuais); exportação e fatura ficam bloqueadas.
 *  - `pronto`: todas leram sem erro, nada em andamento, nenhuma relação ausente.
 *    Só aqui existe `rows`.
 *
 * O QUE ISTO NÃO É. Não é snapshot: as seis tabelas são lidas em requisições
 * separadas, em instantes diferentes. `pronto` significa "cada leitura foi
 * completa (ver `paginacao.ts`) e as relações fecham", não "o banco estava parado".
 * Coerência transacional exige uma agregação no banco, fora desta fase.
 */

import {
  ErroDeComponentes,
  centavosDeReais,
  componentesDoLancamento,
} from "./componentes-financeiros";
import type {
  AttendanceStatus,
  Client,
  Employee,
  Operation,
  Shift,
  Timesheet,
  TimesheetEntry,
} from "./types";

export interface LedgerRow {
  entryId: string;
  timesheetId: string;
  date: string;
  clientId: string;
  clientName: string;
  operationId: string;
  operationName: string;
  operationType: "fixed" | "spot";
  shiftName: string;
  employeeId: string;
  employeeName: string;
  status: AttendanceStatus;
  workedMinutes: number;
  overtimeMinutes: number;
  dailies: number;
  billed: number;
  /** Diária cobrada (V2: componente gravado; legado: cobrado − HE). */
  dailyValue: number;
  /** Hora extra cobrada (V2: componente gravado; legado: max(cobrado − diária, 0)). */
  otValue: number;
  /** Horas especiais de domingo/feriado (V2, PR 09). Zero no legado. */
  specialValue: number;
  /** Adicional diário (PR 08). Zero no legado. */
  additionalValue: number;
  cost: number;
  invoiceId: string | null;
  timesheetStatus: "open" | "closed";
}

/** Retrato mínimo de uma consulta do React Query (o que a decisão precisa). */
export interface ConsultaDoLedger<T> {
  readonly status: "pending" | "error" | "success";
  readonly fetchStatus: "fetching" | "paused" | "idle";
  readonly data: readonly T[] | undefined;
  readonly dataUpdatedAt: number;
}

export interface EntradaDoLedger {
  readonly entries: ConsultaDoLedger<TimesheetEntry>;
  readonly timesheets: ConsultaDoLedger<Timesheet>;
  readonly operations: ConsultaDoLedger<Operation>;
  readonly clients: ConsultaDoLedger<Client>;
  readonly employees: ConsultaDoLedger<Employee>;
  readonly shifts: ConsultaDoLedger<Shift>;
}

export type NomeDaConsulta = keyof EntradaDoLedger;

export const NOMES_DAS_CONSULTAS: readonly NomeDaConsulta[] = [
  "entries",
  "timesheets",
  "operations",
  "clients",
  "employees",
  "shifts",
];

/** `queryKey` de cada consulta, as mesmas de `queries.ts`. */
export const CHAVES_DAS_CONSULTAS: Readonly<Record<NomeDaConsulta, readonly string[]>> = {
  entries: ["timesheet_entries"],
  timesheets: ["timesheets"],
  operations: ["operations"],
  clients: ["clients"],
  employees: ["employees"],
  shifts: ["shifts"],
};

const ROTULO_DA_CONSULTA: Readonly<Record<NomeDaConsulta, string>> = {
  entries: "lançamentos",
  timesheets: "folhas",
  operations: "operações",
  clients: "clientes",
  employees: "colaboradores",
  shifts: "turnos",
};

export type TipoDeRelacaoAusente =
  | "lancamento-sem-folha"
  | "folha-sem-operacao"
  | "operacao-sem-cliente"
  | "lancamento-sem-colaborador"
  | "folha-sem-turno"
  | "componentes-inconsistentes";

export interface ProblemaDeRelacao {
  readonly tipo: TipoDeRelacaoAusente;
  /** Quantos lançamentos do ledger têm esta relação ausente. Nunca identifica registro. */
  readonly quantidade: number;
}

/** Consultas que precisam ser relidas para tirar a dúvida de cada relação. */
const CONSULTAS_DA_RELACAO: Readonly<Record<TipoDeRelacaoAusente, readonly NomeDaConsulta[]>> = {
  "lancamento-sem-folha": ["entries", "timesheets"],
  "folha-sem-operacao": ["timesheets", "operations"],
  "operacao-sem-cliente": ["operations", "clients"],
  "lancamento-sem-colaborador": ["entries", "employees"],
  "folha-sem-turno": ["timesheets", "shifts"],
  "componentes-inconsistentes": ["entries"],
};

const ROTULO_DA_RELACAO: Readonly<Record<TipoDeRelacaoAusente, string>> = {
  "lancamento-sem-folha": "lançamento(s) sem folha",
  "folha-sem-operacao": "lançamento(s) de folha sem operação",
  "operacao-sem-cliente": "lançamento(s) de operação sem cliente",
  "lancamento-sem-colaborador": "lançamento(s) sem colaborador",
  "folha-sem-turno": "lançamento(s) de folha com turno inexistente",
  "componentes-inconsistentes":
    "lançamento(s) com componentes do valor que não fecham com o cobrado",
};

export type LedgerAvaliacao =
  | { readonly estado: "carregando" }
  | {
      readonly estado: "erro";
      readonly falhas: readonly NomeDaConsulta[];
      /** Há uma releitura em andamento (retry do usuário ou do React Query). */
      readonly recarregando: boolean;
    }
  | { readonly estado: "inconsistente"; readonly problemas: readonly ProblemaDeRelacao[] }
  | {
      readonly estado: "atualizando";
      readonly motivo: "leitura" | "reconciliacao";
      /** Dados da leitura anterior: úteis para a tela, nunca "atuais". */
      readonly rowsAnteriores: readonly LedgerRow[];
    }
  | { readonly estado: "pronto"; readonly rows: readonly LedgerRow[]; readonly lidoEm: number };

export interface LinhasMontadas {
  readonly rows: LedgerRow[];
  readonly problemas: ProblemaDeRelacao[];
}

/**
 * Consolida lançamento + folha + operação + cliente + colaborador + turno.
 * As fórmulas são as de sempre (`billed`, `otValue`, `cost`, `dailies`) e a ordem
 * final também. A diferença é que um lançamento com relação ausente NÃO é mais
 * descartado em silêncio nem completado com "—": fica fora de `rows` e entra na
 * contagem de `problemas`.
 */
export function montarLinhas(entrada: {
  entries: readonly TimesheetEntry[];
  timesheets: readonly Timesheet[];
  operations: readonly Operation[];
  clients: readonly Client[];
  employees: readonly Employee[];
  shifts: readonly Shift[];
}): LinhasMontadas {
  const tsMap = new Map(entrada.timesheets.map((t) => [t.id, t]));
  const opMap = new Map(entrada.operations.map((o) => [o.id, o]));
  const clMap = new Map(entrada.clients.map((c) => [c.id, c]));
  const empMap = new Map(entrada.employees.map((e) => [e.id, e]));
  const shMap = new Map(entrada.shifts.map((s) => [s.id, s]));

  const contagem = new Map<TipoDeRelacaoAusente, number>();
  const marcar = (tipo: TipoDeRelacaoAusente) => contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);

  const rows: LedgerRow[] = [];

  for (const entry of entrada.entries) {
    const ts = tsMap.get(entry.timesheet_id);
    if (!ts) {
      marcar("lancamento-sem-folha");
      continue;
    }

    const op = opMap.get(ts.operation_id);
    const client = op ? clMap.get(op.client_id) : undefined;
    const employee = empMap.get(entry.employee_id);
    const shift = ts.shift_id ? shMap.get(ts.shift_id) : undefined;

    let completa = true;
    if (!op) {
      marcar("folha-sem-operacao");
      completa = false;
    } else if (!client) {
      marcar("operacao-sem-cliente");
      completa = false;
    }
    if (!employee) {
      marcar("lancamento-sem-colaborador");
      completa = false;
    }
    if (ts.shift_id && !shift) {
      marcar("folha-sem-turno");
      completa = false;
    }
    if (!completa || !op || !client || !employee) continue;

    // Componentes do valor cobrado: uma regra só, em `componentes-financeiros.ts`. Lançamento V2
    // com componentes que não fecham fica fora das linhas e aparece como problema, nunca "consertado".
    let componentes;
    try {
      componentes = componentesDoLancamento({
        rotulo: `lançamento ${entry.id}`,
        status: entry.status,
        cobradoCentavos: centavosDeReais(entry.billed_amount ?? 0) ?? 0,
        diariaSnapshotCentavos: centavosDeReais(entry.daily_rate_snapshot ?? 0) ?? 0,
        calcVersion: entry.calc_version,
        baseCentavos: centavosDeReais(entry.billed_base_amount),
        extraCentavos: centavosDeReais(entry.billed_overtime_amount),
        especialCentavos: centavosDeReais(entry.billed_special_amount),
        adicionalCentavos: centavosDeReais(entry.additional_amount),
      });
    } catch (erro) {
      if (!(erro instanceof ErroDeComponentes)) throw erro;
      marcar("componentes-inconsistentes");
      continue;
    }

    rows.push({
      entryId: entry.id,
      timesheetId: ts.id,
      date: ts.work_date,
      clientId: op.client_id,
      clientName: client.name,
      operationId: op.id,
      operationName: op.name,
      operationType: op.type,
      shiftName: shift?.name ?? "—",
      employeeId: entry.employee_id,
      employeeName: employee.name,
      status: entry.status,
      workedMinutes: entry.worked_minutes,
      // Minutos COBRADOS (migration 030: arredondados no dia; brutos no modo acumulado), os mesmos
      // da fatura. Apontamento anterior à 030 não tem a coluna: vale o excedente gravado.
      overtimeMinutes: entry.billed_overtime_minutes ?? entry.overtime_minutes,
      dailies: entry.status === "absent" ? 0 : 1,
      billed: Number(entry.billed_amount ?? 0),
      dailyValue: componentes.diariaCentavos / 100,
      otValue: componentes.extraCentavos / 100,
      specialValue: componentes.especialCentavos / 100,
      additionalValue: componentes.adicionalCentavos / 100,
      cost: Number(entry.cost_amount ?? 0),
      invoiceId: entry.invoice_id,
      timesheetStatus: ts.status,
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const problemas = [...contagem.entries()].map(([tipo, quantidade]) => ({ tipo, quantidade }));
  return { rows, problemas };
}

function dadosDe(entrada: EntradaDoLedger) {
  return {
    entries: entrada.entries.data ?? [],
    timesheets: entrada.timesheets.data ?? [],
    operations: entrada.operations.data ?? [],
    clients: entrada.clients.data ?? [],
    employees: entrada.employees.data ?? [],
    shifts: entrada.shifts.data ?? [],
  };
}

/**
 * Decide o estado a partir do retrato das seis consultas.
 *
 * `tentativaDeReconciliacao` é 0 até que a primeira relação ausente tenha mandado
 * reler as consultas envolvidas; com 1, uma nova ausência já é `inconsistente`.
 * É o que impede o laço de invalidação: no máximo uma releitura por episódio.
 */
export function avaliarLedger(
  entrada: EntradaDoLedger,
  tentativaDeReconciliacao: 0 | 1,
): LedgerAvaliacao {
  const consultas = NOMES_DAS_CONSULTAS.map((nome) => ({ nome, c: entrada[nome] }));

  // 1. Falha vence tudo, inclusive dado antigo em cache: não dá para provar completude.
  const falhas = consultas.filter(({ c }) => c.status === "error").map(({ nome }) => nome);
  if (falhas.length > 0) {
    return {
      estado: "erro",
      falhas,
      recarregando: consultas.some(({ c }) => c.fetchStatus !== "idle"),
    };
  }

  // 2. Sem dado ainda (primeira carga, ou retry do React Query sem nenhum sucesso).
  if (consultas.some(({ c }) => c.status === "pending" || c.data === undefined)) {
    return { estado: "carregando" };
  }

  const { rows, problemas } = montarLinhas(dadosDe(entrada));

  // 3. Leitura em andamento (refetch, foco da janela, invalidação, rede pausada).
  if (consultas.some(({ c }) => c.fetchStatus !== "idle")) {
    return { estado: "atualizando", motivo: "leitura", rowsAnteriores: rows };
  }

  // 4. Tudo assentado. Relação ausente: uma releitura; persistindo, inconsistente.
  if (problemas.length > 0) {
    if (tentativaDeReconciliacao === 0) {
      return { estado: "atualizando", motivo: "reconciliacao", rowsAnteriores: rows };
    }
    return { estado: "inconsistente", problemas };
  }

  const lidoEm = Math.min(...consultas.map(({ c }) => c.dataUpdatedAt));
  return { estado: "pronto", rows, lidoEm };
}

/**
 * Consultas a reler na reconciliação: as duas pontas de cada relação ausente.
 * Vazio quando não há o que reconciliar ou quando a tentativa já foi gasta.
 */
export function planoDeReconciliacao(
  avaliacao: LedgerAvaliacao,
  entrada: EntradaDoLedger,
  tentativaDeReconciliacao: 0 | 1,
): NomeDaConsulta[] {
  if (
    tentativaDeReconciliacao !== 0 ||
    avaliacao.estado !== "atualizando" ||
    avaliacao.motivo !== "reconciliacao"
  ) {
    return [];
  }
  const { problemas } = montarLinhas(dadosDe(entrada));
  const alvo = new Set<NomeDaConsulta>();
  for (const problema of problemas) {
    for (const nome of CONSULTAS_DA_RELACAO[problema.tipo]) alvo.add(nome);
  }
  return NOMES_DAS_CONSULTAS.filter((nome) => alvo.has(nome));
}

// ---------------------------------------------------------------------------
// Decisão de exibição (o que cada tela pode mostrar e habilitar)
// ---------------------------------------------------------------------------

export interface AvisoDoLedger {
  readonly titulo: string;
  readonly descricao: string;
}

export interface DecisaoDeExibicao {
  /** Mostra valores (KPIs, totais, tabelas) calculados do ledger. */
  readonly mostrarValores: boolean;
  /** Os valores mostrados são da leitura anterior e podem estar desatualizados. */
  readonly valoresDesatualizados: boolean;
  /** Exportar CSV, gerar fatura e qualquer ação que dependa da prévia. */
  readonly podeAgir: boolean;
  /** Retry do usuário faz sentido (erro ou inconsistência). */
  readonly podeTentarNovamente: boolean;
  readonly aviso: AvisoDoLedger | null;
}

export function decidirExibicao(avaliacao: LedgerAvaliacao): DecisaoDeExibicao {
  switch (avaliacao.estado) {
    case "pronto":
      return {
        mostrarValores: true,
        valoresDesatualizados: false,
        podeAgir: true,
        podeTentarNovamente: false,
        aviso: null,
      };
    case "atualizando":
      return {
        mostrarValores: true,
        valoresDesatualizados: true,
        podeAgir: false,
        podeTentarNovamente: false,
        aviso: {
          titulo: "Atualizando os dados…",
          descricao:
            "Os valores exibidos são da leitura anterior e podem estar desatualizados. Exportação e geração de fatura ficam indisponíveis até a conclusão.",
        },
      };
    case "carregando":
      return {
        mostrarValores: false,
        valoresDesatualizados: false,
        podeAgir: false,
        podeTentarNovamente: false,
        aviso: {
          titulo: "Carregando lançamentos…",
          descricao: "Os valores aparecem quando a leitura terminar.",
        },
      };
    case "erro":
      return {
        mostrarValores: false,
        valoresDesatualizados: false,
        podeAgir: false,
        podeTentarNovamente: !avaliacao.recarregando,
        aviso: {
          titulo: "Não foi possível carregar os dados financeiros",
          descricao: `Nenhum valor é exibido porque não foi possível ler: ${avaliacao.falhas
            .map((nome) => ROTULO_DA_CONSULTA[nome])
            .join(", ")}. Tente novamente.`,
        },
      };
    case "inconsistente":
      return {
        mostrarValores: false,
        valoresDesatualizados: false,
        podeAgir: false,
        podeTentarNovamente: true,
        aviso: {
          titulo: "Dados financeiros inconsistentes",
          descricao: `A leitura trouxe relações ausentes (${avaliacao.problemas
            .map((p) => `${p.quantidade} ${ROTULO_DA_RELACAO[p.tipo]}`)
            .join(
              "; ",
            )}), mesmo após reler. Valores, prévia e exportação ficam bloqueados. Tente novamente em instantes.`,
        },
      };
  }
}

/** Linhas para os cálculos da tela (memos). Vazio quando não há o que mostrar. */
export function linhasParaExibicao(avaliacao: LedgerAvaliacao): readonly LedgerRow[] {
  if (avaliacao.estado === "pronto") return avaliacao.rows;
  if (avaliacao.estado === "atualizando") return avaliacao.rowsAnteriores;
  return SEM_LINHAS;
}

const SEM_LINHAS: readonly LedgerRow[] = [];
