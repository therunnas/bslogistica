"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "../_components/app-shell";
import { prepararLoteDeContainers, type LoteDeContainers } from "@/lib/container-servico";
import {
  assertPayloadDaIntencao,
  criarIntencao,
  corrigirIntencaoRecusada,
  limparIntencao,
  marcarIntencao,
  recuperarIntencao,
  salvarIntencao,
  sanearIntencoes,
  type MarcadorIntencaoContainer,
} from "@/lib/container-servico-intencao";
import {
  carregarFormularioContainerAction,
  recuperarIntencaoContainerAction,
  recuperarMarcadorContainerAction,
  registrarContainerAction,
} from "./_acoes";
import { dinheiroContainer } from "./lista-containers";

type Dados = Extract<
  Awaited<ReturnType<typeof carregarFormularioContainerAction>>,
  { ok: true }
>["data"];
type Intencao = ReturnType<typeof criarIntencao>;
const vazio: LoteDeContainers = {
  clienteId: "",
  operacaoId: null,
  solicitadoEm: "",
  executadoEm: "",
  descricao: "",
  quantidade: 1,
  totalCobrado: "",
  participantes: [],
  modalidadeCusto: "por_pessoa",
};
const uuid = (valor: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);

function Campo({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id}>{titulo}</Label>
      {children}
    </div>
  );
}

