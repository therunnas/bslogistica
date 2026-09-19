"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { todayISO } from "@/lib/format";
import { useSalvarApontamentoOperacional } from "@/lib/operacional/mutations";
import {
  useApontamentosDoOperador,
  useEquipeDoOperador,
  useOperacoesDoOperador,
  useTurnosDoOperador,
} from "@/lib/operacional/queries";

import { PageHeader } from "../_components/app-shell";
import {
  escolhaAutomatica,
  folhaEstaFechada,
  linhasAlteradas,
  mensagemDeErro,
  montarRascunho,
  normalizarIntervalo,
  type LinhaDoRascunho,
} from "./_dominio";

const STATUS = [
  { valor: "present", rotulo: "Presente" },
  { valor: "absent", rotulo: "Falta" },
  { valor: "replacement", rotulo: "Substituição" },
] as const;

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Apontamento do operador.
 *
 * Tela SEPARADA da administrativa, e não uma variação dela. A de
 * `/apontamentos` mistura o operacional com regra de contrato, ledger e valores
 * cobrados; aqui nada disso existe, e é por isso que a separação vale o
 * arquivo a mais: o que não está importado não vaza.
 *
 * **Toda a leitura e a escrita passam pelos hooks de `src/lib/operacional`**,
 * que falam com as cinco RPCs da migration 013. Nenhum `from(...)`, nenhum
 * `select("*")`: em AAL1 as tabelas de negócio recusam a leitura direta, e a
 * única porta é a RPC.
 *
 * O que decide alguma coisa mora em `_dominio.ts`, em função pura e testável. O
 * que sobra aqui é montagem de tela.
 */
