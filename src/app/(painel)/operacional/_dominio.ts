/**
 * As decisões da tela operacional, separadas da tela.
 *
 * Tudo aqui é função pura: entra dado, sai dado, sem React, sem rede e sem
 * cliente do Supabase. É o que permite exercitar a junção da equipe com os
 * apontamentos, a detecção do que mudou e a tradução dos códigos de erro em
 * Node puro, do jeito que as outras suítes do projeto fazem — e é o que impede
 * que essas regras fiquem escondidas dentro de um componente de 400 linhas.
 *
 * O módulo não importa nenhum valor, só tipos, que somem na compilação.
 */

import type {
  ApontamentoDoOperador,
  EntradaDaLinha,
  MembroDaEquipeDoOperador,
  ResultadoDaGravacaoOperacional,
} from "@/lib/operacional/tipos";

/**
 * O que a tela sabe de uma leitura.
 *
 * `pendente` é a leitura INICIAL, aquela em que ainda não há resposta nenhuma
 * do servidor — e não o `isFetching`, que também fica verdadeiro durante um
 * refetch em segundo plano com dados válidos na tela. Confundir os dois
 * desmontaria a tabela a cada revalidação.
 */
export interface Leitura {
  pendente: boolean;
  erro: boolean;
  /** `undefined` enquanto não houver snapshot do servidor. */
  quantidade: number | undefined;
}

/**
 * Em que ponto do fluxo a tela está.
 *
 * Existe porque "sem dados" tem TRÊS causas que não podem se confundir:
 * ainda não chegou, falhou, ou chegou vazio. Tratar erro como lista vazia
 * diria "nenhum turno configurado" quando a rede caiu — e, pior, no caso dos
 * apontamentos faria toda a equipe parecer linha nova, liberando um salvamento
 * por cima de um estado do servidor que a tela não conhece.
 *
 * A ordem das perguntas é a do fluxo: sem operação não se pergunta por turno,
 * sem turno não se pergunta por equipe, e sem equipe não se pergunta pela
 * folha.
 */
export type FaseDaTela =
  | "selecionar"
  | "carregando"
  | "erro-turnos"
  | "erro-equipe"
  | "erro-apontamentos"
  | "sem-turno"
  | "sem-equipe"
  | "pronto";

const semSnapshot = (leitura: Leitura): boolean =>
  leitura.pendente || leitura.quantidade === undefined;

export function faseDaTela(entrada: {
  operationId: string | null;
  shiftId: string | null;
  turnos: Leitura;
  equipe: Leitura;
  apontamentos: Leitura;
}): FaseDaTela {
  const { operationId, shiftId, turnos, equipe, apontamentos } = entrada;

  if (!operationId) return "selecionar";

  if (turnos.erro) return "erro-turnos";
  if (semSnapshot(turnos)) return "carregando";
  if (turnos.quantidade === 0) return "sem-turno";

  if (!shiftId) return "selecionar";

  if (equipe.erro) return "erro-equipe";
  if (semSnapshot(equipe)) return "carregando";
  if (equipe.quantidade === 0) return "sem-equipe";

  // A folha é a última pergunta e a mais importante: é ela que diz o que já
  // existe no servidor. Sem a resposta, nada é editável.
  if (apontamentos.erro) return "erro-apontamentos";
  if (semSnapshot(apontamentos)) return "carregando";

  return "pronto";
}

/**
 * A tabela só é editável — e o payload só existe — na fase `pronto`.
 *
 * É a regra que impede gravar sobre estado desconhecido do servidor: enquanto a
 * leitura dos apontamentos não concluiu, ou falhou, não há o que comparar, e
 * toda linha pareceria nova.
 */
export const leituraConcluida = (fase: FaseDaTela): boolean => fase === "pronto";

/** O salvar exige tudo: fase pronta, folha aberta e alteração de verdade. */
export function podeSalvar(entrada: {
  fase: FaseDaTela;
  fechada: boolean;
  pendentes: number;
  salvando: boolean;
}): boolean {
  return (
    leituraConcluida(entrada.fase) && !entrada.fechada && !entrada.salvando && entrada.pendentes > 0
  );
}

