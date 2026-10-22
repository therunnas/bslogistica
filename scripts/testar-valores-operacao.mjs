/**
 * Valor acordado por operação e congelamento dormente de turno: forma da migration 024 (C05-B3.2).
 *
 * COMO RODAR:
 *
 *   npm run test:valores-operacao
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não usa
 * rede nem banco.
 *
 * O QUE ESTA SUÍTE PROVA: a forma literal da migration. A 024 é aditiva: cria a tabela de
 * versões do valor acordado, a referência anulável no apontamento, as RPCs administrativas e
 * o congelamento de turno usado — este último DESABILITADO. Não toca a derivação financeira,
 * `gerar_fatura` nem as colunas de origem (`operations.agreed_amount`, `shifts.*`), e as telas
 * de Operações e de turnos continuam gravando por UPDATE direto, como antes.
 *
 * O QUE ELA NÃO PROVA: o comportamento. Vigências sem sobreposição, autorização, auditoria,
 * imutabilidade e o congelamento (habilitado dentro de uma transação) são da suíte SQL
 * `019_valores_acordados_operacao.sql`, e a concorrência foi medida com duas sessões.
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

const NOME = "20261020210000_024_valores_acordados_operacao.sql";
const arquivos = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();

const RPCS = [
  "registrar_valor_acordado_operacao",
  "corrigir_valor_acordado_operacao",
  "encerrar_valor_acordado_operacao",
  "aposentar_valor_acordado_operacao",
  "valor_acordado_operacao_na_data",
];
const INTERNAS = ["exigir_valor_acordado_operacao_na_data", "condicoes_encerrar_operacao_interno"];

// ---------------------------------------------------------------------------
// A. Identidade da migration
// ---------------------------------------------------------------------------

console.log("A. Identidade da migration");

verificar("A1. a migration existe", arquivos.includes(NOME), true);
verificar(
  "A2. o número 024 aparece uma vez só",
  arquivos.filter((a) => a.includes("_024_")).length,
  1,
);
verificar(
  "A3. o timestamp é posterior ao de todas as migrations numeradas antes da 024",
  arquivos
    .filter((a) => /_0(0\d|1\d|2[0-3])_/.test(a))
    .every((a) => a.split("_")[0] < NOME.split("_")[0]),
  true,
);
verificar(
  "A4. a migration 019 (Fechamento) não foi trazida para este conjunto",
  arquivos.some((a) => a.includes("_019_")),
  false,
);
verificar(
  "A5. a única 026 é a do cadastro atômico (C05-B5.1) (a 025 é o motor por vigência, que usa as versões desta migration)",
  arquivos
    .filter((a) => a.includes("_026_"))
    .every((a) => a.endsWith("_026_cadastro_atomico_com_vigencia.sql")),
  true,
);

const migration = ler(`supabase/migrations/${NOME}`);
const semComentarios = migration.replace(/^\s*--.*$/gm, "");
const semCorpos = semComentarios
  .replace(/create or replace function[\s\S]*?\n\$(\w*)\$;/gi, "")
  .replace(/do \$(\w+)\$[\s\S]*?\$\1\$;/gi, "")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase();
const codigo = semComentarios.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
const codigoComTextos = semComentarios.toLowerCase();

// ---------------------------------------------------------------------------
// B. Aditiva: derivação, faturamento e colunas de origem intactos
// ---------------------------------------------------------------------------

console.log("B. Aditiva: nada existente é reescrito");

verificar(
  "B1. não recria nem altera derivar_valores_financeiros nem gerar_fatura",
  /(create (or replace )?function|alter function|drop function)\s+public\.(derivar_valores_financeiros|gerar_fatura)\b/.test(
    codigo,
  ),
  false,
);
verificar(
  "B2. nenhuma tabela de origem é alterada, exceto timesheet_entries (só ADD COLUMN) e a trilha (só o CHECK)",
  /alter table\s+(only\s+)?public\.(contracts|employees|operations|timesheets|shifts)\b[^;]*\b(add|drop|alter|rename)\b/.test(
    codigo,
  ),
  false,
);
verificar(
  "B3. timesheet_entries só ganha a coluna operation_terms_id",
  (codigo.match(/alter table public\.timesheet_entries\s+(add|drop|alter|rename)[^;]*;/g) ?? [])
    .length === 1 &&
    /alter table public\.timesheet_entries\s+add column operation_terms_id uuid references public\.operation_terms \(id\);/.test(
      codigo,
    ),
  true,
);
verificar(
  "B4. a única mexida em shifts é desabilitar o trigger novo",
  (codigo.match(/alter table public\.shifts\s+[^;]*;/g) ?? []).join("|"),
  "alter table public.shifts disable trigger trg_shifts_congela_jornada_usada;",
);
verificar(
  "B5. nenhum INSERT, UPDATE, DELETE ou TRUNCATE solto: dados só dentro das funções",
  /\b(insert into public\.|update public\.|delete from public\.|truncate public\.)/.test(semCorpos),
  false,
);
verificar(
  "B6. o único DROP executável é o dos dois CHECK da trilha, que são recriados",
  (codigo.match(/\bdrop\s+\w+/g) ?? []).join(","),
  "drop constraint,drop constraint",
);
verificar(
  "B7. nenhuma função lê operations.agreed_amount para preencher lacuna (sem fallback)",
  /select[^;]*\bagreed_amount\b[^;]*from public\.operations\b/.test(codigo),
  false,
);
verificar(
  "B8. a função exigir_* levanta P0002 quando não há vigência",
  /errcode = 'p0002',\s+hint = 'registre a vigência/.test(codigoComTextos.replace(/\s+/g, " ")) ||
    /exigir_valor_acordado_operacao_na_data[\s\S]*errcode = 'p0002'/.test(codigoComTextos),
  true,
);
verificar(
  "B9. nenhum INSERT de versão fora das RPCs (nenhuma vigência presumida)",
  /insert into public\.operation_terms/.test(semCorpos),
  false,
);
verificar(
  "B10. não cria nenhum trigger em contracts, employees, operations nem timesheets",
  /create trigger[^;]*\bon public\.(contracts|employees|operations|timesheets)\b/.test(codigo),
  false,
);

// ---------------------------------------------------------------------------
// C. Segurança e integridade
// ---------------------------------------------------------------------------

console.log("C. Segurança, vigência e trilha");

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
    `C3. ${nome} valida admin + AAL2 + identidade antes de qualquer outra coisa (gate da 023)`,
    /\bbegin\s+perform public\.condicoes_exigir_admin\(\);/i.test(f),
    true,
  );
}
for (const nome of RPCS.filter((n) => !n.endsWith("_na_data"))) {
  verificar(
    `C4. ${nome} serializa por operação com advisory lock`,
    /pg_advisory_xact_lock\(hashtextextended\('condicoes_operacao:/.test(corpoDe(nome)),
    true,
  );
}
verificar(
  "C5. a 024 reaproveita os helpers da 023 sem recriá-los",
  !/create (or replace )?function public\.(condicoes_exigir_admin|condicoes_validar_motivo|condicoes_auditar|proteger_versao_financeira)\b/.test(
    codigo,
  ) &&
    /public\.condicoes_auditar\(/.test(codigo) &&
    /execute function public\.proteger_versao_financeira\(\)/.test(codigo),
  true,
);
verificar(
  "C6. nenhum EXECUTE é concedido a anon, service_role, public nem ao papel operacional",
  /grant\s+execute[^;]*\bto\b[^;]*(anon|service_role|public\b|bslog_rpc_operacional)/.test(
    codigoComTextos,
  ),
  false,
);
verificar(
  "C7. o único GRANT EXECUTE é para authenticated, dentro do laço sobre as 5 RPCs",
  (codigoComTextos.match(/grant execute on function/g) ?? []).length === 1 &&
    /grant execute on function %s to authenticated/.test(codigoComTextos),
  true,
);
{
  const laco = semComentarios.slice(
    semComentarios.indexOf("if _f.nome in ("),
    semComentarios.indexOf("end loop;"),
  );
  verificar(
    "C8. as 5 RPCs de API estão na lista que recebe EXECUTE e as 2 internas não",
    RPCS.every((n) => laco.includes(`'${n}'`)) && INTERNAS.every((n) => !laco.includes(`'${n}'`)),
    true,
  );
}
verificar(
  "C9. toda função é revogada de public, anon, authenticated, service_role e do papel operacional",
  /revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
    codigoComTextos,
  ),
  true,
);
verificar(
  "C10. operation_terms: RLS, leitura de admin AAL2 e policy RESTRICTIVE, sem policy de escrita",
  /alter table public\.operation_terms enable row level security/.test(codigo) &&
    /as restrictive for all to authenticated/.test(codigo) &&
    !/create policy[^;]*for (insert|update|delete)\b/.test(codigo.replace(/\s+/g, " ")),
  true,
);
verificar(
  "C11. operation_terms só concede SELECT a authenticated",
  /revoke all on table public\.operation_terms from public, anon, authenticated, service_role, bslog_rpc_operacional;\s+grant select on table public\.operation_terms to authenticated;/.test(
    codigo,
  ),
  true,
);
verificar(
  "C12. exclusão de sobreposição por operação, só entre ativas, intervalo semiaberto",
  /exclude using gist[^;]*operation_id with =[^;]*with &&[^;]*where \(active\)/.test(
    codigoComTextos.replace(/\s+/g, " "),
  ) && /daterange\(valid_from, valid_to, '\[\)'\)/.test(codigoComTextos),
  true,
);
verificar(
  "C13. dinheiro em numeric(12,2), nunca float",
  /agreed_amount\s+numeric\(12,2\) not null/.test(codigo) &&
    !/\b(float|double precision|real)\b/.test(codigo),
  true,
);
verificar(
  "C14. o apontamento referencia a versão sem cascata (NO ACTION) e a coluna é anulável sem DEFAULT",
  /add column operation_terms_id uuid references public\.operation_terms \(id\);/.test(codigo) &&
    !/references public\.operation_terms \(id\)\s+on delete/.test(codigo.replace(/\s+/g, " ")),
  true,
);
verificar(
  "C15. a referência só é preenchida pelo sistema (guard com 42501, isento postgres e service_role)",
  /current_user not in \('postgres', 'service_role'\)/.test(codigoComTextos) &&
    /bloquear_coluna_de_valor_acordado/.test(codigo) &&
    /create trigger trg_timesheet_entries_bloqueia_condicoes_operacao\s+before insert or update on public\.timesheet_entries/.test(
      codigo,
    ),
  true,
);
verificar(
  "C16. o nome do trigger da referência ordena antes dos triggers financeiros",
  "trg_timesheet_entries_bloqueia_condicoes_operacao" <
    "trg_timesheet_entries_bloqueio_financeiro" &&
    "trg_timesheet_entries_bloqueia_condicoes_operacao" <
      "trg_timesheet_entries_calculo_financeiro",
  true,
);
verificar(
  "C17. a trilha passa a aceitar a entidade operacao e 4 ações novas, mantendo as 8 antigas",
  [
    "operacao_valor_registrado",
    "operacao_valor_corrigido",
    "operacao_valor_encerrado",
    "operacao_valor_aposentado",
    "contrato_condicao_registrada",
    "colaborador_custo_aposentado",
  ].every((a) => migration.includes(`'${a}'`)) && /'operacao'\)\)/.test(migration),
  true,
);
verificar(
  "C18. a autoverificação final existe e falha com exception",
  /do \$verificacao\$/.test(semComentarios) && /raise exception/.test(semComentarios),
  true,
);
verificar(
  "C19. a migration documenta a reversão em comentário, nos dois modos",
  /^--\s+drop table public\.operation_terms;/m.test(migration) &&
    /^--\s+alter table public\.timesheet_entries drop column operation_terms_id;/m.test(
      migration,
    ) &&
    /SÓ valem se a trilha não tiver nenhum evento de operação/.test(migration),
  true,
);

const registrar = corpoDe("registrar_valor_acordado_operacao");
verificar(
  "C20. motivo obrigatório e normalizado",
  /condicoes_validar_motivo\(p_reason\)/.test(registrar),
  true,
);
verificar(
  "C21. recusa mais de duas casas decimais (sem arredondar em silêncio)",
  /round\(p_agreed_amount, 2\)/.test(registrar),
  true,
);
verificar(
  "C22. traduz a violação da exclusão em 23P01",
  /when exclusion_violation then[\s\S]*errcode = '23P01'/.test(registrar),
  true,
);
verificar(
  "C23. versão referenciada não perde cobertura nem é aposentada sem substituta (55000)",
  [
    "condicoes_encerrar_operacao_interno",
    "corrigir_valor_acordado_operacao",
    "aposentar_valor_acordado_operacao",
  ].every((n) => /timesheet_entries/.test(corpoDe(n)) && /errcode = '55000'/.test(corpoDe(n))),
  true,
);

// ---------------------------------------------------------------------------
// D. Turnos (D2): congelamento dormente
// ---------------------------------------------------------------------------

console.log("D. Turnos: congelamento criado desabilitado");

const congela = corpoDe("congelar_jornada_de_turno_usado");
verificar(
  "D1. a função de congelamento existe e é SECURITY INVOKER",
  /security invoker/.test(congela),
  true,
);
verificar(
  "D2. congela só a jornada: início, fim, intervalo e virada de meia-noite",
  ["start_time", "end_time", "break_minutes", "crosses_midnight"].every((c) =>
    new RegExp(`new\\.${c}\\s+is distinct from old\\.${c}`).test(congela),
  ),
  true,
);
verificar(
  "D3. nome, status e operação não entram na regra (continuam editáveis)",
  !/new\.(name|status)\s+is distinct/.test(congela),
  true,
);
verificar(
  "D4. 'usado' = tem apontamento (timesheet_entries por timesheets.shift_id)",
  /join public\.timesheet_entries te on te\.timesheet_id = t\.id[\s\S]*t\.shift_id = old\.id/.test(
    congela,
  ),
  true,
);
verificar(
  "D5. recusa com 23514 e dica para cadastrar turno novo; os demais papéis seguem com 42501",
  /errcode = '23514'/.test(congela) &&
    /cadastre um turno novo/.test(congela) &&
    /errcode = '42501'/.test(congela),
  true,
);
verificar(
  "D6. o sistema (postgres, service_role) é isento, como nas outras proteções de fonte",
  /current_user not in \('postgres', 'service_role'\)/.test(congela),
  true,
);
verificar(
  "D7. o trigger é criado e DESABILITADO na mesma migration",
  /create trigger trg_shifts_congela_jornada_usada\s+before update on public\.shifts/.test(
    codigo,
  ) && /alter table public\.shifts disable trigger trg_shifts_congela_jornada_usada;/.test(codigo),
  true,
);
verificar(
  "D8. a autoverificação exige o trigger DESABILITADO ('D')",
  /tgname = 'trg_shifts_congela_jornada_usada' and tgenabled = 'd'/.test(codigoComTextos),
  true,
);

// ---------------------------------------------------------------------------
// E. Compatibilidade: as telas continuam como estavam
// ---------------------------------------------------------------------------

console.log("E. Compatibilidade transitória das telas");

const operacoes = ler("src/app/(painel)/operacoes/painel-operacoes.tsx");
verificar(
  "E1. a tela de Operações continua gravando operations.agreed_amount por UPDATE direto com o motor DESLIGADO (e só então: ligado ou desconhecido, a coluna não é enviada)",
  /useSaveRow\("operations"\)/.test(operacoes) &&
    /payload\["agreed_amount"\] = opForm\.agreed_amount === ""/.test(operacoes) &&
    /const enviaValor =\s+modoDeValor === "direta"/.test(operacoes),
  true,
);
verificar(
  "E2. o formulário de turnos continua gravando shifts por UPDATE direto (o congelamento está desabilitado)",
  /useSaveRow\("shifts"\)/.test(operacoes),
  true,
);
verificar(
  "E3. nenhum arquivo da aplicação chama as RPCs novas ainda (a interface é etapa posterior)",
  RPCS.concat(INTERNAS).every(
    (n) =>
      !new RegExp(`['"]${n}['"]`).test(
        operacoes + ler("src/lib/mutations.ts") + ler("src/lib/erros-banco.ts"),
      ),
  ),
  true,
);
verificar(
  "E4. o erro 23514 do turno chega legível à tela e a tela (C05-B4.6, U7) explica o bloqueio e oferece 'novo turno a partir deste'",
  /MENSAGEM_CRUA_DO_BANCO/.test(ler("src/lib/erros-banco.ts")) &&
    /MENSAGEM_TURNO_PROTEGIDO/.test(operacoes) &&
    /novoTurnoAPartir/.test(operacoes) &&
    /Criar novo turno a partir deste/.test(operacoes),
  true,
);
verificar(
  "E5. o PROGRESS.md registra a dependência do congelamento e a ordem das migrations",
  /congelamento|Congelar a configuração de turno/i.test(ler("PROGRESS.md")) &&
    /024/.test(ler("PROGRESS.md")),
  true,
);

// ---------------------------------------------------------------------------
// F. A suíte SQL e o CI
// ---------------------------------------------------------------------------

console.log("F. Suíte SQL, scripts e CI");

const CAMINHO_SQL = "supabase/tests/019_valores_acordados_operacao.sql";
verificar(
  "F1. a suíte SQL existe",
  existsSync(new URL(`../${CAMINHO_SQL}`, import.meta.url)),
  true,
);
const sql = ler(CAMINHO_SQL);
for (const rotulo of [
  "R0.",
  "A1.",
  "A3.",
  "B1.",
  "B2.",
  "B3.",
  "C1.",
  "D1.",
  "D3.",
  "E3.",
  "E4.",
  "E9.",
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
  "M2.",
  "M3.",
  "M4.",
  "O1.",
  "O3.",
  "O6.",
  "O8.",
  "O10.",
  "P1.",
  "P6.",
  "P9.",
  "P10.",
  "P12.",
  "Q1.",
  "Q2.",
  "Q3.",
  "Q5.",
  "R2.",
  "R3.",
  "R4.",
  "R7.",
  "S1.",
  "S3.",
  "T1.",
  "U1.",
  "U2.",
  "U5.",
  "U6.",
  "W1.",
  "W2.",
  "W3.",
  "W5.",
  "W7.",
  "W9.",
  "W10.",
  "W11.",
  "W13.",
  "W15.",
  "V1.",
  "V2.",
  "V3.",
  "V4.",
  "V5.",
  "V6.",
  "V7.",
  "V8.",
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
  /raise exception '019_valores_acordados_operacao/.test(sql),
  true,
);

const pacote = JSON.parse(ler("package.json"));
verificar(
  "F6. o script test:valores-operacao existe",
  typeof pacote.scripts["test:valores-operacao"],
  "string",
);
verificar(
  "F7. as suítes anteriores continuam disponíveis",
  Object.keys(pacote.scripts).filter((n) => n.startsWith("test:")).length >= 22,
  true,
);
const ci = ler(".github/workflows/ci.yml");
verificar("F8. o CI executa a suíte nova", /npm run test:valores-operacao/.test(ci), true);
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
