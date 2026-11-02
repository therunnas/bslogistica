/**
 * Diária individual e adicional diário (FIN-PR-08, migration 042).
 *
 * COMO RODAR:  npm run test:diaria-individual-bonus
 *
 * Sem rede e sem banco. As provas com banco são a suíte SQL `042_diaria_individual_e_bonus.sql`, o
 * ensaio `comparar-catalogo-diaria.sh` (valores iguais antes/depois com a resolução desligada) e a
 * compatibilidade de deploy (bancos 034 a 042, resolução desligada e ligada, com e sem diária
 * individual). Dados SINTÉTICOS: nenhum nome real de cliente, pessoa ou planilha neste arquivo.
 *
 *   T  regras puras (diaria-individual.ts): capacidade, validação, vigência, quadro, fonte, adicional
 *   M  migration 042: só o previsto; o motor só troca as linhas esperadas e mantém a ordem
 *   R  runbook devolve os corpos vigentes antes da 042 e RECUSA se houver dado
 *   F  o código financeiro do app não conhece diária individual nem fonte de preço
 *   B  reconciliação sintética: 14 colaboradores, uma diária fixa cada, HE sobre a diária da linha
 *   C  telas (Contratos e Apontamentos), capacidade anunciada pelo banco e CI
 */

import { readFileSync, readdirSync } from "node:fs";

