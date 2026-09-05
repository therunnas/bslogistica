"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "@/lib/notificacoes";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "../_components/app-shell";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
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

export function PainelOperacoes() {
  const queryClient = useQueryClient();
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

  const [opOpen, setOpOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState<Operation | null>(null);
  const [equipeBusca, setEquipeBusca] = useState("");
  const [equipeFiltro, setEquipeFiltro] = useState<"todos" | "aqui" | "disponivel" | "outra">(
    "todos",
  );

  /**
   * Alocação e desalocação não usam o CRUD genérico porque precisam de
   * tratamento próprio de erro: se o banco recusar por exclusividade (23505),
   * a mensagem técnica não serve para o usuário, e a lista precisa ser
   * recarregada para mostrar quem pegou o colaborador primeiro.
   */
  const alocarEquipe = useMutation({
    mutationFn: async (v: { employeeId: string; shiftId: string | null; vinculoId?: string }) => {
      if (!teamOpen) throw new Error("Nenhuma operação selecionada.");
      const cliente = criarClienteNavegador();
      if (v.vinculoId) {
        // Troca de turno na mesma operação: move o vínculo existente em vez de
        // criar um segundo. Assim nunca existem duas linhas ativas, nem por um
        // instante.
        const { error } = await cliente
          .from("operation_team")
          .update({ shift_id: v.shiftId })
          .eq("id", v.vinculoId);
        if (error) throw error;
        return;
      }
      const { error } = await cliente.from("operation_team").insert({
        operation_id: teamOpen.id,
        employee_id: v.employeeId,
        shift_id: v.shiftId,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operation_team"] }),
    onError: async (error: unknown) => {
      await queryClient.invalidateQueries({ queryKey: ["operation_team"] });
      const codigo = typeof error === "object" && error && "code" in error ? error.code : undefined;
      toast.error(
        codigo === "23505"
          ? "Este colaborador já foi alocado em outra operação. Atualize a equipe e tente novamente."
          : error instanceof Error
            ? error.message
            : "Não foi possível alocar o colaborador.",
      );
    },
  });

  const desalocarEquipe = useMutation({
    mutationFn: async (vinculoId: string) => {
      const { error } = await criarClienteNavegador()
        .from("operation_team")
        .delete()
        .eq("id", vinculoId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operation_team"] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const [opForm, setOpForm] = useState(emptyOperation);
  const [shiftForm, setShiftForm] = useState(emptyShift);

  /**
   * Um grupo por turno da operação. O grupo "sem turno" só aparece quando a
   * operação não tem turno nenhum — caso das avulsas — ou quando ainda existe
   * vínculo antigo gravado sem `shift_id`, para que ele continue visível e
   * possa ser desfeito em vez de sumir da tela.
   */
  const equipeGrupos = useMemo(() => {
    type Grupo = { id: string | null; nome: string; horario: string; alocados: number };
    if (!teamOpen) return [] as Grupo[];
    const membros = (team.data ?? []).filter((t) => t.operation_id === teamOpen.id);
    const contar = (shiftId: string | null) =>
      membros.filter((t) => (t.shift_id ?? null) === shiftId).length;

    const turnos: Grupo[] = (shifts.data ?? [])
      .filter((s) => s.operation_id === teamOpen.id)
      .map((s) => ({
        id: s.id,
        nome: s.name,
        horario: `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
        alocados: contar(s.id),
      }));

    const semTurno = contar(null);
    if (!turnos.length || semTurno > 0) {
      turnos.push({ id: null, nome: "Sem turno", horario: "definido", alocados: semTurno });
    }
    return turnos;
  }, [teamOpen, shifts.data, team.data]);

  /**
   * Uma linha por colaborador, com a alocação ativa dele — em qualquer operação.
   *
   * A regra é exclusividade global: um colaborador ocupa no máximo uma operação
   * e um turno por vez. Por isso a linha carrega o vínculo ativo onde quer que
   * ele esteja, e não só os vínculos desta operação: é o que permite mostrar
   * "alocado em OPP" e bloquear a alocação aqui.
   *
   * Busca e filtros são locais — os colaboradores já vieram do servidor, então
   * digitar não dispara consulta nova.
   */
  const equipeLinhas = useMemo(() => {
    if (!teamOpen) return [];
    const ativos = (team.data ?? []).filter((t) => t.active);
    const termo = equipeBusca.trim().toLowerCase();

    return (employees.data ?? [])
      .map((employee) => {
        const vinculos = ativos.filter((t) => t.employee_id === employee.id);
        const alocacao = vinculos[0] ?? null;
        const situacao: "disponivel" | "aqui" | "outra" = !alocacao
          ? "disponivel"
          : alocacao.operation_id === teamOpen.id
            ? "aqui"
            : "outra";
        return { employee, alocacao, situacao, conflito: vinculos.length > 1 };
      })
      .filter(({ employee, situacao }) => {
        if (equipeFiltro !== "todos" && equipeFiltro !== situacao) return false;
        if (!termo) return true;
        return (
          employee.name.toLowerCase().includes(termo) ||
          (employee.role ?? "").toLowerCase().includes(termo)
        );
      });
  }, [teamOpen, team.data, employees.data, equipeBusca, equipeFiltro]);

  /** Contadores do cabeçalho: sobre todos os colaboradores, não sobre o filtro. */
  const equipeResumo = useMemo(() => {
    if (!teamOpen) return { total: 0, aqui: 0, disponivel: 0, outra: 0 };
    const ativos = (team.data ?? []).filter((t) => t.active);
    let aqui = 0;
    let disponivel = 0;
    let outra = 0;
    (employees.data ?? []).forEach((employee) => {
      const alocacao = ativos.find((t) => t.employee_id === employee.id);
      if (!alocacao) disponivel += 1;
      else if (alocacao.operation_id === teamOpen.id) aqui += 1;
      else outra += 1;
    });
    return { total: (employees.data ?? []).length, aqui, disponivel, outra };
  }, [teamOpen, team.data, employees.data]);

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";
  const operationName = (id: string | undefined) =>
    operations.data?.find((o) => o.id === id)?.name ?? "outra operação";
  const shiftLabel = (id: string | null) => {
    if (!id) return "sem turno";
    const s = shifts.data?.find((x) => x.id === id);
    return s ? `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : "turno";
  };
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
          // Pessoas distintas com vínculo ativo nesta operação, não linhas da tabela.
          const opTeam = new Set(
            (team.data ?? [])
              .filter((t) => t.operation_id === operation.id && t.active)
              .map((t) => t.employee_id),
          );
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
                      <Users className="size-4" /> Equipe ({opTeam.size})
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

      <Dialog
        open={!!teamOpen}
        onOpenChange={(v) => {
          if (!v) {
            setTeamOpen(null);
            setEquipeBusca("");
            setEquipeFiltro("todos");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-[95vw] sm:max-w-4xl lg:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Equipe — {teamOpen?.name}</DialogTitle>
            <DialogDescription>
              Cada colaborador ocupa uma única operação e turno por vez. Para movê-lo, desaloque na
              operação atual antes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{equipeResumo.total} colaboradores</span>
            <span>
              Alocados aqui: <strong className="text-foreground">{equipeResumo.aqui}</strong>
            </span>
            <span>
              Disponíveis: <strong className="text-foreground">{equipeResumo.disponivel}</strong>
            </span>
            <span>
              Outras operações: <strong className="text-foreground">{equipeResumo.outra}</strong>
            </span>
            {equipeGrupos.map((grupo) => (
              <span key={`resumo-${grupo.id ?? "sem-turno"}`}>
                {grupo.nome}: <strong className="text-foreground">{grupo.alocados}</strong>
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Buscar colaborador..."
              value={equipeBusca}
              onChange={(e) => setEquipeBusca(e.target.value)}
              className="sm:flex-1"
            />
            {/* flex-wrap: os quatro filtros quebram para a linha de baixo em vez
                de esticarem o modal e criarem barra horizontal. */}
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["todos", "Todos"],
                  ["aqui", "Alocados aqui"],
                  ["disponivel", "Disponíveis"],
                  ["outra", "Em outra operação"],
                ] as const
              ).map(([valor, rotulo]) => (
                <Button
                  key={valor}
                  type="button"
                  size="sm"
                  className="shrink-0"
                  variant={equipeFiltro === valor ? "default" : "outline"}
                  onClick={() => setEquipeFiltro(valor)}
                >
                  {rotulo}
                </Button>
              ))}
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto overflow-x-hidden rounded-md border border-border">
            <div className="sticky top-0 z-10 hidden border-b border-border bg-background px-3 py-2 sm:flex sm:items-center">
              <p className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Colaborador
              </p>
              <p className="w-[22rem] shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Alocação
              </p>
            </div>

            {equipeLinhas.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nenhum colaborador encontrado com esses critérios.
              </p>
            ) : (
              equipeLinhas.map(({ employee, alocacao, situacao, conflito }) => (
                <div
                  key={employee.id}
                  className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{employee.name}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {employee.role ?? "—"} · custo {brl(employee.daily_cost)}
                    </p>
                    {conflito ? (
                      <p className="text-xs font-medium text-destructive">
                        Conflito: mais de uma alocação ativa. Revise antes de continuar.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex w-full min-w-0 items-center gap-2 sm:w-[22rem] sm:shrink-0">
                    {situacao === "outra" ? (
                      <p className="min-w-0 break-words text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1">
                          Indisponível
                        </Badge>
                        Alocado em {operationName(alocacao?.operation_id)} ·{" "}
                        {shiftLabel(alocacao?.shift_id ?? null)}
                      </p>
                    ) : (
                      <>
                        <Select
                          value={
                            situacao === "aqui" ? (alocacao?.shift_id ?? "sem-turno") : "nenhum"
                          }
                          onValueChange={(v) =>
                            alocarEquipe.mutate({
                              employeeId: employee.id,
                              shiftId: v === "sem-turno" ? null : v,
                              ...(alocacao ? { vinculoId: alocacao.id } : {}),
                            })
                          }
                        >
                          <SelectTrigger className="min-w-0 flex-1">
                            <SelectValue placeholder="Selecionar turno" />
                          </SelectTrigger>
                          <SelectContent>
                            {situacao === "disponivel" ? (
                              <SelectItem value="nenhum" disabled>
                                Selecionar turno
                              </SelectItem>
                            ) : null}
                            {equipeGrupos.map((grupo) => (
                              <SelectItem
                                key={`opt-${grupo.id ?? "sem-turno"}`}
                                value={grupo.id ?? "sem-turno"}
                              >
                                {grupo.nome}
                                {grupo.id ? ` · ${grupo.horario}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {situacao === "aqui" && alocacao ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => desalocarEquipe.mutate(alocacao.id)}
                          >
                            Desalocar
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setTeamOpen(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
