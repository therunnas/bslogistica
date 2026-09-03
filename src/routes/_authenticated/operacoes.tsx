import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  useContracts,
  useEmployees,
  useOperations,
  useShifts,
  useTeam,
} from "@/lib/queries";
import { useDeleteRow, useSaveRow } from "@/lib/mutations";
import { brl, dateBR, minutesToLabel, todayISO } from "@/lib/format";
import { shiftPlannedMinutes } from "@/lib/billing";
import type { Operation, Shift } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/operacoes")({
  head: () => ({
    meta: [
      { title: "Operações e turnos | BS Logística" },
      {
        name: "description",
        content:
          "Operações fixas e avulsas de carga e descarga, com turnos, intervalos e equipe alocada.",
      },
      { property: "og:title", content: "Operações e turnos | BS Logística" },
      {
        property: "og:description",
        content: "Operações fixas e avulsas com turnos e equipe alocada.",
      },
    ],
  }),
  component: OperationsPage,
});

const emptyOperation = {
  id: "",
  client_id: "",
  contract_id: "",
  type: "fixed",
  name: "",
  site: "",
  agreed_amount: "",
  operation_date: "",
  status: "active",
  notes: "",
};

const emptyShift = {
  id: "",
  operation_id: "",
  name: "",
  start_time: "06:00",
  end_time: "15:00",
  break_minutes: 60,
  crosses_midnight: false,
  status: "active",
};