/** Uma linha da tabela da tela, já pronta para edição. */
export interface LinhaDoRascunho {
  employee_id: string;
  employee_name: string;
  employee_role: string | null;
  /** Está na equipe ativa do turno? Só quem está pode ser gravado. */
  ativo: boolean;
  status: "present" | "absent" | "replacement";
  /** Vazio em vez de nulo: são campos de formulário controlado. */
  check_in: string;
  check_out: string;
  break_minutes: number;
  notes: string;
  /** Linha já vinculada a uma fatura. Booleano derivado, nunca o id. */
  faturado: boolean;
  /**
   * A versão da linha no banco quando ela entrou no rascunho (0 = ainda não existe). Numa linha
   * editada é a versão do INÍCIO da edição: é o que vai como `versao_esperada`, e é o que faz o
   * banco recusar (40001) a gravação feita sobre uma leitura antiga.
   */
  versao: number;
}

/**
 * Intervalo nunca é negativo.
 *
 * Isto é **UX**, não a regra: a autoridade é o
 * `CHECK (break_minutes >= 0)` da migration 014, que vale para o admin, para a
 * RPC e para qualquer caminho futuro. Aqui o valor é corrigido antes de virar
 * payload para que a pessoa veja o campo se ajustar em vez de receber um erro
 * do banco por um sinal de menos digitado sem querer.
 *
 * Sem teto: `break_minutes` maior que a jornada é decisão em aberto, registrada
 * no PROGRESS.md, e inventar 1440 aqui seria inventar regra de negócio.
 */
export function normalizarIntervalo(valor: number | string | null | undefined): number {
  const numero = typeof valor === "string" ? Number(valor) : (valor ?? 0);
  if (!Number.isFinite(numero)) return 0;
  return Math.max(0, Math.trunc(numero));
}

/** Seleciona sozinho só quando não há escolha a fazer. */
export function escolhaAutomatica<T extends { id: string }>(
  lista: readonly T[] | undefined,
): string | null {
  return lista?.length === 1 ? (lista[0] as T).id : null;
}

/**
 * A folha está fechada?
 *
 * `folha_status` vem repetido em toda linha da resposta — é da folha, não da
 * linha —, então a primeira basta. Sem folha ainda, nada está fechado.
 */
export function folhaEstaFechada(
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): boolean {
  return apontamentos?.[0]?.folha_status === "closed";
}

/** Indexa o que já está gravado, por colaborador. */
export function apontamentosPorColaborador(
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): Map<string, ApontamentoDoOperador> {
  const mapa = new Map<string, ApontamentoDoOperador>();
  for (const linha of apontamentos ?? []) {
    // Folha vazia chega como uma linha só de folha, com os campos de
    // apontamento nulos: é o LEFT JOIN da RPC, e não uma linha de verdade.
    if (linha.employee_id) mapa.set(linha.employee_id, linha);
  }
  return mapa;
}

/**
 * Junta a equipe do turno com o que já foi apontado.
 *
 * Quem está **inativo** na equipe só aparece se já tiver apontamento: a escrita
 * exige equipe ativa, então oferecer uma linha nova para quem saiu produziria
 * um `23514` garantido. O histórico, esse, continua visível — some da tela
 * quem nunca esteve, não quem deixou de estar.
 */
export function montarRascunho(
  equipe: readonly MembroDaEquipeDoOperador[] | undefined,
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
  intervaloPadrao: number,
): LinhaDoRascunho[] {
  const gravados = apontamentosPorColaborador(apontamentos);

  return (equipe ?? [])
    .filter((membro) => membro.active || gravados.has(membro.employee_id))
    .map((membro) => {
      const gravado = gravados.get(membro.employee_id);
      return {
        employee_id: membro.employee_id,
        employee_name: membro.employee_name,
        employee_role: membro.employee_role,
        ativo: membro.active,
        status: gravado?.status ?? "present",
        check_in: gravado?.check_in ?? "",
        check_out: gravado?.check_out ?? "",
        // Linha gravada manda no seu próprio intervalo; o padrão do turno
        // serve só para linha que ainda não existe. Com `??` aqui, uma
        // linha gravada sem intervalo pegaria o padrão e pareceria
        // alterada sem ninguém ter tocado nela.
        break_minutes: normalizarIntervalo(gravado ? gravado.break_minutes : intervaloPadrao),
        notes: gravado?.notes ?? "",
        faturado: gravado?.faturado ?? false,
        versao: gravado?.versao ?? 0,
      };
    });
}

