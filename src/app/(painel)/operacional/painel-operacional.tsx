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
 * Falha de leitura, com a saída óbvia.
 *
 * Erro nunca vira estado vazio: dizer "nenhum turno configurado" porque a rede
 * caiu manda a pessoa procurar o administrador por um problema que não existe.
 */
function FalhaDeLeitura({ oQue, tentarDeNovo }: { oQue: string; tentarDeNovo: () => void }) {
  return (
    <Aviso>
      <p>Não foi possível carregar {oQue}.</p>
      <Button variant="outline" className="mt-4" onClick={tentarDeNovo}>
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

  /**
   * O rascunho carrega o escopo a que pertence.
   *
   * Sem isso, a troca de operação, turno ou data poderia deixar linhas editadas
   * de um dia aparecerem no outro, dependendo da ordem em que as consultas
   * respondessem. Com o escopo junto, a pergunta "este rascunho é deste
   * contexto?" é respondida pelo próprio dado, e não por sincronia de efeito.
   */
  const [rascunho, setRascunho] = useState<{
    escopo: string;
    linhas: LinhaDoRascunho[];
  } | null>(null);

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

  /**
   * O rascunho nasce UMA vez por escopo, e só depois que as leituras daquele
   * escopo concluíram.
   *
   * As duas condições importam. Inicializar antes de a folha chegar montaria
   * todo mundo como linha nova e deixaria salvar por cima de um estado do
   * servidor desconhecido. E reinicializar a cada nova referência de `base`
   * apagaria o que a pessoa está digitando toda vez que uma revalidação em
   * segundo plano respondesse — que é exatamente o que a versão anterior fazia,
   * apesar do comentário em contrário.
   */
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
        linha.employee_id === employeeId ? { ...linha, ...mudanca } : linha,
      ),
    }));
  }

  // Fora da fase pronta não existe payload: sem saber o que o servidor tem, não
  // há "alterado" a calcular.
  const pendentes = pronto ? linhasAlteradas(linhas, apontamentos.data) : [];

  function enviar() {
    if (!operationId || !shiftId || !pronto) return;
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

  // As três causas de "sem dados" são separadas em toda leitura: ainda não
  // chegou, falhou, ou chegou vazio. A ordem é sempre a mesma — erro primeiro,
  // porque erro tratado como vazio é o defeito que dá a resposta errada.
  if (operacoes.isError) {
    return <FalhaDeLeitura oQue="suas operações" tentarDeNovo={() => void operacoes.refetch()} />;
  }
  if (operacoes.isPending || !operacoes.data) {
    return <Aviso>Carregando suas operações...</Aviso>;
  }
  if (operacoes.data.length === 0) {
    return <Aviso>Nenhuma operação atribuída a você. Procure o administrador.</Aviso>;
  }

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

      {fase === "erro-turnos" ? (
        <FalhaDeLeitura oQue="os turnos" tentarDeNovo={() => void turnos.refetch()} />
      ) : null}

      {fase === "erro-equipe" ? (
        <FalhaDeLeitura oQue="a equipe" tentarDeNovo={() => void equipe.refetch()} />
      ) : null}

      {/* A leitura da folha é a que diz o que já existe no servidor. Falhou, a
          tela não monta tabela editável nem calcula payload: montar todo mundo
          como linha nova permitiria gravar por cima de um estado desconhecido. */}
      {fase === "erro-apontamentos" ? (
        <FalhaDeLeitura oQue="os apontamentos" tentarDeNovo={() => void apontamentos.refetch()} />
      ) : null}

      {fase === "carregando" ? <Aviso>Carregando...</Aviso> : null}

      {/* A RPC de escrita exige turno, então operação sem turno não entra no
          fluxo. Só aparece com a leitura concluída SEM erro e com zero turnos —
          nunca por falha de rede. */}
      {fase === "sem-turno" ? <Aviso>Nenhum turno configurado para esta operação.</Aviso> : null}

      {fase === "sem-equipe" ? <Aviso>Nenhum colaborador alocado neste turno.</Aviso> : null}

      {pronto ? (
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
              disabled={
                !podeSalvar({
                  fase,
                  fechada,
                  pendentes: pendentes.length,
                  salvando: salvar.isPending,
                })
              }
            >
              {salvar.isPending ? "Salvando..." : "Salvar apontamento"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
