"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "../_components/app-shell";
import {
  cancelarContainerAction,
  capacidadeCorrecaoContainerAction,
  carregarContainerAction,
} from "./_acoes";
import { dinheiroContainer } from "./lista-containers";

type Detalhe = Extract<Awaited<ReturnType<typeof carregarContainerAction>>, { ok: true }>["data"];

export function DetalheDoContainer({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [indeterminado, setIndeterminado] = useState(false);
  const [podeCorrigir, setPodeCorrigir] = useState(false);
  const trava = useRef(false);
  useEffect(() => {
    let ativo = true;
    // Falha ao conferir a capacidade = não oferecer a correção; nunca bloqueia o detalhe.
    Promise.resolve()
      .then(() => capacidadeCorrecaoContainerAction())
      .then((r) => {
        if (ativo) setPodeCorrigir(r.ok && r.data === true);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const resultado = await carregarContainerAction(id);
      if (!resultado.ok) {
        setDetalhe(null);
        setErro(resultado.mensagem);
        return;
      }
      setDetalhe(resultado.data);
      if (resultado.data.servico.situacao === "cancelado") setIndeterminado(false);
    } catch {
      setDetalhe(null);
      setErro("Não foi possível carregar o serviço. Confira o acesso e tente novamente.");
    } finally {
      setCarregando(false);
    }
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  function atualizarConsultas() {
    for (const key of ["adicionais", "containers", "invoices"]) {
      void queryClient.invalidateQueries({ queryKey: [key] }).catch(() => {});
    }
  }

  async function cancelar() {
    if (
      trava.current ||
      indeterminado ||
      detalhe?.servico.situacao !== "disponivel" ||
      !motivo.trim()
    ) {
      return;
    }
    trava.current = true;
    setCancelando(true);
    setErro("");
    try {
      const resultado = await cancelarContainerAction({ id, motivo: motivo.trim() });
      if (!resultado.ok || resultado.data.id !== id) {
        throw new Error("Confirmação indisponível.");
      }
      atualizarConsultas();
      setIndeterminado(true);
      await carregar();
    } catch {
      setIndeterminado(true);
      try {
        const atualizado = await carregarContainerAction(id);
        if (atualizado.ok) {
          setDetalhe(atualizado.data);
          if (atualizado.data.servico.situacao === "cancelado") {
            setIndeterminado(false);
            atualizarConsultas();
            return;
          }
        }
      } catch {
        // Mantém a ação bloqueada até confirmar o estado.
      }
      setErro(
        "Resultado indeterminado. Confira o serviço antes de qualquer nova ação de cancelamento.",
      );
    } finally {
      trava.current = false;
      setCancelando(false);
    }
  }

  if (carregando) return <p role="status">Carregando serviço…</p>;
  if (!detalhe) {
    return (
      <div className="space-y-4">
        <p role="alert">{erro}</p>
        <Button onClick={() => void carregar()}>Tentar novamente</Button>
        <Link className="block underline" href="/containers">
          Voltar para containers
        </Link>
      </div>
    );
  }
  const { servico, participantes, auditoria, competencia, substituidoPor } = detalhe;
  const campos = [
    ["Cliente", servico.cliente_nome],
    ["Operação", servico.operacao_nome ?? "Sem operação"],
    ["Solicitação", servico.requested_on],
    ["Execução", servico.executed_on],
    ["Quantidade", `${servico.quantity} container(s)`],
    ["Referência", servico.reference ?? "Não informada"],
    ["Receita negociada", dinheiroContainer(servico.revenue_cents)],
    ["Custo total", dinheiroContainer(servico.cost_total_cents)],
    [
      "Modalidade de custo",
      servico.cost_mode === "por_pessoa" ? "Por pessoa" : "Total distribuído",
    ],
    ["Competência de cobrança", `${competencia.inicio} a ${competencia.fim}`],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Serviço de containers" description={servico.description} />
      <Link className="underline" href="/containers">
        Voltar para containers
      </Link>
      {erro && (
        <p role="alert" className="rounded-md border p-4">
          {erro}
        </p>
      )}
      {substituidoPor && (
        <p className="rounded-md border p-4">
          Este serviço foi corrigido e substituído.{" "}
          <Link className="underline" href={`/containers/${substituidoPor}`}>
            Abrir o serviço corrigido
          </Link>
        </p>
      )}
      {servico.situacao === "disponivel" && podeCorrigir && !indeterminado && (
        <Button asChild variant="outline">
          <Link href={`/containers/${servico.id}/corrigir`}>Corrigir serviço</Link>
        </Button>
      )}
      {indeterminado && (
        <Button variant="outline" onClick={() => void carregar()}>
          Conferir situação atual
        </Button>
      )}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Badge variant="outline">
            {servico.situacao === "disponivel"
              ? "Disponível para faturamento"
              : servico.situacao === "faturado"
                ? "Faturado"
                : "Cancelado"}
          </Badge>
          <dl className="grid gap-4 sm:grid-cols-2">
            {campos.map(([titulo, valor]) => (
              <div key={titulo}>
                <dt className="text-sm text-muted-foreground">{titulo}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
          {servico.invoice_id && (
            <p>
              Fatura vinculada: {servico.invoice_id}. O vínculo de faturamento preserva a
              imutabilidade deste serviço.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-lg font-semibold">Custos por participante</h2>
          {participantes.map((p) => (
            <div key={p.employee_id} className="flex justify-between gap-4">
              <span>{p.nome}</span>
              <span>{dinheiroContainer(p.cost_cents)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-lg font-semibold">Auditoria</h2>
          {auditoria.map((evento) => (
            <div key={evento.id}>
              <p className="font-medium">
                {evento.action === "registered"
                  ? "Registro"
                  : evento.action === "corrected"
                    ? "Correção"
                    : "Cancelamento"}{" "}
                · {evento.created_at}
              </p>
              <p className="text-sm text-muted-foreground">{evento.reason}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      {servico.situacao === "disponivel" && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Cancelar serviço</h2>
            <p className="text-sm text-muted-foreground">
              O cancelamento mantém o histórico e retira o serviço disponível do faturamento.
            </p>
            <Label htmlFor="motivo-cancelamento">Motivo do cancelamento</Label>
            <Textarea
              id="motivo-cancelamento"
              maxLength={1000}
              disabled={cancelando || indeterminado}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={cancelando || indeterminado || !motivo.trim()}
                >
                  Cancelar serviço
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar cancelamento</AlertDialogTitle>
                  <AlertDialogDescription>
                    O serviço {servico.description} será cancelado. Motivo: {motivo.trim()}. O
                    histórico será preservado.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={cancelando || indeterminado || !motivo.trim()}
                    onClick={() => void cancelar()}
                  >
                    Confirmar cancelamento
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