// ---------------------------------------------------------------------------
// GATE-FIN-06 — o rascunho sobre a leitura v2 (versão da linha)
//
// O rascunho guarda só as linhas EDITADAS; as demais acompanham a leitura do banco. Cada linha
// editada guarda a versão de quando a edição começou. Se o banco já está em outra versão, a linha
// está em conflito: nada a regrava sem a pessoa decidir (manter a sua ou usar o gravado).

export type Editadas = ReadonlyMap<string, LinhaDoRascunho>;

/** Aplica uma edição: na 1ª, a linha entra no rascunho com a versão que a tela mostrava. */
export function aplicarEdicao(
  editadas: Editadas,
  base: readonly LinhaDoRascunho[],
  employeeId: string,
  mudanca: Partial<Omit<LinhaDoRascunho, "versao">>,
): Map<string, LinhaDoRascunho> {
  const atual = editadas.get(employeeId) ?? base.find((l) => l.employee_id === employeeId);
  const novo = new Map(editadas);
  if (atual) novo.set(employeeId, { ...atual, ...mudanca, versao: atual.versao });
  return novo;
}

/** O que a tela mostra: a linha editada no lugar da lida; as demais, como o banco as tem. */
export function linhasDaTela(
  base: readonly LinhaDoRascunho[],
  editadas: Editadas,
): LinhaDoRascunho[] {
  return base.map((l) => editadas.get(l.employee_id) ?? l);
}

const versaoNoBanco = (gravado: ApontamentoDoOperador | undefined): number => gravado?.versao ?? 0;

const mesmoConteudo = (linha: LinhaDoRascunho, gravado: ApontamentoDoOperador): boolean =>
  gravado.status === linha.status &&
  soHoraEMinuto(gravado.check_in) === soHoraEMinuto(linha.check_in) &&
  soHoraEMinuto(gravado.check_out) === soHoraEMinuto(linha.check_out) &&
  normalizarIntervalo(gravado.break_minutes) === normalizarIntervalo(linha.break_minutes) &&
  (gravado.notes ?? "") === linha.notes;

/** Linhas editadas cuja versão de partida não é mais a do banco (outra sessão gravou antes). */
export function conflitosDoRascunho(
  editadas: Editadas,
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): string[] {
  const gravados = apontamentosPorColaborador(apontamentos);
  return [...editadas.values()]
    .filter((l) => {
      const g = gravados.get(l.employee_id);
      if (g && mesmoConteudo(l, g)) return false;
      return l.versao !== versaoNoBanco(g);
    })
    .map((l) => l.employee_id);
}

/**
 * Reconciliação com a leitura: a linha editada que ficou igual ao banco (a resposta perdida, ou a
 * mesma alteração feita por outra sessão) sai do rascunho — não há o que gravar nela.
 */
export function editadasReconciliadas(
  editadas: Editadas,
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): Map<string, LinhaDoRascunho> {
  const gravados = apontamentosPorColaborador(apontamentos);
  return new Map(
    [...editadas].filter(([id, l]) => {
      const g = gravados.get(id);
      return !(g && mesmoConteudo(l, g));
    }),
  );
}

/**
 * Depois de gravar: a linha que continua igual ao que foi enviado sai do rascunho; a que foi
 * editada enquanto gravava fica, com a versão que ESTA gravação produziu (a edição nova está sobre
 * o que a própria pessoa enviou).
 */
