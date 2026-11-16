/**
 * O que a tela de Apontamentos envia ao banco, e quais linhas ela envia (C05-B4.3A).
 *
 * Duas regras, ambas sobre o salvamento:
 *
 * 1. SÓ COLUNAS EDITÁVEIS. O formulário não digita valor financeiro nenhum: receita, custo,
 *    minutos trabalhados, extras e snapshots saem do cálculo do banco
 *    (`derivar_valores_financeiros`). Mandá-los no upsert era inútil — o banco os
 *    sobrescreve — e perigoso: quando o contrato é reajustado, a prévia da tela passa a
 *    divergir do que está gravado, e reenviar uma linha tocada sem mudança real é recusado
 *    com `42501` ("Valores financeiros ... não podem ser alterados diretamente"), perdendo
 *    todas as outras linhas do mesmo salvamento. Seguem como chaves de contexto só
 *    `operation_id` e `work_date`, que o tipo gerado do Supabase exige no INSERT: o banco os
 *    sobrescreve com os da folha (`sincronizar_chave_da_diaria`), então não decidem nada.
 *
 * 2. SÓ LINHAS ALTERADAS. Uma linha existente só entra no salvamento se o usuário a tocou
 *    E ela difere do que o servidor tem, depois de normalizar (`08:00` = `08:00:00`; nota
 *    nula = nota vazia). Linha nova entra sempre: salvar cria o apontamento do dia.
 *    Linha faturada nunca entra: é imutável no banco.
 *
 * O upsert do PostgREST monta o INSERT com a UNIÃO das chaves de todas as linhas e preenche
 * a chave ausente com NULL. Uma linha nova sem `id` junto de uma existente com `id` falhava
 * com `23502` (id nulo). Por isso TODA linha leva `id`; as novas ganham um uuid gerado aqui,
 * e o `ON CONFLICT (id)` do upsert decide entre inserir e atualizar.
 *
 * Este módulo não importa nada em tempo de execução, para que a suíte Node o execute de
 * verdade.
 */

import type { AttendanceStatus } from "./billing";

/** A linha do rascunho da tela. */
export interface LinhaDoApontamento {
  employeeId: string;
  entryId: string | undefined;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  notes: string;
}

/** O que o servidor tem para a linha: só os campos que esta lógica compara. */
export interface ApontamentoGravado {
  id: string;
  employee_id: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  notes: string | null;
  invoice_id?: string | null;
}

/** Exatamente as colunas enviadas. Nada além disto vai no upsert. */
export interface CargaDeApontamento {
  id: string;
  timesheet_id: string;
  employee_id: string;
  operation_id: string;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  notes: string | null;
}

export const COLUNAS_ENVIADAS = [
  "id",
  "timesheet_id",
  "employee_id",
  "operation_id",
  "work_date",
  "status",
  "check_in",
  "check_out",
  "break_minutes",
  "notes",
] as const;

/** `"08:00"` e `"08:00:00"` são o mesmo horário para quem aponta. */
export const soHoraEMinuto = (valor: string | null | undefined): string =>
  (valor ?? "").slice(0, 5);

const intervaloNormalizado = (valor: number): number => (Number.isFinite(valor) ? valor : 0);

/** Falta não tem horário: o que for digitado nos campos não é gravado. */
function horarioEfetivo(status: AttendanceStatus, valor: string): string {
  return status === "absent" ? "" : soHoraEMinuto(valor);
}

/**
 * A linha difere do que o servidor tem?
 *
 * Compara o que seria GRAVADO (horário de falta é sempre nulo), não o que está digitado.
 */
export function linhaFoiAlterada(linha: LinhaDoApontamento, gravado: ApontamentoGravado): boolean {
  return (
    gravado.status !== linha.status ||
    soHoraEMinuto(gravado.check_in) !== horarioEfetivo(linha.status, linha.checkIn) ||
    soHoraEMinuto(gravado.check_out) !== horarioEfetivo(linha.status, linha.checkOut) ||
    intervaloNormalizado(gravado.break_minutes) !== intervaloNormalizado(linha.breakMinutes) ||
    (gravado.notes ?? "") !== linha.notes
  );
}

