import type { FechamentoData } from "./tipos";
import { somarCentavos } from "./centavos";

export const CAMPOS_DOS_COMPONENTES = [
  "diariasCentavos",
  "horasExtrasCentavos",
  "domingoFeriadoCentavos",
  "adicionalDiarioCentavos",
  "outrosAdicionaisCentavos",
  "containersCentavos",
  "ajustesCentavos",
] as const;

export type CampoDeComponente = (typeof CAMPOS_DOS_COMPONENTES)[number];
export type ComponentesComerciais = Record<CampoDeComponente, number>;

export interface BaseComercial {
  fonte: { arquivo: string; sha256: string };
  cliente: { id: string; nome: string };
  periodo: { inicio: string; fim: string };
  quantidadeApontamentos: number;
  quantidadeColaboradores: number;
  componentes: ComponentesComerciais;
  totalCentavos: number;
}

export interface DiferencaComercial {
  campo: string;
  base: string | number;
  fechamento: string | number;
  diferencaCentavos?: number;
}

export interface ResultadoDaConciliacao {
  confere: boolean;
  fonte: BaseComercial["fonte"];
  totalBaseCentavos: number;
  totalFechamentoCentavos: number;
  diferencas: DiferencaComercial[];
}

function registro(valor: unknown, campo: string): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new Error(`${campo} deve ser um objeto.`);
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`${campo} deve ser um texto não vazio.`);
  }
  return valor;
}

function inteiroNaoNegativo(valor: unknown, campo: string): number {
  if (!Number.isSafeInteger(valor) || (valor as number) < 0) {
    throw new Error(`${campo} deve ser um inteiro não negativo.`);
  }
  return valor as number;
}

function inteiro(valor: unknown, campo: string): number {
  if (!Number.isSafeInteger(valor)) throw new Error(`${campo} deve ser um inteiro seguro.`);
  return valor as number;
}

