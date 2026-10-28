"use client";

import { ClipboardCheck, FileSearch, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "../_components/app-shell";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  anosParaEscolher,
  estadoDoResultado,
  mesAtualNoBrasil,
  NOMES_DOS_MESES,
  periodoDoPreset,
  ROTULO_DO_MODO,
  rotuloDaAtualizacao,
  rotuloDoPeriodo,
  type ModoDoPeriodo,
} from "@/lib/fechamento/apresentacao";
import { mensagemDoErro, podeTentarDeNovo, type FiltrosDaBusca } from "@/lib/fechamento/buscar";
import { validarPeriodo } from "@/lib/fechamento/periodo";
import type { FechamentoData } from "@/lib/fechamento/tipos";
import { useClients } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { AlertasDoFechamento } from "./_alertas";
import { ConciliacaoDoFechamento } from "./_conciliacao";
import { DetalheDiario } from "./_detalhe-diario";
import { ExportarFechamento } from "./_exportar";
import { useFechamento } from "./_hooks";
import { ResumoDoFechamento } from "./_resumo";
import { CARTAO, INPUT_CLASS, SELECT_CLASS } from "./_estilos";
import { TabelaPorColaborador } from "./_tabela-colaboradores";

const MODOS: ModoDoPeriodo[] = ["primeira", "segunda", "mes", "personalizado"];

const mesmosFiltros = (a: FiltrosDaBusca | null, b: FiltrosDaBusca | null) =>
  a !== null &&
  b !== null &&
  a.clienteId === b.clienteId &&
  a.inicio === b.inicio &&
  a.fim === b.fim;

/**
 * Tela de Fechamento.
 *
 * Este componente só CONDUZ: guarda os filtros, pede o fechamento à API e
 * exibe o `FechamentoData` que voltou. Não calcula diária, extra, custo,
 * faturado, resultado nem margem — tudo isso chega pronto do núcleo, e o
 * calendário das quinzenas vem de `periodo.ts`.
 */
