"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CalendarCheck,
  Clock3,
  Lock,
  LockOpen,
  Save,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import {
  attendanceLabel,
  calcEntry,
  shiftPlannedMinutes,
  type AttendanceStatus,
} from "@/lib/billing";
import {
  colaboradoresFaturados,
  linhaGravadaFoiAlterada,
  linhasParaSalvar,
  montarCarga,
} from "@/lib/apontamentos-salvar";
import { mensagemDoErro } from "@/lib/erros-banco";
import { somarLinhas, valorDaLinha, type CondicaoDoDia } from "@/lib/apontamentos-financeiro";
import { useEstadoDoMotor, useTermosDoApontamento } from "@/lib/vigencias-dados";
import { resolverCondicaoDoDia } from "@/lib/vigencias-ui";
import { AvisoDoMotor } from "../_components/vigencias";
import { brl, minutesToLabel, todayISO } from "@/lib/format";
import { useContractRules } from "@/lib/ledger";
import { exigirLinhaAfetada } from "@/lib/mutations";
import { toast } from "@/lib/notificacoes";
import {
  useClients,
  useEmployees,
  useEntries,
  useOperations,
  useShifts,
  useTeam,
  useTimesheets,
} from "@/lib/queries";

interface DraftEntry {
  employeeId: string;
  entryId: string | undefined;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  notes: string;
}

/**
 * O rascunho carrega a identidade do contexto que ele representa e o conjunto
 * de linhas que o usuário tocou.
 *
 * Guardar os três juntos é o que impede a edição manual de ser descartada: o
 * rascunho só é reconstruído do zero quando `key` muda, e enquanto ela não muda
 * as linhas em `dirty` têm precedência sobre o que vem do servidor.
 */
interface DraftState {
  key: string;
  rows: DraftEntry[];
  dirty: ReadonlySet<string>;
}

/** Índice que garante a invariável de diária, em public.timesheet_entries. */
const INDICE_DA_DIARIA = "timesheet_entries_uma_diaria_por_operacao_dia";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

/**
 * O erro é mesmo violação da invariável de diária?
 *
 * `code === "23505"` sozinho não serve: qualquer unique da tabela devolve o
 * mesmo código, e afirmar "já possui diária" diante de outra violação mandaria
 * o usuário procurar um problema que não existe. O PostgrestError não expõe
 * campo `constraint` — só `message`, `details`, `hint` e `code` —, então a
 * identificação é pelo nome do índice, que o Postgres escreve na mensagem de
 * unique_violation.
 */
