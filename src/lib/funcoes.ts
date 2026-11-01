/**
 * Catálogo de funções e período do turno (FIN-PR-06, migration 039).
 *
 * É CADASTRO. Nada aqui calcula valor: a função do colaborador, a função da alocação e o período do
 * turno não entram em diária, hora extra, custo, tarifa, snapshot, fatura nem Fechamento. Preço por
 * contrato + função + período + vigência é o FIN-PR-07.
 *
 * O banco é a barreira (RPCs de admin, catálogo sem escrita direta, função inativa recusada em
 * escolha nova). Este módulo só valida o formulário, monta os parâmetros e reproduz as regras de
 * normalização e de herança, para a tela e a suíte Node.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export const RPC_FUNCOES = {
  criar: "criar_funcao",
  renomear: "renomear_funcao",
  situacao: "alterar_situacao_funcao",
  vincular: "vincular_funcoes_exatas",
} as const;

export interface FuncaoDoCatalogo {
  id: string;
  code: string;
  name: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type PeriodoDoTurno = "diurno" | "noturno";

export const PERIODOS_DO_TURNO: readonly { valor: PeriodoDoTurno; rotulo: string }[] = [
  { valor: "diurno", rotulo: "Diurno" },
  { valor: "noturno", rotulo: "Noturno" },
];

export const ROTULO_DO_PERIODO: Readonly<Record<PeriodoDoTurno, string>> = {
  diurno: "Diurno",
  noturno: "Noturno",
};

/** Valor da escolha "não classificado" (turno histórico ainda sem confirmação do administrador). */
export const SEM_PERIODO = "__sem_periodo__";
/** Valor da escolha "sem função". */
export const SEM_FUNCAO = "__sem_funcao__";

/**
 * O banco já tem a migration 039? Anuncia com `funcoes_turno = true` em `estado_motor_vigencia`
 * (mesmo padrão de `regras_bs`, `nucleo_v2` e `periodo_contratual`). Sem o anúncio (banco anterior,
 * erro ou resposta inválida) a tela não mostra nem envia nada de função ou período.
 */
export function interpretarFuncoesTurno(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { funcoes_turno?: unknown }).funcoes_turno === true;
}

const COM_ACENTO = "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO = "AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn";

/**
 * Espelho de `normalizar_texto_chave` (migration 039): maiúsculas, acento, espaço e pontuação não
 * distinguem. É a regra do vínculo por texto exato e da unicidade de nome no catálogo.
 */
