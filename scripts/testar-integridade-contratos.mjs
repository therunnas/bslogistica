/**
 * Integridade cliente-contrato-operação: a parte que se mede fora do banco (C05-A).
 *
 * COMO RODAR:
 *
 *   npm run test:integridade-contratos
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente de
 * zero em qualquer falha. Não usa rede nem banco.
 *
 * TRÊS METADES:
 *
 *   - comportamento de `mensagemDoErro`, função pura, contra os textos que o banco
 *     devolveu de fato (suíte SQL `016_integridade_cliente_contrato.sql`, casos I1 e I2);
 *   - forma literal dos arquivos que a tela usa, porque o formulário não se observa de
 *     fora sem navegador: o seletor de cliente do contrato trava quando há operação,
 *     o filtro de contratos do formulário de operação segue de pé, e o salvar genérico
 *     traduz o erro;
 *   - forma da migration 021 e da suíte SQL: a migration só cria constraints, não toca
 *     dados, não mexe em policy, grant, trigger nem função, e não derruba a chave original.
 *
 * O QUE ESTA SUÍTE NÃO PROVA: que o banco recusa a relação inválida. Isso é da suíte SQL,
 * que roda contra PostgreSQL com o papel `authenticated`, RLS e triggers ativos. A tela
 * nunca é a defesa; é só a primeira barreira e a mensagem.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

import {
  MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE,
  MENSAGEM_CONTRATO_EM_USO,
  mensagemDoErro,
} from "../src/lib/erros-banco.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Textos reais do PostgreSQL 17 (suíte SQL 016, casos I1 e I2).
const MSG_ESCRITA_DE_OPERACAO =
  'insert or update on table "operations" violates foreign key constraint "operations_contrato_do_cliente_fkey"';
const MSG_TROCA_DE_CLIENTE_DO_CONTRATO =
  'update or delete on table "contracts" violates foreign key constraint "operations_contrato_do_cliente_fkey" on table "operations"';

// ---------------------------------------------------------------------------
// A. mensagemDoErro
// ---------------------------------------------------------------------------

console.log("A. Tradução das recusas do banco");

verificar(
  "A1. escrita de operação com contrato de outro cliente -> mensagem sobre o contrato",
  mensagemDoErro({ code: "23503", message: MSG_ESCRITA_DE_OPERACAO }),
  MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE,
);
verificar(
  "A2. troca de cliente de contrato referenciado -> mensagem sobre o contrato em uso",
  mensagemDoErro({ code: "23503", message: MSG_TROCA_DE_CLIENTE_DO_CONTRATO }),
  MENSAGEM_CONTRATO_EM_USO,
);
verificar(
  "A3. outra violação de chave estrangeira (outra constraint) mantém a mensagem original",
  mensagemDoErro({
    code: "23503",
    message:
      'insert or update on table "shifts" violates foreign key constraint "shifts_operation_id_fkey"',
  }),
  'insert or update on table "shifts" violates foreign key constraint "shifts_operation_id_fkey"',
);
verificar(
  "A4. a constraint certa com SQLSTATE diferente não é traduzida",
  mensagemDoErro({ code: "42501", message: MSG_ESCRITA_DE_OPERACAO }),
  MSG_ESCRITA_DE_OPERACAO,
);
verificar(
  "A5. permissão negada continua com o texto original",
  mensagemDoErro({ code: "42501", message: "new row violates row-level security policy" }),
  "new row violates row-level security policy",
);
verificar(
  "A6. instância de Error devolve a própria mensagem",
  mensagemDoErro(new Error("falha de rede")),
  "falha de rede",
);
verificar(
  "A7. texto solto não quebra",
  mensagemDoErro("texto"),
  "Não foi possível concluir a operação.",
);
verificar("A8. null não quebra", mensagemDoErro(null), "Não foi possível concluir a operação.");
verificar(
  "A9. undefined não quebra",
  mensagemDoErro(undefined),
  "Não foi possível concluir a operação.",
);
verificar(
  "A10. objeto sem mensagem não quebra",
  mensagemDoErro({ code: "23503" }),
  "Não foi possível concluir a operação.",
);
verificar(
  "A11. as mensagens traduzidas estão em português e não vazam termo técnico",
  [MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE, MENSAGEM_CONTRATO_EM_USO].every(
    (m) => !/constraint|violates|foreign key|23503/i.test(m) && /contrato/.test(m),
  ),
  true,
);
verificar(
  "A12. as duas mensagens são diferentes",
  MENSAGEM_CONTRATO_DE_OUTRO_CLIENTE === MENSAGEM_CONTRATO_EM_USO,
  false,
);

// ---------------------------------------------------------------------------
// B. Forma do código que a tela usa
// ---------------------------------------------------------------------------

console.log("B. Formulários e salvar genérico");

const clientes = semComentarios(ler("src/app/(painel)/clientes/painel-clientes.tsx"));
const operacoes = semComentarios(ler("src/app/(painel)/operacoes/painel-operacoes.tsx"));
const mutacoes = semComentarios(ler("src/lib/mutations.ts"));
const erros = ler("src/lib/erros-banco.ts");

verificar(
  "B1. a tela de clientes lê as operações para saber se o contrato está em uso",
  /useOperations/.test(clientes),
  true,
);
verificar(
  "B2. contratoEmUso exige contrato existente e uma operação que o referencie",
  /contratoEmUso\s*=\s*Boolean\(contractForm\.id\)\s*&&\s*\(operations\.data \?\? \[\]\)\.some\(\(operation\) => operation\.contract_id === contractForm\.id\)/.test(
    clientes.replace(/\s+/g, " "),
  ),
  true,
);
{
  const bloco = clientes.split("value={contractForm.client_id}")[1]?.slice(0, 260) ?? "";
  verificar(
    "B3. o seletor de cliente do CONTRATO é desabilitado quando em uso",
    /disabled=\{contratoEmUso\}/.test(bloco),
    true,
  );
}
verificar(
  "B4. a tela explica por que o cliente não pode ser trocado",
  /contratoEmUso && \(/.test(clientes.replace(/\s+/g, " ")) &&
    /crie um novo contrato/.test(clientes.replace(/\s+/g, " ")),
  true,
);
verificar(
  "B5. o formulário de operação continua filtrando os contratos pelo cliente escolhido",
  /contract\.client_id === opForm\.client_id/.test(operacoes),
  true,
);
verificar(
  "B6. o formulário de operação continua zerando o contrato ao trocar o cliente",
  /client_id: value,\s*contract_id: ""/.test(operacoes),
  true,
);
verificar(
  "B7. o salvar genérico traduz o erro",
  /toast\.error\(mensagemDoErro\(error\)\)/.test(mutacoes),
  true,
);
{
  const bloco = mutacoes.split("export function useSaveRow")[1]?.split("export function")[0] ?? "";
  verificar(
    "B8. o salvar genérico (useSaveRow) não mostra mais error.message direto",
    /toast\.error\(error\.message\)/.test(bloco),
    false,
  );
}
verificar(
  "B9. a tradução é função pura: não importa Supabase nem React",
  /from "(@supabase|react|@\/integrations)/.test(erros),
  false,
);
verificar(
  "B10. o banco continua sendo a barreira: nenhuma checagem de cliente ou contrato nova em gravação no cliente",
  /contract\.client_id !== |client_id !== contract_id/.test(clientes + operacoes),
  false,
);

// ---------------------------------------------------------------------------
// C. A migration 021
// ---------------------------------------------------------------------------

console.log("C. Migration 021");

const NOME = "20261020120000_021_integridade_cliente_contrato.sql";
const arquivos = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
verificar("C1. a migration existe", arquivos.includes(NOME), true);
verificar(
  "C2. o número 021 aparece uma vez só",
  arquivos.filter((a) => a.includes("_021_")).length,
  1,
);
verificar(
  "C3. o timestamp é posterior ao de todas as migrations numeradas antes da 021",
  arquivos
    .filter((a) => /_0(0\d|1\d|20)_/.test(a))
    .every((a) => a.split("_")[0] < NOME.split("_")[0]),
  true,
);

const migration = ler(`supabase/migrations/${NOME}`);
// Remove comentários de linha e literais entre aspas simples, para medir só o SQL executável.
const codigo = migration
  .replace(/^\s*--.*$/gm, "")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase();

verificar(
  "C4. UNIQUE (id, client_id) em contracts",
  /alter table public\.contracts\s+add constraint contracts_id_client_id_key unique \(id, client_id\)/.test(
    codigo,
  ),
  true,
);
verificar(
  "C5. chave composta de operations referenciando contracts (id, client_id)",
  /foreign key \(contract_id, client_id\)\s+references public\.contracts \(id, client_id\)/.test(
    codigo,
  ),
  true,
);
verificar(
  "C6. ON DELETE SET NULL apenas de contract_id (preserva o cliente da operação)",
  /on delete set null \(contract_id\)/.test(codigo),
  true,
);
verificar(
  "C7. a chave entra NOT VALID (não examina nem altera dado legado)",
  /\bnot valid\b/.test(codigo),
  true,
);
verificar(
  "C8. a validação é condicional à ausência de linhas inconsistentes",
  /if _inconsistentes = 0 then\s+alter table public\.operations\s+validate constraint/.test(codigo),
  true,
);
verificar(
  "C9. com linhas inconsistentes só emite aviso (raise warning), sem corrigir",
  /else\s+raise warning/.test(codigo),
  true,
);
verificar(
  "C10. a migration não contém comando que escreva dados (insert, update, delete, truncate)",
  /(?<!on )\b(insert|update|delete|truncate)\b/.test(codigo),
  false,
);
verificar(
  "C11. a migration não derruba constraint alguma (a chave original fica)",
  /drop constraint|drop table|drop column/.test(codigo),
  false,
);
verificar(
  "C12. a migration não mexe em policy, grant, trigger nem função",
  /create policy|alter policy|drop policy|\bgrant\b|\brevoke\b|create trigger|drop trigger|create (or replace )?function|disable row level/.test(
    codigo,
  ),
  false,
);
verificar(
  "C13. a autoverificação confere a chave original operations_contract_id_fkey",
  /operations_contract_id_fkey/.test(migration.replace(/^\s*--.*$/gm, "")),
  true,
);
verificar(
  "C14. a migration é a única a citar operations_contrato_do_cliente_fkey entre as migrations",
  arquivos
    .filter((a) => /operations_contrato_do_cliente_fkey/.test(ler(`supabase/migrations/${a}`)))
    .join(),
  NOME,
);

// ---------------------------------------------------------------------------
// D. A suíte SQL e o CI
// ---------------------------------------------------------------------------

console.log("D. Suíte SQL, scripts e CI");

const CAMINHO_SQL = "supabase/tests/016_integridade_cliente_contrato.sql";
verificar(
  "D1. a suíte SQL existe",
  existsSync(new URL(`../${CAMINHO_SQL}`, import.meta.url)),
  true,
);
const sql = ler(CAMINHO_SQL);
for (const rotulo of [
  "A1.",
  "A2.",
  "A3.",
  "A4.",
  "A5.",
  "A6.",
  "A7.",
  "A8a.",
  "A8d.",
  "A9a.",
  "G1.",
  "G2.",
  "G3.",
  "G5.",
  "H1.",
  "H2.",
  "I1.",
  "I2.",
  "J1.",
  "K1.",
  "K2.",
  "K3.",
  "K4.",
]) {
  verificar(
    `D2. a suíte SQL cobre o caso ${rotulo}`,
    sql.includes(`registrar('${rotulo}`) || sql.includes(`registrar($r$${rotulo}`),
    true,
  );
}
verificar(
  "D3. a suíte SQL é transacional e termina em rollback",
  /^begin;/m.test(sql) && /rollback;\s*$/.test(sql),
  true,
);
verificar(
  "D4. a suíte SQL nunca confirma nada",
  /(?<!on )\bcommit\b/i.test(sql.replace(/^\s*--.*$/gm, "")),
  false,
);
verificar(
  "D5. a suíte SQL falha de verdade quando um caso falha",
  /raise exception '016_integridade_cliente_contrato/.test(sql),
  true,
);

const pacote = JSON.parse(ler("package.json"));
const ESPERADAS = [
  "test:cookies-supabase",
  "test:mfa",
  "test:recuperacao",
  "test:prova",
  "test:troca",
  "test:operacional",
  "test:papel",
  "test:tela-operacional",
  "test:admin-usuarios",
  "test:tela-usuarios",
  "test:configuracoes",
  "test:isolamento",
  "test:paginacao",
  "test:queries-paginacao",
  "test:ledger-estados",
  "test:admin-paginacao",
  "test:apontamentos-leitura",
  "test:paridade-financeira",
];
verificar(
  "D6. as 18 suítes anteriores continuam disponíveis",
  ESPERADAS.every((n) => typeof pacote.scripts[n] === "string"),
  true,
);
verificar(
  "D7. o script test:integridade-contratos existe",
  typeof pacote.scripts["test:integridade-contratos"],
  "string",
);
const ci = ler(".github/workflows/ci.yml");
verificar(
  "D8. o CI conserva todas as suítes anteriores",
  ESPERADAS.every((n) => ci.includes(`npm run ${n}`)),
  true,
);
verificar("D9. o CI executa a suíte nova", /npm run test:integridade-contratos/.test(ci), true);
verificar(
  "D10. o CI continua sem secrets e com permissões de leitura",
  /permissions:\s*\n\s*contents: read/.test(ci) && !/secrets\./.test(ci),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
