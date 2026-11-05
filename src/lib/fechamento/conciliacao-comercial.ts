import type { FechamentoData } from "./tipos";

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
      inteiroNaoNegativo(componentesRecebidos[campo], `componentes.${campo}`),
    ]),
  ) as unknown as ComponentesComerciais;
  const totalCentavos = inteiroNaoNegativo(raiz["totalCentavos"], "totalCentavos");
  if (somarComponentes(componentes) !== totalCentavos) {
    throw new Error("totalCentavos não corresponde à soma dos componentes.");
  }

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
  const idsDeContainer = new Set(adicionaisDeContainer);
  let containersCentavos = 0;
  let outrosAdicionaisCentavos = 0;
  for (const adicional of dados.adicionais) {
    if (idsDeContainer.has(adicional.id)) containersCentavos += adicional.valorCentavos;
    else outrosAdicionaisCentavos += adicional.valorCentavos;
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
