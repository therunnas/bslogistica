"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Layers3,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { shiftPlannedMinutes } from "@/lib/billing";
import { brl, dateBR, minutesToLabel } from "@/lib/format";
import { exigirLinhaAfetada, useDeleteRow, useSaveRow } from "@/lib/mutations";
import { toast } from "@/lib/notificacoes";
import {
  useClients,
  useContracts,
  useEmployees,
  useOperations,
  useShifts,
  useTeam,
  useEntries,
  useTimesheets,
} from "@/lib/queries";
import type { Operation, Shift } from "@/lib/types";
import { AvisoDoMotor, HistoricoDeVigencias } from "../_components/vigencias";
import { MENSAGEM_TURNO_PROTEGIDO } from "@/lib/erros-banco";
import { useCriarComVigencia, useEstadoDoMotor } from "@/lib/vigencias-dados";
import {
  hojeEmSaoPaulo,
  jornadaDoTurnoProtegida,
  modoDeEdicaoDeTaxa,
  novoTurnoAPartir,
  turnoTemApontamentos,
} from "@/lib/vigencias-ui";

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

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

export function PainelOperacoes() {
  const queryClient = useQueryClient();

  const clients = useClients();
  const contracts = useContracts();
  const operations = useOperations();
  const shifts = useShifts();
  const employees = useEmployees();
  const team = useTeam();

  const saveOperation = useSaveRow("operations");
  const criarOperacaoComVigencia = useCriarComVigencia("operacao", "operations", ["operations"]);
  const estadoDoMotor = useEstadoDoMotor();
  const modoDeValor = modoDeEdicaoDeTaxa(estadoDoMotor);
  const timesheets = useTimesheets();
  const entries = useEntries();
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

  const [opForm, setOpForm] = useState(emptyOperation);
  const [shiftForm, setShiftForm] = useState(emptyShift);

  /**
   * Alocação e desalocação não usam o CRUD genérico porque precisam de
   * tratamento próprio de erro: se o banco recusar por exclusividade (23505),
   * a mensagem técnica não serve para o usuário, e a lista precisa ser
   * recarregada para mostrar quem pegou o colaborador primeiro.
   */
  const alocarEquipe = useMutation({
    mutationFn: async (v: { employeeId: string; shiftId: string | null; vinculoId?: string }) => {
      if (!teamOpen) {
        throw new Error("Nenhuma operação selecionada.");
      }

      const cliente = criarClienteNavegador();

      if (v.vinculoId) {
        const { error, count } = await cliente
          .from("operation_team")
          .update(
            {
              shift_id: v.shiftId,
            },
            {
              count: "exact",
            },
          )
          .eq("id", v.vinculoId);

        if (error) {
          throw error;
        }

        exigirLinhaAfetada(count, "mudar o turno do colaborador");
        return;
      }

      const { error } = await cliente.from("operation_team").insert({
        operation_id: teamOpen.id,
        employee_id: v.employeeId,
        shift_id: v.shiftId,
        active: true,
      });

      if (error) {
        throw error;
      }
    },

    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["operation_team"],
      }),

    onError: async (error: unknown) => {
      await queryClient.invalidateQueries({
        queryKey: ["operation_team"],
      });

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
      const { error, count } = await criarClienteNavegador()
        .from("operation_team")
        .delete({
          count: "exact",
        })
        .eq("id", vinculoId);

      if (error) {
        throw error;
      }

      exigirLinhaAfetada(count, "desalocar o colaborador");
    },

    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["operation_team"],
      }),

    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Um grupo por turno da operação. O grupo "sem turno" só aparece quando a
   * operação não tem turno nenhum — caso das avulsas — ou quando ainda existe
   * vínculo antigo gravado sem `shift_id`, para que ele continue visível e
   * possa ser desfeito em vez de sumir da tela.
   */
  const equipeGrupos = useMemo(() => {
    type Grupo = {
      id: string | null;
      nome: string;
      horario: string;
      alocados: number;
    };

    if (!teamOpen) {
      return [] as Grupo[];
    }

    const membros = (team.data ?? []).filter((item) => item.operation_id === teamOpen.id);

    const contar = (shiftId: string | null) =>
      membros.filter((item) => (item.shift_id ?? null) === shiftId).length;

    const turnos: Grupo[] = (shifts.data ?? [])
      .filter((shift) => shift.operation_id === teamOpen.id)
      .map((shift) => ({
        id: shift.id,
        nome: shift.name,
        horario: `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`,
        alocados: contar(shift.id),
      }));

    const semTurno = contar(null);

    if (!turnos.length || semTurno > 0) {
      turnos.push({
        id: null,
        nome: "Sem turno",
        horario: "definido",
        alocados: semTurno,
      });
    }

    return turnos;
  }, [teamOpen, shifts.data, team.data]);

  /**
   * Uma linha por colaborador, com a alocação ativa dele — em qualquer operação.
   *
   * A regra é exclusividade global: um colaborador ocupa no máximo uma operação
   * e um turno por vez.
   */
  const equipeLinhas = useMemo(() => {
    if (!teamOpen) {
      return [];
    }

    const ativos = (team.data ?? []).filter((item) => item.active);
    const termo = equipeBusca.trim().toLowerCase();

    return (employees.data ?? [])
      .map((employee) => {
        const vinculos = ativos.filter((item) => item.employee_id === employee.id);

        const alocacao = vinculos[0] ?? null;

        const situacao: "disponivel" | "aqui" | "outra" = !alocacao
          ? "disponivel"
          : alocacao.operation_id === teamOpen.id
            ? "aqui"
            : "outra";

        return {
          employee,
          alocacao,
          situacao,
          conflito: vinculos.length > 1,
        };
      })
      .filter(({ employee, situacao }) => {
        if (equipeFiltro !== "todos" && equipeFiltro !== situacao) {
          return false;
        }

        if (!termo) {
          return true;
        }

        return (
          employee.name.toLowerCase().includes(termo) ||
          (employee.role ?? "").toLowerCase().includes(termo)
        );
      });
  }, [teamOpen, team.data, employees.data, equipeBusca, equipeFiltro]);

  const equipeResumo = useMemo(() => {
    if (!teamOpen) {
      return {
        total: 0,
        aqui: 0,
        disponivel: 0,
        outra: 0,
      };
    }

    const ativos = (team.data ?? []).filter((item) => item.active);

    let aqui = 0;
    let disponivel = 0;
    let outra = 0;

    (employees.data ?? []).forEach((employee) => {
      const alocacao = ativos.find((item) => item.employee_id === employee.id);

      if (!alocacao) {
        disponivel += 1;
      } else if (alocacao.operation_id === teamOpen.id) {
        aqui += 1;
      } else {
        outra += 1;
      }
    });

    return {
      total: (employees.data ?? []).length,
      aqui,
      disponivel,
      outra,
    };
  }, [teamOpen, team.data, employees.data]);

  const totalOperacoes = operations.data?.length ?? 0;

  const operacoesFixas =
    operations.data?.filter((operation) => operation.type === "fixed").length ?? 0;

  const operacoesAvulsas =
    operations.data?.filter((operation) => operation.type === "spot").length ?? 0;

  const colaboradoresAlocados = new Set(
    (team.data ?? []).filter((item) => item.active).map((item) => item.employee_id),
  ).size;

  const clientName = (id: string) => clients.data?.find((client) => client.id === id)?.name ?? "—";

  const operationName = (id: string | undefined) =>
    operations.data?.find((operation) => operation.id === id)?.name ?? "outra operação";

  const shiftLabel = (id: string | null) => {
    if (!id) {
      return "sem turno";
    }

    const shift = shifts.data?.find((item) => item.id === id);

    return shift
      ? `${shift.name} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`
      : "turno";
  };

  const contractName = (id: string | null) =>
    contracts.data?.find((contract) => contract.id === id)?.name ?? "Valor acordado";

  const clientContracts = useMemo(
    () => (contracts.data ?? []).filter((contract) => contract.client_id === opForm.client_id),
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

  // O valor acordado de operação existente só muda aqui com o motor DESLIGADO; ligado, é por nova
  // vigência; sem estado confirmado, nada financeiro é oferecido nem enviado. `contract_id` nunca é
  // alterado por esta lógica: segue exatamente o que o usuário escolheu no formulário.
  const valorTravado =
    modoDeValor !== "direta" && (Boolean(opForm.id) || modoDeValor === "bloqueada");

  function submitOperation() {
    const payload: Record<string, unknown> = {
      client_id: opForm.client_id,
      contract_id: opForm.contract_id || null,
      type: opForm.type,
      name: opForm.name,
      site: opForm.site || null,
      operation_date: opForm.operation_date || null,
      status: opForm.status,
      notes: opForm.notes || null,
    };

    const enviaValor = modoDeValor === "direta" || (!opForm.id && modoDeValor === "por-vigencia");
    if (enviaValor) {
      payload["agreed_amount"] = opForm.agreed_amount === "" ? null : Number(opForm.agreed_amount);
    }

    if (opForm.id) {
      payload["id"] = opForm.id;
      saveOperation.mutate(payload, { onSuccess: () => setOpOpen(false) });
      return;
    }

    if (modoDeValor === "por-vigencia" && !opForm.contract_id && opForm.agreed_amount !== "") {
      // Motor ligado, operação nova sem contrato: nasce com a vigência inicial do valor acordado.
      criarOperacaoComVigencia.mutate(
        {
          linha: payload,
          form: {
            inicio: opForm.operation_date || hojeEmSaoPaulo(),
            motivo: "Cadastro inicial da operação",
            valores: { agreed_amount: String(opForm.agreed_amount) },
            encerrarAnterior: false,
          },
        },
        { onSuccess: () => setOpOpen(false) },
      );
      return;
    }

    saveOperation.mutate(payload, { onSuccess: () => setOpOpen(false) });
  }

  // Turnos (U7): a jornada de turno com apontamento é protegida quando o motor está ligado ou o
  // estado é desconhecido (o congelamento é habilitado junto com o motor).
  const turnoUsado = shiftForm.id
    ? turnoTemApontamentos(shiftForm.id, timesheets.data ?? [], entries.data ?? [])
    : false;
  const jornadaTravada = jornadaDoTurnoProtegida(estadoDoMotor, turnoUsado);

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
      status: shiftForm.status,
    };

    // Turno com apontamento e jornada protegida: só nome e status seguem (o histórico não muda).
    if (!jornadaTravada) {
      payload["start_time"] = `${shiftForm.start_time}:00`;
      payload["end_time"] = `${shiftForm.end_time}:00`;
      payload["break_minutes"] = Number(shiftForm.break_minutes) || 0;
      payload["crosses_midnight"] = shiftForm.crosses_midnight;
    }

    if (shiftForm.id) {
      payload["id"] = shiftForm.id;
    }

    saveShift.mutate(payload, {
      onSuccess: () => setShiftOpen(false),
    });
  }

  return (
    <div>
      <PageHeader
        title="Operações"
        description="Gerencie operações fixas e avulsas, turnos e equipes alocadas."
        action={
          <Button
            className="h-10 rounded-xl"
            onClick={() => {
              setOpForm({
                ...emptyOperation,
                client_id: clients.data?.[0]?.id ?? "",
              });

              setOpOpen(true);
            }}
            disabled={!clients.data?.length}
          >
            <Plus className="h-4 w-4" />
            Nova operação
          </Button>
        }
      />

      <AvisoDoMotor estado={estadoDoMotor} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          label="Operações"
          value={String(totalOperacoes)}
          description="Total cadastrado"
          icon={Layers3}
        />

        <Resumo
          label="Fixas"
          value={String(operacoesFixas)}
          description="Operações recorrentes"
          icon={BriefcaseBusiness}
        />

        <Resumo
          label="Avulsas"
          value={String(operacoesAvulsas)}
          description="Carga e descarga"
          icon={CalendarDays}
        />

        <Resumo
          label="Alocados"
          value={String(colaboradoresAlocados)}
          description="Colaboradores em operação"
          icon={Users}
        />
      </div>

      <div className="mb-4">
        <p className="text-sm font-medium text-foreground">Operações cadastradas</p>

        <p className="mt-1 text-xs text-muted-foreground">
          Consulte regras comerciais, turnos e equipes vinculadas a cada operação.
        </p>
      </div>

      <div className="space-y-4">
        {(operations.data ?? []).map((operation) => {
          const opShifts = (shifts.data ?? []).filter(
            (shift) => shift.operation_id === operation.id,
          );

          const opTeam = new Set(
            (team.data ?? [])
              .filter((item) => item.operation_id === operation.id && item.active)
              .map((item) => item.employee_id),
          );

          return (
            <Card
              key={operation.id}
              className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]"
            >
              <CardContent className="p-0">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary">
                        <BriefcaseBusiness className="h-4 w-4" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-foreground">
                            {operation.name}
                          </h2>

                          <TipoBadge tipo={operation.type} />
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {clientName(operation.client_id)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {operation.site ?? "Sem local definido"}
                      </span>

                      <span className="flex items-center gap-1.5">
                        <Layers3 className="h-3.5 w-3.5" />
                        {contractName(operation.contract_id)}
                      </span>

                      {operation.agreed_amount != null ? (
                        <span className="font-medium text-foreground">
                          {brl(operation.agreed_amount)}
                        </span>
                      ) : null}

                      {operation.operation_date ? (
                        <span className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {dateBR(operation.operation_date)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setTeamOpen(operation)}
                    >
                      <Users className="h-4 w-4" />
                      Equipe ({opTeam.size})
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => {
                        setShiftForm({
                          ...emptyShift,
                          operation_id: operation.id,
                        });

                        setShiftOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Turno
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
                      onClick={() => editOperation(operation)}
                      aria-label={`Editar ${operation.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeOperation.mutate(operation.id)}
                      aria-label={`Excluir ${operation.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {opShifts.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                          <TableHead className="h-11 text-xs font-semibold text-muted-foreground">
                            Turno
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Início
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Fim
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Intervalo
                          </TableHead>

                          <TableHead className="text-xs font-semibold text-muted-foreground">
                            Jornada líquida
                          </TableHead>

                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {opShifts.map((shift) => (
                          <TableRow key={shift.id} className="border-border hover:bg-secondary/20">
                            <TableCell className="py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary/40">
                                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>

                                <span className="text-sm font-medium text-foreground">
                                  {shift.name}
                                </span>
                              </div>
                            </TableCell>

                            <TableCell className="text-sm text-muted-foreground">
                              {shift.start_time.slice(0, 5)}
                            </TableCell>

                            <TableCell className="text-sm text-muted-foreground">
                              {shift.end_time.slice(0, 5)}
                              {shift.crosses_midnight ? " (+1d)" : ""}
                            </TableCell>

                            <TableCell className="text-sm text-muted-foreground">
                              {shift.break_minutes} min
                            </TableCell>

                            <TableCell className="text-sm font-medium text-foreground">
                              {minutesToLabel(shiftPlannedMinutes(shift))}
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                                  onClick={() => editShift(shift)}
                                  aria-label={`Editar turno ${shift.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => removeShift.mutate(shift.id)}
                                  aria-label={`Excluir turno ${shift.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex min-h-28 items-center justify-center px-5 py-6">
                    <p className="text-sm text-muted-foreground">
                      Nenhum turno cadastrado nesta operação.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {operations.data?.length === 0 ? (
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
                <BriefcaseBusiness className="h-5 w-5 text-muted-foreground" />
              </div>

              <p className="mt-4 text-sm font-medium text-foreground">
                Nenhuma operação cadastrada
              </p>

              <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                Cadastre a primeira operação para configurar turnos e alocar colaboradores.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={opOpen} onOpenChange={setOpOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card text-card-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">
              {opForm.id ? "Editar operação" : "Nova operação"}
            </DialogTitle>

            <DialogDescription>
              Operações fixas usam turnos diários; avulsas registram data e valor acordado.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cliente</Label>

              <Select
                value={opForm.client_id}
                onValueChange={(value) =>
                  setOpForm({
                    ...opForm,
                    client_id: value,
                    contract_id: "",
                  })
                }
              >
                <SelectTrigger className={SELECT_CLASS}>
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

            <div className="space-y-2">
              <Label>Tipo</Label>

              <Select
                value={opForm.type}
                onValueChange={(value) =>
                  setOpForm({
                    ...opForm,
                    type: value,
                  })
                }
              >
                <SelectTrigger className={SELECT_CLASS}>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="fixed">Fixa</SelectItem>

                  <SelectItem value="spot">Avulsa (carga/descarga)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Nome da operação</Label>

              <Input
                value={opForm.name}
                onChange={(event) =>
                  setOpForm({
                    ...opForm,
                    name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Local</Label>

              <Input
                value={opForm.site}
                onChange={(event) =>
                  setOpForm({
                    ...opForm,
                    site: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Contrato (regra de cobrança)</Label>

              <Select
                value={opForm.contract_id || "none"}
                onValueChange={(value) =>
                  setOpForm({
                    ...opForm,
                    contract_id: value === "none" ? "" : value,
                  })
                }
              >
                <SelectTrigger className={SELECT_CLASS}>
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

            <div className="space-y-2">
              <Label>Valor acordado por diária (avulsa)</Label>

              <Input
                type="number"
                step="0.01"
                value={opForm.agreed_amount}
                disabled={valorTravado}
                onChange={(event) =>
                  setOpForm({
                    ...opForm,
                    agreed_amount: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            {valorTravado ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {modoDeValor === "por-vigencia"
                  ? "Motor ligado: o valor acordado não é editado aqui. Registre uma nova vigência no histórico abaixo."
                  : "Estado do motor não confirmado: o valor acordado está somente para leitura."}
              </p>
            ) : null}

            {opForm.id && !opForm.contract_id ? (
              <div className="sm:col-span-2">
                <HistoricoDeVigencias
                  tipo="operacao"
                  entidadeId={opForm.id}
                  estado={estadoDoMotor}
                  valoresIniciais={{ agreed_amount: opForm.agreed_amount }}
                />
              </div>
            ) : opForm.id && opForm.contract_id ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Esta operação tem contrato: diária e regras vêm das vigências do contrato (tela
                Clientes e contratos).
              </p>
            ) : null}

            <div className="space-y-2">
              <Label>Data da operação (avulsa)</Label>

              <Input
                type="date"
                value={opForm.operation_date}
                onChange={(event) =>
                  setOpForm({
                    ...opForm,
                    operation_date: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Observações</Label>

              <Textarea
                value={opForm.notes}
                onChange={(event) =>
                  setOpForm({
                    ...opForm,
                    notes: event.target.value,
                  })
                }
                className="min-h-24 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
          </div>

          <DialogFooter className="mt-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setOpOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              onClick={submitOperation}
              disabled={
                !opForm.name ||
                !opForm.client_id ||
                saveOperation.isPending ||
                criarOperacaoComVigencia.isPending
              }
            >
              Salvar operação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent className="rounded-2xl border-border bg-card text-card-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">
              {shiftForm.id ? "Editar turno" : "Novo turno"}
            </DialogTitle>

            <DialogDescription>
              Defina o período de trabalho e o intervalo previsto para o turno.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome do turno</Label>

              <Input
                placeholder="1º turno"
                value={shiftForm.name}
                onChange={(event) =>
                  setShiftForm({
                    ...shiftForm,
                    name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Início</Label>

              <Input
                type="time"
                value={shiftForm.start_time}
                disabled={jornadaTravada}
                onChange={(event) =>
                  setShiftForm({
                    ...shiftForm,
                    start_time: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Fim</Label>

              <Input
                type="time"
                value={shiftForm.end_time}
                disabled={jornadaTravada}
                onChange={(event) =>
                  setShiftForm({
                    ...shiftForm,
                    end_time: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Intervalo (min)</Label>

              <Input
                type="number"
                value={shiftForm.break_minutes}
                disabled={jornadaTravada}
                onChange={(event) =>
                  setShiftForm({
                    ...shiftForm,
                    break_minutes: Number(event.target.value),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3 sm:mt-7">
              <Checkbox
                id="crosses"
                checked={shiftForm.crosses_midnight}
                disabled={jornadaTravada}
                onCheckedChange={(value) =>
                  setShiftForm({
                    ...shiftForm,
                    crosses_midnight: Boolean(value),
                  })
                }
              />

              <Label htmlFor="crosses" className="cursor-pointer text-sm">
                Vira a meia-noite
              </Label>
            </div>
          </div>

          {jornadaTravada ? (
            <div
              className="rounded-xl border border-border bg-secondary/30 p-4 text-sm"
              role="note"
            >
              <p className="text-foreground">{MENSAGEM_TURNO_PROTEGIDO}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 rounded-xl"
                onClick={() => {
                  const atual = (shifts.data ?? []).find((item) => item.id === shiftForm.id);
                  if (atual) setShiftForm(novoTurnoAPartir(atual));
                }}
              >
                Criar novo turno a partir deste
              </Button>
            </div>
          ) : null}

          <DialogFooter className="mt-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setShiftOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              onClick={submitShift}
              disabled={!shiftForm.name}
            >
              Salvar turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!teamOpen}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setTeamOpen(null);
            setEquipeBusca("");
            setEquipeFiltro("todos");
          }
        }}
      >
        <DialogContent className="max-h-[92vh] w-[95vw] max-w-[95vw] overflow-hidden rounded-2xl border-border bg-card p-0 text-card-foreground sm:max-w-4xl lg:max-w-6xl">
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4 sm:px-6">
            <DialogTitle className="text-xl tracking-[-0.025em]">
              Equipe — {teamOpen?.name}
            </DialogTitle>

            <DialogDescription>
              Cada colaborador ocupa uma única operação e turno por vez. Para movê-lo, desaloque na
              operação atual antes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6">
            <div className="grid gap-3 py-5 sm:grid-cols-2 xl:grid-cols-4">
              <ResumoEquipe label="Colaboradores" value={equipeResumo.total} />

              <ResumoEquipe label="Alocados aqui" value={equipeResumo.aqui} />

              <ResumoEquipe label="Disponíveis" value={equipeResumo.disponivel} />

              <ResumoEquipe label="Outras operações" value={equipeResumo.outra} />
            </div>

            {equipeGrupos.length ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {equipeGrupos.map((grupo) => (
                  <div
                    key={`resumo-${grupo.id ?? "sem-turno"}`}
                    className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
                  >
                    {grupo.nome}
                    <span className="ml-2 font-semibold text-foreground">{grupo.alocados}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  placeholder="Buscar colaborador..."
                  value={equipeBusca}
                  onChange={(event) => setEquipeBusca(event.target.value)}
                  className="h-10 rounded-xl border-input bg-secondary/50 pl-9"
                />
              </div>

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
                    className="shrink-0 rounded-xl"
                    variant={equipeFiltro === valor ? "default" : "outline"}
                    onClick={() => setEquipeFiltro(valor)}
                  >
                    {rotulo}
                  </Button>
                ))}
              </div>
            </div>

            <div className="max-h-[48vh] overflow-y-auto overflow-x-hidden rounded-xl border border-border">
              <div className="sticky top-0 z-10 hidden border-b border-border bg-card/95 px-4 py-3 backdrop-blur sm:flex sm:items-center">
                <p className="flex-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Colaborador
                </p>

                <p className="w-[22rem] shrink-0 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Alocação
                </p>
              </div>

              {equipeLinhas.length === 0 ? (
                <div className="flex min-h-36 items-center justify-center p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nenhum colaborador encontrado com esses critérios.
                  </p>
                </div>
              ) : (
                equipeLinhas.map(({ employee, alocacao, situacao, conflito }) => (
                  <div
                    key={employee.id}
                    className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <AvatarNome nome={employee.name} />

                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {employee.name}
                          </p>

                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {employee.role ?? "—"} · custo {brl(employee.daily_cost)}
                          </p>
                        </div>
                      </div>

                      {conflito ? (
                        <p className="mt-2 text-xs font-medium text-destructive">
                          Conflito: mais de uma alocação ativa. Revise antes de continuar.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex w-full min-w-0 items-center gap-2 sm:w-[22rem] sm:shrink-0">
                      {situacao === "outra" ? (
                        <div className="min-w-0 text-xs text-muted-foreground">
                          <Badge variant="outline" className="mr-1 border-border bg-secondary/50">
                            Indisponível
                          </Badge>

                          <span className="break-words">
                            Alocado em {operationName(alocacao?.operation_id)} ·{" "}
                            {shiftLabel(alocacao?.shift_id ?? null)}
                          </span>
                        </div>
                      ) : (
                        <>
                          <Select
                            value={
                              situacao === "aqui" ? (alocacao?.shift_id ?? "sem-turno") : "nenhum"
                            }
                            onValueChange={(value) =>
                              alocarEquipe.mutate({
                                employeeId: employee.id,
                                shiftId: value === "sem-turno" ? null : value,
                                ...(alocacao
                                  ? {
                                      vinculoId: alocacao.id,
                                    }
                                  : {}),
                              })
                            }
                          >
                            <SelectTrigger className="min-w-0 flex-1 rounded-xl">
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
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0 rounded-xl"
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
          </div>

          <DialogFooter className="border-t border-border px-5 py-4 sm:px-6">
            <Button
              type="button"
              className="rounded-xl"
              onClick={() => {
                setTeamOpen(null);
                setEquipeBusca("");
                setEquipeFiltro("todos");
              }}
            >
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TipoBadge({ tipo }: { tipo: string }) {
  const fixa = tipo === "fixed";

  return (
    <Badge
      variant="secondary"
      className={
        fixa
          ? "border border-primary/15 bg-primary/10 font-medium text-primary shadow-none"
          : "border border-border bg-secondary font-medium text-muted-foreground shadow-none"
      }
    >
      {fixa ? "Fixa" : "Avulsa"}
    </Badge>
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

            <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-foreground">
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

function ResumoEquipe({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/35 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>

      <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">{value}</p>
    </div>
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
