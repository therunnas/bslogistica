/**
 * Normalização: do que a leitura devolve (`LinhaBrutaDoFechamento`) para tipos
 * seguros (`LinhaNormalizada`).
 *
 * Aqui o dinheiro vira centavos inteiros, a decomposição diária/extra é aplicada
 * LINHA A LINHA (a regra de `gerar_fatura`), e os textos que a tela mostraria
 * ("Sem função", "Sem turno") são resolvidos uma vez, para tela, CSV e XLSX não
 * decidirem cada um o seu.
 *
 * **Nada inválido é escondido.** Valor financeiro mal formado, status
 * desconhecido, minutos negativos, data que não existe, relação ausente: o erro
 * sobe e o carregamento inteiro falha. Corrigir ou descartar a linha produziria
 * um relatório que parece certo e não é.
 *
 * Datas ficam como `YYYY-MM-DD`. Não se cria `Date` para a regra de período:
 * `new Date("2026-03-01")` é meia-noite UTC e muda de dia no fuso do Brasil.
 */

import { centavosDeNumeric, decomporLancamento } from "./centavos";
import { ErroDeDadoDoFechamento, ErroDeDadoFinanceiro } from "./erros";
import type { LinhaBrutaDoFechamento } from "./leitura";
import { ehDataCivil } from "./periodo";
import {
  SEM_FUNCAO,
  SEM_NOME,
  SEM_TURNO,
  type LinhaNormalizada,
  type StatusDaFolha,
  type StatusDoLancamento,
} from "./tipos";

const STATUS_DO_LANCAMENTO: readonly StatusDoLancamento[] = ["present", "absent", "replacement"];
const STATUS_DA_FOLHA: readonly StatusDaFolha[] = ["open", "closed"];

const FORMATO_DE_HORA = /^\d{2}:\d{2}(:\d{2})?$/;

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor === "") {
    throw new ErroDeDadoDoFechamento(`${campo}: texto obrigatório ausente.`);
  }
  return valor;
}

function textoOuNulo(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ErroDeDadoDoFechamento(`${campo}: esperado texto ou null.`);
  }
  return valor;
}

function horaOuNula(valor: unknown, campo: string): string | null {
  const texto = textoOuNulo(valor, campo);
  if (texto === null) return null;
  if (!FORMATO_DE_HORA.test(texto)) {
    throw new ErroDeDadoDoFechamento(`${campo}: "${texto}" não é uma hora.`);
  }
  return texto;
}

function minutos(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new ErroDeDadoDoFechamento(`${campo}: minutos devem ser um inteiro não negativo.`);
  }
  return valor;
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErroDeDadoDoFechamento(`${campo}: relação ausente ou em formato inesperado.`);
  }
  return valor as Record<string, unknown>;
}

/** Dinheiro que o domínio não admite negativo: faturado, custo e taxa da diária. */
function centavosNaoNegativos(valor: unknown, campo: string): number {
  const centavos = centavosDeNumeric(valor, campo);
  if (centavos < 0) {
    throw new ErroDeDadoFinanceiro(`${campo}: valor negativo não é esperado neste campo.`);
  }
  return centavos;
}

/** Função em texto livre: vazia, nula ou só espaços vira `SEM_FUNCAO`. */
export function funcaoDe(role: string | null | undefined): string {
  if (role === null || role === undefined) return SEM_FUNCAO;
  const aparada = role.trim();
  return aparada === "" ? SEM_FUNCAO : aparada;
}

export function normalizarLinha(bruta: LinhaBrutaDoFechamento): LinhaNormalizada {
  const entryId = textoObrigatorio(bruta.id, "lançamento.id");
  const rotulo = `lançamento ${entryId}`;

  const status = bruta.status as unknown;
  if (!STATUS_DO_LANCAMENTO.includes(status as StatusDoLancamento)) {
    throw new ErroDeDadoDoFechamento(`${rotulo}: status desconhecido (${String(status)}).`);
  }

  const folha = objeto(bruta.timesheets, `${rotulo}: folha`);
  const operacao = objeto(folha["operations"], `${rotulo}: operação`);
  const colaborador = objeto(bruta.employees, `${rotulo}: colaborador`);
  const turno = folha["shifts"] === null ? null : objeto(folha["shifts"], `${rotulo}: turno`);

  const workDate = folha["work_date"];
  if (!ehDataCivil(workDate)) {
    throw new ErroDeDadoDoFechamento(`${rotulo}: data inválida (${String(workDate)}).`);
  }

  const situacaoDaFolha = folha["status"] as unknown;
  if (!STATUS_DA_FOLHA.includes(situacaoDaFolha as StatusDaFolha)) {
    throw new ErroDeDadoDoFechamento(`${rotulo}: status da folha desconhecido.`);
  }

  const faturadoCentavos = centavosNaoNegativos(bruta.faturado, `${rotulo}: faturado`);
  const custoCentavos = centavosNaoNegativos(bruta.custo, `${rotulo}: custo`);
  const diariaSnapshotCentavos = centavosNaoNegativos(
    bruta.taxa_da_diaria,
    `${rotulo}: taxa da diária`,
  );
  const { diariaCentavos, extraCentavos } = decomporLancamento(
    faturadoCentavos,
    diariaSnapshotCentavos,
  );

  const nome = typeof colaborador["name"] === "string" ? colaborador["name"].trim() : "";
  const nomeDoTurno = turno === null ? null : textoOuNulo(turno["name"], `${rotulo}: turno.name`);

  return {
    entryId,
    employeeId: textoObrigatorio(bruta.employee_id, `${rotulo}: employee_id`),
    colaborador: nome === "" ? SEM_NOME : nome,
    funcao: funcaoDe(textoOuNulo(colaborador["role"], `${rotulo}: função`)),
    clienteId: textoObrigatorio(operacao["client_id"], `${rotulo}: client_id`),
    operationId: textoObrigatorio(folha["operation_id"], `${rotulo}: operation_id`),
    operacao: textoObrigatorio(operacao["name"], `${rotulo}: nome da operação`),
    contractId: textoOuNulo(operacao["contract_id"], `${rotulo}: contract_id`),
    turno: nomeDoTurno === null || nomeDoTurno.trim() === "" ? SEM_TURNO : nomeDoTurno.trim(),
    workDate,
    status: status as StatusDoLancamento,
    situacaoDaFolha: situacaoDaFolha as StatusDaFolha,
    checkIn: horaOuNula(bruta.check_in, `${rotulo}: check_in`),
    checkOut: horaOuNula(bruta.check_out, `${rotulo}: check_out`),
    minutosTrabalhados: minutos(bruta.worked_minutes, `${rotulo}: worked_minutes`),
    minutosExtras: minutos(bruta.overtime_minutes, `${rotulo}: overtime_minutes`),
    faturadoCentavos,
    custoCentavos,
    diariaSnapshotCentavos,
    diariaCentavos,
    extraCentavos,
    invoiceId: textoOuNulo(bruta.invoice_id, `${rotulo}: invoice_id`),
  };
}

export function normalizarLinhas(brutas: readonly LinhaBrutaDoFechamento[]): LinhaNormalizada[] {
  return brutas.map(normalizarLinha);
}
