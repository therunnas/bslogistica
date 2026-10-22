/**
 * Tradução das recusas do banco que a interface sabe explicar (C05-A).
 *
 * A chave composta `operations_contrato_do_cliente_fkey` (migration 021) impede que
 * uma operação referencie o contrato de OUTRO cliente. O Postgres a recusa com
 * SQLSTATE 23503 e uma mensagem em inglês que não diz o que fazer. Os dois textos
 * abaixo são os que o banco devolveu de fato na suíte
 * `supabase/tests/016_integridade_cliente_contrato.sql` (casos I1 e I2); a suíte
 * `test:integridade-contratos` fixa a tradução contra eles.
 *
 * O banco continua sendo a barreira. Esta função só troca a mensagem: qualquer erro
 * que não seja essa recusa devolve o texto que já era mostrado.
 */

const CONSTRAINT_CLIENTE_CONTRATO = "operations_contrato_do_cliente_fkey";

export const MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE =
  "O contrato escolhido pertence a outro cliente. Escolha um contrato do mesmo cliente da operação ou deixe a operação sem contrato.";

export const MENSAGEM_CONTRATO_EM_USO =
  "Este contrato já é usado por operações do cliente atual, então o cliente dele não pode ser trocado. Crie um novo contrato para o outro cliente.";

/**
 * Recusa de jornada de turno que já tem apontamentos (23514 do trigger da migration 024, quando
 * habilitado). O texto do banco já é em português; a tela troca por esta explicação, que diz o que
 * fazer: criar um turno novo a partir do existente.
 */
export const MENSAGEM_TURNO_PROTEGIDO =
  "Este turno já tem apontamentos, então o horário e o intervalo dele não podem ser alterados: " +
  "isso mudaria o cálculo de dias já registrados. Crie um turno novo a partir deste e, depois, " +
  "inative o antigo. Nome e status continuam editáveis.";

/** O erro é a recusa de jornada de turno usado (23514 com a mensagem do trigger)? */
export function ehTurnoProtegido(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  const e = erro as { code?: unknown; message?: unknown };
  return (
    e.code === "23514" &&
    typeof e.message === "string" &&
    /turno j[aá] tem apontamentos|cadastre um turno novo/i.test(e.message)
  );
}

interface ErroDoBanco {
  message?: unknown;
  code?: unknown;
}

export function mensagemDoErro(erro: unknown): string {
  const e: ErroDoBanco = typeof erro === "object" && erro !== null ? (erro as ErroDoBanco) : {};
  const mensagem = typeof e.message === "string" ? e.message : "";

  if (e.code === "23503" && mensagem.includes(CONSTRAINT_CLIENTE_CONTRATO)) {
    // `UPDATE` de contracts: o Postgres fala da tabela referenciada. `INSERT` ou
    // `UPDATE` de operations: fala da tabela que referencia.
    return mensagem.startsWith('update or delete on table "contracts"')
      ? MENSAGEM_CONTRATO_EM_USO
      : MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE;
  }

  if (ehTurnoProtegido(erro)) {
    return MENSAGEM_TURNO_PROTEGIDO;
  }

  const traducao = traducaoDoCodigo(e.code, mensagem);
  if (traducao) {
    return traducao;
  }

  return mensagem || "Não foi possível concluir a operação.";
}

/**
 * Erros financeiros conhecidos das migrations 022 a 024 (vigências, turnos congelados e
 * apontamento): o SQLSTATE decide, nunca o texto.
 *
 * As funções e os triggers do projeto levantam mensagens JÁ em português e pensadas para a
 * tela ("Sem condições contratuais vigentes em …"): essas são mantidas. Só a mensagem crua do
 * PostgreSQL, em inglês e com nome de constraint, é trocada pelo texto genérico do código.
 * `42501` fica de fora: continua devolvendo o texto de sempre. Nenhuma mensagem aqui carrega
 * valor financeiro.
 */
const MENSAGENS_FINANCEIRAS: Readonly<Record<string, string>> = {
  P0002: "Não há registro ou vigência para os dados informados. Confira a data e o cadastro.",
  "55000": "Esta operação não é possível no estado atual do registro.",
  "23P01": "O período informado se sobrepõe a outro já cadastrado.",
  "22023": "Valor ou período inválido. Revise os campos informados.",
  "23514": "Os dados informados não atendem a uma regra de validação.",
};

const MENSAGEM_CRUA_DO_BANCO =
  /violates|constraint|permission denied|row-level security|does not exist|invalid input|duplicate key|null value|conflicting key/i;

function traducaoDoCodigo(codigo: unknown, mensagem: string): string | null {
  if (typeof codigo !== "string" || !(codigo in MENSAGENS_FINANCEIRAS)) {
    return null;
  }
  if (mensagem && !MENSAGEM_CRUA_DO_BANCO.test(mensagem)) {
    return mensagem;
  }
  return MENSAGENS_FINANCEIRAS[codigo] ?? null;
}
