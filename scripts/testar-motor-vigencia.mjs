/**
 * Motor financeiro por vigência: forma da migration 025 e contrato com as telas (C05-B4.3C).
 *
 * COMO RODAR:
 *
 *   npm run test:motor-vigencia
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha. Não usa
 * rede nem banco.
 *
 * O QUE ESTA SUÍTE PROVA: a forma literal da migration. A 025 nasce DESLIGADA: o motor novo
 * é um trigger desabilitado, o motor antigo (010) não é tocado, e a aritmética do motor novo
 * é, linha a linha, a da 010 (comparada aqui, normalizada). Também prova que o módulo
 * `src/lib/vigencias.ts` descreve as RPCs com os mesmos nomes e parâmetros do SQL, que a
 * interface não chama nada disso ainda, e que a suíte SQL e o CI estão ligados.
 *
 * O QUE ELA NÃO PROVA: o comportamento. Preço da data, preços congelados, legado, ativação e
 * rollback são da suíte SQL `021_motor_vigencia.sql` (201 casos) e da paridade de 23.862
 * casos pelo trigger real, com o motor desligado (idêntica byte a byte) e ligado.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

import { CODIGOS_FINANCEIROS, RPC_VIGENCIAS } from "../src/lib/vigencias.ts";

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

const NOME = "20261021100000_025_motor_financeiro_por_vigencia.sql";
const arquivos = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();

// ---------------------------------------------------------------------------
// A. Identidade
// ---------------------------------------------------------------------------

console.log("A. Identidade da migration");

verificar("A1. a migration existe", arquivos.includes(NOME), true);
verificar(
  "A2. o número 025 aparece uma vez só",
  arquivos.filter((a) => a.includes("_025_")).length,
  1,
);
verificar(
  "A3. o timestamp é posterior ao de todas as outras migrations",
  arquivos.filter((a) => a !== NOME).every((a) => a.split("_")[0] < NOME.split("_")[0]),
  true,
);
verificar(
  "A4. a 019 (Fechamento) não foi trazida para este conjunto",
  arquivos.some((a) => a.includes("_019_")),
  false,
);
verificar(
  "A5. não existe a 026",
  arquivos.some((a) => a.includes("_026_")),
  false,
);
verificar(
  "A6. as migrations 021 a 024 continuam no conjunto",
  ["_021_", "_022_", "_023_", "_024_"].every((n) => arquivos.some((a) => a.includes(n))),
  true,
);

const migration = ler(`supabase/migrations/${NOME}`);
const semComentarios = migration.replace(/^\s*--.*$/gm, "");
const texto = semComentarios.toLowerCase();
const semCorpos = semComentarios
  .replace(/create or replace function[\s\S]*?\n\$(\w*)\$;/gi, "")
  .replace(/do \$(\w+)\$[\s\S]*?\$\1\$;/gi, "")
  .replace(/'(?:[^']|'')*'/g, "''")
  .toLowerCase();

function corpoDe(nome) {
  const m = semComentarios.match(
    new RegExp(`create or replace function public\\.${nome}\\([\\s\\S]*?\\n\\$\\$;`),
  );
  return m ? m[0] : "";
}

// ---------------------------------------------------------------------------
// B. Nasce desligada e não toca no motor antigo
// ---------------------------------------------------------------------------

console.log("B. Nasce DESLIGADA; o motor antigo fica intacto");

verificar(
  "B1. não recria, altera nem derruba derivar_valores_financeiros, gerar_fatura nem bloquear_edicao_financeira",
  /(create (or replace )?function|alter function|drop function)\s+public\.(derivar_valores_financeiros|gerar_fatura|bloquear_edicao_financeira)\b/.test(
    texto,
  ),
  false,
);
verificar(
  "B2. não cria nem recria o trigger do motor antigo",
  /create trigger trg_timesheet_entries_calculo_financeiro/.test(texto),
  false,
);
verificar(
  "B3. o motor novo é criado e DESABILITADO na mesma migration",
  /create trigger trg_timesheet_entries_calculo_vigencia\s+before insert or update on public\.timesheet_entries/.test(
    texto,
  ) &&
    /alter table public\.timesheet_entries disable trigger trg_timesheet_entries_calculo_vigencia;/.test(
      texto,
    ),
  true,
);
verificar(
  "B4. os três bloqueios de edição direta são criados e DESABILITADOS",
  [
    ["contracts", "trg_contracts_bloqueia_taxa_direta"],
    ["employees", "trg_employees_bloqueia_taxa_direta"],
    ["operations", "trg_operations_bloqueia_taxa_direta"],
  ].every(
    ([tabela, trg]) =>
      new RegExp(`create trigger ${trg}\\s+before update of [a-z_, ]+ on public\\.${tabela}`).test(
        texto,
      ) && new RegExp(`alter table public\\.${tabela}\\s+disable trigger ${trg};`).test(texto),
  ),
  true,
);
verificar(
  "B5. a chave nasce desligada: a única linha é inserida com vigencia_ativa = false",
  /insert into public\.financial_engine_settings \(id, vigencia_ativa\) values \(true, false\);/.test(
    texto,
  ),
  true,
);
verificar(
  "B6. nenhum INSERT, UPDATE ou DELETE solto além da linha da chave: dados só dentro das funções",
  (
    semCorpos.match(
      /\b(insert into public\.|update public\.|delete from public\.|truncate public\.)/g,
    ) ?? []
  ).length,
  1,
);
verificar(
  "B7. nenhuma tabela de origem é alterada (colunas, tipos, constraints)",
  /alter table\s+(only\s+)?public\.(contracts|employees|operations|shifts|timesheets|timesheet_entries)\s+(add|drop|alter|rename)\b/.test(
    texto,
  ),
  false,
);
verificar(
  "B8. nada existente é derrubado além dos 2 CHECK da trilha (que são recriados)",
  (
    texto
      .replace(/\s+/g, " ")
      .match(/\bdrop (table|column|constraint|policy|trigger|function|index|extension)\b[^;]*;/g) ??
    []
  ).length,
  1,
);
verificar(
  "B9. a autoverificação confere o estado desligado dos 6 triggers e que o motor antigo não mudou",
  /_n <> 6/.test(semComentarios) &&
    /tgenabled = 'o'/.test(texto) &&
    /tgenabled = 'd'/.test(texto) &&
    /derivar_valores_financeiros', 'gerar_fatura'/.test(texto),
  true,
);

// ---------------------------------------------------------------------------
// C. A aritmética é a da 010
// ---------------------------------------------------------------------------

console.log("C. A aritmética do motor novo é a do motor antigo");

const legado = ler("supabase/migrations/20260912183000_010_derivar_valores_financeiros.sql");
const novoMotor = corpoDe("derivar_valores_por_vigencia");
const normalizar = (t) => t.replace(/--.*$/gm, "").replace(/\s+/g, "").toLowerCase();
function trecho(fonte, de, ate) {
  const i = fonte.indexOf(de);
  const j = fonte.indexOf(ate, i);
  return i >= 0 && j > i ? fonte.slice(i, j + ate.length) : "";
}
const aritmeticaLegado = normalizar(
  trecho(legado, "_shift_hours_efetivo := CASE", "NEW.cost_amount           := _cost;").replace(
    /_daily_rate        := COALESCE\(_daily_rate, 0\);/,
    "_daily_rate := coalesce(_daily_rate, 0); _daily_cost := coalesce(_daily_cost, 0);",
  ),
);
const aritmeticaNova = normalizar(
  trecho(novoMotor, "_shift_hours_efetivo := case", "new.cost_amount           := _cost;"),
);
verificar(
  "C1. o trecho aritmético foi localizado nos dois motores",
  aritmeticaLegado.length > 800 && aritmeticaNova.length > 800,
  true,
);
verificar(
  "C2. do cálculo de jornada efetiva até a gravação de receita e custo: texto IDÊNTICO ao da 010 (normalizado), salvo o coalesce do custo, que a 010 faz antes",
  aritmeticaNova,
  aritmeticaLegado,
);
verificar(
  "C3. arredondamento, minutos, tolerância e hora extra são os mesmos (round half away sobre numeric, ot_horas = overtime/60.0)",
  /round\(\(\(\s*_daily_rate \+ _ot_horas \* _ot_hour_rate\) \* 100\)::numeric\) \/ 100/.test(
    novoMotor,
  ) && /_ot_horas := _overtime \/ 60\.0;/.test(novoMotor),
  true,
);

// ---------------------------------------------------------------------------
// D. Regras do motor ligado
// ---------------------------------------------------------------------------

console.log("D. Regras do motor ligado");

const lcNovo = novoMotor.toLowerCase();
verificar(
  "D1. data, operação e turno vêm da folha, não do payload",
  /from public\.timesheets t\s+where t\.id = new\.timesheet_id/.test(lcNovo.replace(/\s+/g, " ")) ||
    /from public\.timesheets t\s*where t\.id = new\.timesheet_id/.test(lcNovo),
  true,
);
verificar(
  "D2. o BEFORE INSERT de um upsert sobre linha existente (por id ou por folha+colaborador) só repassa",
  /if exists \(select 1 from public\.timesheet_entries e where e\.id = new\.id\)/.test(lcNovo) &&
    /e\.timesheet_id = new\.timesheet_id and e\.employee_id = new\.employee_id/.test(lcNovo),
  true,
);
verificar(
  "D3. UPDATE sem coluna motriz e sem mudança de origem preserva o gravado (como a 010)",
  /new\.terms_origin is not distinct from old\.terms_origin/.test(lcNovo) &&
    /new\.billed_amount\s+:= old\.billed_amount;/.test(lcNovo),
  true,
);
verificar(
  "D4. só apontamento novo ou que muda de folha lê as versões; a edição usa os snapshots gravados",
  /_precificar := tg_op = 'insert' or new\.timesheet_id is distinct from old\.timesheet_id;/.test(
    lcNovo,
  ) &&
    /_daily_rate := new\.daily_rate_snapshot;/.test(lcNovo) &&
    /_planned := new\.planned_minutes_snapshot;/.test(lcNovo),
  true,
);
verificar(
  "D5. trocar o colaborador relê só o custo, na data trabalhada",
  /if new\.employee_id is distinct from old\.employee_id then\s+select \* into _custo from public\.motor_custo_do_dia\(new\.employee_id, _work_date\);/.test(
    lcNovo,
  ),
  true,
);
verificar(
  "D6. legado (sem origem de preço) é recusado com 55000 e orienta a regularização",
  /apontamento anterior ao histórico de vigências/.test(lcNovo) &&
    /errcode = '55000'/.test(lcNovo) &&
    /regularizar_apontamento_legado/.test(lcNovo),
  true,
);
verificar(
  "D7. retroativo anterior à ativação em operação com legado é recusado (vínculo desconhecido)",
  /_work_date < _ativacao/.test(lcNovo) && /e\.terms_origin is null/.test(lcNovo),
  true,
);
verificar(
  "D8. grava origem, referências e snapshots; falta também fixa preço",
  ["terms_origin", "contract_terms_id", "operation_terms_id", "employee_cost_terms_id"].every((c) =>
    new RegExp(`new\\.${c}\\s+:=`).test(lcNovo),
  ) &&
    [
      "shift_hours_snapshot",
      "ot_factor_snapshot",
      "ot_tolerance_snapshot",
      "planned_minutes_snapshot",
    ].every((c) => new RegExp(`new\\.${c} := `).test(lcNovo)),
  true,
);
const fonte = corpoDe("motor_fonte_do_dia").toLowerCase();
verificar(
  "D9. fonte do preço: contrato OU valor acordado; ambos na mesma data = ambíguo (55000)",
  /_tem_ct and _tem_ot/.test(fonte) &&
    /fonte do preço ambígua/.test(fonte) &&
    /errcode = '55000'/.test(fonte),
  true,
);
verificar(
  "D10. sem versão: P0002, nunca lê as colunas de contracts/operations",
  (fonte.match(/errcode = 'p0002'/g) ?? []).length === 2 &&
    !/from public\.contracts|agreed_amount from public\.operations/.test(fonte),
  true,
);
verificar(
  "D11. sem versão de custo: P0002, nunca lê employees",
  /errcode = 'p0002'/.test(corpoDe("motor_custo_do_dia").toLowerCase()) &&
    !/from public\.employees/.test(corpoDe("motor_custo_do_dia").toLowerCase()),
  true,
);
verificar(
  "D12. trava compartilhada na mesma chave das RPCs 023/024, antes de ler a versão",
  ["condicoes_contrato:", "condicoes_operacao:"].every((k) =>
    fonte.includes(`pg_advisory_xact_lock_shared(hashtextextended('${k}'`),
  ) &&
    corpoDe("motor_custo_do_dia").includes(
      "pg_advisory_xact_lock_shared(hashtextextended('condicoes_colaborador:'",
    ) &&
    /for share/.test(fonte),
  true,
);
verificar(
  "D13. as RPCs das migrations 023 e 024 usam as mesmas chaves (exclusivas)",
  ["condicoes_contrato:", "condicoes_colaborador:"].every((k) =>
    ler("supabase/migrations/20261020180000_023_registro_vigencias_financeiras.sql").includes(
      `pg_advisory_xact_lock(hashtextextended('${k}`,
    ),
  ) &&
    ler("supabase/migrations/20261020210000_024_valores_acordados_operacao.sql").includes(
      "pg_advisory_xact_lock(hashtextextended('condicoes_operacao:",
    ),
  true,
);
const bloqueioOperacao = corpoDe("bloquear_taxa_direta_operacao").toLowerCase();
verificar(
  "D14. com o motor ligado, o contrato de operação com apontamento não muda e o valor acordado só por vigência; postgres/service_role isentos",
  /current_user in \('postgres', 'service_role'\)/.test(bloqueioOperacao) &&
    /new\.contract_id is distinct from old\.contract_id/.test(bloqueioOperacao) &&
    /new\.agreed_amount is distinct from old\.agreed_amount/.test(bloqueioOperacao),
  true,
);

// ---------------------------------------------------------------------------
// E. A chave: ativação reversível, segurança e rollback
// ---------------------------------------------------------------------------

console.log("E. A chave de ativação");

const alterar = corpoDe("alterar_motor_vigencia");
const lcAlterar = alterar.toLowerCase();
verificar(
  "E1. exige admin AAL2, identidade e motivo, antes de qualquer coisa",
  /\bbegin\s+perform public\.condicoes_exigir_admin\(\);\s+_motivo := public\.condicoes_validar_motivo\(p_reason\);/i.test(
    alterar,
  ),
  true,
);
verificar(
  "E2. serializa a troca com advisory lock exclusivo",
  /pg_advisory_xact_lock\(hashtextextended\('motor_vigencia'/.test(alterar),
  true,
);
verificar(
  "E3. ligar recusa pendências, salvo confirmação explícita",
  /_pend > 0 and not coalesce\(p_aceitar_pendencias, false\)/.test(lcAlterar),
  true,
);
const iLigar = lcAlterar.indexOf("if p_ativar then");
const iSync = lcAlterar.indexOf("motor_sincronizar_colunas_interno()");
const iDesligaMotorNovo = lcAlterar.indexOf(
  "disable trigger trg_timesheet_entries_calculo_vigencia",
);
verificar(
  "E4. desligar ressincroniza as colunas antigas ANTES de trocar os triggers",
  iSync > lcAlterar.indexOf("else") && iSync < iDesligaMotorNovo,
  true,
);
verificar(
  "E5. ligar: desabilita o motor antigo, habilita o novo, os 3 bloqueios e o congelamento de turno",
  [
    "disable trigger trg_timesheet_entries_calculo_financeiro",
    "enable  trigger trg_timesheet_entries_calculo_vigencia",
    "enable  trigger trg_contracts_bloqueia_taxa_direta",
    "enable  trigger trg_employees_bloqueia_taxa_direta",
    "enable  trigger trg_operations_bloqueia_taxa_direta",
    "enable  trigger trg_shifts_congela_jornada_usada",
  ].every((t) => lcAlterar.slice(iLigar, iSync).includes(t)),
  true,
);
verificar(
  "E6. desligar: o inverso, de volta ao motor antigo",
  [
    "disable trigger trg_timesheet_entries_calculo_vigencia",
    "enable  trigger trg_timesheet_entries_calculo_financeiro",
    "disable trigger trg_contracts_bloqueia_taxa_direta",
    "disable trigger trg_employees_bloqueia_taxa_direta",
    "disable trigger trg_operations_bloqueia_taxa_direta",
    "disable trigger trg_shifts_congela_jornada_usada",
  ].every((t) => lcAlterar.slice(iSync).includes(t)),
  true,
);
verificar(
  "E7. a troca grava a chave e a trilha (antes e depois, motivo, pendências, sincronização)",
  /condicoes_auditar\(/.test(alterar) &&
    /'motor_vigencia_ativado'/.test(alterar) &&
    /'motor_vigencia_desativado'/.test(alterar) &&
    /'sincronizacao'/.test(alterar),
  true,
);
verificar(
  "E8. ligar e desligar repetidos são recusados (55000)",
  /já está ligado/.test(alterar) && /já está desligado/.test(alterar),
  true,
);

const RPCS = [
  "estado_motor_vigencia",
  "pendencias_implantacao_vigencias",
  "alterar_motor_vigencia",
  "sincronizar_colunas_legadas",
  "regularizar_apontamento_legado",
];
for (const nome of RPCS) {
  const f = corpoDe(nome);
  verificar(
    `E9. ${nome} é SECURITY DEFINER com search_path fixo`,
    /security definer\s+set search_path = pg_catalog, public, pg_temp/i.test(f),
    true,
  );
  verificar(
    `E10. ${nome} valida admin + AAL2 + identidade antes de qualquer outra coisa`,
    /\bbegin\s+perform public\.condicoes_exigir_admin\(\);/i.test(f),
    true,
  );
}
verificar(
  "E11. o único GRANT EXECUTE é para authenticated, só nas 5 RPCs",
  (texto.match(/grant execute on function/g) ?? []).length === 1 &&
    /grant execute on function %s to authenticated/.test(texto) &&
    RPCS.every((n) =>
      semComentarios
        .slice(semComentarios.indexOf("if _f.nome in ("), semComentarios.indexOf("end loop;"))
        .includes(`'${n}'`),
    ) &&
    !/grant\s+execute[^;]*\bto\b[^;]*(anon|service_role|public\b|bslog_rpc_operacional)/.test(
      texto,
    ),
  true,
);
verificar(
  "E12. toda função é revogada de public, anon, authenticated, service_role e do papel operacional",
  /revoke all on function %s from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
    texto,
  ),
  true,
);
verificar(
  "E13. a chave: RLS, leitura de admin AAL2, policy RESTRICTIVE, só SELECT para authenticated, não apagável",
  /alter table public\.financial_engine_settings enable row level security/.test(texto) &&
    /as restrictive for all to authenticated/.test(texto) &&
    /revoke all on table public\.financial_engine_settings from public, anon, authenticated, service_role, bslog_rpc_operacional;\s+grant select on table public\.financial_engine_settings to authenticated;/.test(
      texto,
    ) &&
    /before delete or truncate on public\.financial_engine_settings/.test(texto),
  true,
);
verificar(
  "E14. a trilha passa a aceitar 4 ações e 2 entidades novas, mantendo as 12 antigas",
  [
    "motor_vigencia_ativado",
    "motor_vigencia_desativado",
    "colunas_legadas_sincronizadas",
    "apontamento_legado_regularizado",
    "operacao_valor_registrado",
    "contrato_condicao_registrada",
    "'sistema'",
    "'apontamento'",
  ].every((a) => migration.includes(a.startsWith("'") ? a : `'${a}'`)),
  true,
);
verificar(
  "E15. a regularização de legado tem prévia (subtransação desfeita) e só grava com p_aplicar",
  /errcode = 'zz025'/.test(corpoDe("regularizar_apontamento_legado").toLowerCase()) &&
    /if coalesce\(p_aplicar, false\) then\s+perform public\.condicoes_auditar/i.test(
      corpoDe("regularizar_apontamento_legado"),
    ),
  true,
);
verificar(
  "E16. a regularização recusa faturado, apontamento que já tem origem e motor desligado",
  /e\.invoice_id is not null/.test(corpoDe("regularizar_apontamento_legado")) &&
    /e\.terms_origin in \('versao', 'valor_acordado'\)/.test(
      corpoDe("regularizar_apontamento_legado"),
    ) &&
    /not public\.motor_ativo\(\)/.test(corpoDe("regularizar_apontamento_legado")),
  true,
);
verificar(
  "E17. as colunas antigas são ressincronizadas pela versão vigente HOJE; as RPCs 023/024 NÃO foram alteradas",
  /now\(\) at time zone 'america\/sao_paulo'/.test(
    corpoDe("motor_sincronizar_colunas_interno").toLowerCase(),
  ) &&
    !/create or replace function public\.(registrar_|corrigir_|encerrar_|aposentar_)/.test(texto),
  true,
);
verificar(
  "E18. a migration documenta a reversão em comentário, não executável",
  /^--\s+drop table public\.financial_engine_settings;/m.test(migration) &&
    /^--\s+drop function public\.derivar_valores_por_vigencia\(\);/m.test(migration),
  true,
);
verificar(
  "E19. a autoverificação final existe e falha com exception",
  /do \$verificacao\$/.test(semComentarios) && /raise exception/.test(semComentarios),
  true,
);

// ---------------------------------------------------------------------------
// F. Contrato com as telas (src/lib/vigencias.ts)
// ---------------------------------------------------------------------------

console.log("F. Contrato TypeScript x SQL");

const sqlTodas = [
  "20261020180000_023_registro_vigencias_financeiras.sql",
  "20261020210000_024_valores_acordados_operacao.sql",
  NOME,
]
  .map((f) => ler(`supabase/migrations/${f}`).replace(/^\s*--.*$/gm, ""))
  .join("\n");
function parametrosDoSql(nome) {
  const m = sqlTodas.match(
    new RegExp(`create or replace function public\\.${nome}\\(([\\s\\S]*?)\\)\\s*returns`),
  );
  return m ? [...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]) : null;
}
const nomesTs = Object.values(RPC_VIGENCIAS).flatMap((g) => Object.values(g));
verificar(
  "F1. as 20 RPCs do módulo existem no SQL (023, 024 e 025)",
  nomesTs.every((n) => parametrosDoSql(n) !== null),
  true,
);
verificar("F2. nenhum nome repetido no módulo", new Set(nomesTs).size, nomesTs.length);
const tipos = ler("src/lib/vigencias.ts");
function interfaceTs(nome) {
  const m = tipos.match(new RegExp(`interface ${nome} \\{([\\s\\S]*?)\\n\\}`));
  return m ? [...m[1].matchAll(/\b(p_[a-z_]+)\??:/g)].map((x) => x[1]) : null;
}
for (const [interfaceNome, rpc] of [
  ["ParametrosRegistrarCondicaoContrato", "registrar_condicao_contrato"],
  ["ParametrosCorrigirCondicaoContrato", "corrigir_condicao_contrato"],
  ["ParametrosRegistrarCustoColaborador", "registrar_custo_colaborador"],
  ["ParametrosRegistrarValorAcordadoOperacao", "registrar_valor_acordado_operacao"],
  ["ParametrosAlterarMotor", "alterar_motor_vigencia"],
  ["ParametrosRegularizarApontamento", "regularizar_apontamento_legado"],
]) {
  verificar(
    `F3. ${interfaceNome} tem exatamente os parâmetros de ${rpc}`,
    JSON.stringify(interfaceTs(interfaceNome)),
    JSON.stringify(parametrosDoSql(rpc)),
  );
}
for (const rpc of [
  "encerrar_condicao_contrato",
  "encerrar_custo_colaborador",
  "encerrar_valor_acordado_operacao",
]) {
  verificar(
    `F4. ParametrosEncerrarVigencia serve a ${rpc}`,
    JSON.stringify(interfaceTs("ParametrosEncerrarVigencia")),
    JSON.stringify(parametrosDoSql(rpc)),
  );
}
for (const rpc of [
  "aposentar_condicao_contrato",
  "aposentar_custo_colaborador",
  "aposentar_valor_acordado_operacao",
]) {
  verificar(
    `F5. ParametrosAposentarVigencia serve a ${rpc}`,
    JSON.stringify(interfaceTs("ParametrosAposentarVigencia")),
    JSON.stringify(parametrosDoSql(rpc)),
  );
}
verificar(
  "F6. os códigos financeiros do módulo são os que o banco levanta e os que erros-banco.ts traduz",
  Object.values(CODIGOS_FINANCEIROS)
    .filter((c) => !["42501", "28000"].includes(c))
    .every(
      (c) =>
        sqlTodas.includes(`'${c.toLowerCase()}'`) ||
        sqlTodas.toLowerCase().includes(`errcode = '${c.toLowerCase()}'`),
    ) &&
    ["P0002", "55000", "23P01", "22023", "23514"].every((c) =>
      ler("src/lib/erros-banco.ts").includes(c),
    ),
  true,
);
verificar(
  "F7. o módulo não importa nada em tempo de execução",
  (tipos.match(/^import (?!type)/gm) ?? []).length,
  0,
);
verificar(
  "F8. a função RPC_VIGENCIAS é só dado (nenhuma chamada)",
  /\.rpc\(|criarClienteNavegador|fetch\(/.test(tipos.replace(/\/\*[\s\S]*?\*\//g, "")),
  false,
);

// ---------------------------------------------------------------------------
// G. A interface ainda não usa o motor
// ---------------------------------------------------------------------------

console.log("G. A interface não muda nesta etapa");

const telas = [
  "src/app/(painel)/apontamentos/painel-apontamentos.tsx",
  "src/app/(painel)/clientes/painel-clientes.tsx",
  "src/app/(painel)/colaboradores/painel-colaboradores.tsx",
  "src/app/(painel)/operacoes/painel-operacoes.tsx",
  "src/app/(painel)/operacional/painel-operacional.tsx",
  "src/lib/mutations.ts",
]
  .map(ler)
  .join("\n");
verificar(
  "G1. nenhuma tela chama as RPCs do motor nem importa o módulo de vigências",
  [
    ...Object.values(RPC_VIGENCIAS.motor),
    "lib/vigencias",
    "financial_engine_settings",
    "regularizar_apontamento",
  ]
    .filter((n) => telas.includes(n))
    .join(","),
  "",
);
verificar(
  "G2. os formulários continuam gravando taxas por UPDATE direto (o bloqueio só vale com o motor ligado)",
  /useSaveRow\("contracts"\)/.test(telas) &&
    /useSaveRow\("employees"\)/.test(telas) &&
    /useSaveRow\("operations"\)/.test(telas),
  true,
);

// ---------------------------------------------------------------------------
// H. Suíte SQL, scripts e CI
// ---------------------------------------------------------------------------

console.log("H. Suíte SQL, scripts e CI");

const CAMINHO_SQL = "supabase/tests/021_motor_vigencia.sql";
verificar(
  "H1. a suíte SQL existe",
  existsSync(new URL(`../${CAMINHO_SQL}`, import.meta.url)),
  true,
);
const sql = ler(CAMINHO_SQL);
for (const rotulo of [
  "A0.",
  "A2.",
  "A7.",
  "A8.",
  "A9.",
  "A10.",
  "A11.",
  "B1.",
  "B11.",
  "B12.",
  "B15.",
  "C1.",
  "C2.",
  "C3.",
  "C4.",
  "C5.",
  "C7.",
  "D1.",
  "D3.",
  "D6.",
  "D7.",
  "E1.",
  "E4.",
  "F1.",
  "F3b.",
  "G1.",
  "G2.",
  "H1.",
  "H2.",
  "H6.",
  "H8.",
  "H10.",
  "H11.",
  "I1.",
  "J1.",
  "J2.",
  "J5.",
  "J6.",
  "J7.",
  "J9.",
  "K1.",
  "K3b.",
  "K4.",
  "L1.",
  "L4.",
  "M1.",
  "M3.",
  "M7.",
  "M8.",
  "M9.",
  "M12.",
  "N1.",
  "N2.",
  "O1.",
  "O8.",
  "O10.",
  "O12.",
]) {
  verificar(
    `H2. a suíte SQL cobre o caso ${rotulo}`,
    sql.includes(`registrar('${rotulo}`) || sql.includes(`registrar(format('${rotulo}`),
    true,
  );
}
verificar(
  "H3. a suíte SQL é transacional e termina em rollback",
  /^begin;/m.test(sql) && /rollback;\s*$/.test(sql),
  true,
);
verificar(
  "H4. a suíte SQL nunca confirma nada",
  /(?<!on )\bcommit\b/i.test(sql.replace(/^\s*--.*$/gm, "")),
  false,
);
verificar(
  "H5. a suíte SQL falha de verdade quando um caso falha",
  /raise exception '021_motor_vigencia/.test(sql),
  true,
);
const pacote = JSON.parse(ler("package.json"));
verificar(
  "H6. o script test:motor-vigencia existe",
  typeof pacote.scripts["test:motor-vigencia"],
  "string",
);
verificar(
  "H7. as suítes anteriores continuam disponíveis",
  Object.keys(pacote.scripts).filter((n) => n.startsWith("test:")).length >= 24,
  true,
);
const ci = ler(".github/workflows/ci.yml");
verificar("H8. o CI executa a suíte nova", /npm run test:motor-vigencia/.test(ci), true);
verificar(
  "H9. o CI conserva todas as suítes de package.json",
  Object.keys(pacote.scripts)
    .filter((n) => n.startsWith("test:"))
    .every((n) => ci.includes(`npm run ${n}`)),
  true,
);
verificar(
  "H10. o CI continua sem secrets e com permissões de leitura",
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
