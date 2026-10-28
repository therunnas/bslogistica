"use client";

import { useState } from "react";
import {
  Building2,
  CalendarRange,
  FileText,
  Pencil,
  Plus,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { brl, dateBR, num, todayISO } from "@/lib/format";
import { AvisoDoMotor, HistoricoDeVigencias } from "../_components/vigencias";
import { FeriadosDoCalendario } from "./feriados";
import { useCriarComVigencia, useEstadoDoMotor, useRegrasDefinitivas } from "@/lib/vigencias-dados";
import { modoDeEdicaoDeTaxa } from "@/lib/vigencias-ui";
import { useDeleteRow, useSaveRow } from "@/lib/mutations";
import { useClients, useContracts, useOperations } from "@/lib/queries";
import type { Client, Contract } from "@/lib/types";

const emptyClient = {
  id: "",
  name: "",
  doc: "",
  contact_name: "",
  email: "",
  phone: "",
  status: "active",
  notes: "",
};

const emptyContract = {
  id: "",
  client_id: "",
  name: "",
  daily_rate: 0,
  shift_hours: 8,
  ot_factor: 1,
  ot_tolerance_min: 10,
  valid_from: todayISO(),
  valid_to: "",
  status: "active",
};

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

const CARD_CLASS =
  "overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]";

export function PainelClientes() {
  const clients = useClients();
  const contracts = useContracts();
  const operations = useOperations();

  const saveClient = useSaveRow("clients");
  const removeClient = useDeleteRow("clients");

  const saveContract = useSaveRow("contracts");
  const criarContratoComVigencia = useCriarComVigencia("contrato", ["contracts"]);
  const estadoDoMotor = useEstadoDoMotor();
  // Calendário de feriados só existe com a migration 030 (o banco anuncia `regras_definitivas`).
  const regrasDefinitivas = useRegrasDefinitivas();
  const modoDeTaxa = modoDeEdicaoDeTaxa(estadoDoMotor);
  const removeContract = useDeleteRow("contracts");

  const [clientOpen, setClientOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  const [clientForm, setClientForm] = useState(emptyClient);
  const [contractForm, setContractForm] = useState(emptyContract);

  const clientName = (id: string) => clients.data?.find((client) => client.id === id)?.name ?? "—";

  // O banco recusa trocar o cliente de um contrato que já tem operação (migration 021);
  // a tela evita oferecer a troca. Quem decide continua sendo o banco.
  const contratoEmUso =
    Boolean(contractForm.id) &&
    (operations.data ?? []).some((operation) => operation.contract_id === contractForm.id);

  // Taxa de contrato existente só muda por esta tela com o motor DESLIGADO; ligado, é por nova
  // vigência; sem estado confirmado, nada financeiro é oferecido nem enviado.
  const taxaTravada =
    modoDeTaxa !== "direta" && (Boolean(contractForm.id) || modoDeTaxa === "bloqueada");

  const totalClientes = clients.data?.length ?? 0;

  const clientesAtivos = clients.data?.filter((client) => client.status === "active").length ?? 0;

  const totalContratos = contracts.data?.length ?? 0;

  const contratosAtivos =
    contracts.data?.filter((contract) => contract.status === "active").length ?? 0;

  function editClient(client: Client) {
    setClientForm({
      id: client.id,
      name: client.name,
      doc: client.doc ?? "",
      contact_name: client.contact_name ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      status: client.status,
      notes: client.notes ?? "",
    });

    setClientOpen(true);
  }

  function submitClient() {
    const payload: Record<string, unknown> = {
      name: clientForm.name,
      doc: clientForm.doc || null,
      contact_name: clientForm.contact_name || null,
      email: clientForm.email || null,
      phone: clientForm.phone || null,
      status: clientForm.status,
      notes: clientForm.notes || null,
    };

    if (clientForm.id) {
      payload["id"] = clientForm.id;
    }

    saveClient.mutate(payload, {
      onSuccess: () => setClientOpen(false),
    });
  }

  function editContract(contract: Contract) {
    setContractForm({
      id: contract.id,
      client_id: contract.client_id,
      name: contract.name,
      daily_rate: Number(contract.daily_rate),
      shift_hours: Number(contract.shift_hours),
      ot_factor: Number(contract.ot_factor),
      ot_tolerance_min: Number(contract.ot_tolerance_min),
      valid_from: contract.valid_from,
      valid_to: contract.valid_to ?? "",
      status: contract.status,
    });

    setContractOpen(true);
  }

  function submitContract() {
    const payload: Record<string, unknown> = {
      client_id: contractForm.client_id,
      name: contractForm.name,
      valid_from: contractForm.valid_from,
      valid_to: contractForm.valid_to || null,
      status: contractForm.status,
    };

    // Colunas financeiras: contrato existente só com o motor desligado (edição tradicional);
    // contrato novo precisa delas como valores iniciais. Nunca com o estado desconhecido.
    if (modoDeTaxa === "direta" || (!contractForm.id && modoDeTaxa === "por-vigencia")) {
      payload["daily_rate"] = Number(contractForm.daily_rate) || 0;
      payload["shift_hours"] = Number(contractForm.shift_hours) || 8;
      payload["ot_factor"] = Number(contractForm.ot_factor) || 1;
      payload["ot_tolerance_min"] = Number(contractForm.ot_tolerance_min) || 0;
    }

    if (contractForm.id) {
      payload["id"] = contractForm.id;
      saveContract.mutate(payload, { onSuccess: () => setContractOpen(false) });
      return;
    }

    if (modoDeTaxa === "por-vigencia") {
      // Motor ligado: o preço vem da vigência. O contrato novo já nasce com a vigência inicial.
      criarContratoComVigencia.mutate(
        {
          linha: payload,
          form: {
            inicio: contractForm.valid_from,
            motivo: "Cadastro inicial do contrato",
            valores: {
              daily_rate: String(payload["daily_rate"]),
              shift_hours: String(payload["shift_hours"]),
              ot_factor: String(payload["ot_factor"]),
              ot_tolerance_min: String(payload["ot_tolerance_min"]),
            },
            encerrarAnterior: false,
          },
        },
        { onSuccess: () => setContractOpen(false) },
      );
      return;
    }

    if (modoDeTaxa === "direta") {
      saveContract.mutate(payload, { onSuccess: () => setContractOpen(false) });
    }
  }

  return (
    <div>
      <PageHeader
        title="Clientes e contratos"
        description="Gerencie clientes, contratos comerciais e as regras utilizadas nos cálculos operacionais."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          label="Clientes"
          value={totalClientes}
          description="Total cadastrado"
          icon={Building2}
        />

        <Resumo
          label="Clientes ativos"
          value={clientesAtivos}
          description="Disponíveis para operação"
          icon={Users}
        />

        <Resumo
          label="Contratos"
          value={totalContratos}
          description="Regras cadastradas"
          icon={FileText}
        />

        <Resumo
          label="Contratos ativos"
          value={contratosAtivos}
          description="Regras em utilização"
          icon={CalendarRange}
        />
      </div>

      <AvisoDoMotor estado={estadoDoMotor} />

      <Tabs defaultValue="clients">
        <TabsList className="mb-5 h-auto rounded-xl border border-border bg-secondary/50 p-1">
          <TabsTrigger
            value="clients"
            className="min-h-9 rounded-lg px-4 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            Clientes
          </TabsTrigger>

          <TabsTrigger
            value="contracts"
            className="min-h-9 rounded-lg px-4 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            Contratos e regras
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Cadastro de clientes</p>

              <p className="mt-1 text-xs text-muted-foreground">
                Empresas atendidas pela operação da BS.
              </p>
            </div>

            <Button
              className="h-10 rounded-xl"
              onClick={() => {
                setClientForm(emptyClient);
                setClientOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Novo cliente
            </Button>
          </div>

          <Card className={CARD_CLASS}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border bg-secondary/35 hover:bg-secondary/35">
                      <TableHead className="h-12 text-xs font-semibold text-muted-foreground">
                        Cliente
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        CNPJ
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Contato
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        E-mail
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Status
                      </TableHead>

                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {(clients.data ?? []).map((client) => (
                      <TableRow
                        key={client.id}
                        className="border-border transition-colors hover:bg-secondary/30"
                      >
                        <TableCell className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06]">
                              <Building2 className="h-4 w-4 text-primary" />
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {client.name}
                              </p>

                              <p className="mt-0.5 text-xs text-muted-foreground">Cliente</p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {client.doc ?? "—"}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {client.contact_name ?? "—"}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {client.email ?? "—"}
                        </TableCell>

                        <TableCell>
                          <StatusBadge status={client.status} />
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
                              onClick={() => editClient(client)}
                              aria-label={`Editar ${client.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeClient.mutate(client.id)}
                              aria-label={`Excluir ${client.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {clients.data?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <EstadoVazio
                            icon={Building2}
                            title="Nenhum cliente cadastrado"
                            description="Cadastre o primeiro cliente para começar a estruturar contratos e operações."
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="mt-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Contratos e regras</p>

              <p className="mt-1 text-xs text-muted-foreground">
                Valores de diária, jornada e parâmetros de hora extra.
              </p>
            </div>

            <Button
              className="h-10 rounded-xl"
              onClick={() => {
                setContractForm({
                  ...emptyContract,
                  client_id: clients.data?.[0]?.id ?? "",
                });

                setContractOpen(true);
              }}
              disabled={!clients.data?.length || modoDeTaxa === "bloqueada"}
            >
              <Plus className="h-4 w-4" />
              Novo contrato
            </Button>
          </div>

          <Card className={CARD_CLASS}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border bg-secondary/35 hover:bg-secondary/35">
                      <TableHead className="h-12 text-xs font-semibold text-muted-foreground">
                        Contrato
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Cliente
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Diária
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Jornada
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Fator HE
                      </TableHead>

                      <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                        Tolerância
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Vigência
                      </TableHead>

                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {(contracts.data ?? []).map((contract) => (
                      <TableRow
                        key={contract.id}
                        className="border-border transition-colors hover:bg-secondary/30"
                      >
                        <TableCell className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06]">
                              <FileText className="h-4 w-4 text-primary" />
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {contract.name}
                              </p>

                              <div className="mt-1">
                                <StatusBadge status={contract.status} />
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {clientName(contract.client_id)}
                        </TableCell>

                        <TableCell className="text-right text-sm font-medium text-foreground">
                          {brl(contract.daily_rate)}
                        </TableCell>

                        <TableCell className="text-right text-sm text-muted-foreground">
                          {num(contract.shift_hours, 1)} h
                        </TableCell>

                        <TableCell className="text-right text-sm text-muted-foreground">
                          {num(contract.ot_factor, 2)}x
                        </TableCell>

                        <TableCell className="text-right text-sm text-muted-foreground">
                          {contract.ot_tolerance_min} min
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {dateBR(contract.valid_from)}
                          {contract.valid_to ? ` até ${dateBR(contract.valid_to)}` : ""}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
                              onClick={() => editContract(contract)}
                              aria-label={`Editar ${contract.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeContract.mutate(contract.id)}
                              aria-label={`Excluir ${contract.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {contracts.data?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <EstadoVazio
                            icon={FileText}
                            title="Nenhum contrato cadastrado"
                            description="Crie uma regra comercial para definir diária, jornada e hora extra."
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {regrasDefinitivas ? <FeriadosDoCalendario /> : null}
        </TabsContent>
      </Tabs>

      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card text-card-foreground sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">
              {clientForm.id ? "Editar cliente" : "Novo cliente"}
            </DialogTitle>

            <DialogDescription>
              {clientForm.id
                ? "Atualize as informações cadastrais do cliente."
                : "Cadastre os dados principais da empresa atendida."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome</Label>

              <Input
                value={clientForm.name}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>CNPJ</Label>

              <Input
                value={clientForm.doc}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    doc: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Contato</Label>

              <Input
                value={clientForm.contact_name}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    contact_name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>E-mail</Label>

              <Input
                type="email"
                value={clientForm.email}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    email: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Telefone</Label>

              <Input
                value={clientForm.phone}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    phone: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Observações</Label>

              <Textarea
                value={clientForm.notes}
                onChange={(event) =>
                  setClientForm({
                    ...clientForm,
                    notes: event.target.value,
                  })
                }
                className="min-h-24 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>

              <Select
                value={clientForm.status}
                onValueChange={(value) =>
                  setClientForm({
                    ...clientForm,
                    status: value,
                  })
                }
              >
                <SelectTrigger className={SELECT_CLASS}>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>

                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setClientOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              onClick={submitClient}
              disabled={!clientForm.name}
            >
              Salvar cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card text-card-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">
              {contractForm.id ? "Editar contrato" : "Novo contrato"}
            </DialogTitle>

            <DialogDescription>
              A hora extra é calculada como (diária ÷ jornada) × fator, após a tolerância.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cliente</Label>

              <Select
                value={contractForm.client_id}
                disabled={contratoEmUso}
                onValueChange={(value) =>
                  setContractForm({
                    ...contractForm,
                    client_id: value,
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

              {contratoEmUso && (
                <p className="text-xs text-muted-foreground">
                  Este contrato já é usado por operações, então o cliente não pode ser trocado. Para
                  outro cliente, crie um novo contrato.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nome do contrato</Label>

              <Input
                value={contractForm.name}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Valor da diária (R$)</Label>

              <Input
                type="number"
                step="0.01"
                value={contractForm.daily_rate}
                disabled={taxaTravada}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    daily_rate: Number(event.target.value),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Jornada da diária (horas)</Label>

              <Input
                type="number"
                step="0.5"
                value={contractForm.shift_hours}
                disabled={taxaTravada}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    shift_hours: Number(event.target.value),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Fator hora extra</Label>

              <Input
                type="number"
                step="0.05"
                value={contractForm.ot_factor}
                disabled={taxaTravada}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    ot_factor: Number(event.target.value),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Tolerância (min)</Label>

              <Input
                type="number"
                value={contractForm.ot_tolerance_min}
                disabled={taxaTravada}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    ot_tolerance_min: Number(event.target.value),
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Vigente de</Label>

              <Input
                type="date"
                value={contractForm.valid_from}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    valid_from: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label>Vigente até (opcional)</Label>

              <Input
                type="date"
                value={contractForm.valid_to}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    valid_to: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {taxaTravada ? (
            <p className="text-xs text-muted-foreground">
              {modoDeTaxa === "por-vigencia"
                ? "Motor ligado: diária, jornada, fator e tolerância não são editados aqui. Registre uma nova vigência no histórico abaixo."
                : "Estado do motor não confirmado: as condições financeiras estão somente para leitura."}
            </p>
          ) : null}

          {contractForm.id ? (
            <HistoricoDeVigencias
              tipo="contrato"
              entidadeId={contractForm.id}
              estado={estadoDoMotor}
              valoresIniciais={{
                daily_rate: String(contractForm.daily_rate),
                shift_hours: String(contractForm.shift_hours),
                ot_factor: String(contractForm.ot_factor),
                ot_tolerance_min: String(contractForm.ot_tolerance_min),
              }}
            />
          ) : modoDeTaxa === "direta" ? (
            <p className="text-xs text-muted-foreground">
              Depois de salvar, abra o contrato para preparar vigências futuras (reajustes com
              data).
            </p>
          ) : null}

          <DialogFooter className="mt-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setContractOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              onClick={submitContract}
              disabled={
                !contractForm.name ||
                !contractForm.client_id ||
                (modoDeTaxa === "bloqueada" && !contractForm.id) ||
                saveContract.isPending ||
                criarContratoComVigencia.isPending
              }
            >
              Salvar contrato
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ativo = status === "active";

  return (
    <Badge
      variant="secondary"
      className={
        ativo
          ? "border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
          : "border border-border bg-secondary font-medium text-muted-foreground shadow-none"
      }
    >
      <span
        className={
          ativo
            ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
            : "mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground"
        }
      />

      {ativo ? "Ativo" : "Inativo"}
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
  value: number;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
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

function EstadoVazio({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>

      <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