function periodoValido(inicio: string, fim: string): void {
  for (const data of [inicio, fim]) {
    const instante = new Date(`${data}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(data) ||
      !Number.isFinite(instante.getTime()) ||
      instante.toISOString().slice(0, 10) !== data
    )
      throw new Error("Período com data inválida.");
  }
  if (inicio > fim) throw new Error("Período invertido.");
}

function somarComponentes(componentes: ComponentesComerciais): number {
  return CAMPOS_DOS_COMPONENTES.reduce((total, campo) => {
    const soma = total + componentes[campo];
    if (!Number.isSafeInteger(soma))
      throw new Error("Soma dos componentes fora do intervalo seguro.");
    return soma;
  }, 0);
}

/** Valida uma base externa serializada antes de compará-la com o Fechamento. */
export function validarBaseComercial(valor: unknown): BaseComercial {
  const raiz = registro(valor, "base comercial");
  const fonte = registro(raiz["fonte"], "fonte");
  const cliente = registro(raiz["cliente"], "cliente");
  const periodo = registro(raiz["periodo"], "periodo");
  const componentesRecebidos = registro(raiz["componentes"], "componentes");

  const sha256 = texto(fonte["sha256"], "fonte.sha256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new Error("fonte.sha256 deve ser um SHA-256 hexadecimal.");

  const componentes = Object.fromEntries(
    CAMPOS_DOS_COMPONENTES.map((campo) => [
      campo,
      campo === "ajustesCentavos"
        ? inteiro(componentesRecebidos[campo], `componentes.${campo}`)
        : inteiroNaoNegativo(componentesRecebidos[campo], `componentes.${campo}`),
    ]),
  ) as unknown as ComponentesComerciais;
  const totalCentavos = inteiroNaoNegativo(raiz["totalCentavos"], "totalCentavos");
  if (somarComponentes(componentes) !== totalCentavos) {
    throw new Error("totalCentavos não corresponde à soma dos componentes.");
  }
  periodoValido(texto(periodo["inicio"], "periodo.inicio"), texto(periodo["fim"], "periodo.fim"));

  return {
    fonte: { arquivo: texto(fonte["arquivo"], "fonte.arquivo"), sha256 },
    cliente: {
      id: texto(cliente["id"], "cliente.id"),
      nome: texto(cliente["nome"], "cliente.nome"),
    },
    periodo: {
      inicio: texto(periodo["inicio"], "periodo.inicio"),
      fim: texto(periodo["fim"], "periodo.fim"),
    },
    quantidadeApontamentos: inteiroNaoNegativo(
      raiz["quantidadeApontamentos"],
      "quantidadeApontamentos",
    ),
    quantidadeColaboradores: inteiroNaoNegativo(
      raiz["quantidadeColaboradores"],
      "quantidadeColaboradores",
    ),
    componentes,
    totalCentavos,
  };
}

/** Separa serviços de Containers dos demais adicionais, sem recalcular valor financeiro. */
export function extrairComponentesDoFechamento(
  dados: FechamentoData,
  adicionaisDeContainer: readonly string[],
): ComponentesComerciais {
  if (
    dados.versao !== 2 ||
    !Array.isArray(dados.conciliacao) ||
    dados.conciliacao.some((item) => item.confere !== true)
  ) {
    throw new Error("Snapshot de Fechamento inválido ou com conciliação divergente.");
  }
  periodoValido(dados.meta.inicio, dados.meta.fim);
  inteiroNaoNegativo(dados.meta.linhasLidas, "linhasLidas");
  inteiroNaoNegativo(dados.financeiro.receitaCentavos, "receitaCentavos");
  if (dados.meta.linhasLidas < dados.detalhes.length)
    throw new Error("Contagem de apontamentos inconsistente.");
  const colaboradores = new Set(
    dados.colaboradores.map((item) => texto(item.employeeId, "employeeId")),
  );
  if (
    colaboradores.size !== dados.colaboradores.length ||
    dados.detalhes.some((item) => !colaboradores.has(item.employeeId))
  ) {
    throw new Error("Colaboradores inconsistentes com os detalhes.");
  }
  const previsto = dados.ajustesAcumulados.reduce(
    (total, item) => somarCentavos(total, inteiro(item.ajusteCentavos, "ajuste previsto")),
    0,
  );
  const faturado = dados.ajustesFaturados.reduce(
    (total, item) => somarCentavos(total, inteiro(item.valorCentavos, "ajuste faturado")),
    0,
  );
  if (
    previsto !== dados.financeiro.ajustePrevistoCentavos ||
    faturado !== dados.financeiro.ajusteFaturadoCentavos ||
    somarCentavos(previsto, faturado) !== dados.financeiro.ajusteCentavos
  ) {
    throw new Error("Ajustes divergem do lastro do Fechamento.");
  }
  const campos = [
    "diariaCentavos",
    "extraCentavos",
    "especialCentavos",
    "adicionalDiarioCentavos",
    "faturadoCentavos",
  ] as const;
  const entradas = new Set<string>();
  for (const detalhe of dados.detalhes) {
    texto(detalhe.entryId, "entryId");
    if (entradas.has(detalhe.entryId)) throw new Error("Apontamento duplicado.");
    entradas.add(detalhe.entryId);
    let soma = 0;
    for (const campo of campos.slice(0, 4)) {
      soma = somarCentavos(soma, inteiroNaoNegativo(detalhe[campo], campo));
    }
    if (soma !== inteiroNaoNegativo(detalhe.faturadoCentavos, "faturadoCentavos")) {
      throw new Error("Componentes do apontamento divergem do cobrado.");
    }
  }
  for (const campo of campos) {
    const soma = dados.detalhes.reduce((total, detalhe) => somarCentavos(total, detalhe[campo]), 0);
    if (soma !== inteiroNaoNegativo(dados.consolidado[campo], campo)) {
      throw new Error("Detalhes divergem do consolidado do Fechamento.");
    }
  }
  const idsDeContainer = new Set(adicionaisDeContainer);
  if (idsDeContainer.size !== adicionaisDeContainer.length)
    throw new Error("Vínculo de Container duplicado.");
  const ids = new Set<string>();
  let containersCentavos = 0;
  let outrosAdicionaisCentavos = 0;
  for (const adicional of dados.adicionais) {
    texto(adicional.id, "adicional.id");
    if (ids.has(adicional.id)) throw new Error("Adicional duplicado no Fechamento.");
    ids.add(adicional.id);
    inteiroNaoNegativo(adicional.valorCentavos, "adicional.valorCentavos");
    if (idsDeContainer.has(adicional.id))
      containersCentavos = somarCentavos(containersCentavos, adicional.valorCentavos);
    else
      outrosAdicionaisCentavos = somarCentavos(outrosAdicionaisCentavos, adicional.valorCentavos);
  }
  for (const id of idsDeContainer) {
    if (!ids.has(id)) throw new Error("Vínculo de Container ausente no Fechamento.");
  }

  const componentes: ComponentesComerciais = {
    diariasCentavos: dados.consolidado.diariaCentavos,
    horasExtrasCentavos: dados.consolidado.extraCentavos,
    domingoFeriadoCentavos: dados.consolidado.especialCentavos,
    adicionalDiarioCentavos: dados.consolidado.adicionalDiarioCentavos,
    outrosAdicionaisCentavos,
    containersCentavos,
    ajustesCentavos: dados.financeiro.ajusteCentavos,
  };
  for (const campo of CAMPOS_DOS_COMPONENTES) {
    if (campo === "ajustesCentavos") inteiro(componentes[campo], campo);
    else inteiroNaoNegativo(componentes[campo], campo);
  }
  const soma = somarComponentes(componentes);
  if (soma !== dados.financeiro.receitaCentavos) {
    throw new Error(
      `Componentes comerciais (${soma}) divergem da receita do Fechamento (${dados.financeiro.receitaCentavos}).`,
    );
  }
  return componentes;
}

function comparar(
  diferencas: DiferencaComercial[],
  campo: string,
  base: string | number,
  fechamento: string | number,
  monetario = false,
): void {
  if (base === fechamento) return;
  diferencas.push({
    campo,
    base,
    fechamento,
    ...(monetario ? { diferencaCentavos: Number(fechamento) - Number(base) } : {}),
  });
}

/** Compara a base comercial componente a componente. Nunca corrige nem tolera diferenças. */
export function conciliarBaseComercial(
  baseRecebida: BaseComercial,
  dados: FechamentoData,
  adicionaisDeContainer: readonly string[],
): ResultadoDaConciliacao {
  const base = validarBaseComercial(baseRecebida);
  const fechamento = extrairComponentesDoFechamento(dados, adicionaisDeContainer);
  const diferencas: DiferencaComercial[] = [];

  comparar(diferencas, "cliente.id", base.cliente.id, dados.meta.clienteId);
  comparar(diferencas, "cliente.nome", base.cliente.nome, dados.meta.clienteNome);
  comparar(diferencas, "periodo.inicio", base.periodo.inicio, dados.meta.inicio);
  comparar(diferencas, "periodo.fim", base.periodo.fim, dados.meta.fim);
  comparar(
    diferencas,
    "quantidadeApontamentos",
    base.quantidadeApontamentos,
    dados.meta.linhasLidas,
  );
  comparar(
    diferencas,
    "quantidadeColaboradores",
    base.quantidadeColaboradores,
    dados.colaboradores.length,
  );
  for (const campo of CAMPOS_DOS_COMPONENTES) {
    comparar(diferencas, `componentes.${campo}`, base.componentes[campo], fechamento[campo], true);
  }
  comparar(diferencas, "totalCentavos", base.totalCentavos, dados.financeiro.receitaCentavos, true);

  return {
    confere: diferencas.length === 0,
    fonte: base.fonte,
    totalBaseCentavos: base.totalCentavos,
    totalFechamentoCentavos: dados.financeiro.receitaCentavos,
    diferencas,
  };
}
