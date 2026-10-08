/**
 * Agregação: de lançamentos normalizados para `FechamentoData`.
 *
 * Função pura e determinística. O resultado não depende da ordem em que as
 * linhas chegam, não lê relógio, rede nem banco, e não recalcula regra
 * contratual: soma o que já foi persistido e decomposto linha a linha.
 *
 * REGRAS
 *
 *  - `absent` não gera diária, custo nem faturamento. Conta como falta (só
 *    informação) e não vira linha do detalhe;
 *  - `present` e `replacement` geram uma diária cada. Não se afirma quem o
 *    substituto substituiu;
 *  - `invoice_id` nulo é "a faturar", preenchido é "já faturado"; o consolidado
 *    é a soma dos dois;
 *  - resultado = faturado − custo; margem em milésimos, `null` sem faturado.
 *
 * Um colaborador que só tem faltas no período aparece com valores zerados e a
 * contagem de faltas: é informação, não uma diária simulada.
 */

import { detectarAlertas } from "./alertas";
import { ErroDeDadoDoFechamento } from "./erros";
import { ehDataCivil } from "./periodo";
import {
  VERSAO_DO_FECHAMENTO,
  type FechamentoData,
  type LinhaColaborador,
  type LinhaDetalhe,
  type LinhaNormalizada,
} from "./tipos";
import { acumular, fecharValores, novoAcumulador, type Acumulador } from "./valores";

export interface ContextoDoFechamento {
  clienteId: string;
  clienteNome: string;
  /** `YYYY-MM-DD`, inclusivo. */
  inicio: string;
  /** `YYYY-MM-DD`, inclusivo. */
  fim: string;
  /** ISO-8601. Injetado: o núcleo não lê o relógio. */
  geradoEm: string;
  /** Calculada por quem carrega (`assinatura.ts`); o núcleo só a carrega na meta. */
  assinatura: string;
}

const colador = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Ordem estrita por código de caractere. Para identificadores. */
function compararId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Texto por ordem alfabética pt-BR; empate pela ordem estrita de código. */
function compararTexto(a: string, b: string): number {
  return colador.compare(a, b) || compararId(a, b);
}

function compararDetalhes(a: LinhaDetalhe, b: LinhaDetalhe): number {
  if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
  return (
    compararTexto(a.colaborador, b.colaborador) ||
    compararTexto(a.operacao, b.operacao) ||
    compararId(a.entryId, b.entryId)
  );
}

interface GrupoDoColaborador {
  employeeId: string;
  nome: string;
  funcao: string;
  consolidado: Acumulador;
  aFaturar: Acumulador;
  jaFaturado: Acumulador;
  faltas: number;
  substituicoes: number;
}

function validarContexto(contexto: ContextoDoFechamento): void {
  if (contexto.clienteId === "") {
    throw new ErroDeDadoDoFechamento("contexto: cliente ausente.");
  }
  if (!ehDataCivil(contexto.inicio) || !ehDataCivil(contexto.fim)) {
    throw new ErroDeDadoDoFechamento("contexto: período com data inválida.");
  }
  if (contexto.inicio > contexto.fim) {
    throw new ErroDeDadoDoFechamento("contexto: início posterior ao fim.");
  }
}

export function agregarFechamento(
  linhas: readonly LinhaNormalizada[],
  contexto: ContextoDoFechamento,
): FechamentoData {
  validarContexto(contexto);

  const entryIds = new Set<string>();
  for (const linha of linhas) {
    if (entryIds.has(linha.entryId)) {
      throw new ErroDeDadoDoFechamento(`lançamento ${linha.entryId}: repetido na entrada.`);
    }
    entryIds.add(linha.entryId);

    // A leitura já filtrou no banco. Conferir aqui impede que um filtro que
    // deixou de chegar ao banco vire número errado em silêncio.
    if (linha.clienteId !== contexto.clienteId) {
      throw new ErroDeDadoDoFechamento(
        `lançamento ${linha.entryId}: pertence a outro cliente (${linha.clienteId}).`,
      );
    }
    if (linha.workDate < contexto.inicio || linha.workDate > contexto.fim) {
      throw new ErroDeDadoDoFechamento(
        `lançamento ${linha.entryId}: data ${linha.workDate} fora do período.`,
      );
    }
  }

  const consolidado = novoAcumulador();
  const aFaturar = novoAcumulador();
  const jaFaturado = novoAcumulador();
  const grupos = new Map<string, GrupoDoColaborador>();
  const detalhes: LinhaDetalhe[] = [];
  let faltas = 0;
  let substituicoes = 0;

  for (const linha of linhas) {
    let grupo = grupos.get(linha.employeeId);
    if (grupo === undefined) {
      grupo = {
        employeeId: linha.employeeId,
        nome: linha.colaborador,
        funcao: linha.funcao,
        consolidado: novoAcumulador(),
        aFaturar: novoAcumulador(),
        jaFaturado: novoAcumulador(),
        faltas: 0,
        substituicoes: 0,
      };
      grupos.set(linha.employeeId, grupo);
    }

    if (linha.status === "absent") {
      faltas += 1;
      grupo.faltas += 1;
      continue;
    }

    const faturada = linha.invoiceId !== null;
    acumular(consolidado, linha);
    acumular(faturada ? jaFaturado : aFaturar, linha);
    acumular(grupo.consolidado, linha);
    acumular(faturada ? grupo.jaFaturado : grupo.aFaturar, linha);

    if (linha.status === "replacement") {
      substituicoes += 1;
      grupo.substituicoes += 1;
    }

    detalhes.push({
      entryId: linha.entryId,
      workDate: linha.workDate,
      employeeId: linha.employeeId,
      colaborador: linha.colaborador,
      funcao: linha.funcao,
      operationId: linha.operationId,
      operacao: linha.operacao,
      turno: linha.turno,
      status: linha.status,
      minutosTrabalhados: linha.minutosTrabalhados,
      minutosExtras: linha.minutosExtras,
      diariaCentavos: linha.diariaCentavos,
      extraCentavos: linha.extraCentavos,
      faturadoCentavos: linha.faturadoCentavos,
      custoCentavos: linha.custoCentavos,
      situacaoDeFaturamento: faturada ? "jaFaturado" : "aFaturar",
      situacaoDaFolha: linha.situacaoDaFolha,
    });
  }

  const colaboradores: LinhaColaborador[] = [...grupos.values()]
    .map((grupo) => ({
      employeeId: grupo.employeeId,
      nome: grupo.nome,
      funcao: grupo.funcao,
      consolidado: fecharValores(grupo.consolidado),
      aFaturar: fecharValores(grupo.aFaturar),
      jaFaturado: fecharValores(grupo.jaFaturado),
      faltas: grupo.faltas,
      substituicoes: grupo.substituicoes,
    }))
    .sort((a, b) => compararTexto(a.nome, b.nome) || compararId(a.employeeId, b.employeeId));

  return {
    versao: VERSAO_DO_FECHAMENTO,
    meta: {
      clienteId: contexto.clienteId,
      clienteNome: contexto.clienteNome,
      inicio: contexto.inicio,
      fim: contexto.fim,
      geradoEm: contexto.geradoEm,
      linhasLidas: linhas.length,
      assinatura: contexto.assinatura,
    },
    consolidado: fecharValores(consolidado),
    aFaturar: fecharValores(aFaturar),
    jaFaturado: fecharValores(jaFaturado),
    faltas,
    substituicoes,
    colaboradores,
    detalhes: detalhes.sort(compararDetalhes),
    alertas: detectarAlertas(linhas),
  };
}
