"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useOperations } from "@/lib/queries";
import { toast } from "@/lib/notificacoes";
import type { Papel, UsuarioAdministrativo } from "@/lib/admin-usuarios/tipos";

import {
  type Feedback,
  feedbackDaAlteracaoDePapel,
  feedbackDaAtribuicaoDeOperacao,
  feedbackDaReativacao,
  feedbackDaRemocaoDeOperacao,
  feedbackDaRevogacaoDeAcesso,
  ROTULO_PAPEL,
  situacaoDoUsuario,
} from "./_dominio";
import {
  useAlterarPapel,
  useAtribuirOperacao,
  useOperacoesDoUsuario,
  useReativarUsuario,
  useRemoverOperacao,
  useRevogarAcesso,
  useUsuarios,
} from "./_hooks";

const PAPEIS: readonly Papel[] = ["admin", "operacional"];

function BannerDeFeedback({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  const classe =
    feedback.tipo === "erro"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-500";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classe}`}>{feedback.texto}</div>;
}

/** Toast imediato + banner que persiste enquanto o diálogo estiver aberto.
 * Um "parcial" ou um "erro" (como "ultimo-admin") não pode desaparecer sozinho
 * em alguns segundos: o admin precisa continuar vendo que algo não terminou
 * como esperado até decidir o próximo passo. */
function aplicarFeedback(feedback: Feedback, definirBanner: (f: Feedback | null) => void) {
  if (feedback.tipo === "sucesso") {
    toast.success(feedback.texto);
    definirBanner(null);
    return;
  }
  if (feedback.tipo === "parcial") {
    toast.warning(feedback.texto);
    definirBanner(feedback);
    return;
  }
  toast.error(feedback.texto);
  definirBanner(feedback);
}

function ConteudoGerenciarUsuario({ usuario }: { usuario: UsuarioAdministrativo }) {
  // Relê a listagem para refletir mudanças feitas nesta mesma sessão de
  // diálogo (conceder papel, revogar, reativar) sem depender de o componente
  // pai atualizar o objeto que passou por prop.
  const usuarios = useUsuarios();
  const atual = usuarios.data?.find((u) => u.id === usuario.id) ?? usuario;
  const situacao = situacaoDoUsuario(atual);

  const alterarPapel = useAlterarPapel();
  const revogarAcesso = useRevogarAcesso();
  const reativar = useReativarUsuario();
  const operacoesDoUsuario = useOperacoesDoUsuario(atual.id);
  const todasOperacoes = useOperations();
  const atribuir = useAtribuirOperacao();
  const remover = useRemoverOperacao();

  const [papelParaRevogar, setPapelParaRevogar] = useState<Papel | null>(null);
  const [bannerPapel, setBannerPapel] = useState<Feedback | null>(null);

  const [confirmandoRevogacaoDeAcesso, setConfirmandoRevogacaoDeAcesso] = useState(false);
  const [papelDeReativacao, setPapelDeReativacao] = useState<Papel>("operacional");
  const [bannerAcesso, setBannerAcesso] = useState<Feedback | null>(null);

  const [operationIdParaAtribuir, setOperationIdParaAtribuir] = useState("");
  const [operacaoParaRemover, setOperacaoParaRemover] = useState<string | null>(null);
  const [bannerOperacoes, setBannerOperacoes] = useState<Feedback | null>(null);

  function conceder(papel: Papel) {
    alterarPapel.mutate(
      { userId: atual.id, papel, acao: "conceder" },
      {
        onSuccess: (resultado) =>
          aplicarFeedback(feedbackDaAlteracaoDePapel(resultado), setBannerPapel),
        onError: () =>
          aplicarFeedback({ tipo: "erro", texto: "Falha ao conceder papel." }, setBannerPapel),
      },
    );
  }

  function confirmarRevogacaoDePapel() {
    if (!papelParaRevogar) return;
    const papel = papelParaRevogar;
    setPapelParaRevogar(null);
    alterarPapel.mutate(
      { userId: atual.id, papel, acao: "revogar" },
      {
        onSuccess: (resultado) =>
          aplicarFeedback(feedbackDaAlteracaoDePapel(resultado), setBannerPapel),
        onError: () =>
          aplicarFeedback({ tipo: "erro", texto: "Falha ao revogar papel." }, setBannerPapel),
      },
    );
  }

  function confirmarRevogacaoDeAcesso() {
    setConfirmandoRevogacaoDeAcesso(false);
    revogarAcesso.mutate(
      { userId: atual.id },
      {
        onSuccess: (resultado) =>
          aplicarFeedback(feedbackDaRevogacaoDeAcesso(resultado), setBannerAcesso),
        onError: () =>
          aplicarFeedback({ tipo: "erro", texto: "Falha ao revogar acesso." }, setBannerAcesso),
      },
    );
  }

  function reativarAcesso() {
    reativar.mutate(
      { userId: atual.id, papel: papelDeReativacao },
      {
        onSuccess: (resultado) => aplicarFeedback(feedbackDaReativacao(resultado), setBannerAcesso),
        onError: () =>
          aplicarFeedback({ tipo: "erro", texto: "Falha ao reativar usuário." }, setBannerAcesso),
      },
    );
  }

  function atribuirOperacaoSelecionada() {
    if (!operationIdParaAtribuir) return;
    atribuir.mutate(
      { userId: atual.id, operationId: operationIdParaAtribuir },
      {
        onSuccess: (resultado) => {
          const feedback = feedbackDaAtribuicaoDeOperacao(resultado);
          aplicarFeedback(feedback, setBannerOperacoes);
          if (feedback.tipo === "sucesso") setOperationIdParaAtribuir("");
        },
        onError: () =>
          aplicarFeedback(
            { tipo: "erro", texto: "Falha ao atribuir operação." },
            setBannerOperacoes,
          ),
      },
    );
  }

  function confirmarRemocaoDeOperacao() {
    if (!operacaoParaRemover) return;
    const operationId = operacaoParaRemover;
    setOperacaoParaRemover(null);
    remover.mutate(
      { userId: atual.id, operationId },
      {
        onSuccess: (resultado) =>
          aplicarFeedback(feedbackDaRemocaoDeOperacao(resultado), setBannerOperacoes),
        onError: () =>
          aplicarFeedback(
            { tipo: "erro", texto: "Falha ao remover operação." },
            setBannerOperacoes,
          ),
      },
    );
  }

  const idsAtribuidos = new Set((operacoesDoUsuario.data ?? []).map((a) => a.operationId));
  const disponiveis = (todasOperacoes.data ?? []).filter((op) => !idsAtribuidos.has(op.id));
  const nomeDaOperacao = (operationId: string) =>
    todasOperacoes.data?.find((op) => op.id === operationId)?.name ?? operationId;

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>{atual.email ?? "Usuário"}</DialogTitle>
        <DialogDescription>Papéis, acesso e operações atribuídas a esta conta.</DialogDescription>
      </DialogHeader>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Papéis</h3>
        <BannerDeFeedback feedback={bannerPapel} />
        <div className="space-y-2">
          {PAPEIS.map((papel) => {
            const concedido = atual.papeis.includes(papel);
            return (
              <div
                key={papel}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{ROTULO_PAPEL[papel]}</span>
                  {concedido ? <Badge variant="secondary">Concedido</Badge> : null}
                </div>
                {concedido ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alterarPapel.isPending}
                    onClick={() => setPapelParaRevogar(papel)}
                  >
                    Revogar
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alterarPapel.isPending}
                    onClick={() => conceder(papel)}
                  >
                    Conceder
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Acesso</h3>
        <BannerDeFeedback feedback={bannerAcesso} />
        {situacao === "banido" ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-destructive">
              REATIVAR ACESSO NÃO RESTAURA OPERAÇÕES ANTIGAS
            </p>
            <p className="text-sm text-muted-foreground">
              A conta volta a poder logar com o papel escolhido abaixo. As operações que ela tinha
              antes da revogação precisam ser atribuídas de novo, uma a uma.
            </p>
            <div className="flex items-end gap-3">
              <div className="w-48 space-y-1.5">
                <Label>Papel ao reativar</Label>
                <Select
                  value={papelDeReativacao}
                  onValueChange={(v) => setPapelDeReativacao(v as Papel)}
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
              <Button onClick={reativarAcesso} disabled={reativar.isPending}>
                {reativar.isPending ? "Reativando..." : "Reativar acesso"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <p className="text-sm text-muted-foreground">
              Remove todos os papéis, todas as operações atribuídas e bane a conta. Reversível pela
              reativação.
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={revogarAcesso.isPending}
              onClick={() => setConfirmandoRevogacaoDeAcesso(true)}
            >
              Revogar acesso
            </Button>
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Operações atribuídas</h3>
        <BannerDeFeedback feedback={bannerOperacoes} />

        {operacoesDoUsuario.isError ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as operações desta conta.
          </p>
        ) : operacoesDoUsuario.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (operacoesDoUsuario.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma operação atribuída.</p>
        ) : (
          <div className="space-y-1">
            {(operacoesDoUsuario.data ?? []).map((atribuicao) => (
              <div
                key={atribuicao.operationId}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm">{nomeDaOperacao(atribuicao.operationId)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={remover.isPending}
                  onClick={() => setOperacaoParaRemover(atribuicao.operationId)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3 pt-2">
          <div className="flex-1 space-y-1.5">
            <Label>Atribuir operação</Label>
            <Select value={operationIdParaAtribuir} onValueChange={setOperationIdParaAtribuir}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma operação" />
              </SelectTrigger>
              <SelectContent>
                {disponiveis.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!operationIdParaAtribuir || atribuir.isPending}
            onClick={atribuirOperacaoSelecionada}
          >
            {atribuir.isPending ? "Atribuindo..." : "Atribuir"}
          </Button>
        </div>
      </section>

      <AlertDialog
        open={papelParaRevogar !== null}
        onOpenChange={(v) => !v && setPapelParaRevogar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar papel</AlertDialogTitle>
            <AlertDialogDescription>
              {papelParaRevogar
                ? `A conta perde o papel de ${ROTULO_PAPEL[papelParaRevogar]}. Se for o último administrador, o sistema recusa a ação.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRevogacaoDePapel}>Revogar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmandoRevogacaoDeAcesso}
        onOpenChange={setConfirmandoRevogacaoDeAcesso}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar acesso</AlertDialogTitle>
            <AlertDialogDescription>
              Remove todos os papéis desta conta, todas as operações atribuídas a ela e bane o
              login. A ação é reversível apenas pela reativação explícita, que não restaura as
              operações removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRevogacaoDeAcesso}>
              Revogar acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={operacaoParaRemover !== null}
        onOpenChange={(v) => !v && setOperacaoParaRemover(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover operação</AlertDialogTitle>
            <AlertDialogDescription>
              {operacaoParaRemover
                ? `A conta deixa de ver e apontar em "${nomeDaOperacao(operacaoParaRemover)}".`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocaoDeOperacao}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function GerenciarUsuario({
  usuario,
  onOpenChange,
}: {
  usuario: UsuarioAdministrativo | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={usuario !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {usuario ? <ConteudoGerenciarUsuario key={usuario.id} usuario={usuario} /> : null}
      </DialogContent>
    </Dialog>
  );
}