export function PainelOperacional() {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(todayISO());
  const [rascunho, setRascunho] = useState<LinhaDoRascunho[] | null>(null);

  const operacoes = useOperacoesDoOperador();
  const turnos = useTurnosDoOperador(operationId);
  const equipe = useEquipeDoOperador(operationId, shiftId);
  const apontamentos = useApontamentosDoOperador(operationId, shiftId, workDate);
  const salvar = useSalvarApontamentoOperacional();

  // Uma opção só não é escolha: seleciona sozinho. Com mais de uma, quem
  // escolhe é quem está apontando.
  useEffect(() => {
    if (!operationId) setOperationId(escolhaAutomatica(operacoes.data));
  }, [operacoes.data, operationId]);

  useEffect(() => {
    if (!shiftId) setShiftId(escolhaAutomatica(turnos.data));
  }, [turnos.data, shiftId]);

  const turno = useMemo(
    () => turnos.data?.find((t) => t.id === shiftId) ?? null,
    [turnos.data, shiftId],
  );

  const fechada = folhaEstaFechada(apontamentos.data);

  // O rascunho nasce do servidor e só é reconstruído quando a base muda. Sem
  // isto, cada refetch em segundo plano apagaria o que a pessoa está digitando.
  const base = useMemo(
    () => montarRascunho(equipe.data, apontamentos.data, turno?.break_minutes ?? 0),
    [equipe.data, apontamentos.data, turno],
  );

  useEffect(() => {
    setRascunho(base);
  }, [base]);

  const linhas = rascunho ?? base;

  function trocarOperacao(valor: string) {
    setOperationId(valor);
    setShiftId(null);
    setRascunho(null);
  }

  function trocarTurno(valor: string) {
    setShiftId(valor);
    setRascunho(null);
  }

  function trocarData(valor: string) {
    setWorkDate(valor);
    setRascunho(null);
  }

  function editar(employeeId: string, mudanca: Partial<LinhaDoRascunho>) {
    setRascunho((atual) =>
      (atual ?? base).map((linha) =>
        linha.employee_id === employeeId ? { ...linha, ...mudanca } : linha,
      ),
    );
  }

  const pendentes = linhasAlteradas(linhas, apontamentos.data);

  function enviar() {
    if (!operationId || !shiftId) return;
    if (pendentes.length === 0) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }

    salvar.mutate(
      { operationId, shiftId, workDate, linhas: pendentes },
      {
        onSuccess: () => toast.success("Apontamento salvo."),
        // A mensagem vem do SQLSTATE, nunca do texto da exceção, e o rascunho
        // continua na tela: perder o que foi digitado por causa de uma falha de
        // rede seria punir quem está apontando.
        onError: (erro) => toast.error(mensagemDeErro(erro)),
      },
    );
  }

  if (operacoes.isPending) return <Aviso>Carregando suas operações...</Aviso>;
  if (operacoes.isError) {
    return (
      <Aviso>
        <p>Não foi possível carregar suas operações.</p>
        <Button variant="outline" className="mt-4" onClick={() => void operacoes.refetch()}>
          Tentar novamente
        </Button>
      </Aviso>
    );
  }

  if ((operacoes.data ?? []).length === 0) {
    return <Aviso>Nenhuma operação atribuída a você. Procure o administrador.</Aviso>;
  }

  const semTurno = Boolean(operationId) && !turnos.isPending && (turnos.data ?? []).length === 0;
  const semEquipe = Boolean(shiftId) && !equipe.isPending && (equipe.data ?? []).length === 0;

  return (
    <>
      <PageHeader
        title="Apontamento"
        description="Registre presença e horários da equipe no turno e na data."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Operação</Label>
          <Select value={operationId ?? ""} onValueChange={trocarOperacao}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {(operacoes.data ?? []).map((operacao) => (
                <SelectItem key={operacao.id} value={operacao.id}>
                  {operacao.name} — {operacao.cliente_nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Turno</Label>
          <Select value={shiftId ?? ""} onValueChange={trocarTurno} disabled={!operationId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {(turnos.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} — {t.start_time.slice(0, 5)} às {t.end_time.slice(0, 5)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Data</Label>
          <Input type="date" value={workDate} onChange={(e) => trocarData(e.target.value)} />
        </div>
      </div>

      {/* A RPC de escrita exige turno, então operação sem turno não entra no
          fluxo. Dizer isso é melhor que deixar a pessoa procurando o que
          selecionar. */}
      {semTurno ? <Aviso>Nenhum turno configurado para esta operação.</Aviso> : null}

      {semEquipe ? <Aviso>Nenhum colaborador alocado neste turno.</Aviso> : null}

      {shiftId && !semTurno && !semEquipe ? (
        <div className="space-y-4">
          {fechada ? (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              Folha fechada pelo administrador.
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead>Saída</TableHead>
                  <TableHead>Intervalo (min)</TableHead>
                  <TableHead>Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha) => {
                  // Linha faturada é imutável desde a migration 011, e folha
                  // fechada é decisão administrativa: nos dois casos a tela
                  // mostra, mas não deixa editar.
                  const travada = fechada || linha.faturado || !linha.ativo;
                  return (
                    <TableRow key={linha.employee_id}>
                      <TableCell>
                        <span className="font-medium">{linha.employee_name}</span>
                        {linha.employee_role ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {linha.employee_role}
                          </span>
                        ) : null}
                        {linha.faturado ? (
                          <Badge variant="secondary" className="ml-2">
                            Faturado
                          </Badge>
                        ) : null}
                        {!linha.ativo ? (
                          <Badge variant="outline" className="ml-2">
                            Fora da equipe
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={linha.status}
                          disabled={travada}
                          onValueChange={(valor) =>
                            editar(linha.employee_id, {
                              status: valor as LinhaDoRascunho["status"],
                            })
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS.map(({ valor, rotulo }) => (
                              <SelectItem key={valor} value={valor}>
                                {rotulo}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          className="w-28"
                          value={linha.check_in.slice(0, 5)}
                          disabled={travada || linha.status === "absent"}
                          onChange={(e) => editar(linha.employee_id, { check_in: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          className="w-28"
                          value={linha.check_out.slice(0, 5)}
                          disabled={travada || linha.status === "absent"}
                          onChange={(e) => editar(linha.employee_id, { check_out: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        {/* `min={0}` e a normalização abaixo são UX. A regra é o
                            CHECK (break_minutes >= 0) da migration 014. */}
                        <Input
                          type="number"
                          min={0}
                          className="w-24"
                          value={linha.break_minutes}
                          disabled={travada || linha.status === "absent"}
                          onChange={(e) =>
                            editar(linha.employee_id, {
                              break_minutes: normalizarIntervalo(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="min-w-40"
                          value={linha.notes}
                          disabled={travada}
                          onChange={(e) => editar(linha.employee_id, { notes: e.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">
              {pendentes.length === 0
                ? "Nenhuma alteração pendente"
                : `${pendentes.length} linha(s) alterada(s)`}
            </span>
            <Button
              onClick={enviar}
              disabled={fechada || salvar.isPending || pendentes.length === 0}
            >
              {salvar.isPending ? "Salvando..." : "Salvar apontamento"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