/**
 * Uma linha JÁ GRAVADA tem alteração real? É o critério único do salvamento e da prévia de
 * preço: tocar na linha não basta (editar e devolver o valor original deixa a linha em
 * `tocadas`, mas sem diferença), e o que conta é o que seria gravado.
 *
 * Se o servidor não tem mais a linha (leitura velha), vale como alterada: não há como provar
 * que é idêntica. Linha sem `entryId` não é "gravada": a pergunta não se aplica (`false`).
 */
export function linhaGravadaFoiAlterada(
  linha: LinhaDoApontamento,
  tocadas: ReadonlySet<string>,
  gravado: ApontamentoGravado | undefined,
): boolean {
  if (!linha.entryId || !tocadas.has(linha.employeeId)) {
    return false;
  }

  return gravado ? linhaFoiAlterada(linha, gravado) : true;
}

/**
 * As linhas que o salvamento envia, na ordem em que vieram.
 *
 * - sem `entryId`: nova, entra sempre;
 * - com `entryId`: entra se foi tocada (`tocadas`) e difere do gravado; se o servidor não
 *   tem mais a linha (leitura velha), entra, porque não há como provar que é idêntica;
 * - faturada: nunca entra.
 */
export function linhasParaSalvar(
  linhas: readonly LinhaDoApontamento[],
  tocadas: ReadonlySet<string>,
  gravados: readonly ApontamentoGravado[],
): LinhaDoApontamento[] {
  const porColaborador = new Map(gravados.map((g) => [g.employee_id, g]));

  return linhas.filter((linha) => {
    const gravado = porColaborador.get(linha.employeeId);

    if (gravado?.invoice_id) {
      return false;
    }

    if (!linha.entryId) {
      return true;
    }

    return linhaGravadaFoiAlterada(linha, tocadas, gravado);
  });
}

/** Linhas que o banco recusaria por já estarem faturadas. */
export function colaboradoresFaturados(
  gravados: readonly ApontamentoGravado[],
): ReadonlySet<string> {
  return new Set(gravados.filter((g) => g.invoice_id).map((g) => g.employee_id));
}

/**
 * A carga de uma linha. `gerarId` só é chamado para linha nova.
 */
export function montarCarga(
  linha: LinhaDoApontamento,
  contexto: { timesheetId: string; operationId: string; workDate: string },
  gerarId: () => string,
): CargaDeApontamento {
  const ausente = linha.status === "absent";

  return {
    id: linha.entryId ?? gerarId(),
    timesheet_id: contexto.timesheetId,
    employee_id: linha.employeeId,
    operation_id: contexto.operationId,
    work_date: contexto.workDate,
    status: linha.status,
    check_in: ausente || !linha.checkIn ? null : `${soHoraEMinuto(linha.checkIn)}:00`,
    check_out: ausente || !linha.checkOut ? null : `${soHoraEMinuto(linha.checkOut)}:00`,
    break_minutes: intervaloNormalizado(linha.breakMinutes),
    notes: linha.notes || null,
  };
}

// ---------------------------------------------------------------------------
// C07 — salvamento do administrador: rascunho, contexto e concorrência
//
// Tudo puro. A tela só chama estas funções; nenhuma regra de "o que está sujo" fica no componente.

/** O que o salvamento leva de UMA linha, em forma comparável (mesma normalização de `montarCarga`). */
export function assinaturaDaLinha(linha: LinhaDoApontamento): string {
  const ausente = linha.status === "absent";
  return JSON.stringify([
    linha.employeeId,
    linha.status,
    ausente ? "" : soHoraEMinuto(linha.checkIn),
    ausente ? "" : soHoraEMinuto(linha.checkOut),
    intervaloNormalizado(linha.breakMinutes),
    linha.notes,
  ]);
}

/** As assinaturas, por colaborador, das linhas que ESTE salvamento levou. */
export function assinaturasSalvas(
  linhas: readonly LinhaDoApontamento[],
): ReadonlyMap<string, string> {
  return new Map(linhas.map((linha) => [linha.employeeId, assinaturaDaLinha(linha)]));
}