function OperationsPage() {
  const clients = useClients();
  const contracts = useContracts();
  const operations = useOperations();
  const shifts = useShifts();
  const employees = useEmployees();
  const team = useTeam();

  const saveOperation = useSaveRow("operations");
  const removeOperation = useDeleteRow("operations");
  const saveShift = useSaveRow("shifts");
  const removeShift = useDeleteRow("shifts");
  const saveTeam = useSaveRow("operation_team");
  const removeTeam = useDeleteRow("operation_team");

  const [opOpen, setOpOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState<Operation | null>(null);
  const [opForm, setOpForm] = useState(emptyOperation);
  const [shiftForm, setShiftForm] = useState(emptyShift);

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";
  const contractName = (id: string | null) =>
    contracts.data?.find((c) => c.id === id)?.name ?? "Valor acordado";
  const clientContracts = useMemo(
    () => (contracts.data ?? []).filter((c) => c.client_id === opForm.client_id),
    [contracts.data, opForm.client_id],
  );

  function editOperation(operation: Operation) {
    setOpForm({
      id: operation.id,
      client_id: operation.client_id,
      contract_id: operation.contract_id ?? "",
      type: operation.type,
      name: operation.name,
      site: operation.site ?? "",
      agreed_amount: operation.agreed_amount == null ? "" : String(operation.agreed_amount),
      operation_date: operation.operation_date ?? "",
      status: operation.status,
      notes: operation.notes ?? "",
    });
    setOpOpen(true);
  }

  function submitOperation() {
    const payload: Record<string, unknown> = {
      client_id: opForm.client_id,
      contract_id: opForm.contract_id || null,
      type: opForm.type,
      name: opForm.name,
      site: opForm.site || null,
      agreed_amount: opForm.agreed_amount === "" ? null : Number(opForm.agreed_amount),
      operation_date: opForm.operation_date || null,
      status: opForm.status,
      notes: opForm.notes || null,
    };
    if (opForm.id) payload["id"] = opForm.id;
    saveOperation.mutate(payload, { onSuccess: () => setOpOpen(false) });
  }

  function editShift(shift: Shift) {
    setShiftForm({
      id: shift.id,
      operation_id: shift.operation_id,
      name: shift.name,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      break_minutes: shift.break_minutes,
      crosses_midnight: shift.crosses_midnight,
      status: shift.status,
    });
    setShiftOpen(true);
  }

  function submitShift() {
    const payload: Record<string, unknown> = {
      operation_id: shiftForm.operation_id,
      name: shiftForm.name,
      start_time: `${shiftForm.start_time}:00`,
      end_time: `${shiftForm.end_time}:00`,
      break_minutes: Number(shiftForm.break_minutes) || 0,
      crosses_midnight: shiftForm.crosses_midnight,
      status: shiftForm.status,
    };
    if (shiftForm.id) payload["id"] = shiftForm.id;
    saveShift.mutate(payload, { onSuccess: () => setShiftOpen(false) });
  }

  function toggleTeam(operationId: string, employeeId: string, shiftId: string | null) {
    const existing = (team.data ?? []).find(
      (t) => t.operation_id === operationId && t.employee_id === employeeId,
    );
    if (existing) removeTeam.mutate(existing.id);
    else
      saveTeam.mutate({
        operation_id: operationId,
        employee_id: employeeId,
        shift_id: shiftId,
        active: true,
      });
  }

  return (
    <div>
      <PageHeader
        title="Operações"
        description="Operações fixas com turnos diários e operações avulsas de carga e descarga."
        action={
          <Button
            onClick={() => {
              setOpForm({ ...emptyOperation, client_id: clients.data?.[0]?.id ?? "" });
              setOpOpen(true);
            }}
            disabled={!clients.data?.length}
          >
            <Plus className="size-4" /> Nova operação
          </Button>
        }
      />

      <div className="space-y-4">
        {(operations.data ?? []).map((operation) => {
          const opShifts = (shifts.data ?? []).filter((s) => s.operation_id === operation.id);
          const opTeam = (team.data ?? []).filter((t) => t.operation_id === operation.id);
          return (
            <Card key={operation.id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-semibold">{operation.name}</h2>
                      <Badge variant={operation.type === "fixed" ? "default" : "secondary"}>
                        {operation.type === "fixed" ? "Fixa" : "Avulsa"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {clientName(operation.client_id)} · {operation.site ?? "sem local"} ·{" "}
                      {contractName(operation.contract_id)}
                      {operation.agreed_amount != null
                        ? ` · valor acordado ${brl(operation.agreed_amount)}`
                        : ""}
                      {operation.operation_date ? ` · ${dateBR(operation.operation_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setTeamOpen(operation)}>
                      <Users className="size-4" /> Equipe ({opTeam.length})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShiftForm({ ...emptyShift, operation_id: operation.id });
                        setShiftOpen(true);
                      }}
                    >
                      <Plus className="size-4" /> Turno
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => editOperation(operation)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOperation.mutate(operation.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {opShifts.length ? (
                  <Table className="mt-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Turno</TableHead>
                        <TableHead>Início</TableHead>
                        <TableHead>Fim</TableHead>
                        <TableHead>Intervalo</TableHead>
                        <TableHead>Jornada líquida</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {opShifts.map((shift) => (
                        <TableRow key={shift.id}>
                          <TableCell className="font-medium">{shift.name}</TableCell>
                          <TableCell>{shift.start_time.slice(0, 5)}</TableCell>
                          <TableCell>
                            {shift.end_time.slice(0, 5)}
                            {shift.crosses_midnight ? " (+1d)" : ""}
                          </TableCell>
                          <TableCell>{shift.break_minutes} min</TableCell>
                          <TableCell>{minutesToLabel(shiftPlannedMinutes(shift))}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => editShift(shift)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeShift.mutate(shift.id)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Nenhum turno cadastrado nesta operação.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {operations.data?.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma operação cadastrada.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={opOpen} onOpenChange={setOpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{opForm.id ? "Editar operação" : "Nova operação"}</DialogTitle>
            <DialogDescription>
              Operações fixas usam turnos diários; avulsas registram data e valor acordado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select
                value={opForm.client_id}
                onValueChange={(v) => setOpForm({ ...opForm, client_id: v, contract_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={opForm.type} onValueChange={(v) => setOpForm({ ...opForm, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixa</SelectItem>
                  <SelectItem value="spot">Avulsa (carga/descarga)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome da operação</Label>
              <Input
                value={opForm.name}
                onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Local</Label>
              <Input
                value={opForm.site}
                onChange={(e) => setOpForm({ ...opForm, site: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contrato (regra de cobrança)</Label>
              <Select
                value={opForm.contract_id || "none"}
                onValueChange={(v) => setOpForm({ ...opForm, contract_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem contrato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem contrato (valor acordado)</SelectItem>
                  {clientContracts.map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.name} — {brl(contract.daily_rate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor acordado por diária (avulsa)</Label>
              <Input
                type="number"
                step="0.01"
                value={opForm.agreed_amount}
                onChange={(e) => setOpForm({ ...opForm, agreed_amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data da operação (avulsa)</Label>
              <Input
                type="date"
                value={opForm.operation_date}
                onChange={(e) => setOpForm({ ...opForm, operation_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={opForm.notes}
                onChange={(e) => setOpForm({ ...opForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitOperation} disabled={!opForm.name || !opForm.client_id}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{shiftForm.id ? "Editar turno" : "Novo turno"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome do turno</Label>
              <Input
                placeholder="1º turno"
                value={shiftForm.name}
                onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Início</Label>
              <Input
                type="time"
                value={shiftForm.start_time}
                onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fim</Label>
              <Input
                type="time"
                value={shiftForm.end_time}
                onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Intervalo (min)</Label>
              <Input
                type="number"
                value={shiftForm.break_minutes}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, break_minutes: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox
                id="crosses"
                checked={shiftForm.crosses_midnight}
                onCheckedChange={(v) =>
                  setShiftForm({ ...shiftForm, crosses_midnight: Boolean(v) })
                }
              />
              <Label htmlFor="crosses">Vira a meia-noite</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitShift} disabled={!shiftForm.name}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!teamOpen} onOpenChange={(v) => !v && setTeamOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Equipe — {teamOpen?.name}</DialogTitle>
            <DialogDescription>
              Marque os colaboradores alocados. A cobrança considera apenas quem trabalhou no dia.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(employees.data ?? []).map((employee) => {
              const member = (team.data ?? []).find(
                (t) => t.operation_id === teamOpen?.id && t.employee_id === employee.id,
              );
              const opShifts = (shifts.data ?? []).filter((s) => s.operation_id === teamOpen?.id);
              return (
                <div
                  key={employee.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={!!member}
                      onCheckedChange={() =>
                        teamOpen && toggleTeam(teamOpen.id, employee.id, opShifts[0]?.id ?? null)
                      }
                    />
                    <div>
                      <p className="text-sm font-medium">{employee.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {employee.role ?? "—"} · custo {brl(employee.daily_cost)}
                      </p>
                    </div>
                  </div>
                  {member?.shift_id ? (
                    <Badge variant="secondary">
                      {shifts.data?.find((s) => s.id === member.shift_id)?.name ?? "turno"}
                    </Badge>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button onClick={() => setTeamOpen(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
