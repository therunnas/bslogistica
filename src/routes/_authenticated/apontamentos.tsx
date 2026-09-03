import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, LockOpen, Save } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { attendanceLabel, calcEntry, shiftPlannedMinutes, type AttendanceStatus } from "@/lib/billing";
import { brl, minutesToLabel, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/apontamentos")({
  head: () => ({
    meta: [
      { title: "Apontamento diário | OpLog" },
      {
        name: "description",
        content:
          "Registre presença, faltas, horários e horas extras por turno e gere as diárias faturáveis do dia.",
      },
      { property: "og:title", content: "Apontamento diário | OpLog" },
      {
        property: "og:description",
        content: "Presença, horários e horas extras por turno, com cálculo automático da diária.",
      },
    ],
  }),
  component: TimesheetPage,
});

interface DraftEntry {
  employeeId: string;
  entryId: string | undefined;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  notes: string;
}

function TimesheetPage() {
  const queryClient = useQueryClient();
  const clients = useClients();
  const operations = useOperations();
  const shifts = useShifts();
  const employees = useEmployees();
  const team = useTeam();
  const timesheets = useTimesheets();
  const entries = useEntries();

  const [operationId, setOperationId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<DraftEntry[]>([]);

  const operationList = operations.data ?? [];
  useEffect(() => {
    if (!operationId && operationList[0]) setOperationId(operationList[0].id);
  }, [operationId, operationList]);

  const operationShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.operation_id === operationId),
    [shifts.data, operationId],
  );
  useEffect(() => {
    setShiftId(operationShifts[0]?.id ?? "");
  }, [operationShifts]);

  const shift = operationShifts.find((s) => s.id === shiftId) ?? null;
  const plannedMinutes = shiftPlannedMinutes(shift);
  const rules = useContractRules(operationId);

  const timesheet = useMemo(
    () =>
      (timesheets.data ?? []).find(
        (t) =>
          t.operation_id === operationId &&
          t.work_date === date &&
          (t.shift_id ?? "") === (shiftId ?? ""),
      ),
    [timesheets.data, operationId, date, shiftId],
  );

  const existingEntries = useMemo(
    () => (entries.data ?? []).filter((e) => e.timesheet_id === timesheet?.id),
    [entries.data, timesheet?.id],
  );

  const teamMembers = useMemo(
    () =>
      (team.data ?? []).filter(
        (t) => t.operation_id === operationId && (!shiftId || !t.shift_id || t.shift_id === shiftId),
      ),
    [team.data, operationId, shiftId],
  );

  useEffect(() => {
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
    setDraft([...base, ...extras]);
  }, [teamMembers, existingEntries, shift?.start_time, shift?.end_time, shift?.break_minutes]);

  const employeeMap = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const computed = draft.map((row) => {
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

  const saveAll = useMutation({
    mutationFn: async () => {
      let timesheetId = timesheet?.id;
      if (!timesheetId) {
        const { data, error } = await supabase
          .from("timesheets")
          .insert({
            operation_id: operationId,
            shift_id: shiftId || null,
            work_date: date,
            status: "open",
          })
          .select("id")
          .single();
        if (error) throw error;
        timesheetId = data.id;
      }
      const payload = computed.map(({ row, calc }) => ({
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
      if (payload.length) {
        const { error } = await supabase.from("timesheet_entries").upsert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
      toast.success("Apontamento salvo.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (status: "open" | "closed") => {
      if (!timesheet) throw new Error("Salve o apontamento antes de fechar.");
      const { error } = await supabase
        .from("timesheets")
        .update({ status })
        .eq("id", timesheet.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
      toast.success("Status do apontamento atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function update(employeeId: string, patch: Partial<DraftEntry>) {
    setDraft((rows) =>
      rows.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row)),
    );
  }

  const clientName =
    clients.data?.find(
      (c) => c.id === operationList.find((o) => o.id === operationId)?.client_id,
    )?.name ?? "—";

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
            <Button onClick={() => saveAll.mutate()} disabled={isClosed || !draft.length}>
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
              value={shiftId || "none"}
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
              {computed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Nenhum colaborador alocado nesta operação. Monte a equipe em Operações.
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
