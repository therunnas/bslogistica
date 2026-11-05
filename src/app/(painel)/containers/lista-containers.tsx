"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "../_components/app-shell";
import { carregarContainersAction, carregarFormularioContainerAction } from "./_acoes";
import type { ServicoContainerLista } from "@/lib/container-servico-dados";

export const dinheiroContainer = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ListaContainers() {
  const [servicos, setServicos] = useState<ServicoContainerLista[]>([]);
  const [clientes, setClientes] = useState<{ id: string; name: string }[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [situacao, setSituacao] = useState<"todos" | "disponivel" | "faturado" | "cancelado">(
    "todos",
  );
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [avisoFiltros, setAvisoFiltros] = useState("");
  const sequencia = useRef(0);
  const carregar = useCallback(async () => {
    const atual = ++sequencia.current;
    setCarregando(true);
    setErro("");
    try {
      const resultado = await carregarContainersAction({
        ...(clienteId ? { clienteId } : {}),
        ...(inicio ? { inicio } : {}),
        ...(fim ? { fim } : {}),
        situacao,
      });
      if (atual !== sequencia.current) return;
      if (!resultado.ok) {
        setServicos([]);
        setErro(resultado.mensagem);
        return;
      }
      setServicos(
        [...resultado.data.servicos].sort(
          (a, b) => b.executed_on.localeCompare(a.executed_on) || a.id.localeCompare(b.id),
        ),
      );
    } catch {
      if (atual !== sequencia.current) return;
      setServicos([]);
      setErro("Não foi possível carregar os serviços. Tente novamente.");
    } finally {
      if (atual === sequencia.current) setCarregando(false);
    }
  }, [clienteId, inicio, fim, situacao]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useEffect(() => {
    let ativo = true;
    void carregarFormularioContainerAction()
      .then((resultado) => {
        if (!ativo) return;
        if (resultado.ok) setClientes(resultado.data.clientes);
        else
          setAvisoFiltros(`Catálogo de clientes para filtros indisponível: ${resultado.mensagem}`);
      })
      .catch(() => {
        if (ativo)
          setAvisoFiltros(
            "Catálogo de clientes para filtros indisponível. Recarregue para tentar novamente.",
          );
      });
    return () => {
      ativo = false;
    };
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Containers"
        description="Serviços avulsos, valores negociados e custos por participante."
      />
      <Button asChild>
        <Link href="/containers/novo">Novo serviço</Link>
      </Button>
      {avisoFiltros && <p role="alert">{avisoFiltros}</p>}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-4">
          <div>
            <Label htmlFor="clienteId">Cliente</Label>
            <select
              id="clienteId"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
            >
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="inicio">Execução a partir de</Label>
            <Input
              id="inicio"
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fim">Execução até</Label>
            <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="situacao">Situação</Label>
            <select
              id="situacao"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={situacao}
              onChange={(e) => setSituacao(e.target.value as typeof situacao)}
            >
              <option value="todos">Todas</option>
              <option value="disponivel">Disponível</option>
              <option value="faturado">Faturado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
        </CardContent>
      </Card>
      {carregando ? (
        <p role="status">Carregando serviços…</p>
      ) : erro ? (
        <div role="alert">
          <p>{erro}</p>
          <Button variant="outline" onClick={() => void carregar()}>
            Tentar novamente
          </Button>
        </div>
      ) : servicos.length === 0 ? (
        <p>Nenhum serviço encontrado.</p>
      ) : (
        <div className="space-y-3">
          {servicos.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                <div>
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href={`/containers/${s.id}`}
                  >
                    {s.description}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {s.cliente_nome} · {s.executed_on} · {s.quantity} container(s)
                  </p>
                  <p className="text-sm">
                    Receita {dinheiroContainer(s.revenue_cents)} · Custo{" "}
                    {dinheiroContainer(s.cost_total_cents)}
                  </p>
                </div>
                <Badge variant="outline">
                  {s.situacao === "disponivel"
                    ? "Disponível"
                    : s.situacao === "faturado"
                      ? "Faturado"
                      : "Cancelado"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
