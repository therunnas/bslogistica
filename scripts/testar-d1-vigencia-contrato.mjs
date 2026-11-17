/**
 * Gate C · D1 · migration 055 — vigência do contrato: o que a aplicação mostra e a forma da migration.
 *
 * COMO RODAR:
 *
 *   npm run test:d1-vigencia-contrato
 *
 * A REGRA mora no banco (gatilho e CHECK da 055) e é provada pela suíte SQL
 * `supabase/tests/055_vigencia_do_contrato.sql`. Aqui:
 *   A. o operador recebe um texto próprio quando o 23514 vem da vigência (detalhe
 *      `vigencia_do_contrato`), sem ver contrato nem datas; os outros 23514 seguem como antes;
 *   B. o admin vê a mensagem do banco como ela vem (português, sem texto cru do PostgreSQL);
 *   C. os limites de ano da tela de contratos são os mesmos do CHECK da 055;
 *   D. a forma da migration: envelope, NOT VALID, nenhuma escrita em dado, função protegida, sem
 *      isenção por papel.
 * Sem rede, sem banco.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (arquivo) => readFileSync(path.join(RAIZ, arquivo), "utf8");

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
    console.log(
      `  FAIL  ${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`,
    );
  }
}

const operacional = await import("../src/app/(painel)/operacional/_dominio.ts");
const erros = await import("../src/lib/erros-banco.ts");
const clientes = await import("../src/app/(painel)/clientes/_dominio.ts");

const MENSAGEM_DO_BANCO =
  "A data 21/03/2026 está fora da vigência do contrato desta operação (de 02/03/2026 até 20/03/2026). Lance só datas dentro da vigência ou ajuste a vigência do contrato.";

console.log("\nA. Operador");
verificar(
  "A1. 23514 com detalhe vigencia_do_contrato vira o texto da vigência",
  operacional.mensagemDeErro({
    code: "23514",
    message: MENSAGEM_DO_BANCO,
    details: "vigencia_do_contrato",
  }),
  operacional.MENSAGEM_FORA_DA_VIGENCIA_DO_OPERADOR,
);
verificar(
  "A2. o texto do operador não mostra contrato nem datas",
  /\d{2}\/\d{2}\/\d{4}|contrato "/.test(operacional.MENSAGEM_FORA_DA_VIGENCIA_DO_OPERADOR),
  false,
);
verificar(
  "A3. outro 23514 (turno, equipe, intervalo) segue com o texto de antes",
  operacional.mensagemDeErro({ code: "23514", message: "x", details: "" }),
  "Não foi possível salvar: os dados não são válidos para esta operação. Revise turno, equipe e intervalo.",
);
verificar(
  "A4. o detalhe sozinho, sem o 23514, não decide nada",
  operacional.mensagemDeErro({ code: "42501", details: "vigencia_do_contrato" }) ===
    operacional.MENSAGEM_FORA_DA_VIGENCIA_DO_OPERADOR,
  false,
);

console.log("\nB. Admin");
verificar(
  "B1. a mensagem da 055 chega à tela do admin como o banco a escreveu",
  erros.mensagemDoErro({
    code: "23514",
    message: MENSAGEM_DO_BANCO,
    details: "vigencia_do_contrato",
  }),
  MENSAGEM_DO_BANCO,
);
verificar(
  "B2. a do contrato antigo inválido também",
  erros.mensagemDoErro({
    code: "23514",
    message:
      "O contrato desta operação tem fim (01/01/0001) antes do início (01/11/2026): nenhuma data está dentro da vigência. Corrija as datas do contrato antes de lançar.",
  }),
  "O contrato desta operação tem fim (01/01/0001) antes do início (01/11/2026): nenhuma data está dentro da vigência. Corrija as datas do contrato antes de lançar.",
);
verificar(
  "B3. o CHECK do contrato (texto cru do PostgreSQL) vira o texto genérico — a tela já confere antes",
  erros.mensagemDoErro({
    code: "23514",
    message:
      'new row for relation "contracts" violates check constraint "contracts_vigencia_valida"',
  }),
  "Os dados informados não atendem a uma regra de validação.",
);

console.log("\nC. Tela de contratos × banco");
const migration = ler("supabase/migrations/20261122120000_055_vigencia_do_contrato.sql");
verificar("C1. ano mínimo da tela = 1900 (o do CHECK)", clientes.ANO_MINIMO, 1900);
verificar("C2. ano máximo da tela = 2100 (o do CHECK)", clientes.ANO_MAXIMO, 2100);
verificar(
  "C3. o CHECK usa exatamente 1900-01-01 e 2100-12-31",
  (migration.match(/date '1900-01-01' and date '2100-12-31'/g) ?? []).length,
  2,
);
verificar(
  "C4. fim igual ao início é válido na tela (fim inclusivo) e no CHECK (>=)",
  clientes.errosDasDatasDoContrato("2026-03-10", "2026-03-10").length === 0 &&
    /valid_to >= valid_from/.test(migration),
  true,
);
verificar(
  "C5. fim antes do início e ano 0001 seguem recusados na tela",
  clientes.errosDasDatasDoContrato("2026-03-10", "2026-03-01").length > 0 &&
    clientes.errosDasDatasDoContrato("2026-11-01", "0001-01-01").length > 0,
  true,
);

console.log("\nD. Forma da migration 055");
const semComentarios = migration.replace(/--[^\n]*/g, "");
verificar(
  "D1. abre com begin; e termina no próprio commit; (executor remoto)",
  /^\s*begin;/m.test(semComentarios) && migration.trimEnd().endsWith("commit;"),
  true,
);
verificar(
  "D2. o CHECK é NOT VALID e nada o valida (registro antigo intocado)",
  /\)\s*not valid;/.test(semComentarios) && !/validate\s+constraint/i.test(semComentarios),
  true,
);
verificar(
  "D3. nenhuma escrita em dado fora da função (sem UPDATE/DELETE/INSERT/TRUNCATE de tabela)",
  /^\s*(update|delete|insert|truncate)\b/im.test(semComentarios.replace(/\$\$[\s\S]*?\$\$/g, "")),
  false,
);
verificar(
  "D4. função SECURITY DEFINER com search_path fixo",
  /security definer\s+set search_path = pg_catalog, public, pg_temp/.test(semComentarios),
  true,
);
verificar(
  "D5. EXECUTE revogado de public, anon, authenticated, service_role e do operador",
  /revoke all on function public\.recusar_execucao_fora_da_vigencia\(\)\s+from public, anon, authenticated, service_role, bslog_rpc_operacional;/.test(
    semComentarios,
  ),
  true,
);
verificar(
  "D6. sem isenção por papel, sessão ou variável",
  /current_user|session_user|current_setting|service_role'|is_staff|has_role/.test(
    semComentarios.slice(
      semComentarios.indexOf("create or replace function"),
      semComentarios.indexOf("comment on function"),
    ),
  ),
  false,
);
verificar(
  "D7. a recusa usa 23514 e o detalhe vigencia_do_contrato (as duas mensagens)",
  (semComentarios.match(/detail = 'vigencia_do_contrato'/g) ?? []).length,
  2,
);

console.log(`\n${passou} verificações passaram, ${falhas.length} falharam.`);
if (falhas.length) {
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
