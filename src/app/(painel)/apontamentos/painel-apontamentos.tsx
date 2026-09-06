"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/notificacoes";
import { Lock, LockOpen, Save } from "lucide-react";
import { PageHeader } from "../_components/app-shell";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { exigirLinhaAfetada } from "@/lib/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  useClients,
  useEmployees,
  useEntries,
  useOperations,
  useShifts,
  useTeam,
  useTimesheets,
} from "@/lib/queries";
import { useContractRules } from "@/lib/ledger";
import {
  attendanceLabel,
  calcEntry,
  shiftPlannedMinutes,
  type AttendanceStatus,
} from "@/lib/billing";
import { brl, minutesToLabel, todayISO } from "@/lib/format";

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

/** Identidade do contexto: um rascunho pertence a uma operação, turno e data. */
const contextoDe = (operationId: string, turnoId: string, date: string) =>
  `${operationId}|${turnoId}|${date}`;

export function PainelApontamentos() {
  const queryClient = useQueryClient();
  const clients = useClients();
  const operations = useOperations();
  const shifts = useShifts();
  const employees = useEmployees();
  const team = useTeam();
  const timesheets = useTimesheets();
  const entries = useEntries();

  const [operationId, setOperationId] = useState("");
  // null = ainda não escolhido; "" = "sem turno" escolhido de propósito.
  // A distinção evita que a seleção deliberada de "sem turno" seja tratada
  // como ausência de escolha e substituída pelo primeiro turno da operação.
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<DraftState | null>(null);

  const turnoId = shiftId ?? "";

  /**
   * Enquanto qualquer uma dessas consultas não terminou, o rascunho não pode
   * ser montado nem salvo: sem `entries` uma linha já gravada pareceria nova, e
   * o Salvar tentaria inserir por cima de uma que já existe.
   *
   * Usa `isLoading` (primeira carga), não `isFetching`: um refetch em segundo
   * plano não pode bloquear a tela nem desmontar o rascunho.
   */
  const carregando =
    shifts.isLoading || team.isLoading || timesheets.isLoading || entries.isLoading;

  const operationList = operations.data ?? [];
  useEffect(() => {
    if (!operationId && operationList[0]) setOperationId(operationList[0].id);
  }, [operationId, operationList]);

  const operationShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.operation_id === operationId),
    [shifts.data, operationId],
  );
  // Só escolhe um turno quando não há escolha válida para a operação atual.
  // Antes este efeito forçava o primeiro turno sempre que `operationShifts`
  // mudava de identidade, desfazendo a seleção do usuário a cada refetch.
  useEffect(() => {
    setShiftId((atual) => {
      if (atual === "") return atual;
      if (atual !== null && operationShifts.some((s) => s.id === atual)) return atual;
      // Sem turno disponível, continua `null` (não escolhido) em vez de "" —
      // assim um turno cadastrado depois ainda é selecionado automaticamente.
      return operationShifts[0]?.id ?? null;
    });
  }, [operationShifts]);

  const shift = operationShifts.find((s) => s.id === turnoId) ?? null;
  const plannedMinutes = shiftPlannedMinutes(shift);
  const rules = useContractRules(operationId);

  const timesheet = useMemo(
    () =>
      (timesheets.data ?? []).find(
        (t) =>
          t.operation_id === operationId && t.work_date === date && (t.shift_id ?? "") === turnoId,
      ),
    [timesheets.data, operationId, date, turnoId],
  );

  const existingEntries = useMemo(
    () => (entries.data ?? []).filter((e) => e.timesheet_id === timesheet?.id),
    [entries.data, timesheet?.id],
  );

  /**
   * Correspondência exata de operação e turno.
   *
   * Antes um vínculo sem `shift_id` aparecia em todos os turnos da operação.
   * Com a alocação passando a ser sempre operação + turno, isso trazia gente de
   * fora do turno para a folha. Vínculo sem turno agora só aparece quando o
   * turno selecionado também é "sem turno" — caso das operações avulsas.
   */
  const teamMembers = useMemo(
    () =>
      (team.data ?? []).filter(
        (t) => t.operation_id === operationId && t.active && (t.shift_id ?? "") === turnoId,
      ),
    [team.data, operationId, turnoId],
  );

  const contextKey = contextoDe(operationId, turnoId, date);

  useEffect(() => {
    if (carregando) return;

    const base = teamMembers.map((member) => {
      const existing = existingEntries.find((e) => e.employee_id === member.employee_id);
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
      .filter((e) => !teamMembers.some((m) => m.employee_id === e.employee_id))
      .map((e) => ({
        employeeId: e.employee_id,
        entryId: e.id,
        status: e.status,
        checkIn: e.check_in?.slice(0, 5) ?? "",
        checkOut: e.check_out?.slice(0, 5) ?? "",
        breakMinutes: e.break_minutes,
        notes: e.notes ?? "",
      }));
    const servidor = [...base, ...extras];

    setDraft((atual) => {
      // Contexto novo (outra operação, turno ou data): o rascunho anterior não
      // se aplica mais. Reconstrói inteiro e zera o que estava marcado.
      if (!atual || atual.key !== contextKey) {
        return { key: contextKey, rows: servidor, dirty: new Set<string>() };
      }

      // Mesmo contexto: os dados chegaram por carga ou refetch. As linhas que o
      // usuário tocou são preservadas; só o `entryId` é atualizado, para que uma
      // linha recém-gravada em outra aba não volte a ser tratada como nova.
      const anteriores = new Map(atual.rows.map((row) => [row.employeeId, row]));
      const mescladas = servidor.map((linha) => {
        const anterior = anteriores.get(linha.employeeId);
        return atual.dirty.has(linha.employeeId) && anterior
          ? { ...anterior, entryId: linha.entryId }
          : linha;
      });

      // Linha tocada que sumiu da equipe no servidor continua visível até salvar
      // ou trocar de contexto — senão a digitação desapareceria da tela.
      const pendentes = atual.rows.filter(
        (row) =>
          atual.dirty.has(row.employeeId) &&
          !servidor.some((linha) => linha.employeeId === row.employeeId),
      );

      return { key: contextKey, rows: [...mescladas, ...pendentes], dirty: atual.dirty };
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

  const linhas = draft?.rows ?? [];

  const employeeMap = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const computed = linhas.map((row) => {
    const employee = employeeMap.get(row.employeeId);
    const calc = calcEntry({
      status: row.status,
      checkIn: row.checkIn || null,
      checkOut: row.checkOut || null,
      breakMinutes: row.breakMinutes,
      plannedMinutes,
      rules,
      employeeDailyCost: Number(employee?.daily_cost ?? 0),
    });
    return { row, employee, calc };
  });

  const totals = computed.reduce(
    (acc, { row, calc }) => ({
      dailies: acc.dailies + (row.status === "absent" ? 0 : 1),
      overtime: acc.overtime + calc.overtimeMinutes,
      billed: acc.billed + calc.billedAmount,
      cost: acc.cost + calc.costAmount,
    }),
    { dailies: 0, overtime: 0, billed: 0, cost: 0 },
  );

  const isClosed = timesheet?.status === "closed";

  // Uma linha só é gravada se o usuário a tocou ou se ela ainda não existe no
  // banco. É isso que impede um Salvar destinado a um colaborador de regravar
  // os demais com valores recalculados no navegador.
  const aSalvar = computed.filter(
    ({ row }) => !row.entryId || (draft?.dirty.has(row.employeeId) ?? false),
  );

  const saveAll = useMutation({
    mutationFn: async () => {
      if (!aSalvar.length) return { gravadas: 0 };

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
        if (error) throw error;
        timesheetId = data.id;
      }
      const payload = aSalvar.map(({ row, calc }) => ({
        ...(row.entryId ? { id: row.entryId } : {}),
        timesheet_id: timesheetId!,
        employee_id: row.employeeId,
        status: row.status,
        check_in: row.status === "absent" ? null : row.checkIn ? `${row.checkIn}:00` : null,
        check_out: row.status === "absent" ? null : row.checkOut ? `${row.checkOut}:00` : null,
        break_minutes: row.breakMinutes,
        worked_minutes: calc.workedMinutes,
        overtime_minutes: calc.overtimeMinutes,
        daily_rate_snapshot: calc.dailyRate,
        ot_hour_rate_snapshot: calc.otHourRate,
        daily_cost_snapshot: calc.dailyCost,
        billed_amount: calc.billedAmount,
        cost_amount: calc.costAmount,
        notes: row.notes || null,
      }));
      const { error } = await criarClienteNavegador()
        .from("timesheet_entries")
        .upsert(payload as never);
      if (error) throw error;
      return { gravadas: payload.length };
    },
    onSuccess: async ({ gravadas }) => {
      if (!gravadas) {
        toast.info("Nenhuma alteração para salvar.");
        return;
      }
      // Espera o refetch terminar antes de limpar `dirty`. Se limpasse antes, a
      // reconstrução seguinte poderia rodar sobre dados ainda anteriores ao
      // save e devolver ao rascunho os valores que acabaram de ser trocados.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timesheets"] }),
        queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] }),
      ]);
      setDraft((atual) => (atual ? { ...atual, dirty: new Set<string>() } : atual));
      toast.success("Apontamento salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (status: "open" | "closed") => {
      if (!timesheet) throw new Error("Salve o apontamento antes de fechar.");
      const { error, count } = await criarClienteNavegador()
        .from("timesheets")
        .update({ status }, { count: "exact" })
        .eq("id", timesheet.id);
      if (error) throw error;
      exigirLinhaAfetada(count, "atualizar o status do apontamento");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
      toast.success("Status do apontamento atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function update(employeeId: string, patch: Partial<DraftEntry>) {
    setDraft((atual) => {
      if (!atual) return atual;
      // Set novo a cada edição: mutar o atual não mudaria a referência e a
      // precedência da linha editada poderia não ser vista pela renderização.
      const dirty = new Set(atual.dirty);
      dirty.add(employeeId);
      return {
        key: atual.key,
        rows: atual.rows.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row)),
        dirty,
      };
    });
  }

  const clientName =
    clients.data?.find((c) => c.id === operationList.find((o) => o.id === operationId)?.client_id)
      ?.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Apontamento diário"
        description="Cada colaborador presente gera uma diária; o excedente da jornada vira hora extra."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => toggleStatus.mutate(isClosed ? "open" : "closed")}
              disabled={!timesheet}
            >
              {isClosed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
              {isClosed ? "Reabrir" : "Fechar dia"}
            </Button>
            <Button
              onClick={() => saveAll.mutate()}
              disabled={isClosed || carregando || saveAll.isPending || !linhas.length}
            >
              <Save className="size-4" /> Salvar
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-5 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Operação</Label>
            <Select value={operationId} onValueChange={setOperationId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {operationList.map((operation) => (
                  <SelectItem key={operation.id} value={operation.id}>
                    {operation.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Turno</Label>
            <Select
              value={turnoId || "none"}
              onValueChange={(v) => setShiftId(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem turno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem turno definido</SelectItem>
                {operationShifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Regra aplicada</Label>
            <p className="pt-2 text-sm text-muted-foreground">
              {clientName} · diária {brl(rules.daily_rate)} · jornada{" "}
              {minutesToLabel(plannedMinutes || rules.shift_hours * 60)} · HE{" "}
              {brl((rules.daily_rate / (rules.shift_hours || 8)) * rules.ot_factor)}/h
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            Equipe do dia {isClosed ? <Badge className="ml-2">Fechado</Badge> : null}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {totals.dailies} diárias · {minutesToLabel(totals.overtime)} extras ·{" "}
            {brl(totals.billed)} a faturar · custo {brl(totals.cost)}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Presença</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Intervalo</TableHead>
                <TableHead>Trabalhado</TableHead>
                <TableHead>Hora extra</TableHead>
                <TableHead className="text-right">A faturar</TableHead>
                <TableHead className="text-right">Custo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carregando ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Carregando equipe e apontamentos…
                  </TableCell>
                </TableRow>
              ) : computed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Nenhum colaborador alocado neste turno. Configure a equipe em Operações.
                  </TableCell>
                </TableRow>
              ) : (
                computed.map(({ row, employee, calc }) => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="font-medium">{employee?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={row.status}
                        onValueChange={(v) =>
                          update(row.employeeId, { status: v as AttendanceStatus })
                        }
                        disabled={isClosed}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["present", "absent", "replacement"] as AttendanceStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>
                              {attendanceLabel[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="time"
                        className="w-28"
                        value={row.checkIn}
                        disabled={isClosed || row.status === "absent"}
                        onChange={(e) => update(row.employeeId, { checkIn: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="time"
                        className="w-28"
                        value={row.checkOut}
                        disabled={isClosed || row.status === "absent"}
                        onChange={(e) => update(row.employeeId, { checkOut: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-20"
                        value={row.breakMinutes}
                        disabled={isClosed || row.status === "absent"}
                        onChange={(e) =>
                          update(row.employeeId, { breakMinutes: Number(e.target.value) })
                        }
                      />
                    </TableCell>
                    <TableCell>{minutesToLabel(calc.workedMinutes)}</TableCell>
                    <TableCell>
                      {calc.overtimeMinutes > 0 ? (
                        <Badge variant="secondary">{minutesToLabel(calc.overtimeMinutes)}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">{brl(calc.billedAmount)}</TableCell>
                    <TableCell className="text-right">{brl(calc.costAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
