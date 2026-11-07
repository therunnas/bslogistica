"use client";

import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ListChecks,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserCheck,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "../_components/app-shell";
import { ConfirmarAcaoIrreversivel } from "../_components/confirmar-acao-irreversivel";

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

import { brl } from "@/lib/format";
import { AvisoDoMotor, HistoricoDeVigencias } from "../_components/vigencias";
import { CatalogoDeFuncoes } from "./catalogo-de-funcoes";
import { useFuncoes } from "@/lib/funcoes-dados";
import {
  camposDeFuncaoDoColaborador,
  nomeDaFuncao,
  opcoesDeFuncao,
  pendentesDeFuncao,
  SEM_FUNCAO,
} from "@/lib/funcoes";
import {
  useCriarComVigencia,
  useCustosDosColaboradores,
  useEstadoDoMotor,
  useFuncoesTurno,
  usePeriodoContratual,
  useRegistrarVigencia,
  useRegrasDaBs,
  useRegrasDefinitivas,
  useVersoes,
} from "@/lib/vigencias-dados";
import {
  custosVigentesPorColaborador,
  planejarNovoCusto,
  textoDaConfirmacao,
} from "@/lib/colaborador-custo";
import { hojeEmSaoPaulo, modoDeEdicaoDeTaxa, type TermoDeCusto } from "@/lib/vigencias-ui";
import { useDeleteRow, useSaveRow } from "@/lib/mutations";
import { useEmployees } from "@/lib/queries";
import type { Employee } from "@/lib/types";

type StatusColaborador = "active" | "inactive";

const empty = {
  id: "",
  name: "",
  doc: "",
  role: "",
  job_function_id: "",
  phone: "",
  daily_cost: 0,
  status: "active" as StatusColaborador,
};

const INPUT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

const SELECT_CLASS =
  "h-11 rounded-xl border-input bg-secondary/50 text-foreground focus:ring-primary/20";

