"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { todayISO } from "@/lib/format";
import { toast } from "@/lib/notificacoes";
import { useSalvarApontamentoOperacional } from "@/lib/operacional/mutations";
import {
  useApontamentosDoOperador,
  useEquipeDoOperador,
  useOperacoesDoOperador,
  useTurnosDoOperador,
} from "@/lib/operacional/queries";

import {
  escolhaAutomatica,
  faseDaTela,
  folhaEstaFechada,
  leituraConcluida,
  linhasAlteradas,
  mensagemDeErro,
  montarRascunho,
  normalizarIntervalo,
  podeSalvar,
  type Leitura,
  type LinhaDoRascunho,
} from "./_dominio";

const STATUS = [
  {
    valor: "present",
    rotulo: "Presente",
  },
  {
    valor: "absent",
    rotulo: "Falta",
  },
  {
    valor: "replacement",
    rotulo: "Substituição",
  },
] as const;

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

function Aviso({
  children,
  tipo = "neutro",
}: {
  children: ReactNode;
  tipo?: "neutro" | "carregando" | "alerta";
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
      <CardContent className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
        <div
          className={
            tipo === "alerta"
              ? "flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : tipo === "carregando"
                ? "flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.06] text-primary"
                : "flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground"
          }
        >
          {tipo === "alerta" ? (
            <AlertTriangle className="h-5 w-5" />
          ) : tipo === "carregando" ? (
            <LoaderCircle className="h-5 w-5 animate-spin" />
          ) : (
            <Users className="h-5 w-5" />
          )}
        </div>

        <div className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Falha de leitura, com a saída óbvia.
 *
 * Erro nunca vira estado vazio: dizer "nenhum turno configurado" porque a rede
 * caiu manda a pessoa procurar o administrador por um problema que não existe.
 */
function FalhaDeLeitura({ oQue, tentarDeNovo }: { oQue: string; tentarDeNovo: () => void }) {
  return (
    <Aviso tipo="alerta">
      <p className="font-medium text-foreground">Não foi possível carregar {oQue}.</p>

      <p className="mt-1">Verifique sua conexão e tente novamente.</p>

      <Button type="button" variant="outline" className="mt-5 rounded-xl" onClick={tentarDeNovo}>
        Tentar novamente
      </Button>
    </Aviso>
  );
}

/** Traduz uma query do TanStack Query para o que a fase precisa saber. */
const comoLeitura = <T,>(query: {
  isPending: boolean;
  isError: boolean;
  data: T[] | undefined;
}): Leitura => ({
  pendente: query.isPending,
  erro: query.isError,
  quantidade: query.data?.length,
});

/**
 * Apontamento do operador.
 *
 * Tela SEPARADA da administrativa, e não uma variação dela. A de
 * `/apontamentos` mistura o operacional com regra de contrato, ledger e valores
 * cobrados; aqui nada disso existe.
 *
 * Toda a leitura e a escrita passam pelos hooks de `src/lib/operacional`,
 * que falam com as RPCs dedicadas. Nenhum acesso direto às tabelas de negócio.
 */
export function PainelOperacional() {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(todayISO());

  const [rascunho, setRascunho] = useState<{
    escopo: string;
    linhas: LinhaDoRascunho[];
  } | null>(null);

  const operacoes = useOperacoesDoOperador();
  const turnos = useTurnosDoOperador(operationId);
  const equipe = useEquipeDoOperador(operationId, shiftId);
  const apontamentos = useApontamentosDoOperador(operationId, shiftId, workDate);

  const salvar = useSalvarApontamentoOperacional();

  useEffect(() => {
    if (!operationId) {
      setOperationId(escolhaAutomatica(operacoes.data));
    }
  }, [operacoes.data, operationId]);

  useEffect(() => {
    if (!shiftId) {
      setShiftId(escolhaAutomatica(turnos.data));
    }
  }, [turnos.data, shiftId]);

  const turno = useMemo(
    () => turnos.data?.find((item) => item.id === shiftId) ?? null,
    [turnos.data, shiftId],
  );

  const fase = faseDaTela({
    operationId,
    shiftId,
    turnos: comoLeitura(turnos),
    equipe: comoLeitura(equipe),
    apontamentos: comoLeitura(apontamentos),
  });

  const pronto = leituraConcluida(fase);

  const fechada = folhaEstaFechada(apontamentos.data);

  const escopo = `${operationId ?? ""}|${shiftId ?? ""}|${workDate}`;

  const base = useMemo(
    () => montarRascunho(equipe.data, apontamentos.data, turno?.break_minutes ?? 0),
    [equipe.data, apontamentos.data, turno],
  );

  useEffect(() => {
    if (!pronto) return;

    setRascunho((atual) => (atual?.escopo === escopo ? atual : { escopo, linhas: base }));
  }, [pronto, escopo, base]);

  const linhas = rascunho?.escopo === escopo ? rascunho.linhas : base;

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
    setRascunho((atual) => ({
      escopo,
      linhas: (atual?.escopo === escopo ? atual.linhas : base).map((linha) =>
        linha.employee_id === employeeId
          ? {
              ...linha,
              ...mudanca,
            }
          : linha,
      ),
    }));
  }

  const pendentes = pronto ? linhasAlteradas(linhas, apontamentos.data) : [];

  function enviar() {
    if (!operationId || !shiftId || !pronto) return;

    if (pendentes.length === 0) {
      toast.info("Nenhuma alteração para salvar.");

      return;
    }

    salvar.mutate(
      {
        operationId,
        shiftId,
        workDate,
        linhas: pendentes,
      },
      {
        onSuccess: () => toast.success("Apontamento salvo."),

        onError: (erro) => toast.error(mensagemDeErro(erro)),
      },
    );
  }

  if (operacoes.isError) {
    return <FalhaDeLeitura oQue="suas operações" tentarDeNovo={() => void operacoes.refetch()} />;
  }

  if (operacoes.isPending || !operacoes.data) {
    return <Aviso tipo="carregando">Carregando suas operações...</Aviso>;
  }

  if (operacoes.data.length === 0) {
    return <Aviso>Nenhuma operação atribuída a você. Procure o administrador.</Aviso>;
  }

  const operacaoSelecionada =
    operacoes.data.find((operacao) => operacao.id === operationId) ?? null;

  const linhasAtivas = linhas.filter((linha) => linha.ativo).length;

  const presentes = linhas.filter((linha) => linha.ativo && linha.status === "present").length;

  const faltas = linhas.filter((linha) => linha.ativo && linha.status === "absent").length;

  return (
    <>
      <PageHeader
        title="Apontamento"
        description="Registre presença e horários da equipe no turno e na data selecionados."
      />

      <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Operação</Label>

            <Select value={operationId ?? ""} onValueChange={trocarOperacao}>
              <SelectTrigger className={SELECT_CLASS}>
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

          <div className="space-y-2">
            <Label>Turno</Label>

            <Select value={shiftId ?? ""} onValueChange={trocarTurno} disabled={!operationId}>
              <SelectTrigger className={SELECT_CLASS}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>

              <SelectContent>
                {(turnos.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} — {item.start_time.slice(0, 5)} às {item.end_time.slice(0, 5)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Data</Label>

            <Input
              type="date"
              value={workDate}
              onChange={(event) => trocarData(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </CardContent>
      </Card>

      {pronto ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Resumo
            label="Equipe"
            value={String(linhasAtivas)}
            description="Colaboradores ativos"
            icon={Users}
          />

          <Resumo
            label="Presentes"
            value={String(presentes)}
            description="Marcados como presentes"
            icon={CheckCircle2}
          />

          <Resumo
            label="Faltas"
            value={String(faltas)}
            description="Marcados como falta"
            icon={AlertTriangle}
          />

          <Resumo
            label="Alterações"
            value={String(pendentes.length)}
            description="Pendentes para salvar"
            icon={Save}
          />
        </div>
      ) : null}

      {operacaoSelecionada && turno ? (
        <Card className="mb-5 overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />

              <div>
                <p className="text-[11px] text-muted-foreground">Operação</p>

                <p className="text-sm font-medium text-foreground">{operacaoSelecionada.name}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />

              <div>
                <p className="text-[11px] text-muted-foreground">Turno</p>

                <p className="text-sm font-medium text-foreground">
                  {turno.name} · {turno.start_time.slice(0, 5)}–{turno.end_time.slice(0, 5)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />

              <div>
                <p className="text-[11px] text-muted-foreground">Data</p>

                <p className="text-sm font-medium text-foreground">{workDate}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {fase === "erro-turnos" ? (
        <FalhaDeLeitura oQue="os turnos" tentarDeNovo={() => void turnos.refetch()} />
      ) : null}

      {fase === "erro-equipe" ? (
        <FalhaDeLeitura oQue="a equipe" tentarDeNovo={() => void equipe.refetch()} />
      ) : null}

      {fase === "erro-apontamentos" ? (
        <FalhaDeLeitura oQue="os apontamentos" tentarDeNovo={() => void apontamentos.refetch()} />
      ) : null}

      {fase === "carregando" ? <Aviso tipo="carregando">Carregando apontamento...</Aviso> : null}

      {fase === "sem-turno" ? <Aviso>Nenhum turno configurado para esta operação.</Aviso> : null}

      {fase === "sem-equipe" ? <Aviso>Nenhum colaborador alocado neste turno.</Aviso> : null}

      {pronto ? (
        <div className="space-y-4">
          {fechada ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />

              <div>
                <p className="font-medium text-foreground">Folha fechada pelo administrador.</p>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Disponível apenas para consulta.
                </p>
              </div>
            </div>
          ) : null}

          <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
            <CardHeader className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-sm font-semibold tracking-tight">
                  Equipe do turno
                </CardTitle>

                <p className="mt-1 text-xs text-muted-foreground">
                  Informe situação, horários, intervalo e observações.
                </p>
              </div>

              {fechada ? (
                <Badge
                  variant="secondary"
                  className="border border-border bg-secondary font-medium text-muted-foreground shadow-none"
                >
                  Fechado
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
                >
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Aberto
                </Badge>
              )}
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                      <TableHead className="h-12 min-w-56 text-xs font-semibold text-muted-foreground">
                        Colaborador
                      </TableHead>

                      <TableHead className="min-w-40 text-xs font-semibold text-muted-foreground">
                        Situação
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Entrada
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Saída
                      </TableHead>

                      <TableHead className="text-xs font-semibold text-muted-foreground">
                        Intervalo
                      </TableHead>

                      <TableHead className="min-w-52 text-xs font-semibold text-muted-foreground">
                        Observação
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {linhas.map((linha) => {
                      const travada = fechada || linha.faturado || !linha.ativo;

                      return (
                        <TableRow
                          key={linha.employee_id}
                          className="border-border transition-colors hover:bg-secondary/20"
                        >
                          <TableCell className="py-4">
                            <div className="flex items-center gap-3">
                              <AvatarNome nome={linha.employee_name} />

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {linha.employee_name}
                                  </p>

                                  {linha.faturado ? (
                                    <Badge
                                      variant="secondary"
                                      className="border border-primary/15 bg-primary/10 text-[10px] font-medium text-primary shadow-none"
                                    >
                                      Faturado
                                    </Badge>
                                  ) : null}

                                  {!linha.ativo ? (
                                    <Badge variant="outline" className="text-[10px]">
                                      Fora da equipe
                                    </Badge>
                                  ) : null}
                                </div>

                                {linha.employee_role ? (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {linha.employee_role}
                                  </p>
                                ) : null}
                              </div>
                            </div>
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
                              <SelectTrigger className="h-9 w-36 rounded-xl border-input bg-secondary/40">
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
                              className="h-9 w-28 rounded-xl border-input bg-secondary/40"
                              value={linha.check_in.slice(0, 5)}
                              disabled={travada || linha.status === "absent"}
                              onChange={(event) =>
                                editar(linha.employee_id, {
                                  check_in: event.target.value,
                                })
                              }
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              type="time"
                              className="h-9 w-28 rounded-xl border-input bg-secondary/40"
                              value={linha.check_out.slice(0, 5)}
                              disabled={travada || linha.status === "absent"}
                              onChange={(event) =>
                                editar(linha.employee_id, {
                                  check_out: event.target.value,
                                })
                              }
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              className="h-9 w-24 rounded-xl border-input bg-secondary/40"
                              value={linha.break_minutes}
                              disabled={travada || linha.status === "absent"}
                              onChange={(event) =>
                                editar(linha.employee_id, {
                                  break_minutes: normalizarIntervalo(event.target.value),
                                })
                              }
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              className="h-9 min-w-48 rounded-xl border-input bg-secondary/40"
                              value={linha.notes}
                              disabled={travada}
                              placeholder="Opcional"
                              onChange={(event) =>
                                editar(linha.employee_id, {
                                  notes: event.target.value,
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {pendentes.length === 0
                  ? "Tudo atualizado"
                  : `${pendentes.length} alteração${pendentes.length === 1 ? "" : "ões"} pendente${
                      pendentes.length === 1 ? "" : "s"
                    }`}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {pendentes.length === 0
                  ? "Nenhuma informação precisa ser salva."
                  : "Revise as alterações antes de salvar o apontamento."}
              </p>
            </div>

            <Button
              type="button"
              className="h-10 rounded-xl sm:min-w-44"
              onClick={enviar}
              disabled={
                !podeSalvar({
                  fase,
                  fechada,
                  pendentes: pendentes.length,
                  salvando: salvar.isPending,
                })
              }
            >
              <Save className="h-4 w-4" />

              {salvar.isPending ? "Salvando..." : "Salvar apontamento"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
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
  icon: typeof Users;
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
