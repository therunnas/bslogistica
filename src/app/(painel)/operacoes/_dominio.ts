/**
 * Regras puras da tela de operações, turnos e equipes (QA-BS-01, CP-04). Imports relativos: o
 * teste Node (`npm run test:operacoes-turnos`) importa este arquivo direto.
 */
export { nomeLimpo, nomeValido } from "../clientes/_dominio";

const MINUTOS_NO_DIA = 24 * 60;

function minutos(hora: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hora);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export const MENSAGEM_HORARIO_OBRIGATORIO = "Informe o início e o fim do turno.";
export const MENSAGEM_VIRA_COM_FIM_DEPOIS =
  "Com “Vira a meia-noite” marcado, o fim precisa ser antes do início (ex.: 22:00 às 06:00). Desmarque se o turno termina no mesmo dia.";
export const MENSAGEM_INTERVALO_NEGATIVO = "O intervalo não pode ser negativo.";
export const MENSAGEM_INTERVALO_MAIOR = "O intervalo não pode ser maior que a duração do turno.";
export const AVISO_TERMINA_NO_DIA_SEGUINTE =
  "Este turno termina no dia seguinte: o fim é antes do início.";
export const AVISO_TURNO_DE_24_HORAS =
  "Início e fim iguais: o turno terá 24 horas. Confira os horários.";

export interface TurnoDigitado {
  inicio: string;
  fim: string;
  intervalo: number;
  viraAMeiaNoite: boolean;
}

/** Duração bruta, como o cálculo faz (billing.ts e motor_minutos_previstos): fim ≤ início vira o dia. */
function duracao(t: TurnoDigitado): number | null {
  const i = minutos(t.inicio);
  const f = minutos(t.fim);
  if (i === null || f === null) return null;
  return t.viraAMeiaNoite || f <= i ? f + MINUTOS_NO_DIA - i : f - i;
}

/**
 * O que impede salvar. Só o que nunca é uma jornada: "Vira a meia-noite" com o fim DEPOIS do
 * início (08:00–17:00 marcado vira 33 h no cálculo) e intervalo negativo ou maior que o turno.
 * Turno que termina no dia seguinte sem a caixa marcada continua aceito (o cálculo já o trata
 * assim): a tela só avisa. Não muda nenhuma regra de cálculo.
 */
export function errosDoTurno(t: TurnoDigitado): string[] {
  const i = minutos(t.inicio);
  const f = minutos(t.fim);
  if (i === null || f === null) return [MENSAGEM_HORARIO_OBRIGATORIO];
  const erros: string[] = [];
  if (t.viraAMeiaNoite && f > i) erros.push(MENSAGEM_VIRA_COM_FIM_DEPOIS);
  if (!Number.isFinite(t.intervalo) || t.intervalo < 0) erros.push(MENSAGEM_INTERVALO_NEGATIVO);
  else {
    const d = duracao(t);
    if (d !== null && erros.length === 0 && t.intervalo >= d) erros.push(MENSAGEM_INTERVALO_MAIOR);
  }
  return erros;
}

/** Avisos que não impedem salvar. Turno de 24 h (início = fim) fica como aviso: decisão de jornada. */
export function avisosDoTurno(t: TurnoDigitado): string[] {
  const i = minutos(t.inicio);
  const f = minutos(t.fim);
  if (i === null || f === null || errosDoTurno(t).length > 0) return [];
  if (i === f) return [AVISO_TURNO_DE_24_HORAS];
  if (f < i) return [AVISO_TERMINA_NO_DIA_SEGUINTE];
  return [];
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Rótulo do cliente no seletor: o inativo aparece, identificado (a escolha não é bloqueada). */
export function rotuloDoCliente(cliente: { name: string; status: string }): string {
  return cliente.status === "active" ? cliente.name : `${cliente.name} (inativo)`;
}

/**
 * Situação do contrato numa data, só para IDENTIFICAR no seletor. Não bloqueia nem muda cobrança:
 * o fim do contrato não limita a vigência das condições (DEC-CP02-01, pendente).
 */
export function situacaoDoContrato(
  contrato: { status: string; valid_from: string; valid_to: string | null },
  hoje: string,
): string {
  if (contrato.status !== "active") return "inativo";
  if (contrato.valid_to && contrato.valid_to < hoje)
    return `encerrado em ${dataBR(contrato.valid_to)}`;
  if (contrato.valid_from > hoje) return `começa em ${dataBR(contrato.valid_from)}`;
  return "";
}

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/** O que a exclusão de um turno leva junto: as alocações da equipe nele (ON DELETE CASCADE). */
export function consequenciasDaExclusaoDoTurno(alocados: number): string {
  return alocados > 0
    ? `${plural(alocados, "colaborador sai", "colaboradores saem")} da equipe deste turno.`
    : "";
}

/** O que a exclusão de uma operação leva junto: turnos e alocações (ON DELETE CASCADE). */
export function consequenciasDaExclusaoDaOperacao(turnos: number, alocados: number): string {
  const partes: string[] = [];
  if (turnos > 0) partes.push(plural(turnos, "turno", "turnos"));
  if (alocados > 0) partes.push(plural(alocados, "alocação da equipe", "alocações da equipe"));
  return partes.length > 0 ? `Também serão excluídos ${partes.join(" e ")}.` : "";
}