import {
  diariaNaData,
  interpretarBonusDiario,
  interpretarDiariaIndividual,
  lerValorDoBonus,
  montarBonus,
  montarQuadroDeDiarias,
  montarRegistroDeDiaria,
  motivoSemBonus,
  resumoDoDia,
  rotuloDaFonte,
  rotuloDaVigenciaIndividual,
  TEXTO_DO_BONUS,
  validarBonus,
  validarDiariaIndividual,
} from "../src/lib/diaria-individual.ts";
import { corpoDaFuncao } from "./gerar-sql-nucleo-financeiro.mjs";

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// ---------------------------------------------------------------------------
console.log("T. Regras puras da diária individual e do adicional diário");
verificar(
  "T1. capacidades: só `true` explícito liga; erro, ausência, texto e lista não",
  [
    interpretarDiariaIndividual({ diaria_individual: true }, null),
    interpretarDiariaIndividual({ diaria_individual: "true" }, null),
    interpretarDiariaIndividual({}, null),
    interpretarDiariaIndividual(null, null),
    interpretarDiariaIndividual([true], null),
    interpretarDiariaIndividual({ diaria_individual: true }, new Error("x")),
    interpretarBonusDiario({ bonus_diario: true }, null),
    interpretarBonusDiario({ bonus_diario: 1 }, null),
    interpretarBonusDiario({ diaria_individual: true }, null),
    interpretarBonusDiario({ bonus_diario: true }, { message: "falha" }),
  ],
  [true, false, false, false, false, false, true, false, false, false],
);
const base = {
  contratoId: "k1",
  colaboradorId: "e1",
  inicio: "2026-03-01",
  valor: "260,00",
  motivo: "Acordo",
};
verificar("T2. formulário válido não tem erros", validarDiariaIndividual(base), []);
verificar(
  "T3. recusa: contrato, colaborador, data inválida, valor vazio/zero/negativo/3 casas, sem motivo",
  [
    validarDiariaIndividual({ ...base, contratoId: " " }),
    validarDiariaIndividual({ ...base, colaboradorId: "" }),
    validarDiariaIndividual({ ...base, inicio: "2026-02-30" }),
    validarDiariaIndividual({ ...base, valor: "" }),
    validarDiariaIndividual({ ...base, valor: "0" }),
    validarDiariaIndividual({ ...base, valor: "-5" }),
    validarDiariaIndividual({ ...base, valor: "10,005" }),
    validarDiariaIndividual({ ...base, motivo: "   " }),
  ].map((e) => e.length),
  [1, 1, 1, 1, 1, 1, 1, 1],
);
verificar(
  "T4. vazio NUNCA vira zero; vírgula decimal vale; até duas casas",
  [
    montarRegistroDeDiaria({ ...base, valor: "260,5" })["p_daily_rate"],
    montarRegistroDeDiaria({ ...base, valor: "260.50" })["p_daily_rate"],
    (() => {
      try {
        montarRegistroDeDiaria({ ...base, valor: "" });
        return "não lançou";
      } catch {
        return "lançou";
      }
    })(),
  ],
  [260.5, 260.5, "lançou"],
);
verificar(
  "T5. o payload da RPC encerra a vigência anterior e nomeia todos os parâmetros",
  montarRegistroDeDiaria(base),
  {
    p_contract_id: "k1",
    p_employee_id: "e1",
    p_valid_from: "2026-03-01",
    p_daily_rate: 260,
    p_reason: "Acordo",
    p_encerrar_anterior: true,
  },
);
const lista = [
  {
    id: "a",
    contract_id: "k1",
    employee_id: "e1",
    valid_from: "2026-01-01",
    valid_to: "2026-04-01",
    daily_rate: "240.00",
    active: true,
  },
  {
    id: "b",
    contract_id: "k1",
    employee_id: "e1",
    valid_from: "2026-04-01",
    valid_to: null,
    daily_rate: "250.00",
    active: true,
  },
  {
    id: "c",
    contract_id: "k1",
    employee_id: "e2",
    valid_from: "2026-01-01",
    valid_to: null,
    daily_rate: "210.00",
    active: true,
  },
  {
    id: "d",
    contract_id: "k1",
    employee_id: "e2",
    valid_from: "2025-01-01",
    valid_to: "2026-01-01",
    daily_rate: "200.00",
    active: false,
  },
];
verificar(
  "T6. vigência [início, fim): 31/03 vale a antiga, 01/04 a nova; antes de tudo e aposentada não valem",
  [
    diariaNaData(lista, "e1", "2026-03-31")?.id,
    diariaNaData(lista, "e1", "2026-04-01")?.id,
    diariaNaData(lista, "e1", "2025-12-31") ?? null,
    diariaNaData(lista, "e2", "2025-06-01") ?? null,
    diariaNaData(lista, "e3", "2026-03-01") ?? null,
  ],
  ["a", "b", null, null, null],
);
verificar(
  "T7. duas candidatas = dado inconsistente: a tela não escolhe uma",
  diariaNaData(
    [
      ...lista,
      {
        id: "z",
        contract_id: "k1",
        employee_id: "e1",
        valid_from: "2026-02-01",
        valid_to: null,
        daily_rate: 1,
        active: true,
      },
    ],
    "e1",
    "2026-03-01",
  ),
  null,
);
const quadro = montarQuadroDeDiarias(lista, "2026-03-15");
verificar(
  "T8. quadro por colaborador: vigente, próxima agendada e versões anteriores",
  quadro.map((l) => [l.colaboradorId, l.vigente?.id ?? null, l.proxima?.id ?? null, l.anteriores]),
  [
    ["e1", "a", "b", 0],
    ["e2", "c", null, 1],
  ],
);
verificar(
  "T9. rótulo da vigência",
  [
    rotuloDaVigenciaIndividual({ valid_from: "2026-01-01", valid_to: null }),
    rotuloDaVigenciaIndividual({ valid_from: "2026-01-01", valid_to: "2026-04-01" }),
  ],
  ["desde 01/01/2026", "desde 01/01/2026 até 01/04/2026"],
);
verificar(
  "T10. fonte do preço: individual, tarifa da função e período, e a regra anterior (nulo/desconhecido)",
  [
    rotuloDaFonte("individual"),
    rotuloDaFonte("funcao_periodo"),
    rotuloDaFonte(null),
    rotuloDaFonte("outra"),
  ],
  [
    "Diária individual do colaborador",
    "Tarifa da função e do período",
    "Diária do contrato ou valor acordado",
    "Diária do contrato ou valor acordado",
  ],
);
const bonusBase = { entryId: "ap1", valor: "30,00", motivo: "Acúmulo de função" };
verificar(
  "T11. adicional: zero remove; vazio, negativo e 3 casas recusados; sem motivo recusado",
  [
    lerValorDoBonus("30,00"),
    lerValorDoBonus("0"),
    lerValorDoBonus(""),
    lerValorDoBonus("-1"),
    lerValorDoBonus("10,005"),
    validarBonus(bonusBase).length,
    validarBonus({ ...bonusBase, motivo: " " }).length,
    validarBonus({ ...bonusBase, entryId: "" }).length,
  ],
  [30, 0, null, null, null, 0, 1, 1],
);
verificar(
  "T12. payload do adicional: substituir só vai verdadeiro quando confirmado",
  [montarBonus(bonusBase, false), montarBonus({ ...bonusBase, valor: "0" }, true)],
  [
    { p_entry_id: "ap1", p_amount: 30, p_reason: "Acúmulo de função", p_substituir: false },
    { p_entry_id: "ap1", p_amount: 0, p_reason: "Acúmulo de função", p_substituir: true },
  ],
);
const ok = { status: "present", invoice_id: null, calc_version: 2 };
verificar(
  "T13. pré-checagem do adicional espelha o banco, na mesma ordem",
  [
    motivoSemBonus(ok, false, true),
    motivoSemBonus(ok, true, false),
    motivoSemBonus(ok, true, null),
    motivoSemBonus({ ...ok, invoice_id: "f1" }, true, true),
    motivoSemBonus({ ...ok, status: "absent" }, true, true),
    motivoSemBonus({ ...ok, calc_version: null }, true, true),
    motivoSemBonus(ok, true, true),
  ],
  [
    "capacidade",
    "resolucao_desligada",
    "resolucao_desligada",
    "faturado",
    "falta",
    "regra_anterior",
    null,
  ],
);
verificar(
  "T14. o texto do adicional diz o que ele é e que não entra na base da hora extra",
  [
    /acúmulo de função/.test(TEXTO_DO_BONUS),
    /Não aumenta o valor usado para calcular a hora extra/.test(TEXTO_DO_BONUS),
  ],
  [true, true],
);
verificar(
  "T15. o resumo do dia mostra os componentes como o banco gravou (260 + HE 48,75 + adicional 30 = 338,75)",
  resumoDoDia({
    daily_rate_snapshot: "260.00",
    billed_overtime_amount: "48.75",
    additional_amount: "30.00",
    billed_amount: "338.75",
    price_source: "individual",
  }),
  {
    diaria: 260,
    horaExtra: 48.75,
    especial: 0,
    adicional: 30,
    total: 338.75,
    fonte: "Diária individual do colaborador",
  },
);

