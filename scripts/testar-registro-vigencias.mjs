/**
 * Registro controlado de vigências financeiras: forma da migration 023 (C05-B3.1).
 *
 * COMO RODAR:
 *
 *   npm run test:registro-vigencias
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não usa
 * rede nem banco.
 *
 * O QUE ESTA SUÍTE PROVA: a forma literal da migration. A 023 é só REGISTRO: cria a trilha,
 * as RPCs administrativas e a imutabilidade das versões, e NÃO toca na derivação financeira,
 * em `gerar_fatura`, nas tabelas `contracts`, `employees`, `operations`, `shifts` nem em
 * `timesheet_entries`; as telas de Clientes e Colaboradores continuam gravando as taxas
 * atuais por UPDATE direto, como antes. Também prova que a suíte SQL existe, é transacional
 * e falha de verdade, e que o CI a executa.
 *
 * O QUE ELA NÃO PROVA: o comportamento. Vigências sem sobreposição, autorização por papel e
 * AAL2, auditoria e imutabilidade são da suíte SQL `018_registro_vigencias_financeiras.sql`,
 * que roda contra PostgreSQL, e da medição de concorrência com duas sessões.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

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

const NOME = "20261020180000_023_registro_vigencias_financeiras.sql";
const arquivos = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();

const RPCS = [
  "registrar_condicao_contrato",
  "corrigir_condicao_contrato",
  "encerrar_condicao_contrato",
  "aposentar_condicao_contrato",
  "condicao_contrato_na_data",
  "registrar_custo_colaborador",
  "corrigir_custo_colaborador",
  "encerrar_custo_colaborador",
  "aposentar_custo_colaborador",
  "custo_colaborador_na_data",
];
const INTERNAS = [
  "exigir_condicao_contrato_na_data",
  "exigir_custo_colaborador_na_data",
  "condicoes_exigir_admin",
  "condicoes_validar_motivo",
  "condicoes_auditar",
  "condicoes_encerrar_contrato_interno",
  "condicoes_encerrar_colaborador_interno",
];

// ---------------------------------------------------------------------------
// A. Identidade da migration
// ---------------------------------------------------------------------------

console.log("A. Identidade da migration");

verificar("A1. a migration existe", arquivos.includes(NOME), true);
verificar(
  "A2. o número 023 aparece uma vez só",
  arquivos.filter((a) => a.includes("_023_")).length,
  1,
);
verificar(
  "A3. o timestamp é posterior ao de todas as outras migrations",
  arquivos.filter((a) => a !== NOME).every((a) => a.split("_")[0] < NOME.split("_")[0]),
  true,
);
verificar(
  "A4. a migration 019 (Fechamento) não foi trazida para este conjunto",
  arquivos.some((a) => a.includes("_019_")),
  false,
);
verificar(
  "A5. não existe a 024 (a derivação por vigência é a etapa seguinte)",
  arquivos.some((a) => a.includes("_024_")),
  false,
);
verificar(
  "A6. a 022 continua com o conteúdo aprovado (não foi editada)",
  arquivos.includes("20261020150000_022_condicoes_financeiras_expansao.sql"),
  true,
);

const migration = ler(`supabase/migrations/${NOME}`);
const semComentarios = migration.replace(/^\s*--.*$/gm, "");
// Só o SQL executável fora de funções e blocos DO: sem comentários e sem literais.
const semCorpos = semComentarios
  .replace(/create or replace function[\s\S]*?\n\$(\w*)\$;/gi, "")
  .replace(/do \$(\w+)\$[\s\S]*?\$\1\$;/gi, "")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase();
const codigo = semComentarios.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
// Com os literais (códigos de erro, formatos, intervalos).
const codigoComTextos = semComentarios.toLowerCase();

// ---------------------------------------------------------------------------
// B. Só registro: o cálculo atual e as tabelas de origem ficam como estão
// ---------------------------------------------------------------------------

console.log("B. Só registro: derivação, faturamento e taxas atuais intactos");

verificar(
  "B1. não recria nem altera derivar_valores_financeiros",
  /(create (or replace )?function|alter function|drop function)\s+public\.derivar_valores_financeiros/.test(
    codigo,
  ),
  false,
);
verificar(
  "B2. não recria nem altera gerar_fatura",
  /(create (or replace )?function|alter function|drop function)\s+public\.gerar_fatura/.test(
    codigo,
  ),
  false,
);
verificar(
  "B3. nenhuma tabela de origem é alterada (contracts, employees, operations, shifts, timesheets, timesheet_entries)",
  /alter table\s+(only\s+)?public\.(contracts|employees|operations|shifts|timesheets|timesheet_entries)\b/.test(
    codigo,
  ),
  false,
);
verificar(
  "B4. nenhum trigger novo nas tabelas de origem (o bloqueio da edição direta fica para a 024)",
  /create trigger[^;]*\bon public\.(contracts|employees|operations|shifts|timesheets|timesheet_entries)\b/.test(
    codigo,
  ),
  false,
);
verificar(
  "B5. nenhum INSERT, UPDATE, DELETE ou TRUNCATE solto: dados só dentro das funções",
  /\b(insert into public\.|update public\.|delete from public\.|truncate public\.)/.test(semCorpos),
  false,
);
verificar(
  "B6. nada existente é derrubado (nenhum drop executável)",
  /\bdrop\s+(table|column|constraint|policy|trigger|function|index|extension)\b/.test(codigo),
  false,
);
verificar(
  "B7. nenhuma função lê as taxas atuais para preencher lacuna (sem fallback a contracts/employees)",
  /select[^;]*\b(daily_rate|shift_hours|ot_factor|ot_tolerance_min)\b[^;]*from public\.contracts\b/.test(
    codigo,
  ) || /select[^;]*\bdaily_cost\b[^;]*from public\.employees\b/.test(codigo),
  false,
);
verificar(
  "B8. as funções exigir_* levantam P0002 quando não há vigência",
  (codigoComTextos.match(/errcode = 'p0002'/g) ?? []).length >= 6,
  true,
);
verificar(
  "B9. não há valor nem data histórica presumidos (nenhum INSERT de versão fora das RPCs)",
  /insert into public\.(contract_terms|employee_cost_terms)/.test(semCorpos),
  false,
);

// ---------------------------------------------------------------------------
// C. Segurança das RPCs
// ---------------------------------------------------------------------------

console.log("C. Segurança: gate interno, search_path, EXECUTE mínimo, trilha");

function corpoDe(nome) {
  const m = semComentarios.match(
    new RegExp(`create or replace function public\\.${nome}\\([\\s\\S]*?\\n\\$\\$;`),
  );
  return m ? m[0] : "";
}

for (const nome of RPCS) {
  const f = corpoDe(nome);
  verificar(`C1. ${nome} existe`, f.length > 0, true);
  verificar(
    `C2. ${nome} é SECURITY DEFINER com search_path fixo`,
    /security definer\s+set search_path = pg_catalog, public, pg_temp/i.test(f),
    true,
  );
  verificar(
    `C3. ${nome} valida admin + AAL2 + identidade antes de qualquer outra coisa`,
    /\bbegin\s+perform public\.condicoes_exigir_admin\(\);/i.test(f),
    true,
  );
}
for (const nome of [
  "registrar_condicao_contrato",
  "corrigir_condicao_contrato",
  "encerrar_condicao_contrato",
  "aposentar_condicao_contrato",
  "registrar_custo_colaborador",
  "corrigir_custo_colaborador",
  "encerrar_custo_colaborador",
  "aposentar_custo_colaborador",
]) {
  verificar(
    `C4. ${nome} serializa por contrato/colaborador com advisory lock`,
    /pg_advisory_xact_lock\(hashtextextended\('condicoes_/.test(corpoDe(nome)),
    true,
  );
}
const gate = corpoDe("condicoes_exigir_admin");
verificar(
  "C5. o gate recusa sessão ausente com 28000",
  /auth\.uid\(\) is null[\s\S]*errcode = '28000'/i.test(gate),
  true,
);
verificar(
  "C6. o gate exige aal2 ANTES de consultar papel",
  gate.indexOf("'aal2'") > 0 && gate.indexOf("'aal2'") < gate.indexOf("has_role"),
  true,
);
verificar(
  "C7. o gate confere identidade utilizável e papel admin, com 42501",
  /identidade_atual_utilizavel\(\)/.test(gate) &&
    /has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/.test(gate) &&
    (gate.match(/errcode = '42501'/g) ?? []).length === 3,
  true,
);
verificar(
  "C8. todas as funções SECURITY DEFINER do arquivo têm search_path fixo",
  (codigo.match(/security definer/g) ?? []).length ===
    (codigo.match(/security definer\s+set search_path = pg_catalog, public, pg_temp/g) ?? [])
      .length,
  true,
);
verificar(
  "C9. nenhum EXECUTE é concedido a anon, service_role, public nem ao papel operacional",
  /grant\s+execute[^;]*\bto\b[^;]*(anon|service_role|public\b|bslog_rpc_operacional)/.test(codigo),
  false,
);
verificar(
  "C10. o único GRANT EXECUTE é para authenticated, dentro do laço sobre as 10 RPCs",
  (codigoComTextos.match(/grant execute on function/g) ?? []).length === 1 &&
    /grant execute on function %s to authenticated/.test(codigoComTextos),
  true,
);
verificar(
  "C11. as 10 RPCs de API estão na lista que recebe EXECUTE e as 7 internas não",
  RPCS.every((n) =>
    new RegExp(`'${n}'`).test(
      semComentarios.slice(
        semComentarios.indexOf("if _f.nome in ("),
        semComentarios.indexOf("end loop;"),
      ),
    ),
  ) &&
    INTERNAS.every(
      (n) =>
        !new RegExp(`'${n}'`).test(
          semComentarios.slice(
            semComentarios.indexOf("if _f.nome in ("),
            semComentarios.indexOf("end loop;"),
          ),
        ),
    ),
  true,
);
verificar(
  "C12. toda função é revogada de public, anon, authenticated, service_role e do papel operacional antes",
  /revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
    codigoComTextos,
  ),
  true,
);
verificar(
  "C13. todas as funções passam a ser do postgres",
  /alter function %s owner to postgres/.test(codigoComTextos),
  true,
);
verificar(
  "C14. a trilha tem RLS, leitura de admin AAL2 e policy RESTRICTIVE, sem policy de escrita",
  /alter table public\.financial_terms_audit enable row level security/.test(codigo) &&
    /as restrictive for all to authenticated/.test(codigo) &&
    !/create policy[^;]*for (insert|update|delete)\b/.test(codigo.replace(/\s+/g, " ")),
  true,
);
verificar(
  "C15. a trilha só concede SELECT a authenticated",
  /revoke all on table public\.financial_terms_audit from public, anon, authenticated, service_role, bslog_rpc_operacional;\s+grant select on table public\.financial_terms_audit to authenticated;/.test(
    codigo,
  ),
  true,
);
verificar(
  "C16. a trilha é append-only: UPDATE, DELETE e TRUNCATE barrados por trigger, sem FK",
  /create trigger trg_financial_terms_audit_imutavel\s+before update or delete/.test(codigo) &&
    /create trigger trg_financial_terms_audit_sem_truncate\s+before truncate/.test(codigo) &&
    !/financial_terms_audit[^;]*references/.test(codigo.replace(/\s+/g, " ")),
  true,
);
verificar(
  "C17. as versões têm trigger de imutabilidade nas duas tabelas",
  /create trigger trg_contract_terms_imutavel\s+before update on public\.contract_terms/.test(
    codigo,
  ) &&
    /create trigger trg_employee_cost_terms_imutavel\s+before update on public\.employee_cost_terms/.test(
      codigo,
    ),
  true,
);
verificar(
  "C18. a trilha registra ator, sessão, ação, valores anteriores e novos e motivo",
  ["actor_id", "actor_session_id", "action", "previous", "new", "reason"].every((c) =>
    new RegExp(`\\b${c}\\b`).test(corpoDe("condicoes_auditar")),
  ),
  true,
);
verificar(
  "C19. a autoverificação final existe e falha com exception",
  /do \$verificacao\$/.test(semComentarios) && /raise exception/.test(semComentarios),
  true,
);
verificar(
  "C20. a migration documenta a reversão (em comentário, não executável)",
  /^--\s+drop table public\.financial_terms_audit;/m.test(migration) &&
    /^--\s+drop function public\.registrar_condicao_contrato\(/m.test(migration),
  true,
);

// ---------------------------------------------------------------------------
// D. Regras de vigência
// ---------------------------------------------------------------------------

console.log("D. Regras de vigência");

const registrar = corpoDe("registrar_condicao_contrato");
verificar(
  "D1. motivo obrigatório e normalizado",
  /condicoes_validar_motivo\(p_reason\)/.test(registrar),
  true,
);
verificar(
  "D2. recusa valores com mais casas decimais que a coluna (sem arredondar em silêncio)",
  /round\(p_daily_rate, 2\)/.test(registrar),
  true,
);
verificar(
  "D3. traduz a violação da exclusão em 23P01",
  /when exclusion_violation then[\s\S]*errcode = '23P01'/.test(registrar),
  true,
);
verificar(
  "D4. só encerra a anterior quando pedido (p_encerrar_anterior default false)",
  /p_encerrar_anterior\s+boolean default false/.test(registrar),
  true,
);
verificar(
  "D5. origem das versões registradas é 'informada' e das corrigidas é 'correcao'",
  /'informada'/.test(registrar) && /'correcao'/.test(corpoDe("corrigir_condicao_contrato")),
  true,
);
verificar(
  "D6. corrigir aposenta a antiga e aponta a sucessora (3 passos), sem apagar nada",
  /set active = false, retired_at = now\(\)/.test(corpoDe("corrigir_condicao_contrato")) &&
    /set replaced_by = v_novo\.id/.test(corpoDe("corrigir_condicao_contrato")),
  true,
);
verificar(
  "D7. versão referenciada por apontamento não perde cobertura nem é aposentada sem substituta (55000)",
  [
    "condicoes_encerrar_contrato_interno",
    "corrigir_condicao_contrato",
    "aposentar_condicao_contrato",
  ].every((n) => /timesheet_entries/.test(corpoDe(n)) && /errcode = '55000'/.test(corpoDe(n))),
  true,
);
verificar(
  "D8. a data de trabalho usa o intervalo semiaberto [)",
  (codigoComTextos.match(/daterange\(valid_from, valid_to, '\[\)'\)/g) ?? []).length >= 4,
  true,
);

// ---------------------------------------------------------------------------
// E. Compatibilidade transitória com as telas atuais
// ---------------------------------------------------------------------------

console.log("E. Compatibilidade: as telas continuam gravando as taxas atuais");

verificar(
  "E1. o formulário de contratos continua gravando em contracts por UPDATE direto",
  /useSaveRow\("contracts"\)/.test(ler("src/app/(painel)/clientes/painel-clientes.tsx")),
  true,
);
verificar(
  "E2. o formulário de colaboradores continua gravando em employees por UPDATE direto",
  /useSaveRow\("employees"\)/.test(ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx")),
  true,
);
verificar(
  "E3. nenhum arquivo da aplicação chama as RPCs novas ainda (a interface é etapa posterior)",
  RPCS.concat(INTERNAS).every(
    (n) =>
      !new RegExp(`['"]${n}['"]`).test(
        ler("src/lib/mutations.ts") +
          ler("src/app/(painel)/clientes/painel-clientes.tsx") +
          ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx"),
      ),
  ),
  true,
);

// ---------------------------------------------------------------------------
// F. A suíte SQL e o CI
// ---------------------------------------------------------------------------

console.log("F. Suíte SQL, scripts e CI");

const CAMINHO_SQL = "supabase/tests/018_registro_vigencias_financeiras.sql";
verificar(
  "F1. a suíte SQL existe",
  existsSync(new URL(`../${CAMINHO_SQL}`, import.meta.url)),
  true,
);
const sql = ler(CAMINHO_SQL);
for (const rotulo of [
  "A1.",
  "A2.",
  "A3.",
  "B1.",
  "B2.",
  "B3.",
  "C1.",
  "D1.",
  "D2.",
  "E1.",
  "E6.",
  "E7.",
  "G1.",
  "G2.",
  "G3.",
  "G5.",
  "G13.",
  "H/I.",
  "J.",
  "K.",
  "L.",
  "L2.",
  "L3.",
  "L4.",
  "M1.",
  "M5.",
  "M6.",
  "M8.",
  "O1.",
  "O4.",
  "O8.",
  "O12.",
  "O14.",
  "P1.",
  "P7.",
  "P9.",
  "P15.",
  "Q1.",
  "Q2.",
  "Q3.",
  "Q5.",
  "R1.",
  "R3.",
  "R4.",
  "S1.",
  "S3.",
  "T1.",
  "U1.",
  "U11.",
  "U16.",
  "U19.",
  "V1.",
  "V2.",
  "V3.",
  "V4.",
  "V5.",
  "V6.",
  "V7.",
]) {
  verificar(
    `F2. a suíte SQL cobre o caso ${rotulo}`,
    sql.includes(`registrar('${rotulo}`) || sql.includes(`registrar(format('${rotulo}`),
    true,
  );
}
verificar(
  "F3. a suíte SQL é transacional e termina em rollback",
  /^begin;/m.test(sql) && /rollback;\s*$/.test(sql),
  true,
);
verificar(
  "F4. a suíte SQL nunca confirma nada",
  /(?<!on )\bcommit\b/i.test(sql.replace(/^\s*--.*$/gm, "")),
  false,
);
verificar(
  "F5. a suíte SQL falha de verdade quando um caso falha",
  /raise exception '018_registro_vigencias_financeiras/.test(sql),
  true,
);

const pacote = JSON.parse(ler("package.json"));
verificar(
  "F6. o script test:registro-vigencias existe",
  typeof pacote.scripts["test:registro-vigencias"],
  "string",
);
verificar(
  "F7. as suítes anteriores continuam disponíveis",
  Object.keys(pacote.scripts).filter((n) => n.startsWith("test:")).length >= 21,
  true,
);
const ci = ler(".github/workflows/ci.yml");
verificar("F8. o CI executa a suíte nova", /npm run test:registro-vigencias/.test(ci), true);
verificar(
  "F9. o CI conserva todas as suítes de package.json",
  Object.keys(pacote.scripts)
    .filter((n) => n.startsWith("test:"))
    .every((n) => ci.includes(`npm run ${n}`)),
  true,
);
verificar(
  "F10. o CI continua sem secrets e com permissões de leitura",
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
