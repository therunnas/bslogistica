"use client";

// Portado de src/routes/_authenticated/clientes.tsx sem alteração de
// comportamento. É client component porque usa estado, React Query e
// formulários controlados.
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "../_components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useClients, useContracts } from "@/lib/queries";
import { useDeleteRow, useSaveRow } from "@/lib/mutations";
import { brl, dateBR, num, todayISO } from "@/lib/format";
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

export function PainelClientes() {
  const clients = useClients();
  const contracts = useContracts();
  const saveClient = useSaveRow("clients");
  const removeClient = useDeleteRow("clients");
  const saveContract = useSaveRow("contracts");
  const removeContract = useDeleteRow("contracts");

  const [clientOpen, setClientOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [contractForm, setContractForm] = useState(emptyContract);

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";

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
    if (clientForm.id) payload["id"] = clientForm.id;
    saveClient.mutate(payload, { onSuccess: () => setClientOpen(false) });
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
      daily_rate: Number(contractForm.daily_rate) || 0,
      shift_hours: Number(contractForm.shift_hours) || 8,
      ot_factor: Number(contractForm.ot_factor) || 1,
      ot_tolerance_min: Number(contractForm.ot_tolerance_min) || 0,
      valid_from: contractForm.valid_from,
      valid_to: contractForm.valid_to || null,
      status: contractForm.status,
    };
    if (contractForm.id) payload["id"] = contractForm.id;
    saveContract.mutate(payload, { onSuccess: () => setContractOpen(false) });
  }

  return (
    <div>
      <PageHeader
        title="Clientes e contratos"
        description="Cada contrato define o valor da diária, a jornada e as regras de hora extra usadas no cálculo."
      />

      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">Clientes</TabsTrigger>
          <TabsTrigger value="contracts">Contratos e regras</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button
              onClick={() => {
                setClientForm(emptyClient);
                setClientOpen(true);
              }}
            >
              <Plus className="size-4" /> Novo cliente
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(clients.data ?? []).map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{client.doc ?? "—"}</TableCell>
                      <TableCell>{client.contact_name ?? "—"}</TableCell>
                      <TableCell>{client.email ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={client.status === "active" ? "default" : "secondary"}>
                          {client.status === "active" ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => editClient(client)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeClient.mutate(client.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {clients.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        Nenhum cliente cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button
              onClick={() => {
                setContractForm({
                  ...emptyContract,
                  client_id: clients.data?.[0]?.id ?? "",
                });
                setContractOpen(true);
              }}
              disabled={!clients.data?.length}
            >
              <Plus className="size-4" /> Novo contrato
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Diária</TableHead>
                    <TableHead className="text-right">Jornada (h)</TableHead>
                    <TableHead className="text-right">Fator HE</TableHead>
                    <TableHead className="text-right">Tolerância</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(contracts.data ?? []).map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell className="font-medium">{contract.name}</TableCell>
                      <TableCell>{clientName(contract.client_id)}</TableCell>
                      <TableCell className="text-right">{brl(contract.daily_rate)}</TableCell>
                      <TableCell className="text-right">{num(contract.shift_hours, 1)}</TableCell>
                      <TableCell className="text-right">{num(contract.ot_factor, 2)}x</TableCell>
                      <TableCell className="text-right">{contract.ot_tolerance_min} min</TableCell>
                      <TableCell>
                        {dateBR(contract.valid_from)}
                        {contract.valid_to ? ` até ${dateBR(contract.valid_to)}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => editContract(contract)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeContract.mutate(contract.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {contracts.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground">
                        Nenhum contrato cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{clientForm.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={clientForm.name}
                onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>CNPJ</Label>
              <Input
                value={clientForm.doc}
                onChange={(e) => setClientForm({ ...clientForm, doc: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contato</Label>
              <Input
                value={clientForm.contact_name}
                onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                value={clientForm.email}
                onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                value={clientForm.phone}
                onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={clientForm.notes}
                onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={clientForm.status}
                onValueChange={(v) => setClientForm({ ...clientForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClientOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitClient} disabled={!clientForm.name}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{contractForm.id ? "Editar contrato" : "Novo contrato"}</DialogTitle>
            <DialogDescription>
              A hora extra é calculada como (diária ÷ jornada) × fator, após a tolerância.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select
                value={contractForm.client_id}
                onValueChange={(v) => setContractForm({ ...contractForm, client_id: v })}
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
              <Label>Nome do contrato</Label>
              <Input
                value={contractForm.name}
                onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor da diária (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={contractForm.daily_rate}
                onChange={(e) =>
                  setContractForm({ ...contractForm, daily_rate: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Jornada da diária (horas)</Label>
              <Input
                type="number"
                step="0.5"
                value={contractForm.shift_hours}
                onChange={(e) =>
                  setContractForm({ ...contractForm, shift_hours: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fator hora extra</Label>
              <Input
                type="number"
                step="0.05"
                value={contractForm.ot_factor}
                onChange={(e) =>
                  setContractForm({ ...contractForm, ot_factor: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tolerância (min)</Label>
              <Input
                type="number"
                value={contractForm.ot_tolerance_min}
                onChange={(e) =>
                  setContractForm({ ...contractForm, ot_tolerance_min: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vigente de</Label>
              <Input
                type="date"
                value={contractForm.valid_from}
                onChange={(e) => setContractForm({ ...contractForm, valid_from: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vigente até (opcional)</Label>
              <Input
                type="date"
                value={contractForm.valid_to}
                onChange={(e) => setContractForm({ ...contractForm, valid_to: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={submitContract}
              disabled={!contractForm.name || !contractForm.client_id}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