// ---------------------------------------------------------------------------
console.log("\nM. Migration 042");
const N041 = "20261108120000_041_tarifas_por_funcao_e_periodo.sql";
const N042 = "20261109120000_042_diaria_individual_e_bonus.sql";
const m041 = ler(`supabase/migrations/${N041}`);
const m042 = ler(`supabase/migrations/${N042}`);
verificar(
  "M1. 042 uma vez, logo depois da 041 e antes da 043; 019 fora",
  [
    migrations.filter((f) => /_042_/.test(f)).length,
    migrations[migrations.indexOf(N041) + 1] === N042,
    migrations[migrations.indexOf(N042) + 1] === "20261110120000_043_dias_especiais_v2.sql",
    migrations.some((f) => /_019_/.test(f)),
  ],
  [1, true, true, false],
);
const sem = (t) => t.replace(/--[^\n]*/g, "");
const comandos = (t) => sem(t).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
verificar(
  "M2. aditiva: nenhum DROP de dado, nenhum DELETE de dado, nenhum grant a anon, nenhum gatilho desligado, nenhum UPDATE de dado",
  [
    /drop\s+(table|column|policy|trigger)\b/i.test(
      comandos(m042).replace(/drop constraint financial_terms_audit_acao_valida/gi, ""),
    ),
    /\b(delete\s+from)\b/i.test(comandos(m042)),
    /grant[^;]*\banon\b/i.test(comandos(m042)),
    /disable\s+trigger/i.test(comandos(m042)),
    /\bupdate\s+public\.(timesheet_entries|invoices|invoice_items|contract_terms|pricing_settings)\b/i.test(
      comandos(m042),
    ),
  ],
  [false, false, false, false, false],
);
verificar(
  "M3. a migration NÃO liga a resolução de tarifas nem mexe na chave",
  [/alterar_resolucao_tarifas\s*\(/.test(comandos(m042)), /pricing_settings/.test(comandos(m042))],
  [false, false],
);
verificar(
  "M4. dinheiro em numeric(12,2); nenhum float/double/real na tabela nova",
  [
    /daily_rate\s+numeric\(12,2\)\s+not null/.test(m042),
    /\b(float|double precision|real)\b/i.test(
      m042.slice(
        m042.indexOf("create table public.contract_employee_rates"),
        m042.indexOf("create index contract_employee_rates_busca_idx"),
      ),
    ),
  ],
  [true, false],
);
verificar(
  "M5. integridade da tabela: diária positiva, vigência válida, motivo obrigatório, sem sobreposição (EXCLUDE gist), contrato e colaborador RESTRICT",
  [
    /constraint contract_employee_rates_diaria_positiva check \(daily_rate > 0\)/.test(m042),
    /valid_to is null or valid_to > valid_from/.test(m042),
    /btrim\(reason\) <> ''/.test(m042),
    /exclude using gist \(\s*contract_id with =, employee_id with =,\s*daterange\(valid_from, valid_to, '\[\)'\) with &&\s*\) where \(active\)/.test(
      m042,
    ),
    /contract_id uuid not null references public\.contracts \(id\) on delete restrict/.test(m042),
    /employee_id uuid not null references public\.employees \(id\) on delete restrict/.test(m042),
  ],
  [true, true, true, true, true, true],
);
verificar(
  "M6. RLS: só admin lê, restritiva de MFA, nenhum privilégio de escrita, nada para anon/service_role/operacional",
  [
    /enable row level security/.test(m042),
    /contract_employee_rates_leitura_admin[\s\S]{0,200}has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/.test(
      m042,
    ),
    /as restrictive for select[\s\S]{0,120}mfa_cotidiano_ok/.test(m042),
    /revoke all on table public\.contract_employee_rates from public, anon, authenticated, service_role, bslog_rpc_operacional/.test(
      m042,
    ),
    /grant select on table public\.contract_employee_rates to authenticated;/.test(m042),
    /trg_contract_employee_rates_sem_delete[\s\S]{0,200}trg_contract_employee_rates_sem_truncate/.test(
      m042,
    ),
  ],
  [true, true, true, true, true, true],
);
const rpcs = [
  "registrar_diaria_individual",
  "encerrar_diaria_individual",
  "corrigir_diaria_individual",
  "aposentar_diaria_individual",
  "diaria_individual_na_data",
  "definir_bonus_do_apontamento",
];
verificar(
  "M7. toda RPC: SECURITY DEFINER, search_path fixo, exige admin; as que escrevem exigem motivo",
  rpcs.map((n) => {
    const c = corpoDaFuncao(m042, n) ?? "";
    const cab = m042.slice(
      m042.indexOf(`create function public.${n}(`),
      m042.indexOf(`create function public.${n}(`) + 900,
    );
    return [
      /security definer/.test(cab),
      /set search_path = pg_catalog, public, pg_temp/.test(cab),
      /condicoes_exigir_admin(_leitura)?\(\)/.test(c),
      n === "diaria_individual_na_data" ? true : /condicoes_validar_motivo/.test(c),
    ];
  }),
  rpcs.map(() => [true, true, true, true]),
);
verificar(
  "M8. escrita sob a MESMA trava por contrato da 041 e o adicional sob a trava do cliente do faturamento",
  [
    [
      "registrar_diaria_individual",
      "corrigir_diaria_individual",
      "aposentar_diaria_individual",
      "encerrar_diaria_individual",
    ].map((n) =>
      /pg_advisory_xact_lock\(hashtextextended\('condicoes_contrato:' \|\| /.test(
        corpoDaFuncao(m042, n) ?? "",
      ),
    ),
    /pg_advisory_xact_lock\(hashtextextended\(v_cliente::text, 0\)\)/.test(
      corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? "",
    ),
    /pg_advisory_xact_lock\(hashtextextended\(_client_id::text, 0\)\)/.test(
      ler("supabase/migrations/20261104120000_037_leitores_por_componentes.sql"),
    ),
  ],
  [[true, true, true, true], true, true],
);
verificar(
  "M9. o adicional recusa: resolução desligada, faturado, falta, regra anterior, duplicação sem confirmar, remover o que não existe",
  [
    /resolucao_de_tarifas_ativa\(\)/.test(
      corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? "",
    ),
    /e\.invoice_id is not null/.test(corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? ""),
    /e\.status = 'absent'/.test(corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? ""),
    /e\.calc_version is distinct from 2/.test(
      corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? "",
    ),
    /e\.additional_amount > 0 and not coalesce\(p_substituir, false\)/.test(
      corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? "",
    ),
    /p_amount = 0 and e\.additional_amount = 0/.test(
      corpoDaFuncao(m042, "definir_bonus_do_apontamento") ?? "",
    ),
  ],
  [true, true, true, true, true, true],
);
verificar(
  "M10. fonte do preço no lançamento: coluna, FK, CHECK de coerência e a trava de colunas",
  [
    /add column contract_employee_rate_id uuid references public\.contract_employee_rates \(id\)/.test(
      m042,
    ),
    /add column price_source text/.test(m042),
    /price_source is null or price_source in \('individual', 'funcao_periodo'\)/.test(m042),
    /\(price_source = 'individual'\) = \(contract_employee_rate_id is not null\)/.test(m042),
    /new\.contract_employee_rate_id is not null\s+or new\.price_source is not null/.test(
      corpoDaFuncao(m042, "bloquear_colunas_de_condicoes") ?? "",
    ),
    /new\.contract_employee_rate_id is distinct from old\.contract_employee_rate_id\s+or new\.price_source is distinct from old\.price_source/.test(
      corpoDaFuncao(m042, "bloquear_colunas_de_condicoes") ?? "",
    ),
  ],
  [true, true, true, true, true, true],
);
verificar(
  "M11. trilha: cinco ações novas aceitas e as anteriores mantidas",
  [
    "diaria_individual_registrada",
    "diaria_individual_corrigida",
    "diaria_individual_encerrada",
    "diaria_individual_aposentada",
    "apontamento_bonus_definido",
    "tarifa_registrada",
    "tarifas_resolucao_desativada",
    "apontamento_snapshots_corrigidos",
  ].map((a) => m042.includes(`'${a}'`)),
  [true, true, true, true, true, true, true, true],
);

// O motor: sobre o corpo da 041, só as linhas esperadas mudam e a ordem das demais é preservada.
const c041 = corpoDaFuncao(m041, "derivar_valores_por_vigencia");
const c042 = corpoDaFuncao(m042, "derivar_valores_por_vigencia");
const L041 = c041.split("\n");
const L042 = c042.split("\n");
const em042 = new Set(L042);
const em041 = new Set(L041);
const removidas = L041.filter((l) => !em042.has(l)).map((l) => l.trim());
verificar(
  "M12. o motor da 042 troca só 15 linhas do corpo da 041 (recomposição do total, regra da tarifa, adicional)",
  removidas,
  [
    "new.billed_amount           := old.billed_amount;",
    "new.additional_amount       := old.additional_amount;",
    "or new.shift_period_snapshot is distinct from old.shift_period_snapshot))",
    "select * into _tar from public.contract_rate_terms r",
    "where r.contract_id = _cid and r.job_function_id = new.job_function_id_snapshot",
    "and r.shift_period = new.shift_period_snapshot and r.active",
    "and daterange(r.valid_from, r.valid_to, '[)') @> _work_date",
    "if not found then",
    "raise exception 'Sem tarifa vigente em % para a função e o período do turno deste apontamento no contrato.', _work_date",
    "using errcode = 'P0002',",
    "hint = 'Cadastre a tarifa (função + período + vigência) no contrato antes de apontar; não há fallback para a diária genérica.';",
    "_daily_rate := _tar.daily_rate;",
    "new.contract_rate_terms_id := _tar.id;",
    "0,",
    "new.additional_amount       := 0;",
  ],
);
let posicao = 0;
let ordem = true;
for (const l of L041) {
  if (!em042.has(l)) continue;
  const j = L042.indexOf(l, posicao);
  if (j < 0) {
    ordem = false;
    break;
  }
  posicao = j + 1;
}
verificar("M13. as demais linhas do motor da 041 seguem na mesma ordem na 042", ordem, true);
const posIndividual = c042.indexOf("from public.contract_employee_rates ir");
const posPadrao = c042.indexOf("from public.contract_rate_terms r");
const posErro = c042.indexOf("Sem diária individual nem tarifa padrão vigente");
verificar(
  "M14. precedência no motor: 1º diária individual, 2º tarifa padrão, 3º erro (P0002); individual só com a resolução ligada e contrato",
  [
    posIndividual > 0 && posIndividual < posPadrao && posPadrao < posErro,
    /if _res and _origem = 'versao' then/.test(c042),
    /errcode = 'P0002'/.test(c042.slice(posErro, posErro + 400)),
    c042.includes("for share") &&
      /ir\.contract_id = _cid and ir\.employee_id = new\.employee_id and ir\.active/.test(c042),
    /new\.price_source := 'individual'/.test(c042) &&
      /new\.price_source := 'funcao_periodo'/.test(c042),
  ],
  [true, true, true, true, true],
);
verificar(
  "M15. o adicional é lido do próprio lançamento, passa ao núcleo FORA da base da hora extra e nasce zero",
  [
    /_bonus := case when tg_op = 'UPDATE' then coalesce\(old\.additional_amount, 0\) else 0 end;/.test(
      c042,
    ),
    /round\(_bonus \* 100\)::bigint/.test(c042),
    /new\.additional_amount       := _c_adic;/.test(c042),
    /_c_adic        := _n\.adicional_centavos::numeric \/ 100;/.test(c042),
    // a hora extra segue só da diária resolvida
    /_ot_hour_rate/.test(c042) &&
      !/_bonus[^;\n]*_ot_hour_rate|_ot_hour_rate[^;\n]*_bonus/.test(c042),
  ],
  [true, true, true, true, true],
);
verificar(
  "M16. trocar o colaborador de lançamento não faturado reprecifica (a 041 já tratava employee_id como coluna motriz)",
  [
    /new\.employee_id is distinct from old\.employee_id\)\)/.test(c042),
    /new\.employee_id\s+is distinct from old\.employee_id/.test(c042),
  ],
  [true, true],
);
verificar(
  "M17. o estado do motor anuncia diaria_individual e bonus_diario e mantém a chave da resolução",
  [
    /'diaria_individual', true/.test(corpoDaFuncao(m042, "estado_motor_vigencia") ?? ""),
    /'bonus_diario', true/.test(corpoDaFuncao(m042, "estado_motor_vigencia") ?? ""),
    /'resolucao_tarifas', public\.resolucao_de_tarifas_ativa\(\)/.test(
      corpoDaFuncao(m042, "estado_motor_vigencia") ?? "",
    ),
  ],
  [true, true, true],
);
verificar(
  "M18. gerar_fatura NÃO foi redefinida (itemização do adicional já vem da 037)",
  /function public\.gerar_fatura/.test(m042),
  false,
);

// ---------------------------------------------------------------------------
console.log("\nR. Runbook");
const rb = ler("docs/runbooks/rollback-diaria-individual-bonus.sql");
const ate = (numero, nome) => {
  let corpo = null;
  for (const f of migrations) {
    if (Number(f.split("_")[1]) >= numero) break;
    const c = corpoDaFuncao(ler(`supabase/migrations/${f}`), nome);
    if (c !== null) corpo = c;
  }
  return corpo;
};
verificar(
  "R1. o runbook devolve os corpos vigentes antes da 042 (motor, trava de colunas, estado)",
  ["derivar_valores_por_vigencia", "bloquear_colunas_de_condicoes", "estado_motor_vigencia"].map(
    (n) => corpoDaFuncao(rb, n) === ate(42, n),
  ),
  [true, true, true],
);
verificar(
  "R2. recusa ANTES de remover dado e roda numa transação",
  [
    rb.indexOf("Reversão recusada") < rb.search(/drop (column|table)|alter table[^;]*drop column/i),
    /^begin;$/m.test(rb) && /^commit;$/m.test(rb),
  ],
  [true, true],
);
verificar(
  "R3. recusa com diária individual, ligação a apontamento, adicional > 0 ou trilha",
  [
    /from public\.contract_employee_rates\) then/.test(rb),
    /contract_employee_rate_id is not null or price_source = 'individual'/.test(rb),
    /additional_amount > 0/.test(rb),
    /action like 'diaria_individual%' or action = 'apontamento_bonus_definido'/.test(rb),
  ],
  [true, true, true, true],
);
verificar(
  "R4. a lista de ações da trilha volta à da 041 (sem as cinco da 042)",
  (() => {
    const lista = rb.slice(rb.indexOf("add constraint financial_terms_audit_acao_valida"));
    return [
      lista.includes("'tarifas_resolucao_desativada'"),
      lista.includes("'diaria_individual_registrada'"),
      lista.includes("'apontamento_bonus_definido'"),
    ];
  })(),
  [true, false, false],
);