export function normalizarTextoChave(texto: string | null | undefined): string {
  let saida = "";
  for (const c of texto ?? "") {
    const i = COM_ACENTO.indexOf(c);
    saida += i >= 0 ? SEM_ACENTO[i] : c;
  }
  return saida.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Mensagens para o usuário; lista vazia = pode enviar. O banco revalida tudo. */
export function validarNomeDaFuncao(
  nome: string,
  existentes: readonly FuncaoDoCatalogo[],
  ignorarId: string | null = null,
): string[] {
  const erros: string[] = [];
  const limpo = nome.trim();
  if (limpo === "") {
    erros.push("Informe o nome da função.");
    return erros;
  }
  if (limpo.length > 80) erros.push("O nome da função deve ter no máximo 80 caracteres.");
  const chave = normalizarTextoChave(limpo);
  if (chave === "") {
    erros.push("O nome da função deve ter letras ou números.");
  } else if (existentes.some((f) => f.id !== ignorarId && normalizarTextoChave(f.name) === chave)) {
    erros.push(
      "Já existe uma função com este nome (maiúsculas, acentos e espaços não diferenciam).",
    );
  }
  return erros;
}

/** Funções que podem ser escolhidas numa seleção nova: as ativas, em ordem alfabética. */
export function funcoesParaEscolha(catalogo: readonly FuncaoDoCatalogo[]): FuncaoDoCatalogo[] {
  return catalogo.filter((f) => f.active).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Opções de um seletor: as ativas e, se a função já gravada ficou inativa, ela também (para o valor
 * atual não desaparecer da tela). Escolher outra e voltar a ela não é possível: o banco recusa.
 */
export function opcoesDeFuncao(
  catalogo: readonly FuncaoDoCatalogo[],
  atualId: string | null,
): FuncaoDoCatalogo[] {
  const ativas = funcoesParaEscolha(catalogo);
  if (atualId === null || ativas.some((f) => f.id === atualId)) return ativas;
  const atual = catalogo.find((f) => f.id === atualId);
  return atual ? [...ativas, atual] : ativas;
}

/** Correspondência EXATA entre o texto de cargo e uma função ATIVA; nunca aproxima. */
export function funcaoPorTextoExato(
  texto: string | null | undefined,
  catalogo: readonly FuncaoDoCatalogo[],
): FuncaoDoCatalogo | null {
  const chave = normalizarTextoChave(texto);
  if (chave === "") return null;
  return catalogo.find((f) => f.active && normalizarTextoChave(f.name) === chave) ?? null;
}

export interface ColaboradorComFuncao {
  id: string;
  role: string | null;
  job_function_id?: string | null;
}

/** Colaborador com cargo em texto e sem função vinculada: aguarda revisão do administrador. */
export function pendentesDeFuncao<T extends ColaboradorComFuncao>(
  colaboradores: readonly T[],
): T[] {
  return colaboradores.filter(
    (c) => (c.job_function_id ?? null) === null && normalizarTextoChave(c.role) !== "",
  );
}

/** Dos pendentes, os que o vínculo exato resolveria agora (o botão "Vincular exatas"). */
export function pendentesResolviveis<T extends ColaboradorComFuncao>(
  colaboradores: readonly T[],
  catalogo: readonly FuncaoDoCatalogo[],
): T[] {
  return pendentesDeFuncao(colaboradores).filter(
    (c) => funcaoPorTextoExato(c.role, catalogo) !== null,
  );
}

export interface AlocacaoComFuncao {
  job_function_id?: string | null;
}

export type OrigemDaFuncao = "alocacao" | "padrao" | "nenhuma";

/**
 * A função a MOSTRAR de uma alocação: a da própria alocação ou, sem ela, a padrão do colaborador.
 * É informativa: não calcula nada. Para preço (FIN-PR-07) a função trabalhada em cada dia precisará
 * de snapshot próprio no apontamento; esta leitura muda quando o cadastro muda e por isso nunca
 * pode alimentar um valor já faturado.
 */
export function funcaoEfetiva(
  alocacao: AlocacaoComFuncao | null,
  colaborador: Pick<ColaboradorComFuncao, "job_function_id"> | null,
): { funcaoId: string | null; origem: OrigemDaFuncao } {
  const daAlocacao = alocacao?.job_function_id ?? null;
  if (daAlocacao !== null) return { funcaoId: daAlocacao, origem: "alocacao" };
  const padrao = colaborador?.job_function_id ?? null;
  if (padrao !== null) return { funcaoId: padrao, origem: "padrao" };
  return { funcaoId: null, origem: "nenhuma" };
}

/**
 * Função inicial de uma alocação NOVA: herda a padrão do colaborador (se ainda ativa). O valor vai
 * explícito no INSERT e o administrador pode trocá-lo; o banco não herda sozinho.
 */
export function funcaoInicialDaAlocacao(
  colaborador: Pick<ColaboradorComFuncao, "job_function_id">,
  catalogo: readonly FuncaoDoCatalogo[],
): string | null {
  const padrao = colaborador.job_function_id ?? null;
  if (padrao === null) return null;
  return catalogo.some((f) => f.id === padrao && f.active) ? padrao : null;
}

/** Nome da função (ou "—") para exibição. */
export function nomeDaFuncao(
  catalogo: readonly FuncaoDoCatalogo[],
  id: string | null | undefined,
): string {
  if (!id) return "—";
  return catalogo.find((f) => f.id === id)?.name ?? "—";
}

/**
 * Campo de função do colaborador no payload: só com o anúncio do banco. Sem ele o payload é o de
 * antes da 039 (a coluna não existe).
 */
export function camposDeFuncaoDoColaborador(
  funcaoId: string | null,
  habilitado: boolean,
): Record<string, string | null> {
  return habilitado ? { job_function_id: funcaoId } : {};
}

/** Campo de período do turno no payload: só com o anúncio do banco. */
export function camposDePeriodoDoTurno(
  periodo: PeriodoDoTurno | null,
  habilitado: boolean,
): Record<string, string | null> {
  return habilitado ? { shift_period: periodo } : {};
}

export interface LinhaDeAlocacao {
  operation_id: string;
  employee_id: string;
  shift_id: string | null;
  active: true;
  job_function_id?: string | null;
}

/** Alocação nova: a função (herdada ou escolhida) vai explícita, só com o anúncio do banco. */
export function montarAlocacao(
  base: { operationId: string; employeeId: string; shiftId: string | null },
  funcaoId: string | null,
  habilitado: boolean,
): LinhaDeAlocacao {
  return {
    operation_id: base.operationId,
    employee_id: base.employeeId,
    shift_id: base.shiftId,
    active: true,
    ...(habilitado ? { job_function_id: funcaoId } : {}),
  };
}

export function ehPeriodoDoTurno(valor: unknown): valor is PeriodoDoTurno {
  return valor === "diurno" || valor === "noturno";
}

/** Período do turno de uma linha (nulo = ainda não classificado; coluna ausente = banco antigo). */
export function periodoDoTurno(turno: { shift_period?: string | null }): PeriodoDoTurno | null {
  const p = turno.shift_period ?? null;
  return ehPeriodoDoTurno(p) ? p : null;
}

/**
 * Turno NOVO exige classificação explícita quando o banco a suporta; turno existente pode seguir
 * sem (histórico a confirmar). Lista vazia = pode enviar.
 */
export function validarPeriodoDoTurno(
  periodo: PeriodoDoTurno | null,
  turnoNovo: boolean,
  habilitado: boolean,
): string[] {
  if (habilitado && turnoNovo && periodo === null) {
    return ["Escolha o período do turno: diurno ou noturno."];
  }
  return [];
}