function Selecao({
  id,
  valor,
  onChange,
  opcoes,
  vazio,
  disabled = false,
}: {
  id: string;
  valor: string;
  onChange: (valor: string) => void;
  opcoes: { id: string; name: string }[];
  vazio: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className="h-10 w-full rounded-md border bg-background px-3"
      value={valor}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{vazio}</option>
      {opcoes.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

export function FormularioContainer() {
  const queryClient = useQueryClient();
  const [dados, setDados] = useState<Dados | null>(null);
  const [lote, setLote] = useState<LoteDeContainers>(vazio);
  const [motivo, setMotivo] = useState("");
  const [marcador, setMarcador] = useState<MarcadorIntencaoContainer | null>(null);
  const [intencao, setIntencao] = useState<Intencao | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(true);
  const [recuperacaoPendente, setRecuperacaoPendente] = useState(false);
  const [confirmado, setConfirmado] = useState<string | null>(null);
  const [editandoPreparada, setEditandoPreparada] = useState(false);
  const trava = useRef(false);

  const atualizarConsultas = useCallback(() => {
    for (const key of ["adicionais", "containers", "invoices"]) {
      void queryClient.invalidateQueries({ queryKey: [key] }).catch(() => {});
    }
  }, [queryClient]);

  const reconciliar = useCallback(
    async (salva: Intencao) => {
      const resultado = await recuperarIntencaoContainerAction(
        salva.lote.clienteId,
        salva.chave,
        salva.payload,
      );
      if (!resultado.ok) throw new Error(resultado.mensagem);
      if (resultado.data.estado === "registrado") {
        if (!uuid(resultado.data.id)) {
          throw new Error("Resposta sem identificação válida. Confira a recuperação.");
        }
        if (salva.estado === "confirmada" && salva.servicoId !== resultado.data.id) {
          throw new Error("A identificação confirmada diverge da recuperação.");
        }
        setConfirmado(resultado.data.id);
        atualizarConsultas();
        setIntencao(
          salva.estado === "confirmada"
            ? salva
            : marcarIntencao(salva, "confirmada", resultado.data.id),
        );
      }
      if (salva.estado === "confirmada" && resultado.data.estado === "ausente") {
        throw new Error("O registro confirmado não foi localizado. Preserve a intenção.");
      }
      setRecuperacaoPendente(false);
      return resultado.data.estado;
    },
    [atualizarConsultas],
  );

  useEffect(() => {
    let ativo = true;
    async function iniciar() {
      try {
        const resultado = await carregarFormularioContainerAction();
        if (!resultado.ok) {
          if (ativo) {
            setRecuperacaoPendente(true);
            setMensagem(resultado.mensagem);
          }
          return;
        }
        if (!ativo) return;
        const dados = resultado.data;
        setDados(dados);
        // A identidade confirmada no servidor precede a leitura do armazenamento.
        let salva: MarcadorIntencaoContainer | null;
        try {
          sanearIntencoes(sessionStorage);
          salva = recuperarIntencao(sessionStorage, dados.userId);
        } catch {
          setRecuperacaoPendente(true);
          setMensagem(
            "Armazenamento de intenção indisponível. O cadastro de containers está bloqueado. Verifique o armazenamento do navegador e recarregue para reconciliar qualquer intenção preservada; os demais módulos continuam disponíveis.",
          );
          return;
        }
        if (salva) {
          setMarcador(salva);
          setRecuperacaoPendente(true);
          const registro = await recuperarMarcadorContainerAction(salva.chave);
          if (!ativo) return;
          if (!registro.ok) throw new Error(registro.mensagem);
          if (registro.data.estado === "registrado" && uuid(registro.data.id)) {
            setConfirmado(registro.data.id);
            atualizarConsultas();
          } else {
            setMensagem(
              "A chave foi preservada, mas o serviço ainda não foi confirmado. Por confidencialidade, os dados financeiros não são armazenados após recarregar ou sair. Reenvio bloqueado: solicite reconciliação administrativa desta intenção antes de iniciar outro registro.",
            );
          }
        }
      } catch {
        if (ativo) {
          setRecuperacaoPendente(true);
          setMensagem(
            "Não foi possível verificar a sessão ou recuperar o registro. Nenhuma nova tentativa será enviada até a conferência.",
          );
        }
      } finally {
        if (ativo) setOcupado(false);
      }
    }
    void iniciar();
    return () => {
      ativo = false;
    };
  }, [atualizarConsultas]);

  function alterar<K extends keyof LoteDeContainers>(campo: K, valor: LoteDeContainers[K]) {
    setLote((anterior) => ({ ...anterior, [campo]: valor }));
  }

  function revisar() {
    if (
      !dados ||
      trava.current ||
      recuperacaoPendente ||
      (intencao && intencao.estado !== "recusada" && !editandoPreparada)
    ) {
      return;
    }
    setMensagem("");
    try {
      prepararLoteDeContainers(lote);
      if (intencao && lote.clienteId.trim().toLowerCase() !== intencao.payload.clienteId) {
        throw new Error("O cliente da intenção preservada não pode ser alterado.");
      }
      if (!motivo.trim()) throw new Error("Informe o motivo do registro para auditoria.");
      const nova =
        intencao?.estado === "recusada"
          ? corrigirIntencaoRecusada(intencao, lote, motivo)
          : criarIntencao(dados.userId, lote, motivo, intencao?.chave ?? crypto.randomUUID());
      salvarIntencao(sessionStorage, nova);
      setIntencao(nova);
      setEditandoPreparada(false);
    } catch (erro) {
      setMensagem(
        erro instanceof Error
          ? erro.message
          : "Não foi possível preservar o registro nesta sessão. O envio foi bloqueado.",
      );
    }
  }

  async function enviar() {
    if (
      !intencao ||
      !dados ||
      trava.current ||
      recuperacaoPendente ||
      confirmado ||
      intencao.estado === "recusada" ||
      editandoPreparada
    ) {
      return;
    }
    trava.current = true;
    setOcupado(true);
    setMensagem("");
    let enviada = intencao;
    const estavaIndeterminada = intencao.estado === "indeterminada";
    try {
      const identidade = await carregarFormularioContainerAction();
      if (!identidade.ok || identidade.data.userId !== dados.userId) {
        throw new Error("A sessão mudou. Recarregue para verificar a identidade.");
      }
      assertPayloadDaIntencao(intencao, lote, motivo);
      setRecuperacaoPendente(true);
      if ((await reconciliar(intencao)) === "registrado") return;
      enviada = marcarIntencao(intencao, "enviando");
      // Persistência obrigatória antes da chamada de escrita.
      salvarIntencao(sessionStorage, enviada);
      setIntencao(enviada);
      const resultado = await registrarContainerAction({
        lote: intencao.lote,
        chave: intencao.chave,
        motivo: intencao.motivo,
      });
      if (!resultado.ok) {
        if (["validacao", "nao-encontrado"].includes(resultado.codigo) && !estavaIndeterminada) {
          enviada = marcarIntencao(enviada, "recusada");
          salvarIntencao(sessionStorage, enviada);
          setIntencao(enviada);
          setRecuperacaoPendente(true);
          setMensagem(resultado.mensagem);
          await reconciliar(enviada);
          return;
        }
        throw new Error(resultado.mensagem);
      }
      if (!uuid(resultado.data.id)) {
        throw new Error("O resultado do envio precisa ser conferido antes de tentar novamente.");
      }
      const concluida = marcarIntencao(enviada, "confirmada", resultado.data.id);
      setConfirmado(resultado.data.id);
      atualizarConsultas();
      setIntencao(concluida);
      salvarIntencao(sessionStorage, concluida);
    } catch (erro) {
      const incerta =
        enviada.estado === "indeterminada" || enviada.estado === "recusada"
          ? enviada
          : marcarIntencao(enviada, "indeterminada");
      setIntencao(incerta);
      setRecuperacaoPendente(true);
      try {
        salvarIntencao(sessionStorage, incerta);
      } catch {
        // A intenção anterior permanece para recuperação.
      }
      setMensagem(
        erro instanceof Error
          ? erro.message
          : "Resultado indeterminado. Confira o registro antes de tentar novamente.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }

  async function conferir() {
    if (!dados || (!intencao && !marcador) || trava.current) return;
    trava.current = true;
    setOcupado(true);
    try {
      const identidade = await carregarFormularioContainerAction();
      if (!identidade.ok || identidade.data.userId !== dados.userId) {
        throw new Error("A sessão mudou. Recarregue a página.");
      }
      if (!intencao && marcador) {
        const registro = await recuperarMarcadorContainerAction(marcador.chave);
        if (!registro.ok) throw new Error(registro.mensagem);
        if (registro.data.estado === "registrado" && uuid(registro.data.id)) {
          setConfirmado(registro.data.id);
          atualizarConsultas();
        } else {
          setMensagem(
            "Registro ainda não confirmado. Reenvio bloqueado; a chave original está preservada para reconciliação administrativa.",
          );
        }
        return;
      }
      if (!intencao) return;
      await reconciliar(intencao);
      setMensagem(
        intencao.estado === "recusada"
          ? "Registro recusado e conferido. Corrija os dados e revise novamente; a chave original será preservada."
          : "Conferência concluída. Se o serviço estiver ausente, você pode confirmar o mesmo registro.",
      );
    } catch {
      setMensagem(
        "Não foi possível conferir. A intenção original continua preservada e novos envios estão bloqueados.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }

  async function corrigir() {
    if (
      !dados ||
      !intencao ||
      intencao.estado !== "preparada" ||
      trava.current ||
      recuperacaoPendente
    ) {
      return;
    }
    trava.current = true;
    setOcupado(true);
    try {
      const identidade = await carregarFormularioContainerAction();
      if (!identidade.ok || identidade.data.userId !== dados.userId) {
        throw new Error("A sessão mudou.");
      }
      setRecuperacaoPendente(true);
      if ((await reconciliar(intencao)) === "registrado") return;
      setEditandoPreparada(true);
      setMensagem("");
    } catch {
      setRecuperacaoPendente(true);
      setMensagem(
        "Não foi possível liberar a alteração. Confira a intenção preservada antes de editar.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }

  if (confirmado) {
    return (
      <div className="space-y-4">
        <PageHeader title="Serviço registrado" description="Registro confirmado pelo servidor." />
        <Button asChild>
          <Link href={`/containers/${confirmado}`}>Abrir serviço</Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            try {
              if (dados) limparIntencao(sessionStorage, dados.userId);
              window.location.reload();
            } catch {
              setMensagem("Não foi possível limpar a intenção. Recarregue para recuperá-la.");
            }
          }}
        >
          Novo serviço
        </Button>
        {mensagem && <p role="alert">{mensagem}</p>}
      </div>
    );
  }
  if (!dados) {
    return (
      <div className="space-y-4">
        <p role="status">{ocupado ? "Verificando sessão e dados do formulário…" : mensagem}</p>
        {!ocupado && <Button onClick={() => window.location.reload()}>Recarregar</Button>}
      </div>
    );
  }
  const resumo =
    intencao?.estado === "recusada" || editandoPreparada ? undefined : intencao?.payload;
  const bloqueado =
    ocupado ||
    recuperacaoPendente ||
    (!!intencao && intencao.estado !== "recusada" && !editandoPreparada);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo serviço de containers"
        description="Registre o valor total negociado e os custos individuais deste serviço avulso."
      />
      <Link className="underline" href="/containers">
        Voltar para containers
      </Link>
      {mensagem && (
        <p role="alert" className="rounded-md border p-4">
          {mensagem}
        </p>
      )}
      {marcador && <p>Código da intenção preservada: {marcador.chave}</p>}
      {recuperacaoPendente && (intencao || marcador) && (
        <Button disabled={ocupado} onClick={() => void conferir()}>
          Conferir registro preservado
        </Button>
      )}
      <Card>
        <CardContent className="pt-6">
          <fieldset disabled={bloqueado} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="cliente" titulo="Cliente">
                <Selecao
                  id="cliente"
                  valor={lote.clienteId}
                  disabled={!!intencao && !editandoPreparada}
                  vazio="Selecione"
                  opcoes={dados.clientes}
                  onChange={(clienteId) => {
                    if (intencao) {
                      if (!editandoPreparada || intencao.estado !== "preparada" || !dados) return;
                      try {
                        limparIntencao(sessionStorage, dados.userId);
                      } catch {
                        setMensagem(
                          "Não foi possível liberar o rascunho. O cliente foi preservado.",
                        );
                        return;
                      }
                      setIntencao(null);
                      setEditandoPreparada(false);
                    }
                    setLote({ ...lote, clienteId, operacaoId: null });
                  }}
                />
              </Campo>
              <Campo id="operacao" titulo="Operação (opcional)">
                <Selecao
                  id="operacao"
                  valor={lote.operacaoId ?? ""}
                  vazio="Sem operação"
                  opcoes={dados.operacoes.filter((o) => o.client_id === lote.clienteId)}
                  onChange={(valor) => alterar("operacaoId", valor || null)}
                />
              </Campo>
              {(
                [
                  ["solicitadoEm", "Data da solicitação", "date"],
                  ["executadoEm", "Data da execução", "date"],
                  ["totalCobrado", "Valor total negociado (R$)", "text"],
                ] as const
              ).map(([campo, titulo, tipo]) => (
                <Campo id={campo} titulo={titulo} key={campo}>
                  <Input
                    id={campo}
                    type={tipo}
                    inputMode={campo === "totalCobrado" ? "decimal" : "text"}
                    value={lote[campo]}
                    onChange={(e) => alterar(campo, e.target.value)}
                  />
                </Campo>
              ))}
              <Campo id="quantidade" titulo="Quantidade de containers">
                <Input
                  id="quantidade"
                  type="number"
                  min="1"
                  step="1"
                  value={lote.quantidade}
                  onChange={(e) => alterar("quantidade", Number(e.target.value))}
                />
              </Campo>
            </div>
            <Campo id="descricao" titulo="Produto e serviço">
              <Textarea
                id="descricao"
                maxLength={500}
                value={lote.descricao}
                onChange={(e) => alterar("descricao", e.target.value)}
              />
            </Campo>
            <Campo id="referencia" titulo="Referência (opcional)">
              <Input
                id="referencia"
                maxLength={200}
                value={lote.referencia ?? ""}
                onChange={(e) => alterar("referencia", e.target.value)}
              />
            </Campo>
            <Campo id="modalidade" titulo="Modalidade de custo">
              <select
                id="modalidade"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={lote.modalidadeCusto}
                onChange={(e) =>
                  setLote({
                    ...lote,
                    modalidadeCusto: e.target.value as LoteDeContainers["modalidadeCusto"],
                    totalDistribuido: e.target.value === "total_distribuido" ? "" : null,
                  })
                }
              >
                <option value="por_pessoa">Por pessoa</option>
                <option value="total_distribuido">Total distribuído</option>
              </select>
            </Campo>
            {lote.modalidadeCusto === "total_distribuido" && (
              <Campo id="total-custo" titulo="Total a distribuir (R$)">
                <Input
                  id="total-custo"
                  inputMode="decimal"
                  value={lote.totalDistribuido ?? ""}
                  onChange={(e) => alterar("totalDistribuido", e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Informe a parcela de cada participante. A soma precisa ser exata; não há rateio
                  automático.
                </p>
              </Campo>
            )}
            <fieldset className="space-y-3">
              <legend className="font-medium">Participantes e valores devidos</legend>
              <p className="text-sm text-muted-foreground">
                Custo zero deve ser informado explicitamente. Estes valores não são diárias nem
                horas extras.
              </p>
              {lote.participantes.map((p, index) => (
                <div key={index} className="flex flex-wrap items-end gap-3">
                  <Campo id={`p-${index}`} titulo={`Colaborador ${index + 1}`}>
                    <Selecao
                      id={`p-${index}`}
                      valor={p.colaboradorId}
                      vazio="Selecione"
                      opcoes={dados.colaboradores}
                      onChange={(valor) =>
                        alterar(
                          "participantes",
                          lote.participantes.map((item, n) =>
                            n === index ? { ...item, colaboradorId: valor } : item,
                          ),
                        )
                      }
                    />
                  </Campo>
                  <Campo id={`c-${index}`} titulo="Valor devido (R$)">
                    <Input
                      id={`c-${index}`}
                      inputMode="decimal"
                      placeholder="Informe, inclusive zero"
                      value={p.valorDevido}
                      onChange={(e) =>
                        alterar(
                          "participantes",
                          lote.participantes.map((item, n) =>
                            n === index ? { ...item, valorDevido: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Campo>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      alterar(
                        "participantes",
                        lote.participantes.filter((_, n) => n !== index),
                      )
                    }
                  >
                    Remover participante {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  alterar("participantes", [
                    ...lote.participantes,
                    { colaboradorId: "", valorDevido: "" },
                  ])
                }
              >
                Adicionar participante
              </Button>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-medium">Competência de cobrança (opcional)</legend>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!lote.competenciaCobranca}
                  onChange={(e) =>
                    alterar(
                      "competenciaCobranca",
                      e.target.checked ? { inicio: "", fim: "" } : undefined,
                    )
                  }
                />
                Informar competência específica
              </Label>
              {lote.competenciaCobranca && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["inicio", "fim"] as const).map((campo) => (
                    <Campo
                      key={campo}
                      id={`competencia-${campo}`}
                      titulo={campo === "inicio" ? "Início" : "Fim"}
                    >
                      <Input
                        id={`competencia-${campo}`}
                        type="date"
                        value={lote.competenciaCobranca![campo]}
                        onChange={(e) =>
                          alterar("competenciaCobranca", {
                            ...lote.competenciaCobranca!,
                            [campo]: e.target.value,
                          })
                        }
                      />
                    </Campo>
                  ))}
                </div>
              )}
            </fieldset>
            <Campo id="motivo" titulo="Motivo do registro (auditoria)">
              <Textarea
                id="motivo"
                maxLength={1000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Campo>
            <Button type="button" onClick={revisar}>
              Revisar serviço
            </Button>
          </fieldset>
        </CardContent>
      </Card>
      {resumo && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Conferência do serviço</h2>
            <p>
              {lote.descricao} · {lote.quantidade} container(s)
            </p>
            <p>
              {dados.clientes.find((c) => c.id === lote.clienteId)?.name} · Solicitação{" "}
              {lote.solicitadoEm} · Execução {lote.executadoEm}
            </p>
            <p>
              Receita: {dinheiroContainer(resumo.receitaCentavos)} · Custo:{" "}
              {dinheiroContainer(resumo.custoTotalCentavos)}
            </p>
            {resumo.participantes.map((p) => (
              <p key={p.colaboradorId}>
                {dados.colaboradores.find((c) => c.id === p.colaboradorId)?.name}:{" "}
                {dinheiroContainer(p.custoCentavos)}
              </p>
            ))}
            <p>Motivo: {motivo}</p>
            <p className="text-sm text-muted-foreground">
              A confirmação registra o serviço avulso. O faturamento segue o fluxo de faturamento
              existente.
            </p>
            <Button
              variant="outline"
              disabled={ocupado || recuperacaoPendente || intencao?.estado !== "preparada"}
              onClick={() => void corrigir()}
            >
              Voltar e corrigir
            </Button>
            <Button disabled={ocupado || recuperacaoPendente} onClick={() => void enviar()}>
              {ocupado ? "Conferindo…" : "Confirmar registro"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
