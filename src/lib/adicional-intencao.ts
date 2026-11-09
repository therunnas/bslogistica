/**
 * Intenção de registro de um adicional (FIN-20D, migration 047).
 *
 * A CHAVE de idempotência identifica a INTENÇÃO "registrar este adicional", não a tela nem o clique:
 *   - duplo clique, reenvio e retry depois de timeout reutilizam a MESMA chave (o banco devolve o
 *     adicional que já gravou, sem duplicar);
 *   - dados diferentes não descartam marcador pendente: primeiro reconciliar, sem gerar outra chave;
 *   - uma operação legítima nova parte do zero somente após confirmação/reconciliação da anterior.
 *
 * A assinatura de payload abaixo só existe em memória. O fluxo de recuperação persiste exclusivamente
 * chave e indicação de fallback legado, por identidade, antes do envio; nunca persiste valores ou motivos.
 */

export type IntencaoDeAdicional = { readonly chave: string; readonly assinatura: string };

type Parametros = Record<string, string | number | null | undefined>;

/** JSON canônico: mesmas chaves e valores, em qualquer ordem, dão a mesma assinatura. */
export function assinaturaDoRegistro(params: Parametros): string {
  const ordenado: Record<string, string | number | null> = {};
  for (const nome of Object.keys(params).sort()) {
    const valor = params[nome];
    if (valor !== undefined) ordenado[nome] = valor;
  }
  return JSON.stringify(ordenado);
}

/**
 * Comparação em memória mantida para os testes do contrato original. Não autoriza o envio:
 * a barreira de recuperação abaixo prevalece sobre qualquer chave nova deste helper.
 */
export function intencaoParaTentativa(
  atual: IntencaoDeAdicional | null,
  params: Parametros,
  gerarChave: () => string = () => crypto.randomUUID(),
): IntencaoDeAdicional {
  const assinatura = assinaturaDoRegistro(params);
  if (atual !== null && atual.assinatura === assinatura) return atual;
  return { chave: gerarChave(), assinatura };
}

type StorageDeIntencao = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Marcador = { chave: string; legado: boolean };
type GerenciadorDeLocks = Pick<LockManager, "request">;
/** Executa `fn` com exclusão mútua nomeada entre TODAS as abas da origem, ou falha sem executá-la. */
export type Exclusao = <T>(nome: string, fn: () => Promise<T>) => Promise<T>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARCADOR_INVALIDO = "Intenção inválida: reconciliação administrativa necessária.";

/**
 * SQLSTATEs que `registrar_adicional` (038, a RPC legada) levanta por contrato. Um erro com um destes códigos
 * chegou do banco com a transação DESFEITA: nada foi gravado, então a tentativa pode ser corrigida e repetida.
 * Qualquer outro desfecho (timeout, rede, gateway, PGRST*, classe 08) é DESCONHECIDO e continua bloqueando.
 */
const RECUSAS_TRANSACIONAIS_LEGADO = new Set([
  "22023",
  "23505",
  "23514",
  "23P01",
  "28000",
  "40001",
  "42501",
  "55000",
  "P0002",
]);

/**
 * Exclusão entre abas por Web Locks: o lock é por usuário, nunca espera (`ifAvailable`) e é solto pelo próprio
 * navegador quando a aba fecha. Sem a API, ou com qualquer falha ao obtê-lo, nada é enviado: sem exclusão
 * não há como afirmar que duas abas não enviarão a mesma intenção ao mesmo tempo.
 */
export function criarExclusaoEntreAbas(locks: GerenciadorDeLocks | undefined): Exclusao {
  return async (nome, fn) => {
    if (!locks) {
      throw new Error(
        "Este navegador não permite garantir um único envio entre abas. Nada foi enviado.",
      );
    }
    return locks.request(nome, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        throw new Error(
          "Há um envio de adicional em andamento (outra aba ou clique anterior). Aguarde a confirmação.",
        );
      }
      return fn();
    });
  };
}

function lerMarcador(bruto: string): Marcador {
  let marcador: unknown;
  try {
    marcador = JSON.parse(bruto);
  } catch {
    throw new Error(MARCADOR_INVALIDO);
  }
  const m = marcador as Marcador | null;
  if (
    typeof m !== "object" ||
    m === null ||
    Object.keys(m).sort().join() !== "chave,legado" ||
    typeof m.chave !== "string" ||
    !UUID.test(m.chave) ||
    typeof m.legado !== "boolean"
  ) {
    throw new Error(MARCADOR_INVALIDO);
  }
  return { chave: m.chave, legado: m.legado };
}

/** Persiste só chave/modo por identidade, em armazenamento que sobrevive ao fechamento da aba e é
 * compartilhado entre abas; a exclusão entre elas é de `deps.exclusivo`. Ausência na 047 permite SOMENTE a mesma chave.
 * No legado, ausência não prova que um envio em andamento não vai confirmar: bloqueia.
 * Registro localizado encerra a tentativa com aviso, exigindo outra ação explícita para criar outro.
 */
export async function executarIntencaoDeAdicional(deps: {
  storage: StorageDeIntencao;
  userId: string;
  exclusivo: Exclusao;
  gerar: () => string;
  consultar: (chave: string) => Promise<string | null>;
  registrar: (chave: string, marcarLegado: () => void) => Promise<string>;
}): Promise<string> {
  if (!UUID.test(deps.userId)) throw new Error("Sessão inválida.");
  const key = `bs:adicional:intencao:v1:${deps.userId}`;
  return deps.exclusivo(key, async () => {
    const bruto = deps.storage.getItem(key);
    let marcador: Marcador;
    if (bruto !== null) {
      marcador = lerMarcador(bruto);
      if (marcador.legado) {
        throw new Error(
          "Envio anterior sem confirmação no banco legado. Reconciliação administrativa necessária antes de registrar outro adicional.",
        );
      }
      const localizado = await deps.consultar(marcador.chave);
      if (localizado !== null) {
        deps.storage.removeItem(key);
        throw new Error(
          `O adicional anterior já foi registrado (${localizado}). Confira a lista. Para uma operação distinta, faça um novo envio.`,
        );
      }
    } else {
      marcador = { chave: deps.gerar(), legado: false };
      if (!UUID.test(marcador.chave)) throw new Error("Chave inválida.");
    }
    deps.storage.setItem(key, JSON.stringify(marcador));
    let id: string;
    try {
      id = await deps.registrar(marcador.chave, () => {
        marcador.legado = true;
        deps.storage.setItem(key, JSON.stringify(marcador));
      });
    } catch (erro) {
      // Recusa SQL explícita é transacional, portanto não confirmou a gravação.
      const code =
        typeof erro === "object" && erro !== null ? (erro as { code?: string }).code : undefined;
      if (marcador.legado && RECUSAS_TRANSACIONAIS_LEGADO.has(code ?? ""))
        deps.storage.removeItem(key);
      throw erro;
    }
    deps.storage.removeItem(key);
    return id;
  });
}
