"use client";

import { useState } from "react";
import { Plus, Settings } from "lucide-react";

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
import { toast } from "@/lib/notificacoes";
import { dateBR } from "@/lib/format";
import type { Papel, UsuarioAdministrativo } from "@/lib/admin-usuarios/tipos";

import { faseDaListagem, feedbackDoConvite, ROTULO_PAPEL, situacaoDoUsuario } from "./_dominio";
import { useConvidarUsuario, useUsuarios } from "./_hooks";
import { GerenciarUsuario } from "./gerenciar-usuario";

const CONVITE_VAZIO: { email: string; papel: Papel } = { email: "", papel: "operacional" };

function BadgeDeSituacao({ usuario }: { usuario: UsuarioAdministrativo }) {
  const situacao = situacaoDoUsuario(usuario);
  if (situacao === "banido") return <Badge variant="destructive">Acesso revogado</Badge>;
  if (situacao === "sem-papel") return <Badge variant="outline">Sem papel</Badge>;
  return <Badge>Ativo</Badge>;
}

/**
 * Tela administrativa de usuários — PR E.
 *
 * Consome exclusivamente o backend do PR D, por `_hooks.ts` -> `_acoes.ts`.
 * Nenhuma decisão de autorização mora aqui: `page.tsx` já bloqueou quem não é
 * admin antes deste componente existir na árvore, e cada Server
 * Action revalida tudo de novo do lado do servidor.
 */
export function PainelUsuarios() {
  const usuarios = useUsuarios();
  const convidar = useConvidarUsuario();

  const [convidarAberto, setConvidarAberto] = useState(false);
  const [convite, setConvite] = useState(CONVITE_VAZIO);
  const [selecionado, setSelecionado] = useState<UsuarioAdministrativo | null>(null);

  const fase = faseDaListagem({
    pendente: usuarios.isPending,
    erro: usuarios.isError,
    quantidade: usuarios.data?.length,
  });

  function enviarConvite() {
    // `mutate` some com o clique duplo por si só (React Query não reexecuta
    // uma mutation já `isPending`), mas o botão também fica desabilitado —
    // dois cinturões para o mesmo risco, ver DESIGN do checkout.
    convidar.mutate(
      { email: convite.email, papel: convite.papel },
      {
        onSuccess: (resultado) => {
          const feedback = feedbackDoConvite(resultado);
          if (feedback.tipo === "sucesso") {
            toast.success(feedback.texto);
            setConvidarAberto(false);
            setConvite(CONVITE_VAZIO);
          } else {
            toast.error(feedback.texto);
          }
        },
        onError: () => toast.error("Falha ao convidar usuário."),
      },
    );
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Convite, papel e acesso de contas administrativas e operacionais."
        action={
          <Button
            onClick={() => {
              setConvite(CONVITE_VAZIO);
              setConvidarAberto(true);
            }}
          >
            <Plus className="size-4" /> Convidar usuário
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Último login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fase === "erro" ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-muted-foreground">
                        Não foi possível carregar os usuários.
                      </span>
                      <Button variant="outline" size="sm" onClick={() => void usuarios.refetch()}>
                        Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : fase === "carregando" ? (
                <TableRow>
                  <TableCell colSpan={6}>Carregando...</TableCell>
                </TableRow>
              ) : fase === "vazio" ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Nenhum usuário cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                (usuarios.data ?? []).map((usuario) => (
                  <TableRow key={usuario.id}>
                    <TableCell className="font-medium">{usuario.email ?? "—"}</TableCell>
                    <TableCell>
                      {usuario.papeis.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {usuario.papeis.map((papel) => (
                            <Badge key={papel} variant="secondary">
                              {ROTULO_PAPEL[papel]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <BadgeDeSituacao usuario={usuario} />
                    </TableCell>
                    <TableCell>{dateBR(usuario.criadoEm)}</TableCell>
                    <TableCell>{dateBR(usuario.ultimoLoginEm)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setSelecionado(usuario)}>
                        <Settings className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={convidarAberto} onOpenChange={setConvidarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar usuário</DialogTitle>
            <DialogDescription>
              A conta nasce pelo convite; o papel é atribuído em seguida, nesta mesma ação.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={convite.email}
                onChange={(e) => setConvite({ ...convite, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select
                value={convite.papel}
                onValueChange={(v) => setConvite({ ...convite, papel: v as Papel })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROTULO_PAPEL.admin}</SelectItem>
                  <SelectItem value="operacional">{ROTULO_PAPEL.operacional}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvidarAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={enviarConvite} disabled={!convite.email || convidar.isPending}>
              {convidar.isPending ? "Enviando..." : "Enviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GerenciarUsuario
        usuario={selecionado}
        onOpenChange={(aberto) => {
          if (!aberto) setSelecionado(null);
        }}
      />
    </div>
  );
}