function ehViolacaoDeDiaria(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) {
    return false;
  }

  const e = erro as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  if (e.code !== "23505") {
    return false;
  }

  return `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.includes(INDICE_DA_DIARIA);
}

/**
 * Mensagem única para a violação da invariável de diária, venha ela da
 * checagem local ou do 23505 do banco.
 */
function mensagemDeDiariaDuplicada(detalhe?: string) {
  return (
    "Este colaborador já possui uma diária nesta operação e data. " +
    "Registre o período adicional como hora extra no apontamento existente." +
    (detalhe ? ` (${detalhe})` : "")
  );
}

/** Identidade do contexto: um rascunho pertence a uma operação, turno e data. */
const contextoDe = (operationId: string, turnoId: string, date: string) =>
  `${operationId}|${turnoId}|${date}`;

// === leitura-de-apontamentos:inicio ===
// Bloco autocontido (só tipos e funções puras): `scripts/testar-apontamentos-leitura.mjs`
// o extrai deste arquivo e o executa de verdade. Não importe nada para dentro dele.

/** Retrato mínimo de uma consulta do React Query. */
interface ConsultaDeLeitura {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data: unknown;
}

const ROTULOS_DA_LEITURA = {
  operations: "operações",
  shifts: "turnos",
  employees: "colaboradores",
  team: "equipe",
  timesheets: "folhas",
  entries: "lançamentos",
} as const;

type NomeDaLeitura = keyof typeof ROTULOS_DA_LEITURA;

type LeituraDeApontamentos =
  | { estado: "carregando" }
  | { estado: "erro"; falhas: NomeDaLeitura[] }
  | { estado: "atualizando" }
  | { estado: "pronto" };

/**
 * Decide se os dados que a tela usa para achar a folha, a equipe, os turnos e os
 * colaboradores são confiáveis. Só `pronto` autoriza salvar ou fechar/reabrir.
 *
 * Por que não basta `isLoading`: ele só vale na primeira carga. Uma consulta que
 * falha deixa `data` indefinido, o `?? []` da tela a trata como "não há folha" e o
 * salvamento criaria uma folha nova por cima da que existe. Erro com dado antigo
 * em cache também é `erro` (não dá para provar que o dado ainda vale), e refetch em
 * andamento é `atualizando` (a folha pode ter mudado). O rascunho não passa por
 * aqui: este controle só habilita ou bloqueia ações, não toca nas linhas.
 */
function avaliarLeituraDeApontamentos(
  consultas: Record<NomeDaLeitura, ConsultaDeLeitura>,
): LeituraDeApontamentos {
  const nomes = Object.keys(ROTULOS_DA_LEITURA) as NomeDaLeitura[];

  const falhas = nomes.filter((nome) => consultas[nome].status === "error");
  if (falhas.length > 0) {
    return { estado: "erro", falhas };
  }

  if (
    nomes.some((nome) => consultas[nome].status === "pending" || consultas[nome].data === undefined)
  ) {
    return { estado: "carregando" };
  }

  if (nomes.some((nome) => consultas[nome].fetchStatus !== "idle")) {
    return { estado: "atualizando" };
  }

  return { estado: "pronto" };
}

function avisoDaLeitura(
  leitura: LeituraDeApontamentos,
): { titulo: string; descricao: string } | null {
  switch (leitura.estado) {
    case "pronto":
      return null;
    case "carregando":
      return {
        titulo: "Carregando os dados do apontamento…",
        descricao: "Salvar e fechar o dia ficam indisponíveis até a leitura terminar.",
      };
    case "atualizando":
      return {
        titulo: "Atualizando os dados…",
        descricao:
          "Salvar e fechar o dia ficam indisponíveis até a leitura terminar. O que você digitou foi mantido.",
      };
    case "erro":
      return {
        titulo: "Não foi possível carregar todos os dados",
        descricao: `Falha ao ler: ${leitura.falhas
          .map((nome) => ROTULOS_DA_LEITURA[nome])
          .join(
            ", ",
          )}. Salvar e fechar o dia ficam bloqueados para não criar nem alterar apontamentos sobre dados incompletos. O que você digitou foi mantido.`,
      };
  }
}

// === leitura-de-apontamentos:fim ===

export function PainelApontamentos() {
  const queryClient = useQueryClient();

  const clients = useClients();
  const operations = useOperations();
  const shifts = useShifts();
  const employees = useEmployees();
  const team = useTeam();
  const timesheets = useTimesheets();
  const entries = useEntries();

  const leitura = avaliarLeituraDeApontamentos({
    operations,
    shifts,
    employees,
    team,
    timesheets,
    entries,
  });
  const avisoDeLeitura = avisoDaLeitura(leitura);

  function tentarLerDeNovo() {
    for (const chave of [
      "operations",
      "shifts",
      "employees",
      "operation_team",
      "timesheets",
      "timesheet_entries",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [chave], exact: true });
    }
  }

  const [operationId, setOperationId] = useState("");

  // null = ainda não escolhido; "" = "sem turno" escolhido de propósito.
  const [shiftId, setShiftId] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<DraftState | null>(null);

  const turnoId = shiftId ?? "";

  /**
   * Enquanto qualquer uma dessas consultas não terminou, o rascunho não pode
   * ser montado nem salvo.
   */
  const carregando =
    shifts.isLoading || team.isLoading || timesheets.isLoading || entries.isLoading;

  /**
   * Memoizado para manter referência estável e não disparar o efeito abaixo em
   * toda renderização.
   */
  const operationList = useMemo(() => operations.data ?? [], [operations.data]);

  useEffect(() => {
    if (!operationId && operationList[0]) {
      setOperationId(operationList[0].id);
    }
  }, [operationId, operationList]);

  const operationShifts = useMemo(
    () => (shifts.data ?? []).filter((shift) => shift.operation_id === operationId),
    [shifts.data, operationId],
  );

  useEffect(() => {
    setShiftId((atual) => {
      if (atual === "") {
        return atual;
      }

      if (atual !== null && operationShifts.some((shift) => shift.id === atual)) {
        return atual;
      }

      return operationShifts[0]?.id ?? null;
    });
  }, [operationShifts]);

  const shift = operationShifts.find((item) => item.id === turnoId) ?? null;

  const plannedMinutes = shiftPlannedMinutes(shift);
  const rules = useContractRules(operationId);

  const timesheet = useMemo(
    () =>
      (timesheets.data ?? []).find(
        (item) =>
          item.operation_id === operationId &&
          item.work_date === date &&
          (item.shift_id ?? "") === turnoId,
      ),
    [timesheets.data, operationId, date, turnoId],
  );

  const existingEntries = useMemo(
    () => (entries.data ?? []).filter((entry) => entry.timesheet_id === timesheet?.id),
    [entries.data, timesheet?.id],
  );

  const teamMembers = useMemo(
    () =>
      (team.data ?? []).filter(
        (item) =>
          item.operation_id === operationId && item.active && (item.shift_id ?? "") === turnoId,
      ),
    [team.data, operationId, turnoId],
  );

  const contextKey = contextoDe(operationId, turnoId, date);

  useEffect(() => {
    if (carregando) {
      return;
    }

    const base = teamMembers.map((member) => {
      const existing = existingEntries.find((entry) => entry.employee_id === member.employee_id);

      return {
        employeeId: member.employee_id,
        entryId: existing?.id,
        status: (existing?.status ?? "present") as AttendanceStatus,
        checkIn: existing?.check_in?.slice(0, 5) ?? shift?.start_time.slice(0, 5) ?? "",
        checkOut: existing?.check_out?.slice(0, 5) ?? shift?.end_time.slice(0, 5) ?? "",
        breakMinutes: existing?.break_minutes ?? shift?.break_minutes ?? 0,
        notes: existing?.notes ?? "",
      } satisfies DraftEntry;
    });

    const extras = existingEntries
      .filter((entry) => !teamMembers.some((member) => member.employee_id === entry.employee_id))
      .map((entry) => ({
        employeeId: entry.employee_id,
        entryId: entry.id,
        status: entry.status,
        checkIn: entry.check_in?.slice(0, 5) ?? "",
        checkOut: entry.check_out?.slice(0, 5) ?? "",
        breakMinutes: entry.break_minutes,
        notes: entry.notes ?? "",
      }));

    const servidor = [...base, ...extras];

    setDraft((atual) => {
      if (!atual || atual.key !== contextKey) {
        return {
          key: contextKey,
          rows: servidor,
          dirty: new Set<string>(),
        };
      }

      const anteriores = new Map(atual.rows.map((row) => [row.employeeId, row]));

      const mescladas = servidor.map((linha) => {
        const anterior = anteriores.get(linha.employeeId);

        return atual.dirty.has(linha.employeeId) && anterior
          ? {
              ...anterior,
              entryId: linha.entryId,
            }
          : linha;
      });

      const pendentes = atual.rows.filter(
        (row) =>
          atual.dirty.has(row.employeeId) &&
          !servidor.some((linha) => linha.employeeId === row.employeeId),
      );

      return {
        key: contextKey,
        rows: [...mescladas, ...pendentes],
        dirty: atual.dirty,
      };
    });
  }, [
    contextKey,
    carregando,
    teamMembers,
    existingEntries,
    shift?.start_time,
    shift?.end_time,
    shift?.break_minutes,
  ]);

  const linhas = useMemo(() => draft?.rows ?? [], [draft?.rows]);

  const employeeMap = useMemo(
    () => new Map((employees.data ?? []).map((employee) => [employee.id, employee])),
    [employees.data],
  );

  // U3: o estado do motor decide de onde vem o valor mostrado (ver apontamentos-financeiro.ts).
  const estadoDoMotor = useEstadoDoMotor();
  const operacaoDaTela = operationList.find((item) => item.id === operationId) ?? null;
  const termos = useTermosDoApontamento({
    habilitado: estadoDoMotor.tag === "ligado" && Boolean(operationId),
    contratoId: operacaoDaTela?.contract_id ?? null,
    operacaoId: operationId || null,
    colaboradores: useMemo(() => linhas.map((row) => row.employeeId), [linhas]),
  });

  const computed = linhas.map((row) => {
    const employee = employeeMap.get(row.employeeId);

    const gravado = existingEntries.find((entry) => entry.employee_id === row.employeeId) ?? null;

    let condicaoDoDia: CondicaoDoDia | null = null;
    if (estadoDoMotor.tag === "ligado") {
      if (termos.erro) {
        condicaoDoDia = {
          ok: false,
          motivo: "Não foi possível consultar as vigências financeiras.",
        };
      } else if (!termos.carregando) {
        condicaoDoDia = resolverCondicaoDoDia({
          data: date,
          contratoId: operacaoDaTela?.contract_id ?? null,
          termosContrato: termos.termosContrato,
          termosOperacao: termos.termosOperacao,
          termosCusto: termos.termosCusto.filter((termo) => termo.employee_id === row.employeeId),
        });
      }
    }

    const valor = valorDaLinha({
      estado: estadoDoMotor,
      status: row.status,
      gravada: Boolean(row.entryId),
      // Alteração real, não interação: editar e devolver o valor original não é mudança, e o
      // critério é o mesmo do salvamento (`linhasParaSalvar`).
      tocada: linhaGravadaFoiAlterada(row, draft?.dirty ?? new Set<string>(), gravado ?? undefined),
      gravado,
      regrasDoCadastro: rules,
      custoDoCadastro: Number(employee?.daily_cost ?? 0),
      condicaoDoDia,
      plannedMinutes,
      calcular: ({ regras, custoDiario, plannedMinutes: previstos }) =>
        calcEntry({
          status: row.status,
          checkIn: row.checkIn || null,
          checkOut: row.checkOut || null,
          breakMinutes: row.breakMinutes,
          plannedMinutes: previstos,
          rules: regras,
          employeeDailyCost: custoDiario,
        }),
    });

    const calc = calcEntry({
      status: row.status,
      checkIn: row.checkIn || null,
      checkOut: row.checkOut || null,
      breakMinutes: row.breakMinutes,
      plannedMinutes,
      rules,
      employeeDailyCost: Number(employee?.daily_cost ?? 0),
    });

    return {
      row,
      employee,
      calc,
      valor,
    };
  });

  const somaFinanceira = somarLinhas(computed.map((item) => item.valor));
  const totals = {
    dailies: computed.reduce((acc, { row }) => acc + (row.status === "absent" ? 0 : 1), 0),
    overtime: somaFinanceira.overtime,
    billed: somaFinanceira.billed,
    cost: somaFinanceira.cost,
  };
  const linhasBloqueadas = computed.filter((item) => item.valor.bloqueiaSalvar);

  const diariaEmOutraFolha = useMemo(() => {
    const outrasFolhas = new Map(
      (timesheets.data ?? [])
        .filter(
          (item) =>
            item.operation_id === operationId &&
            item.work_date === date &&
            item.id !== timesheet?.id,
        )
        .map((item) => [item.id, item] as const),
    );

    const nomeDoTurno = (outroShiftId: string | null) =>
      (shifts.data ?? []).find((item) => item.id === outroShiftId)?.name ?? "sem turno";

    const mapa = new Map<string, string>();

    for (const entrada of entries.data ?? []) {
      if (entrada.status === "absent") {
        continue;
      }

      const folha = outrasFolhas.get(entrada.timesheet_id);

      if (folha) {
        mapa.set(entrada.employee_id, nomeDoTurno(folha.shift_id));
      }
    }

    return mapa;
  }, [timesheets.data, entries.data, shifts.data, operationId, date, timesheet?.id]);

  const ofereceSemTurno =
    operationShifts.length === 0 ||
    turnoId === "" ||
    (team.data ?? []).some(
      (item) => item.operation_id === operationId && item.active && item.shift_id === null,
    ) ||
    (timesheets.data ?? []).some(
      (item) =>
        item.operation_id === operationId && item.work_date === date && item.shift_id === null,
    );

  const isClosed = timesheet?.status === "closed";

  // Só entra no salvamento a linha nova, ou a existente que o usuário tocou E que difere
  // do servidor. Linha faturada nunca entra: o banco a recusaria e levaria o lote junto.
  const faturados = useMemo(() => colaboradoresFaturados(existingEntries), [existingEntries]);

  const colaboradoresASalvar = new Set(
    linhasParaSalvar(linhas, draft?.dirty ?? new Set<string>(), existingEntries).map(
      (linha) => linha.employeeId,
    ),
  );

  const aSalvar = computed.filter(({ row }) => colaboradoresASalvar.has(row.employeeId));

  const conflitos = aSalvar.filter(
    ({ row }) => row.status !== "absent" && diariaEmOutraFolha.has(row.employeeId),
  );

  const saveAll = useMutation({
    mutationFn: async () => {
      // Sem leitura confiável, "não há folha" pode ser só uma consulta que falhou.
      if (leitura.estado !== "pronto") {
        throw new Error("Aguarde a leitura dos dados terminar antes de salvar.");
      }

      if (!aSalvar.length) {
        return {
          gravadas: 0,
        };
      }

      if (conflitos.length) {
        const primeiro = conflitos[0]!;
        const nome = employeeMap.get(primeiro.row.employeeId)?.name ?? "colaborador";

        const turno = diariaEmOutraFolha.get(primeiro.row.employeeId);

        throw new Error(
          mensagemDeDiariaDuplicada(
            `${nome} — turno ${turno}${
              conflitos.length > 1 ? ` e mais ${conflitos.length - 1}` : ""
            }`,
          ),
        );
      }

      let timesheetId = timesheet?.id;

      if (!timesheetId) {
        const { data, error } = await criarClienteNavegador()
          .from("timesheets")
          .insert({
            operation_id: operationId,
            shift_id: turnoId || null,
            work_date: date,
            status: "open",
          })
          .select("id")
          .single();

        if (error) {
          throw error;
        }

        timesheetId = data.id;
      }

      // Só as colunas editáveis (mais as chaves de contexto, que o banco sobrescreve com as da
      // folha). Receita, custo, minutos e snapshots são derivados no banco.
      const payload = aSalvar.map(({ row }) =>
        montarCarga(row, { timesheetId: timesheetId!, operationId, workDate: date }, () =>
          globalThis.crypto.randomUUID(),
        ),
      );

      const { error } = await criarClienteNavegador().from("timesheet_entries").upsert(payload);

      if (error) {
        throw error;
      }

      return {
        gravadas: payload.length,
      };
    },

    onSuccess: async ({ gravadas }) => {
      if (!gravadas) {
        toast.info("Nenhuma alteração para salvar.");
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["timesheets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["timesheet_entries"],
        }),
      ]);

      setDraft((atual) =>
        atual
          ? {
              ...atual,
              dirty: new Set<string>(),
            }
          : atual,
      );

      toast.success("Apontamento salvo.");
    },

    onError: (error: unknown) => {
      if (ehViolacaoDeDiaria(error)) {
        toast.error(mensagemDeDiariaDuplicada());
        return;
      }

      const codigo =
        typeof error === "object" && error && "code" in error
          ? (error as { code?: string }).code
          : undefined;

      if (codigo === "23505") {
        toast.error(
          "Já existe um registro conflitante para estes dados. Recarregue a página e confira antes de salvar de novo.",
        );

        return;
      }

      toast.error(mensagemDoErro(error));
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async (status: "open" | "closed") => {
      if (leitura.estado !== "pronto") {
        throw new Error("Aguarde a leitura dos dados terminar antes de alterar o status.");
      }

      if (!timesheet) {
        throw new Error("Salve o apontamento antes de fechar.");
      }

      const { error, count } = await criarClienteNavegador()
        .from("timesheets")
        .update(
          {
            status,
          },
          {
            count: "exact",
          },
        )
        .eq("id", timesheet.id);

      if (error) {
        throw error;
      }

      exigirLinhaAfetada(count, "atualizar o status do apontamento");
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["timesheets"],
      });

      toast.success("Status do apontamento atualizado.");
    },

    onError: (error: Error) => toast.error(error.message),
  });

  function update(employeeId: string, patch: Partial<DraftEntry>) {
    setDraft((atual) => {
      if (!atual) {
        return atual;
      }

      const dirty = new Set(atual.dirty);
      dirty.add(employeeId);

      return {
        key: atual.key,
        rows: atual.rows.map((row) =>
          row.employeeId === employeeId
            ? {
                ...row,
                ...patch,
              }
            : row,
        ),
        dirty,
      };
    });
  }

  const operation = operationList.find((item) => item.id === operationId) ?? null;

  const clientName =
    clients.data?.find((client) => client.id === operation?.client_id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Apontamento diário"
        description="Registre presença, horários e excedentes de jornada da equipe alocada."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => toggleStatus.mutate(isClosed ? "open" : "closed")}
              disabled={!timesheet || leitura.estado !== "pronto"}
            >
              {isClosed ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}

              {isClosed ? "Reabrir" : "Fechar dia"}
            </Button>

            <Button
              type="button"
              className="h-10 rounded-xl"
              onClick={() => saveAll.mutate()}
              disabled={
                isClosed ||
                carregando ||
                leitura.estado !== "pronto" ||
                saveAll.isPending ||
                !linhas.length ||
                !!conflitos.length ||
                linhasBloqueadas.length > 0
              }
            >
              <Save className="h-4 w-4" />

              {saveAll.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        }
      />

      <AvisoDoMotor estado={estadoDoMotor} />

      {linhasBloqueadas.length > 0 ? (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-destructive/30 bg-destructive/[0.07] px-4 py-3 text-destructive"
        >
          <p className="text-sm font-medium">
            Sem condição financeira válida para {linhasBloqueadas.length} linha(s). O salvamento
            está bloqueado.
          </p>
          <p className="mt-1 text-xs leading-5">{linhasBloqueadas[0]?.valor.aviso}</p>
        </div>
      ) : null}

      {avisoDeLeitura ? (
        <div
          role="alert"
          className={`mb-5 rounded-xl border px-4 py-3 ${
            leitura.estado === "erro"
              ? "border-destructive/30 bg-destructive/[0.07] text-destructive"
              : "border-border bg-secondary/40 text-foreground"
          }`}
        >
          <p className="text-sm font-medium">{avisoDeLeitura.titulo}</p>

          <p className="mt-1 text-xs leading-5">{avisoDeLeitura.descricao}</p>

          {leitura.estado === "erro" ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-9 rounded-xl"
              onClick={tentarLerDeNovo}
            >
              Tentar novamente
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          label="Diárias"
          value={String(totals.dailies)}
          description="Presenças faturáveis"
          icon={Users}
        />

        <Resumo
          label="Hora extra"
          value={minutesToLabel(totals.overtime)}
          description="Excedente acumulado"
          icon={Clock3}
        />

        <Resumo
          label="A faturar"
          value={brl(totals.billed)}
          description="Valor calculado"
          icon={BadgeDollarSign}
        />

        <Resumo
          label="Custo"
          value={brl(totals.cost)}
          description="Mão de obra calculada"
          icon={WalletCards}
        />
      </div>

      <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Operação</Label>

            <Select value={operationId} onValueChange={setOperationId}>
              <SelectTrigger className={SELECT_CLASS}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>

              <SelectContent>
                {operationList.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Turno</Label>

            <Select
              value={turnoId || "none"}
              onValueChange={(value) => setShiftId(value === "none" ? "" : value)}
            >
              <SelectTrigger className={SELECT_CLASS}>
                <SelectValue placeholder="Sem turno" />
              </SelectTrigger>

              <SelectContent>
                {ofereceSemTurno ? <SelectItem value="none">Sem turno definido</SelectItem> : null}

                {operationShifts.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Data</Label>

            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <Label>Regra aplicada</Label>

            <div className="flex min-h-10 items-center rounded-xl border border-border bg-secondary/35 px-3">
              <p className="text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">{clientName}</span> · diária{" "}
                {estadoDoMotor.tag === "desligado" ? (
                  <>
                    {brl(rules.daily_rate)} · jornada{" "}
                    {minutesToLabel(plannedMinutes || rules.shift_hours * 60)} · HE{" "}
                    {brl((rules.daily_rate / (rules.shift_hours || 8)) * rules.ot_factor)}
                    /h
                  </>
                ) : estadoDoMotor.tag === "ligado" ? (
                  <>
                    preço pela vigência da data trabalhada ·{" "}
                    {computed.find((item) => item.valor.origem)?.valor.origem ??
                      "veja a origem em cada linha"}
                  </>
                ) : (
                  "regra financeira indisponível até confirmar o estado do motor"
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {conflitos.length ? (
        <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/[0.07] px-4 py-3 text-sm leading-6 text-destructive">
          <p className="font-medium">Conflito de diária identificado</p>

          <p className="mt-1 text-xs">
            {mensagemDeDiariaDuplicada()}{" "}
            {conflitos
              .map(({ row }) => {
                const nome = employeeMap.get(row.employeeId)?.name ?? "colaborador";

                return `${nome} (turno ${diariaEmOutraFolha.get(row.employeeId)})`;
              })
              .join(", ")}
          </p>
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardHeader className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm font-semibold tracking-tight">Equipe do dia</CardTitle>

              {isClosed ? (
                <Badge
                  variant="secondary"
                  className="border border-border bg-secondary font-medium text-muted-foreground shadow-none"
                >
                  <Lock className="mr-1 h-3 w-3" />
                  Fechado
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
                >
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Aberto
                </Badge>
              )}
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              Presença e horários da equipe alocada no turno selecionado.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarCheck className="h-4 w-4 text-primary" />
            {date}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead className="h-12 min-w-48 text-xs font-semibold text-muted-foreground">
                    Colaborador
                  </TableHead>

                  <TableHead className="min-w-40 text-xs font-semibold text-muted-foreground">
                    Presença
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Entrada
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Saída
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Intervalo
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Trabalhado
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Hora extra
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    A faturar
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Custo
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {carregando ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <div className="flex min-h-44 items-center justify-center">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                          Carregando equipe e apontamentos...
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : computed.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
                          <Users className="h-5 w-5 text-muted-foreground" />
                        </div>

                        <p className="mt-4 text-sm font-medium text-foreground">
                          Nenhum colaborador neste turno
                        </p>

                        <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                          Configure a equipe desta operação antes de realizar o apontamento.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  computed.map(({ row, employee, calc, valor }) => (
                    <TableRow
                      key={row.employeeId}
                      className="border-border transition-colors hover:bg-secondary/20"
                    >
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <AvatarNome nome={employee?.name ?? ""} />

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {employee?.name ?? "—"}
                            </p>

                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {employee?.role ?? "Colaborador"}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Select
                          value={row.status}
                          onValueChange={(value) =>
                            update(row.employeeId, {
                              status: value as AttendanceStatus,
                            })
                          }
                          disabled={isClosed || faturados.has(row.employeeId)}
                        >
                          <SelectTrigger className="h-9 w-36 rounded-xl border-input bg-secondary/40">
                            <SelectValue />
                          </SelectTrigger>

                          <SelectContent>
                            {(["present", "absent", "replacement"] as AttendanceStatus[]).map(
                              (status) => (
                                <SelectItem key={status} value={status}>
                                  {attendanceLabel[status]}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      <TableCell>
                        <Input
                          type="time"
                          className="h-9 w-28 rounded-xl border-input bg-secondary/40"
                          value={row.checkIn}
                          disabled={
                            isClosed || row.status === "absent" || faturados.has(row.employeeId)
                          }
                          onChange={(event) =>
                            update(row.employeeId, {
                              checkIn: event.target.value,
                            })
                          }
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          type="time"
                          className="h-9 w-28 rounded-xl border-input bg-secondary/40"
                          value={row.checkOut}
                          disabled={
                            isClosed || row.status === "absent" || faturados.has(row.employeeId)
                          }
                          onChange={(event) =>
                            update(row.employeeId, {
                              checkOut: event.target.value,
                            })
                          }
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          className="h-9 w-20 rounded-xl border-input bg-secondary/40"
                          value={row.breakMinutes}
                          disabled={
                            isClosed || row.status === "absent" || faturados.has(row.employeeId)
                          }
                          onChange={(event) =>
                            update(row.employeeId, {
                              breakMinutes: Number(event.target.value),
                            })
                          }
                        />
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {minutesToLabel(calc.workedMinutes)}
                      </TableCell>

                      <TableCell>
                        {valor.tipo !== "indisponivel" && valor.overtime > 0 ? (
                          <Badge
                            variant="secondary"
                            className="border border-primary/15 bg-primary/10 font-medium text-primary shadow-none"
                          >
                            {minutesToLabel(valor.overtime)}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-right text-sm font-medium text-foreground">
                        {valor.tipo === "indisponivel" ? "—" : brl(valor.billed)}
                        {valor.origem || valor.aviso ? (
                          <span className="mt-0.5 block max-w-[220px] whitespace-normal text-right text-[11px] font-normal leading-4 text-muted-foreground">
                            {valor.aviso ?? valor.origem}
                          </span>
                        ) : null}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground">
                        {valor.tipo === "indisponivel" ? "—" : brl(valor.cost)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Resumo({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>

            <p className="mt-2 truncate text-2xl font-semibold tracking-[-0.035em] text-foreground">
              {value}
            </p>

            <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
          </div>

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AvatarNome({ nome }: { nome: string }) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-xs font-semibold text-primary">
      {iniciais || "—"}
    </div>
  );
}