export function PainelFechamento() {
  const clientes = useClients();

  const [ano, setAno] = useState(() => mesAtualNoBrasil(new Date()).ano);
  const [mes, setMes] = useState(() => mesAtualNoBrasil(new Date()).mes);
  const [anosOferecidos] = useState(() => anosParaEscolher(mesAtualNoBrasil(new Date()).ano));
  const [modo, setModo] = useState<ModoDoPeriodo>("primeira");
  const [inicioPersonalizado, setInicioPersonalizado] = useState("");
  const [fimPersonalizado, setFimPersonalizado] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [aplicados, setAplicados] = useState<FiltrosDaBusca | null>(null);

  const consulta = useFechamento(aplicados);

  const periodo = useMemo(() => {
    if (modo === "personalizado") {
      return validarPeriodo(inicioPersonalizado, fimPersonalizado);
    }
    const preset = periodoDoPreset(ano, mes, modo);
    return validarPeriodo(preset.inicio, preset.fim);
  }, [modo, ano, mes, inicioPersonalizado, fimPersonalizado]);

  const filtrosDoFormulario: FiltrosDaBusca | null =
    clienteId !== "" && periodo.ok
      ? { clienteId, inicio: periodo.periodo.inicio, fim: periodo.periodo.fim }
      : null;

  function escolherModo(novo: ModoDoPeriodo) {
    // Ao abrir o personalizado, parte do período que já estava na tela.
    if (novo === "personalizado" && modo !== "personalizado" && periodo.ok) {
      setInicioPersonalizado(periodo.periodo.inicio);
      setFimPersonalizado(periodo.periodo.fim);
    }
    setModo(novo);
  }

  function gerar(evento: FormEvent) {
    evento.preventDefault();
    if (filtrosDoFormulario === null) return;

    if (mesmosFiltros(aplicados, filtrosDoFormulario)) {
      void consulta.refetch();
    } else {
      setAplicados(filtrosDoFormulario);
    }
  }

  const carregando = consulta.isFetching;
  const mostrarErroDoPeriodo = modo === "personalizado" && !periodo.ok;
  const filtrosMudaram =
    aplicados !== null && !carregando && !mesmosFiltros(aplicados, filtrosDoFormulario);

  return (
    <div>
      <PageHeader
        title="Fechamento"
        description="Conferência de diárias, horas extras, custos e faturamento por cliente e período."
      />

      <Card className={cn("mb-6", CARTAO)}>
        <CardContent className="p-5">
          <form onSubmit={gerar} className="space-y-5" noValidate>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="fechamento-cliente">Cliente</Label>

                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger id="fechamento-cliente" className={SELECT_CLASS}>
                    <SelectValue
                      placeholder={clientes.isLoading ? "Carregando clientes…" : "Selecione"}
                    />
                  </SelectTrigger>

                  <SelectContent>
                    {(clientes.data ?? []).map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id}>
                        {cliente.name}
                        {cliente.status === "inactive" ? " (inativo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {clientes.isError ? (
                  <p className="text-xs text-destructive" role="alert">
                    Não foi possível carregar a lista de clientes.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="fechamento-mes">Mês de referência</Label>

                <Select
                  value={String(mes)}
                  onValueChange={(valor) => setMes(Number(valor))}
                  disabled={modo === "personalizado"}
                >
                  <SelectTrigger id="fechamento-mes" className={SELECT_CLASS}>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {NOMES_DOS_MESES.map((nome, indice) => (
                      <SelectItem key={nome} value={String(indice + 1)}>
                        {nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fechamento-ano">Ano</Label>

                <Select
                  value={String(ano)}
                  onValueChange={(valor) => setAno(Number(valor))}
                  disabled={modo === "personalizado"}
                >
                  <SelectTrigger id="fechamento-ano" className={SELECT_CLASS}>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {anosOferecidos.map((opcao) => (
                      <SelectItem key={opcao} value={String(opcao)}>
                        {opcao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none text-foreground">Período</legend>

              <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Tipo de período">
                {MODOS.map((opcao) => (
                  <Button
                    key={opcao}
                    type="button"
                    variant={modo === opcao ? "default" : "outline"}
                    className="h-10 rounded-xl"
                    aria-pressed={modo === opcao}
                    onClick={() => escolherModo(opcao)}
                  >
                    {ROTULO_DO_MODO[opcao]}
                  </Button>
                ))}
              </div>
            </fieldset>

            {modo === "personalizado" ? (
              <div className="grid gap-4 sm:grid-cols-2 md:max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="fechamento-inicio">Data inicial</Label>
                  <Input
                    id="fechamento-inicio"
                    type="date"
                    value={inicioPersonalizado}
                    onChange={(evento) => setInicioPersonalizado(evento.target.value)}
                    className={INPUT_CLASS}
                    aria-invalid={mostrarErroDoPeriodo}
                    aria-describedby="fechamento-periodo-info"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fechamento-fim">Data final</Label>
                  <Input
                    id="fechamento-fim"
                    type="date"
                    value={fimPersonalizado}
                    onChange={(evento) => setFimPersonalizado(evento.target.value)}
                    className={INPUT_CLASS}
                    aria-invalid={mostrarErroDoPeriodo}
                    aria-describedby="fechamento-periodo-info"
                  />
                </div>
              </div>
            ) : null}

            <p
              id="fechamento-periodo-info"
              className={cn(
                "text-xs",
                mostrarErroDoPeriodo ? "font-medium text-destructive" : "text-muted-foreground",
              )}
              role={mostrarErroDoPeriodo ? "alert" : undefined}
            >
              {periodo.ok
                ? `Período: ${rotuloDoPeriodo(periodo.periodo.inicio, periodo.periodo.fim)} (${periodo.dias} ${
                    periodo.dias === 1 ? "dia" : "dias"
                  }).`
                : modo === "personalizado" &&
                    (inicioPersonalizado === "" || fimPersonalizado === "")
                  ? "Informe as duas datas (no máximo 31 dias)."
                  : periodo.mensagem}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                className="h-10 rounded-xl"
                disabled={filtrosDoFormulario === null || carregando}
              >
                {carregando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {carregando ? "Gerando…" : "Gerar fechamento"}
              </Button>

              {clienteId === "" ? (
                <p className="text-xs text-muted-foreground">
                  Selecione um cliente para continuar.
                </p>
              ) : null}

              {filtrosMudaram ? (
                <p className="text-xs text-muted-foreground" role="status">
                  Os filtros foram alterados. Clique em “Gerar fechamento” para atualizar.
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div aria-live="polite" aria-busy={carregando}>
        {aplicados === null ? (
          <EstadoInicial />
        ) : carregando ? (
          <Carregando />
        ) : consulta.isError ? (
          <ErroDaConsulta erro={consulta.error} onTentarNovamente={() => void consulta.refetch()} />
        ) : consulta.data ? (
          <Resultado dados={consulta.data} onAtualizar={() => void consulta.refetch()} />
        ) : null}
      </div>
    </div>
  );
}

function EstadoInicial() {
  return (
    <Mensagem
      icone={<FileSearch className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
      titulo="Nenhum fechamento gerado ainda"
      descricao="Escolha o cliente e o período e clique em “Gerar fechamento” para conferir diárias, horas extras, custos e faturamento."
    />
  );
}

function Mensagem({
  icone,
  titulo,
  descricao,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
}) {
  return (
    <Card className={CARTAO}>
      <CardContent className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
          {icone}
        </div>

        <p className="mt-4 text-sm font-medium text-foreground">{titulo}</p>
        <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{descricao}</p>
      </CardContent>
    </Card>
  );
}

function Carregando() {
  return (
    <div role="status" aria-label="Carregando fechamento" className="space-y-4">
      <span className="sr-only">Carregando fechamento…</span>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, indice) => (
          <Skeleton key={indice} className="h-28 rounded-2xl" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>

      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

function ErroDaConsulta({
  erro,
  onTentarNovamente,
}: {
  erro: unknown;
  onTentarNovamente: () => void;
}) {
  return (
    <Alert variant="destructive" className="rounded-2xl">
      <TriangleAlert className="h-4 w-4" aria-hidden="true" />

      <AlertTitle>Não foi possível gerar o fechamento</AlertTitle>

      <AlertDescription>
        <p>{mensagemDoErro(erro)}</p>

        {podeTentarDeNovo(erro) ? (
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-9 rounded-xl"
            onClick={onTentarNovamente}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function Resultado({ dados, onAtualizar }: { dados: FechamentoData; onAtualizar: () => void }) {
  const estado = estadoDoResultado(dados);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {dados.meta.clienteNome}
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            {rotuloDoPeriodo(dados.meta.inicio, dados.meta.fim)} · atualizado em{" "}
            {rotuloDaAtualizacao(dados.meta.geradoEm)}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Valores previstos, sem registro de pagamento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={onAtualizar}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Atualizar
          </Button>

          <ExportarFechamento
            dados={dados}
            disponivel={estado === "com-lancamentos" || estado === "somente-financeiro"}
            onDesatualizado={onAtualizar}
          />
        </div>
      </div>

      {estado === "vazio" ? (
        <Mensagem
          icone={<FileSearch className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          titulo="Nenhum lançamento financeiro encontrado para este cliente e período."
          descricao="Não há presenças, substitutos nem faltas apontados neste recorte."
        />
      ) : (
        <>
          <AlertasDoFechamento alertas={dados.alertas} />

          {estado === "somente-faltas" ? (
            <div className="mb-6">
              <Mensagem
                icone={<FileSearch className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                titulo="Nenhum lançamento financeiro encontrado para este cliente e período."
                descricao="Foram registradas apenas faltas, que não geram diária, custo nem faturamento. Elas aparecem abaixo, por colaborador."
              />
            </div>
          ) : (
            <>
              {estado === "somente-financeiro" ? (
                <div className="mb-6">
                  <Mensagem
                    icone={
                      <FileSearch className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    }
                    titulo="Período sem diárias, com valores financeiros."
                    descricao="Não há presenças nem substitutos apontados, mas há adicionais ou ajustes no período. Eles entram na receita e na conciliação abaixo; não há diárias nem colaboradores a detalhar."
                  />
                </div>
              ) : null}

              <ResumoDoFechamento dados={dados} />
            </>
          )}

          <ConciliacaoDoFechamento dados={dados} />

          {dados.colaboradores.length === 0 ? null : <TabelaPorColaborador dados={dados} />}

          {estado === "com-lancamentos" ? <DetalheDiario dados={dados} /> : null}
        </>
      )}
    </div>
  );
}