// ---------------------------------------------------------------------------
console.log("\nF. O código financeiro do app não conhece diária individual nem fonte de preço");
const FINANCEIRO = [
  "src/lib/billing.ts",
  "src/lib/nucleo-financeiro.ts",
  "src/lib/previa-v2.ts",
  "src/lib/componentes-financeiros.ts",
  "src/lib/apontamentos-financeiro.ts",
  "src/lib/ledger.ts",
  "src/lib/ledger-estado.ts",
  "src/lib/resumo-financeiro.ts",
  "src/lib/adicionais.ts",
  ...readdirSync(new URL("../src/lib/fechamento/", import.meta.url)).map(
    (f) => `src/lib/fechamento/${f}`,
  ),
  "src/app/(painel)/faturamento/painel-faturamento.tsx",
  "src/app/(painel)/dashboard/painel-dashboard.tsx",
  "src/app/(painel)/relatorios/painel-relatorios.tsx",
];
verificar(
  "F1. Fechamento, Faturamento, Relatórios, Dashboard e a prévia não citam diária individual, fonte do preço nem o adicional por RPC",
  FINANCEIRO.filter((f) =>
    /contract_employee_rate|price_source|diaria-individual|definir_bonus_do_apontamento/.test(
      ler(f),
    ),
  ),
  [],
);
verificar(
  "F2. as migrations financeiras anteriores à 042 não conhecem a diária individual",
  migrations
    .filter((f) => Number(f.split("_")[1]) <= 41 && Number(f.split("_")[1]) >= 25)
    .filter((f) => /contract_employee_rate|price_source/.test(ler(`supabase/migrations/${f}`))),
  [],
);
verificar(
  "F3. nenhuma chave, token ou service_role nos arquivos novos do app",
  ["src/lib/diaria-individual.ts", "src/lib/diaria-individual-dados.ts"].filter((f) =>
    /service_role|SUPABASE_[A-Z_]*KEY|eyJ[A-Za-z0-9_-]{20,}/.test(ler(f)),
  ),
  [],
);