export function PainelColaboradores() {
  const { data = [], isLoading } = useEmployees();

  const save = useSaveRow("employees");
  const criarComVigencia = useCriarComVigencia("colaborador", ["employees"]);
  const estadoDoMotor = useEstadoDoMotor();
  const modoDeCusto = modoDeEdicaoDeTaxa(estadoDoMotor);
  const regrasBs = useRegrasDaBs();
  const remove = useDeleteRow("employees");
  const [colaboradorParaExcluir, setColaboradorParaExcluir] = useState<Employee | null>(null);
  // Catálogo de funções (migration 039): só com o anúncio do banco.
  const funcoesHabilitadas = useFuncoesTurno();
  const funcoes = useFuncoes(funcoesHabilitadas);
  const catalogo = funcoes.data ?? [];
  const [catalogoOpen, setCatalogoOpen] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof empty>(empty);
  // Início da vigência do custo do colaborador NOVO (motor ligado). Colaborador novo não tem
  // apontamento, então nenhuma data aqui reescreve histórico; o existente muda por nova vigência.
  const [inicioDoCusto, setInicioDoCusto] = useState(hojeEmSaoPaulo());
  // Valor-hora acordado da hora extra paga (migration 029), opcional: vazio = sem valor acordado.
  const [horaExtraDoCusto, setHoraExtraDoCusto] = useState("");

  // Reajuste do custo de colaborador EXISTENTE com vigências: editado no próprio cadastro e gravado como
  // NOVA vigência (mecanismo existente), a partir de hoje ou de data futura, com motivo na trilha.
  const registrarCusto = useRegistrarVigencia("colaborador");
  const regrasDefinitivas = useRegrasDefinitivas();
  const periodoContratual = usePeriodoContratual();
  const [custoDigitado, setCustoDigitado] = useState("");
  const [inicioDoReajuste, setInicioDoReajuste] = useState(hojeEmSaoPaulo());
  const [motivoDoReajuste, setMotivoDoReajuste] = useState("");
  const [confirmarCusto, setConfirmarCusto] = useState(false);
  const reajusteNoCadastro = Boolean(form.id) && modoDeCusto === "por-vigencia";
  const versoesDoCusto = useVersoes("colaborador", reajusteNoCadastro ? form.id : null);
  const planoDoCusto = useMemo(
    () =>
      planejarNovoCusto({
        versoes: (versoesDoCusto.data ?? []) as unknown as TermoDeCusto[],
        custoAtual: form.daily_cost,
        novoCusto: custoDigitado,
        inicio: inicioDoReajuste,
        motivo: motivoDoReajuste,
        hoje: hojeEmSaoPaulo(),
        regrasBs,
        regrasDefinitivas,
        periodoContratual,
      }),
    [
      versoesDoCusto.data,
      form.daily_cost,
      custoDigitado,
      inicioDoReajuste,
      motivoDoReajuste,
      regrasBs,
      regrasDefinitivas,
      periodoContratual,
    ],
  );
  const reajustePendente = reajusteNoCadastro && planoDoCusto.muda;

  const colaboradoresAtivos = data.filter((employee) => employee.status === "active").length;

  const colaboradoresInativos = data.filter((employee) => employee.status !== "active").length;

  // Com o motor por vigência o custo que vale é o da versão em vigor hoje (`employees.daily_cost` é só o
  // valor do cadastro e não acompanha os reajustes). undefined = carregando; null = sem custo vigente.
  const porVigencia = modoDeCusto === "por-vigencia";
  const custosDaLista = useCustosDosColaboradores(
    data.map((employee) => employee.id),
    porVigencia,
  );
  const custosVigentes = useMemo(
    () =>
      porVigencia && custosDaLista.data
        ? custosVigentesPorColaborador(
            custosDaLista.data as unknown as (TermoDeCusto & { employee_id: string })[],
            hojeEmSaoPaulo(),
          )
        : null,
    [porVigencia, custosDaLista.data],
  );
  function custoExibido(employee: Employee): number | null | undefined {
    if (!porVigencia) return Number(employee.daily_cost);
    if (!custosVigentes) return undefined;
    return custosVigentes.get(employee.id) ?? null;
  }

  const custosConhecidos = data
    .map(custoExibido)
    .filter((valor): valor is number => typeof valor === "number");
  const custoMedio =
    custosConhecidos.length > 0
      ? custosConhecidos.reduce((total, valor) => total + valor, 0) / custosConhecidos.length
      : 0;

  function edit(employee: Employee) {
    const custoEmVigor = custoExibido(employee) ?? Number(employee.daily_cost);
    setForm({
      id: employee.id,
      name: employee.name,
      doc: employee.doc ?? "",
      role: employee.role ?? "",
      job_function_id: employee.job_function_id ?? "",
      phone: employee.phone ?? "",
      daily_cost: custoEmVigor,
      status: employee.status === "inactive" ? "inactive" : "active",
    });
    setCustoDigitado(custoEmVigor.toFixed(2).replace(".", ","));
    setInicioDoReajuste(hojeEmSaoPaulo());
    setMotivoDoReajuste("");

    setOpen(true);
  }

  // O custo diário de colaborador existente: com o motor DESLIGADO grava direto; ligado, é editado aqui
  // mas vira NOVA vigência (nunca UPDATE da coluna); sem estado confirmado, nada financeiro é enviado.
  const custoTravado = modoDeCusto === "bloqueada";

  // A função padrão se grava no próprio colaborador. No cadastro novo com o motor ligado o cadastro
  // passa pela RPC atômica do custo (que não conhece a função): a função se escolhe depois de salvar.
  const funcaoNoFormulario = funcoesHabilitadas && (Boolean(form.id) || modoDeCusto === "direta");

  function submit() {
    const payload: Record<string, unknown> = {
      name: form.name,
      doc: form.doc || null,
      role: form.role || null,
      phone: form.phone || null,
      status: form.status,
      ...camposDeFuncaoDoColaborador(form.job_function_id || null, funcaoNoFormulario),
    };

    if (modoDeCusto === "direta" || (!form.id && modoDeCusto === "por-vigencia")) {
      payload["daily_cost"] = Number(form.daily_cost) || 0;
    }

    if (form.id) {
      payload["id"] = form.id;
      if (reajustePendente) {
        // Primeiro a confirmação explícita do novo valor e da data; o envio fica em confirmarReajuste.
        if (planoDoCusto.form) setConfirmarCusto(true);
        return;
      }
      save.mutate(payload, { onSuccess: () => setOpen(false) });
      return;
    }

    if (modoDeCusto === "por-vigencia") {
      // Motor ligado: o custo vem da vigência; o colaborador novo já nasce com a inicial.
      criarComVigencia.mutate(
        {
          linha: payload,
          form: {
            inicio: inicioDoCusto,
            motivo: "Cadastro inicial do colaborador",
            valores: {
              daily_cost: String(payload["daily_cost"]),
              ot_hourly_cost: horaExtraDoCusto,
            },
            encerrarAnterior: false,
            regrasBs,
          },
        },
        { onSuccess: () => setOpen(false) },
      );
      return;
    }

    if (modoDeCusto === "direta") {
      save.mutate(payload, { onSuccess: () => setOpen(false) });
    }
  }

  // Cadastro e custo numa só ação: os dados cadastrais (sem o custo) e, depois, a nova vigência.
  function confirmarReajuste() {
    setConfirmarCusto(false);
    const plano = planoDoCusto.form;
    if (!form.id || !plano) return;
    const payload: Record<string, unknown> = {
      id: form.id,
      name: form.name,
      doc: form.doc || null,
      role: form.role || null,
      phone: form.phone || null,
      status: form.status,
      ...camposDeFuncaoDoColaborador(form.job_function_id || null, funcaoNoFormulario),
    };
    const id = form.id;
    save.mutate(payload, {
      onSuccess: () =>
        registrarCusto.mutate({ entidadeId: id, form: plano }, { onSuccess: () => setOpen(false) }),
    });
  }

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description="Gerencie a equipe disponível para alocação, funções, contatos e custo operacional por diária."
        action={
          <div className="flex flex-wrap gap-2">
            {funcoesHabilitadas ? (
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl"
                onClick={() => setCatalogoOpen(true)}
              >
                <ListChecks className="h-4 w-4" aria-hidden />
                Funções
                {pendentesDeFuncao(data).length > 0 ? (
                  <Badge variant="secondary" className="ml-1">
                    {pendentesDeFuncao(data).length}
                  </Badge>
                ) : null}
              </Button>
            ) : null}
            <Button
              className="h-10 rounded-xl"
              disabled={modoDeCusto === "bloqueada"}
              onClick={() => {
                setForm(empty);
                setInicioDoCusto(hojeEmSaoPaulo());
                setHoraExtraDoCusto("");
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Novo colaborador
            </Button>
          </div>
        }
      />

      <AvisoDoMotor estado={estadoDoMotor} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          label="Colaboradores"
          value={String(data.length)}
          description="Total cadastrado"
          icon={Users}
        />

        <Resumo
          label="Ativos"
          value={String(colaboradoresAtivos)}
          description="Disponíveis para alocação"
          icon={UserCheck}
        />

        <Resumo
          label="Inativos"
          value={String(colaboradoresInativos)}
          description="Fora da operação"
          icon={UserX}
        />

        <Resumo
          label="Custo médio"
          value={brl(custoMedio)}
          description="Média por diária"
          icon={BadgeDollarSign}
        />
      </div>

      <div className="mb-4">
        <p className="text-sm font-medium text-foreground">Equipe cadastrada</p>

        <p className="mt-1 text-xs text-muted-foreground">
          Consulte funções, contatos, custos e disponibilidade dos colaboradores.
        </p>
      </div>

      <Card className="overflow-hidden rounded-2xl border-border bg-card text-card-foreground shadow-[0_14px_40px_rgba(0,0,0,0.06)]">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/35 hover:bg-secondary/35">
                  <TableHead className="h-12 text-xs font-semibold text-muted-foreground">
                    Colaborador
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Função
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Documento
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Telefone
                  </TableHead>

                  <TableHead className="text-right text-xs font-semibold text-muted-foreground">
                    Custo diária
                  </TableHead>

                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Status
                  </TableHead>

                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EstadoCarregando />
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EstadoVazio />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((employee) => (
                    <TableRow
                      key={employee.id}
                      className="border-border transition-colors hover:bg-secondary/30"
                    >
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <AvatarNome nome={employee.name} />

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {employee.name}
                            </p>

                            <p className="mt-0.5 text-xs text-muted-foreground">Colaborador</p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        {employee.role ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0" />
                            <span>{employee.role}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        {funcoesHabilitadas && employee.job_function_id ? (
                          <Badge variant="secondary" className="mt-1">
                            {nomeDaFuncao(catalogo, employee.job_function_id)}
                          </Badge>
                        ) : funcoesHabilitadas && pendentesDeFuncao([employee]).length > 0 ? (
                          <Badge variant="outline" className="mt-1">
                            Revisar função
                          </Badge>
                        ) : null}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {employee.doc ?? "—"}
                      </TableCell>

                      <TableCell>
                        {employee.phone ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>{employee.phone}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right text-sm font-medium text-foreground">
                        {(() => {
                          const custo = custoExibido(employee);
                          if (custo === undefined) return "…";
                          if (custo === null)
                            return (
                              <span className="text-xs font-medium text-destructive">
                                Sem custo vigente
                              </span>
                            );
                          return brl(custo);
                        })()}
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={employee.status} />
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
                            onClick={() => edit(employee)}
                            aria-label={`Editar ${employee.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setColaboradorParaExcluir(employee)}
                            aria-label={`Excluir ${employee.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card text-card-foreground sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.025em]">
              {form.id ? "Editar colaborador" : "Novo colaborador"}
            </DialogTitle>

            <DialogDescription>
              {form.id
                ? "Atualize os dados operacionais e cadastrais do colaborador."
                : "Cadastre uma nova pessoa para disponibilizá-la à operação."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="employee-name">Nome</Label>

              <Input
                id="employee-name"
                value={form.name}
                onChange={(event) =>
                  setForm({
                    ...form,
                    name: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee-role">Função</Label>

              <Input
                id="employee-role"
                value={form.role}
                onChange={(event) =>
                  setForm({
                    ...form,
                    role: event.target.value,
                  })
                }
                placeholder="Ex.: Ajudante"
                className={INPUT_CLASS}
              />
            </div>

            {funcaoNoFormulario ? (
              <div className="space-y-2">
                <Label htmlFor="employee-job-function">Função padrão</Label>

                <Select
                  value={form.job_function_id === "" ? SEM_FUNCAO : form.job_function_id}
                  onValueChange={(value) =>
                    setForm({ ...form, job_function_id: value === SEM_FUNCAO ? "" : value })
                  }
                >
                  <SelectTrigger id="employee-job-function" className={SELECT_CLASS}>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value={SEM_FUNCAO}>Sem função definida</SelectItem>
                    {opcoesDeFuncao(catalogo, form.job_function_id || null).map((funcao) => (
                      <SelectItem key={funcao.id} value={funcao.id}>
                        {funcao.name}
                        {funcao.active ? "" : " (inativa)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="text-xs text-muted-foreground">
                  A função padrão não obriga a mesma função em todas as operações. O texto do campo
                  acima é preservado.
                </p>
              </div>
            ) : funcoesHabilitadas ? (
              <p className="text-xs text-muted-foreground">
                A função padrão se escolhe depois de salvar o colaborador.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="employee-doc">Documento</Label>

              <Input
                id="employee-doc"
                value={form.doc}
                onChange={(event) =>
                  setForm({
                    ...form,
                    doc: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee-phone">Telefone</Label>

              <Input
                id="employee-phone"
                value={form.phone}
                onChange={(event) =>
                  setForm({
                    ...form,
                    phone: event.target.value,
                  })
                }
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee-cost">Custo por diária (R$)</Label>

              {reajusteNoCadastro ? (
                <Input
                  id="employee-cost"
                  inputMode="decimal"
                  value={custoDigitado}
                  onChange={(event) => setCustoDigitado(event.target.value)}
                  aria-describedby="employee-cost-hint"
                  className={INPUT_CLASS}
                />
              ) : (
                <Input
                  id="employee-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.daily_cost}
                  disabled={custoTravado}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      daily_cost: Number(event.target.value),
                    })
                  }
                  className={INPUT_CLASS}
                />
              )}
              {reajusteNoCadastro ? (
                <p id="employee-cost-hint" className="text-xs text-muted-foreground">
                  Atual: {brl(form.daily_cost)}. Um valor novo vale a partir da data abaixo; o
                  anterior fica no histórico.
                </p>
              ) : null}
            </div>

            {reajustePendente ? (
              <div className="space-y-2">
                <Label htmlFor="employee-cost-apply-from">Novo custo vale a partir de</Label>
                <Input
                  id="employee-cost-apply-from"
                  type="date"
                  min={hojeEmSaoPaulo()}
                  value={inicioDoReajuste}
                  onChange={(event) => setInicioDoReajuste(event.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            ) : null}

            {reajustePendente ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="employee-cost-reason">Motivo do reajuste</Label>
                <Input
                  id="employee-cost-reason"
                  value={motivoDoReajuste}
                  onChange={(event) => setMotivoDoReajuste(event.target.value)}
                  placeholder="Ex.: reajuste anual combinado"
                  className={INPUT_CLASS}
                />
                {planoDoCusto.erros.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-destructive" role="alert">
                    {planoDoCusto.erros.map((erro) => (
                      <li key={erro}>{erro}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {!form.id && modoDeCusto === "por-vigencia" ? (
              <div className="space-y-2">
                <Label htmlFor="employee-cost-from">Custo vigente desde</Label>

                <Input
                  id="employee-cost-from"
                  type="date"
                  value={inicioDoCusto}
                  onChange={(event) => setInicioDoCusto(event.target.value)}
                  className={INPUT_CLASS}
                />

                <p className="text-xs text-muted-foreground">
                  Primeiro dia trabalhado com este custo. Dias anteriores a esta data não podem ser
                  apontados para o colaborador.
                </p>
              </div>
            ) : null}

            {!form.id && modoDeCusto === "por-vigencia" && regrasBs ? (
              <div className="space-y-2">
                <Label htmlFor="employee-ot-hourly-cost">
                  Valor-hora da hora extra paga (R$, opcional)
                </Label>

                <Input
                  id="employee-ot-hourly-cost"
                  inputMode="decimal"
                  value={horaExtraDoCusto}
                  onChange={(event) => setHoraExtraDoCusto(event.target.value)}
                  className={INPUT_CLASS}
                />

                <p className="text-xs text-muted-foreground">
                  Valor combinado com este colaborador. Vazio: a hora extra paga é o custo da diária
                  dividido pela jornada, sem acréscimo.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Status</Label>

              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    status: value as StatusColaborador,
                  })
                }
              >
                <SelectTrigger className={SELECT_CLASS}>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>

                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {custoTravado ? (
            <p className="text-xs text-muted-foreground">
              Regras financeiras não confirmadas: o custo diário está somente para leitura.
            </p>
          ) : null}

          {form.id ? (
            <details className="group rounded-xl border border-border">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">
                Histórico de custos e ajustes avançados
              </summary>
              <div className="px-2 pb-2">
                <HistoricoDeVigencias
                  tipo="colaborador"
                  entidadeId={form.id}
                  estado={estadoDoMotor}
                  valoresIniciais={{ daily_cost: String(form.daily_cost) }}
                />
              </div>
            </details>
          ) : null}

          <DialogFooter className="mt-2 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              className="rounded-xl"
              onClick={submit}
              disabled={
                !form.name ||
                save.isPending ||
                criarComVigencia.isPending ||
                registrarCusto.isPending ||
                (reajustePendente && planoDoCusto.form === null) ||
                (modoDeCusto === "bloqueada" && !form.id) ||
                (!form.id && modoDeCusto === "por-vigencia" && !inicioDoCusto)
              }
            >
              {save.isPending || criarComVigencia.isPending || registrarCusto.isPending
                ? "Salvando..."
                : reajustePendente
                  ? "Salvar e aplicar novo custo"
                  : "Salvar colaborador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {funcoesHabilitadas ? (
        <CatalogoDeFuncoes
          aberto={catalogoOpen}
          aoMudar={setCatalogoOpen}
          funcoes={catalogo}
          colaboradores={data}
          carregando={funcoes.isLoading}
          erro={funcoes.isError}
        />
      ) : null}

      <ConfirmarAcaoIrreversivel
        open={confirmarCusto}
        onOpenChange={setConfirmarCusto}
        titulo="Confirmar novo custo"
        descricao={textoDaConfirmacao(planoDoCusto, form.name)}
        rotuloConfirmar="Aplicar novo custo"
        onConfirmar={confirmarReajuste}
      />

      <ConfirmarAcaoIrreversivel
        open={colaboradorParaExcluir !== null}
        onOpenChange={(aberto) => !aberto && setColaboradorParaExcluir(null)}
        titulo="Excluir colaborador"
        descricao={`Excluir o colaborador "${colaboradorParaExcluir?.name ?? ""}"? O cadastro é apagado e a exclusão não pode ser desfeita. Colaborador com apontamentos ou vigências em uso não pode ser excluído: nesse caso, inative-o.`}
        rotuloConfirmar="Excluir colaborador"
        onConfirmar={() => {
          const alvo = colaboradorParaExcluir;
          setColaboradorParaExcluir(null);
          if (alvo) remove.mutate(alvo.id);
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ativo = status === "active";

  return (
    <Badge
      variant="secondary"
      className={
        ativo
          ? "border border-emerald-500/15 bg-emerald-500/10 font-medium text-emerald-600 shadow-none dark:text-emerald-400"
          : "border border-border bg-secondary font-medium text-muted-foreground shadow-none"
      }
    >
      <span
        className={
          ativo
            ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
            : "mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground"
        }
      />

      {ativo ? "Ativo" : "Inativo"}
    </Badge>
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

function Resumo({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border bg-card text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>

            <p className="mt-2 truncate text-2xl font-semibold tracking-[-0.035em] text-foreground">
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

function EstadoVazio() {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/50">
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm font-medium text-foreground">Nenhum colaborador cadastrado</p>

      <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
        Cadastre a equipe que poderá ser alocada nas operações da BS.
      </p>
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="flex min-h-44 items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        Carregando colaboradores...
      </div>
    </div>
  );
}