export function editadasAposSalvar(
  editadas: Editadas,
  enviadas: readonly EntradaDaLinha[],
  resultado: ResultadoDaGravacaoOperacional,
): Map<string, LinhaDoRascunho> {
  const versoes = new Map(resultado.linhas.map((l) => [l.employee_id, l.versao]));
  const porColaborador = new Map(enviadas.map((e) => [e.employee_id, e]));
  const novo = new Map<string, LinhaDoRascunho>();
  for (const [id, linha] of editadas) {
    const enviada = porColaborador.get(id);
    const versao = versoes.get(id);
    if (!enviada || versao === undefined) {
      novo.set(id, linha);
      continue;
    }
    const igual =
      enviada.status === linha.status &&
      soHoraEMinuto(enviada.check_in) === soHoraEMinuto(linha.check_in) &&
      soHoraEMinuto(enviada.check_out) === soHoraEMinuto(linha.check_out) &&
      normalizarIntervalo(enviada.break_minutes) === normalizarIntervalo(linha.break_minutes) &&
      (enviada.notes ?? "") === linha.notes;
    if (!igual) novo.set(id, { ...linha, versao });
  }
  return novo;
}

/** Decisão explícita: manter a alteração da pessoa sobre a versão ATUAL do banco. */
export function manterMinhaAlteracao(
  editadas: Editadas,
  employeeId: string,
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): Map<string, LinhaDoRascunho> {
  const linha = editadas.get(employeeId);
  const novo = new Map(editadas);
  if (linha) {
    novo.set(employeeId, {
      ...linha,
      versao: versaoNoBanco(apontamentosPorColaborador(apontamentos).get(employeeId)),
    });
  }
  return novo;
}

/** Decisão explícita: descartar a alteração da pessoa e ficar com o que está gravado. */
export function usarOGravado(editadas: Editadas, employeeId: string): Map<string, LinhaDoRascunho> {
  const novo = new Map(editadas);
  novo.delete(employeeId);
  return novo;
}

/** `"08:00"` e `"08:00:00"` são o mesmo horário para quem aponta. */
const soHoraEMinuto = (valor: string | null | undefined): string => (valor ?? "").slice(0, 5);

const vazioComoNulo = (valor: string): string | null => (valor.trim() === "" ? null : valor);

/**
 * O que mudou, e só o que mudou.
 *
 * Linha ausente do payload é linha **não tocada** — a RPC não apaga nada —,
 * então mandar a tabela inteira a cada salvamento reescreveria linhas que
 * ninguém editou, e cada reescrita dispara de novo a derivação financeira da
 * migration 010. Linha faturada e colaborador inativo ficam de fora sempre: a
 * primeira é imutável desde a 011 e a segunda seria recusada por não estar na
 * equipe ativa.
 */
export function linhasAlteradas(
  rascunho: readonly LinhaDoRascunho[],
  apontamentos: readonly ApontamentoDoOperador[] | undefined,
): EntradaDaLinha[] {
  const gravados = apontamentosPorColaborador(apontamentos);

  return rascunho
    .filter((linha) => !linha.faturado && linha.ativo)
    .filter((linha) => {
      const gravado = gravados.get(linha.employee_id);
      if (!gravado) return true;
      return (
        gravado.status !== linha.status ||
        soHoraEMinuto(gravado.check_in) !== soHoraEMinuto(linha.check_in) ||
        soHoraEMinuto(gravado.check_out) !== soHoraEMinuto(linha.check_out) ||
        normalizarIntervalo(gravado.break_minutes) !== normalizarIntervalo(linha.break_minutes) ||
        (gravado.notes ?? "") !== linha.notes
      );
    })
    .map((linha) => ({
      employee_id: linha.employee_id,
      status: linha.status,
      check_in: vazioComoNulo(linha.check_in),
      check_out: vazioComoNulo(linha.check_out),
      break_minutes: normalizarIntervalo(linha.break_minutes),
      notes: vazioComoNulo(linha.notes),
      versao_esperada: linha.versao,
    }));
}