// ---------------------------------------------------------------------------
console.log("\nB. Reconciliação sintética (14 colaboradores, uma diária fixa cada)");
// Distribuição sintética: C01–C14. Hora extra = diária da própria linha ÷ 8 × 1,5 × horas; o
// adicional diário NÃO entra na base. Cálculo em centavos inteiros, sem float.
const sintetica = [
  ["C01", "ajudante", 21000],
  ["C02", "ajudante", 21000],
  ["C03", "ajudante", 21000],
  ["C04", "ajudante", 21000],
  ["C05", "ajudante", 21000],
  ["C06", "ajudante", 22000],
  ["C07", "ajudante", 22500],
  ["C08", "conferente", 25000],
  ["C09", "conferente", 25000],
  ["C10", "conferente", 25000],
  ["C11", "conferente", 26000],
  ["C12", "conferente", 26000],
  ["C13", "operador", 26000],
  ["C14", "servicos_gerais", 26000],
];
const horaExtraCentavos = (diaria, horas) => Math.round((diaria * 3 * horas) / 16);
verificar(
  "B1. 14 colaboradores, 8 valores de diária por função como na distribuição sintética",
  [
    sintetica.length,
    sintetica.filter((l) => l[1] === "ajudante").map((l) => l[2]),
    sintetica.filter((l) => l[1] === "conferente").map((l) => l[2]),
  ],
  [14, [21000, 21000, 21000, 21000, 21000, 22000, 22500], [25000, 25000, 25000, 26000, 26000]],
);
verificar(
  "B2. HE de 1 h sobre a diária da própria linha: 210 → 39,375→39,38; 250 → 46,88; 260 → 48,75",
  [21000, 25000, 26000].map((d) => horaExtraCentavos(d, 1)),
  [3938, 4688, 4875],
);
verificar(
  "B3. 260 + HE 1 h (48,75) + adicional 30 = 338,75; a base da HE continua 260 (o adicional não a altera)",
  [26000 + horaExtraCentavos(26000, 1) + 3000, horaExtraCentavos(26000, 1)],
  [33875, 4875],
);
verificar(
  "B4. a diferença entre as diárias individuais e uma diária única por função (R$ 45,00 no dia) é preço da diária, não adicional",
  (() => {
    const porLinha = sintetica.reduce((s, l) => s + l[2], 0);
    const pelaFuncao = {
      ajudante: 21000,
      conferente: 25000,
      operador: 26000,
      servicos_gerais: 26000,
    };
    const comFuncaoUnica = sintetica.reduce((s, l) => s + pelaFuncao[l[1]], 0);
    return [porLinha, comFuncaoUnica, porLinha - comFuncaoUnica];
  })(),
  [328500, 324000, 4500],
);