/**
 * Carga da RPC `salvar_apontamento_admin`: só as colunas editáveis, sem id, sem folha, sem
 * contexto. A folha e a identidade da linha (colaborador na folha) são do banco.
 */
export function montarCargaDaRpc(
  linhas: readonly LinhaDoApontamento[],
  /**
   * Função trabalhada (FIN-PR-07), por colaborador, só para linhas NOVAS e só quando o banco grava
   * snapshots de função (migration 040). Sem o mapa o payload é o de antes: o banco antigo não tem a
   * coluna e a RPC antiga ignoraria a chave. Linha existente nunca leva a função: corrigir é a RPC
   * própria, com motivo.
   */
  funcoesDoDia?: ReadonlyMap<string, string>,
) {
  return linhas.map((linha) => {
    const ausente = linha.status === "absent";
    const funcao = funcoesDoDia?.get(linha.employeeId);
    return {
      employee_id: linha.employeeId,
      status: linha.status,
      check_in: ausente || !linha.checkIn ? null : `${soHoraEMinuto(linha.checkIn)}:00`,
      check_out: ausente || !linha.checkOut ? null : `${soHoraEMinuto(linha.checkOut)}:00`,
      break_minutes: intervaloNormalizado(linha.breakMinutes),
      notes: linha.notes || null,
      ...(funcao !== undefined && funcao !== "" && !ausente && linha.entryId === undefined
        ? { job_function_id: funcao }
        : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// D-CP05-02 (QA-BS-01) e GATE-FIN-06 — duas abas (ou duas pessoas) no mesmo dia
//
// Antes da 054 a tela lia o `updated_at` de cada linha e comparava com o que tinha visto, ANTES de
// chamar a RPC: uma conferência fora da transação, com uma janela entre ler e gravar. Com a 054 a
// versão é do banco (`timesheet_entries.versao`, mantida pelo gatilho) e a RPC v2 a confere sob
// `FOR UPDATE`, na mesma transação da gravação. A tela só informa a versão em que a pessoa
// COMEÇOU a editar cada linha; quem decide é o banco (40001). A versão nunca é inventada,
// incrementada nem inferida aqui: ou vem da leitura, ou é 0 (linha que não existe).

/** Versão de uma linha que ainda não existe no banco. */
export const VERSAO_NOVA = 0;

const ehVersaoGravada = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 1;

const ehVersaoEsperada = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0;

/**
 * A versão de uma linha no banco: a coluna `versao` do gravado; `VERSAO_NOVA` sem gravado.
 * `null` = DESCONHECIDA (banco sem a 054, ou leitura sem a coluna): a linha não pode ser enviada.
 */
export function versaoDoGravado(gravado: { versao?: unknown } | undefined): number | null {
  if (gravado === undefined) return VERSAO_NOVA;
  return ehVersaoGravada(gravado.versao) ? gravado.versao : null;
}

/**
 * As linhas do lote cuja versão de partida difere da versão atual no banco (outra sessão gravou).
 *
 * - `bases`: a versão em que a pessoa COMEÇOU a editar cada linha (registrada na 1ª edição);
 * - `mostradas`: a versão que a tela tem agora, para a linha que não foi editada;
 * - `atuais`: as versões lidas do banco.
 */
export function linhasEmConflito<V>(
  colaboradores: readonly string[],
  bases: ReadonlyMap<string, V>,
  mostradas: ReadonlyMap<string, V>,
  atuais: ReadonlyMap<string, V>,
  nova: V = VERSAO_NOVA as V,
): string[] {
  return colaboradores.filter((id) => {
    const base = bases.get(id) ?? mostradas.get(id) ?? nova;
    return (atuais.get(id) ?? nova) !== base;
  });
}

/** A versão que vai no envio: a da 1ª edição; sem edição, a mostrada; sem gravado, 0. */
export function versaoEsperadaDaLinha(
  employeeId: string,
  bases: ReadonlyMap<string, number | null>,
  mostradas: ReadonlyMap<string, number | null>,
): number | null {
  if (bases.has(employeeId)) return bases.get(employeeId) ?? null;
  if (mostradas.has(employeeId)) return mostradas.get(employeeId) ?? null;
  return VERSAO_NOVA;
}

export const MENSAGEM_CONFLITO_DE_VERSAO =
  "Este apontamento foi alterado por outra sessão (outra aba ou outra pessoa) depois que você o abriu. Nada foi gravado. O que você digitou foi mantido: revise as linhas marcadas e escolha, em cada uma, manter a sua alteração ou usar o que está gravado.";

export const MENSAGEM_BANCO_SEM_V2 =
  "O banco deste ambiente ainda não tem a versão exigida por esta tela (migration 054). Nada foi gravado. Avise o administrador do sistema.";

export const MENSAGEM_RESULTADO_INCERTO =
  "Não foi possível confirmar se o apontamento foi gravado (falha de conexão). O que você digitou foi mantido e os dados foram relidos: salvar de novo não duplica nem sobrescreve o que outra sessão gravou.";

export const MENSAGEM_VERSAO_DESCONHECIDA =
  "A versão de uma linha não pôde ser lida do banco. Nada foi gravado. Recarregue a página.";

/** Mensagem de conflito com os nomes (lista curta). */
export function mensagemDeConflito(nomes: readonly string[]): string {
  if (nomes.length === 0) return MENSAGEM_CONFLITO_DE_VERSAO;
  const quem =
    nomes.length > 3
      ? `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}`
      : nomes.join(", ");
  return `${MENSAGEM_CONFLITO_DE_VERSAO} (${quem})`;
}

/** As bases depois de uma edição: a 1ª edição registra a versão vista; desfazer a edição a esquece. */
export function basesAposEdicao<V>(
  bases: ReadonlyMap<string, V>,
  employeeId: string,
  continuaSuja: boolean,
  versaoMostrada: V,
): Map<string, V> {
  const novo = new Map(bases);
  if (!continuaSuja) novo.delete(employeeId);
  else if (!novo.has(employeeId)) novo.set(employeeId, versaoMostrada);
  return novo;
}

/** Só sobrevivem as bases das linhas que continuam sujas (as gravadas passam a valer o servidor). */
export function basesDasSujas<V>(
  bases: ReadonlyMap<string, V>,
  sujas: ReadonlySet<string>,
): Map<string, V> {
  return new Map([...bases].filter(([id]) => sujas.has(id)));
}

/**
 * Carga da RPC `salvar_apontamento_admin_v2`: a da v1 (`montarCargaDaRpc`) mais `versao_esperada`
 * por linha e `confirmar_virada: true` só nas linhas que o ADMINISTRADOR confirmou nesta tela.
 * Versão desconhecida ou fora do formato recusa o lote inteiro, antes de qualquer chamada.
 */
export function montarCargaDaRpcV2(
  linhas: readonly LinhaDoApontamento[],
  versaoEsperada: (employeeId: string) => unknown,
  funcoesDoDia?: ReadonlyMap<string, string>,
  viradasConfirmadas?: ReadonlySet<string>,
) {
  const base = montarCargaDaRpc(linhas, funcoesDoDia);
  return base.map((carga) => {
    const versao = versaoEsperada(carga.employee_id);
    if (!ehVersaoEsperada(versao)) {
      throw new ErroDeVersaoDesconhecida(MENSAGEM_VERSAO_DESCONHECIDA);
    }
    return {
      ...carga,
      versao_esperada: versao,
      ...(viradasConfirmadas?.has(carga.employee_id) ? { confirmar_virada: true as const } : {}),
    };
  });
}

/** Versão que não veio do banco: nenhuma linha é enviada. */
export class ErroDeVersaoDesconhecida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeVersaoDesconhecida";
  }
}

/** Retorno da RPC v2 fora do contrato: nunca tratado como gravação bem-sucedida. */
export class ErroDeContratoDoSalvamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeContratoDoSalvamento";
  }
}

export type ResultadoDaLinha = "inserido" | "atualizado" | "sem_alteracao";

export interface LinhaGravadaAdmin {
  employee_id: string;
  entry_id: string;
  versao: number;
  resultado: ResultadoDaLinha;
}

export interface ResultadoDoSalvamentoAdmin {
  timesheet_id: string;
  folha_criada: boolean;
  linhas: LinhaGravadaAdmin[];
}

const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULTADOS: readonly string[] = ["inserido", "atualizado", "sem_alteracao"];

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lê o retorno de `salvar_apontamento_admin_v2` (`{timesheet_id, folha_criada, linhas[]}`), campo a
 * campo, sem cast genérico. Cada colaborador enviado precisa voltar exatamente uma vez.
 */
export function lerResultadoDoSalvamentoAdmin(
  dados: unknown,
  enviados: readonly string[],
): ResultadoDoSalvamentoAdmin {
  const falha = (motivo: string): never => {
    throw new ErroDeContratoDoSalvamento(
      `Resposta inválida de salvar_apontamento_admin_v2: ${motivo}.`,
    );
  };
  if (!ehObjeto(dados)) return falha("não é um objeto");
  const { timesheet_id, folha_criada, linhas } = dados;
  if (typeof timesheet_id !== "string" || !FORMATO_DE_UUID.test(timesheet_id)) falha("folha");
  if (typeof folha_criada !== "boolean") falha("folha_criada");
  if (!Array.isArray(linhas)) return falha("linhas");
  const lidas = linhas.map((l) => {
    if (!ehObjeto(l)) return falha("linha");
    const { employee_id, entry_id, versao, resultado } = l;
    if (typeof employee_id !== "string" || !FORMATO_DE_UUID.test(employee_id)) falha("colaborador");
    if (typeof entry_id !== "string" || !FORMATO_DE_UUID.test(entry_id)) falha("apontamento");
    if (!ehVersaoGravada(versao)) falha("versão");
    if (typeof resultado !== "string" || !RESULTADOS.includes(resultado)) falha("resultado");
    return { employee_id, entry_id, versao, resultado } as LinhaGravadaAdmin;
  });
  const devolvidos = lidas.map((l) => l.employee_id).sort();
  if (JSON.stringify(devolvidos) !== JSON.stringify([...enviados].sort())) {
    falha("as linhas devolvidas não são as enviadas");
  }
  return {
    timesheet_id: timesheet_id as string,
    folha_criada: folha_criada as boolean,
    linhas: lidas,
  };
}

export type FalhaDoSalvamento =
  "conflito" | "banco_sem_v2" | "rede" | "contrato" | "versao" | "outra";

/**
 * Classifica a falha pelo SQLSTATE e pelo tipo, nunca pelo texto do banco: 40001 é conflito de
 * versão; PGRST202 é a função ausente (banco sem a 054); erro sem código com o texto do `fetch` é
 * falha de rede — e, numa gravação, resultado INCERTO (o banco pode ter gravado).
 */
export function classificarFalhaDoSalvamento(erro: unknown): FalhaDoSalvamento {
  if (erro instanceof ErroDeContratoDoSalvamento) return "contrato";
  if (erro instanceof ErroDeVersaoDesconhecida) return "versao";
  const e = ehObjeto(erro) ? erro : {};
  const codigo = typeof e["code"] === "string" ? e["code"] : "";
  const mensagem = typeof e["message"] === "string" ? e["message"] : "";
  if (codigo === "40001") return "conflito";
  if (codigo === "PGRST202") return "banco_sem_v2";
  if (
    codigo === "" &&
    /^(TypeError: )?(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/i.test(
      mensagem.trim(),
    )
  ) {
    return "rede";
  }
  return "outra";
}

/** O texto do sucesso, dizendo quando a linha já estava gravada (retentativa idempotente). */
export function mensagemDoResultado(resultado: ResultadoDoSalvamentoAdmin): string {
  const iguais = resultado.linhas.filter((l) => l.resultado === "sem_alteracao").length;
  if (iguais === 0) return "Apontamento salvo.";
  if (iguais === resultado.linhas.length) {
    return iguais === 1
      ? "Apontamento salvo. A linha já estava gravada assim: nada mudou."
      : `Apontamento salvo. As ${iguais} linhas já estavam gravadas assim: nada mudou.`;
  }
  return `Apontamento salvo. ${iguais} linha(s) já estava(m) gravada(s) assim.`;
}

/**
 * As bases depois de um salvamento: a linha que segue suja (editada enquanto salvava) passa a ter
 * como base a versão que ESTE salvamento gravou — a edição nova está sobre o que a própria pessoa
 * enviou. A linha limpa sai das bases (vale a versão do banco).
 */
export function basesAposSalvar(
  bases: ReadonlyMap<string, number | null>,
  dirty: ReadonlySet<string>,
  resultado: ResultadoDoSalvamentoAdmin,
): Map<string, number | null> {
  const versoes = new Map(resultado.linhas.map((l) => [l.employee_id, l.versao]));
  const novo = new Map<string, number | null>();
  for (const id of dirty) {
    if (versoes.has(id)) novo.set(id, versoes.get(id)!);
    else if (bases.has(id)) novo.set(id, bases.get(id)!);
  }
  return novo;
}

/**
 * Reconciliação com o banco: a linha suja que ficou IGUAL ao gravado deixa de ser pendência (a
 * gravação da resposta perdida, ou a mesma alteração feita por outra sessão). Nada é descartado:
 * o que está na tela é o que está no banco.
 */
export function dirtyReconciliado(
  dirty: ReadonlySet<string>,
  linhas: readonly LinhaDoApontamento[],
  gravados: readonly ApontamentoGravado[],
): Set<string> {
  const porColaborador = new Map(gravados.map((g) => [g.employee_id, g]));
  const restante = new Set(dirty);
  for (const linha of linhas) {
    const gravado = porColaborador.get(linha.employeeId);
    if (restante.has(linha.employeeId) && gravado && !linhaFoiAlterada(linha, gravado)) {
      restante.delete(linha.employeeId);
    }
  }
  return restante;
}

/**
 * O resultado de um salvamento só vale para o contexto (operação, turno e data) que o pediu. Um
 * retorno atrasado, depois de a pessoa trocar de contexto, não toca no rascunho de agora.
 */
export function deveAplicarResultado(contextoDaMutacao: string, contextoAtual: string): boolean {
  return contextoDaMutacao === contextoAtual;
}

/**
 * Quem continua "sujo" depois de um salvamento: só sai quem foi salvo E não mudou desde o envio.
 * Uma edição feita enquanto o salvamento corria (assinatura diferente) continua sendo pendência, e
 * a linha que não entrou no lote também.
 */
export function dirtyAposSalvar(
  dirty: ReadonlySet<string>,
  linhasAtuais: readonly LinhaDoApontamento[],
  salvas: ReadonlyMap<string, string>,
): Set<string> {
  const restante = new Set(dirty);
  for (const linha of linhasAtuais) {
    const enviada = salvas.get(linha.employeeId);
    if (enviada !== undefined && enviada === assinaturaDaLinha(linha)) {
      restante.delete(linha.employeeId);
    }
  }
  return restante;
}

/**
 * Depois de uma edição: a linha fica "suja" se difere do que o servidor tem; se a edição foi
 * integralmente desfeita (igual ao gravado), deixa de ser. Linha sem registro no servidor é suja
 * enquanto tiver uma decisão (status), e deixa de ser ao voltar a "não apontado".
 */
export function dirtyAposEdicao(
  dirty: ReadonlySet<string>,
  linha: Omit<LinhaDoApontamento, "status"> & { status: AttendanceStatus | null },
  gravado: ApontamentoGravado | undefined,
): Set<string> {
  const novo = new Set(dirty);
  const igualAoServidor =
    gravado !== undefined
      ? linha.status !== null &&
        linhaFoiAlterada({ ...linha, status: linha.status }, gravado) === false
      : linha.status === null;
  if (igualAoServidor) novo.delete(linha.employeeId);
  else novo.add(linha.employeeId);
  return novo;
}