/**
 * Traduz o erro em mensagem, pelo SQLSTATE — nunca pelo texto.
 *
 * O código é categoria de UX, e só isso: **autorização continua no banco e nos
 * guards**, e classificar exceção por substring de mensagem traduzível seria
 * frágil e errado.
 *
 * As mensagens são deliberadamente genéricas dentro de cada código, porque o
 * SQLSTATE sozinho não identifica a causa:
 *
 *   - `42501` cobre operação não autorizada, folha fechada E apontamento já
 *     faturado;
 *   - `23514` cobre turno de outra operação, colaborador fora da equipe ativa
 *     E, desde a migration 014, intervalo negativo — mais qualquer CHECK que
 *     venha a existir.
 *
 * Afirmar uma causa específica daria explicação errada na cara do usuário. O
 * que a tela sabe com certeza — folha fechada, linha faturada — ela mostra
 * antes, pela leitura, e não por dedução de erro.
 */
export const MENSAGEM_CONFLITO_DO_OPERADOR =
  "Este apontamento foi alterado por outra sessão depois que você o abriu. Nada foi gravado. O que você digitou foi mantido: em cada linha marcada, escolha manter a sua alteração ou usar o que está gravado.";

export const MENSAGEM_BANCO_SEM_V2_DO_OPERADOR =
  "O banco deste ambiente ainda não tem a versão exigida por esta tela (migration 054). Nada foi gravado. Avise o administrador.";

/**
 * Virada da meia-noite fora de turno que vira o dia: só o administrador a confirma (054). O
 * operador não tem como registrar a confirmação, e a tela não finge que tem.
 */
export const MENSAGEM_VIRADA_DO_OPERADOR =
  "Saída antes da entrada num turno que não atravessa a meia-noite. Só o administrador pode confirmar uma jornada assim: corrija o horário ou peça ao administrador que registre e confirme este lançamento. O que você digitou foi mantido.";

export function mensagemDeErro(erro: unknown): string {
  const codigo =
    typeof erro === "object" && erro !== null && "code" in erro
      ? String((erro as { code?: unknown }).code ?? "")
      : "";

  switch (codigo) {
    // GATE-FIN-06 (054): versão obsoleta com conteúdo diferente. Nada foi gravado.
    case "40001":
      return MENSAGEM_CONFLITO_DO_OPERADOR;
    // A RPC v2 não existe neste banco: o app novo exige a migration 054. Sem caminho antigo.
    case "PGRST202":
      return MENSAGEM_BANCO_SEM_V2_DO_OPERADOR;
    case "42501":
      return "Este apontamento não pode ser alterado, ou você não tem acesso a esta operação. Atualize os dados e tente novamente.";
    case "23514":
      return "Não foi possível salvar: os dados não são válidos para esta operação. Revise turno, equipe e intervalo.";
    case "22023":
      return "Dados do apontamento inválidos. Revise os campos informados.";
    case "23505":
      return "Já existe um registro conflitante para este apontamento. Atualize os dados e tente novamente.";
    // Condições financeiras da data (migrations 022 a 024). Texto fixo, sem valor: o operador
    // não vê taxa, custo nem margem, e a correção é do administrador.
    case "P0002":
      return "Não há condições financeiras cadastradas para esta data. Avise o administrador.";
    case "55000":
      return "Este apontamento não pode ser alterado no estado atual. Atualize os dados e tente novamente.";
    case "23P01":
      return "Há um conflito no cadastro de períodos. Avise o administrador.";
    default: {
      const mensagem = erro instanceof Error ? erro.message : "";
      // Falha de rede numa gravação: o banco pode ter gravado. Salvar de novo é seguro — a v2 não
      // duplica e devolve `sem_alteracao` se o conteúdo já estiver lá.
      if (
        codigo === "" &&
        /^(TypeError: )?(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/i.test(
          mensagem.trim(),
        )
      ) {
        return "Não foi possível confirmar se o apontamento foi gravado (falha de conexão). O que você digitou foi mantido e os dados foram relidos: salvar de novo não duplica nem sobrescreve o que outra sessão gravou.";
      }
      return mensagem || "Não foi possível salvar o apontamento. Tente novamente.";
    }
  }
}