// ---------------------------------------------------------------------------
console.log("\nC. Telas, capacidade e CI");
const tarifasTela = ler("src/app/(painel)/clientes/tarifas-do-contrato.tsx");
const diariasTela = ler("src/app/(painel)/clientes/diarias-individuais.tsx");
const clientesTela = ler("src/app/(painel)/clientes/painel-clientes.tsx");
const apontTela = ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx");
const precoTela = ler("src/app/(painel)/apontamentos/preco-do-dia.tsx");
const dadosVig = ler("src/lib/vigencias-dados.ts");
verificar(
  "C1. Contratos: a seção só aparece com a capacidade confirmada e com contrato aberto",
  [
    /diariaIndividual = false/.test(tarifasTela),
    /diariaIndividual && contrato !== null \? \(\s*<DiariasIndividuais/.test(tarifasTela),
    /diariaIndividual=\{diariaIndividual === "disponivel"\}/.test(clientesTela),
  ],
  [true, true, true],
);
verificar(
  "C2. Contratos: distingue a diária individual da tarifa da função, diz que não é custo e não inventa valor",
  [
    /Prevalece sobre a tarifa da função/.test(diariasTela),
    /Não é o custo do colaborador/.test(diariasTela),
    /Sem diária individual hoje: vale a tarifa da função/.test(diariasTela),
    /cadastrar diária individual não\s+muda nenhum valor/.test(diariasTela),
    /Motivo \(obrigatório\)/.test(diariasTela),
  ],
  [true, true, true, true, true],
);
verificar(
  "C3. Contratos: grava só pela RPC (versão nova com encerramento da anterior), nunca por tabela",
  [
    /useRegistrarDiariaIndividual/.test(diariasTela),
    /\.from\("contract_employee_rates"\)\s*\.(insert|update|delete|upsert)/.test(
      ler("src/lib/diaria-individual-dados.ts"),
    ),
    /p_encerrar_anterior: true/.test(ler("src/lib/diaria-individual-dados.ts")),
  ],
  [true, false, true],
);
verificar(
  "C4. Apontamentos: o preço do dia só aparece com a capacidade e para lançamento gravado e não falta",
  [
    /const diariaIndividual = useDiariaIndividual\(\) === "disponivel"/.test(apontTela),
    /diariaIndividual && gravado && gravado\.status !== "absent"/.test(apontTela),
    /<AdicionalDiarioDialog/.test(apontTela),
  ],
  [true, true, true],
);
verificar(
  "C5. Apontamentos: o adicional só é oferecido quando a pré-checagem passa e o texto diz que não entra na hora extra",
  [
    /motivoSemBonus\(gravado, bonusDiario, resolucaoLigada\) === null/.test(apontTela),
    /TEXTO_DO_BONUS/.test(precoTela),
    /Confirmo a substituição/.test(precoTela),
    /substituir: jaTem && substituir/.test(precoTela),
  ],
  [true, true, true, true],
);
verificar(
  "C6. as telas novas não calculam preço, não usam armazenamento do navegador nem chave",
  [
    ...[
      "src/app/(painel)/clientes/diarias-individuais.tsx",
      "src/app/(painel)/apontamentos/preco-do-dia.tsx",
    ].map((f) =>
      /localStorage|sessionStorage|service_role|Math\.round|toFixed|\* 1\.5|\/ 8/.test(ler(f)),
    ),
  ],
  [false, false],
);
verificar(
  "C7. capacidade: falha de consulta é 'desconhecida' (não 'indisponível') e o adicional falha fechado",
  [
    /export function useDiariaIndividual\(\): CapacidadeDeTarifas \{\s*const consulta = useConsultaDoMotor\(\);\s*if \(consulta\.isError \|\| !consulta\.data \|\| consulta\.data\.error\) return "desconhecida";/.test(
      dadosVig,
    ),
    /export function useBonusDiario\(\): boolean \{\s*const consulta = useConsultaDoMotor\(\);\s*if \(consulta\.isError \|\| !consulta\.data\) return false;/.test(
      dadosVig,
    ),
  ],
  [true, true],
);
const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
verificar(
  "C8. o script existe, o CI executa a suíte e conserva a anterior",
  [
    typeof pacote.scripts["test:diaria-individual-bonus"],
    /npm run test:diaria-individual-bonus/.test(ci),
    /npm run test:snapshots-tarifas/.test(ci),
  ],
  ["string", true, true],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
