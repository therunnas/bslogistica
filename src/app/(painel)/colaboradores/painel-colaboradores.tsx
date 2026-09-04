"use client";

// Portado de src/routes/_authenticated/colaboradores.tsx sem alteração de
// comportamento. É client component porque usa estado, React Query e
// formulários controlados.
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "../_components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { Card, CardContent } from "@/components/ui/card";
import { useEmployees } from "@/lib/queries";
import { useDeleteRow, useSaveRow } from "@/lib/mutations";
import { brl } from "@/lib/format";
import type { Employee } from "@/lib/types";

const empty = {
  id: "",
  name: "",
  doc: "",
  role: "",
  phone: "",
  daily_cost: 0,
  status: "active" as const,
};

export function PainelColaboradores() {
  const { data = [], isLoading } = useEmployees();
  const save = useSaveRow("employees");
  const remove = useDeleteRow("employees");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof empty>(empty);

  function edit(employee: Employee) {
    setForm({
      id: employee.id,
      name: employee.name,
      doc: employee.doc ?? "",
      role: employee.role ?? "",
      phone: employee.phone ?? "",
      daily_cost: Number(employee.daily_cost),
      status: employee.status as "active",
    });
    setOpen(true);
  }

  function submit() {
    const payload: Record<string, unknown> = {
      name: form.name,
      doc: form.doc || null,
      role: form.role || null,
      phone: form.phone || null,
      daily_cost: Number(form.daily_cost) || 0,
      status: form.status,
    };
    if (form.id) payload["id"] = form.id;
    save.mutate(payload, { onSuccess: () => setOpen(false) });
  }

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description="Equipe disponível para alocação e o custo por diária de cada pessoa."
        action={
          <Button
            onClick={() => {
              setForm(empty);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Novo colaborador
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead className="text-right">Custo diária</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>Carregando...</TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Nenhum colaborador cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">{employee.name}</TableCell>
                    <TableCell>{employee.role ?? "—"}</TableCell>
                    <TableCell>{employee.doc ?? "—"}</TableCell>
                    <TableCell>{employee.phone ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(employee.daily_cost)}</TableCell>
                    <TableCell>
                      <Badge variant={employee.status === "active" ? "default" : "secondary"}>
                        {employee.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => edit(employee)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove.mutate(employee.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Função</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Documento</Label>
              <Input value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Custo por diária (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.daily_cost}
                onChange={(e) => setForm({ ...form, daily_cost: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as "active" })}
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
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!form.name || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
