import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { datasAtivas } from "../src/lib/feriados.ts";
import { valorDaLinha } from "../src/lib/apontamentos-financeiro.ts";

// Detecta a inclusão indevida de calendário territorial no fluxo legado OFF.
assert.deepEqual(
  datasAtivas([
    { active: true, holiday_date: "2026-11-02" },
    { active: true, holiday_date: "2026-11-03", territory_scope: "municipal" },
    { active: true, holiday_date: "2026-11-04", territory_scope: "legado" },
    { active: false, holiday_date: "2026-11-05", territory_scope: "legado" },
  ]),
  ["2026-11-02", "2026-11-04"],
);
const c = await import("../src/lib/calendario-territorial.ts");
assert.equal(c.capacidadeCalendario({ ativo: true, consistente: true }, null), "indisponivel");
assert.equal(
  c.capacidadeCalendario({ calendario_territorial: true }, { message: "rede" }),
  "desconhecida",
);
assert.equal(
  c.capacidadeCalendario({ ativo: true, consistente: true, calendario_territorial: true }, null),
  "disponivel",
);
for (const dados of [null, [], {}, { ativo: true, consistente: false }]) {
  assert.equal(c.capacidadeCalendario(dados, null), "desconhecida");
}
assert.equal(c.urlOficial("https://www.planalto.gov.br/lei"), true);
for (const url of [
  "javascript:alert(1)",
  "https://evil.example/lei",
  "https://x.gov.br.evil.org/",
  "http://x.gov.br/",
]) {
  assert.equal(c.urlOficial(url), false);
}
assert.throws(() => c.interpretarMunicipios([{ id: 1, nome: "Inválido" }], "SC"));
assert.throws(() => c.interpretarMunicipios([], "SC"));
assert.throws(() => c.interpretarMunicipios([{ id: 4209102, nome: "Joinville" }], "XX"));
assert.throws(() =>
  c.interpretarMunicipios(
    [
      { id: 4209102, nome: "Joinville" },
      { id: 4209102, nome: "Joinville" },
    ],
    "SC",
  ),
);
const municipioOficial = {
  id: 4209102,
  nome: "Joinville",
  microrregiao: { mesorregiao: { UF: { sigla: "SC" } } },
};
// Detecta atribuição da UF recebida como parâmetro sem conferir o vínculo oficial.
assert.throws(() => c.interpretarMunicipios([municipioOficial], "SP"));
assert.throws(() => c.interpretarMunicipios([{ ...municipioOficial, id: 3509502 }], "SC"));
assert.throws(() => c.interpretarMunicipios([{ id: 4209102, nome: "Joinville" }], "SC"));
const municipios = c.interpretarMunicipios([municipioOficial], "SC");
const porRegiaoImediata = {
  id: 3205309,
  nome: "Vitória",
  "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: "ES" } } },
};
assert.equal(c.interpretarMunicipios([porRegiaoImediata], "ES")[0].uf, "ES");
assert.equal(municipios[0].codigo, "4209102");
assert.match(municipios[0].fonteUrl, /^https:\/\/servicodados\.ibge\.gov\.br\//);
assert.equal(c.UFS.length, 27);
const f = {
  data: "2026-11-02",
  nome: "Finados",
  motivo: "Lei conferida",
  ambito: "nacional",
  uf: "",
  municipio: "",
  norma: "Lei 10.607",
  fonte: "https://www.planalto.gov.br/lei",
  confirmado: true,
  tipo: "feriado",
  movel: false,
};
// CF, art. 32: DF tem calendário distrital; Brasília continua como identidade IBGE do local.
const distrital = { ...f, ambito: "distrital", uf: "DF", municipio: "" };
assert.deepEqual(c.validarTerritorio(distrital), []);
assert.ok(c.validarTerritorio({ ...distrital, uf: "SC" }).length);
assert.ok(c.validarTerritorio({ ...distrital, municipio: "5300108" }).length);
assert.ok(c.validarTerritorio({ ...distrital, ambito: "estadual" }).length);
assert.ok(c.validarTerritorio({ ...distrital, ambito: "municipal", municipio: "5300108" }).length);
assert.deepEqual(c.validarFeriadoTerritorial(distrital), []);
assert.deepEqual(c.validarCoberturaTerritorial({ ...distrital, confirmado: false }, 2026), []);
assert.deepEqual(c.dadosTerritoriais(distrital), {
  territory_scope: "distrital",
  state_code: "DF",
  municipality_code: null,
  legal_act: "Lei 10.607",
  official_url: "https://www.planalto.gov.br/lei",
  client_confirmed: true,
});
assert.deepEqual(
  c.interpretarMunicipios(
    [
      {
        id: 5300108,
        nome: "Brasília",
        microrregiao: { mesorregiao: { UF: { sigla: "DF" } } },
      },
    ],
    "DF",
  ),
  [
    {
      codigo: "5300108",
      nome: "Brasília",
      uf: "DF",
      fonteUrl: "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/5300108",
    },
  ],
);
console.log("PASS DF: 9 asserções de âmbito distrital exclusivo e identidade IBGE Brasília.");
assert.deepEqual(c.validarFeriadoTerritorial(f), []);
for (const alteracao of [
  { data: "2026-02-30" },
  { ambito: "municipal" },
  { tipo: "ponto_facultativo", confirmado: true },
  { fonte: "https://example.com" },
  { norma: "" },
]) {
  assert.ok(c.validarFeriadoTerritorial({ ...f, ...alteracao }).length);
}
assert.deepEqual(
  c.validarFeriadoTerritorial({ ...f, tipo: "ponto_facultativo", confirmado: false }),
  [],
);
assert.equal(c.dadosTerritoriais(f).municipality_code, null);
const confirmado = {
  status: "confirmado",
  municipality_code: "4209102",
  state_code: "SC",
  location_term_id: "local-1",
  holiday_ids: [],
  coverage_ids: ["c1", "c2", "c3"],
  day_kind: "util",
};
assert.deepEqual(c.lerCalendarioDaOperacao(confirmado), confirmado);
assert.throws(() => c.lerCalendarioDaOperacao({ ...confirmado, municipality_code: null }));
assert.throws(() => c.lerCalendarioDaOperacao({ ...confirmado, day_kind: null }));
assert.throws(() => c.lerCalendarioDaOperacao({ ...confirmado, holiday_ids: [null] }));
const entrada = {
  estado: { tag: "ligado" },
  status: "present",
  gravada: false,
  tocada: true,
  gravado: null,
  regrasDoCadastro: {},
  custoDoCadastro: 0,
  condicaoDoDia: { ok: true, regras: {}, custoDiario: 0, origem: "x" },
  plannedMinutes: 480,
  regrasBs: true,
  regrasDefinitivas: true,
  estadoDoCalendario: "erro",
  calcular: () => {
    throw new Error("Prévia comum indevida");
  },
};
for (const estadoDoCalendario of ["erro", "carregando", "pendente", "localidade_ausente"]) {
  assert.equal(valorDaLinha({ ...entrada, estadoDoCalendario }).bloqueiaSalvar, true);
}
assert.equal(
  valorDaLinha({
    ...entrada,
    gravada: true,
    tocada: false,
    gravado: { status: "present", billed_amount: 321, cost_amount: 123, overtime_minutes: 0 },
  }).billed,
  321,
);
assert.equal(
  valorDaLinha({
    ...entrada,
    estado: { tag: "desligado" },
    calcular: () => ({ billedAmount: 5, costAmount: 3, overtimeMinutes: 0 }),
  }).billed,
  5,
);
// Barreiras da integração: o proxy se autoriza sozinho e a tela não rebaixa a 030 por erro.
const api = readFileSync("src/app/api/calendario/municipios/route.ts", "utf8");
assert.match(api, /await lerAcesso\(\)/);
assert.match(api, /ehAdmin\(acesso.papeis\)/);
assert.match(api, /AbortSignal.timeout\(8_000\)/);
assert.match(api, /redirect: "error"/);
assert.match(api, /interpretarMunicipios\(await resposta.json\(\), uf\)/);
const painel = readFileSync("src/app/(painel)/apontamentos/painel-apontamentos.tsx", "utf8");
assert.doesNotMatch(painel, /regrasDefinitivas: regrasDefinitivas && feriados.isSuccess/);
// Detecta capability confundida com ativação: motor ON não significa resolução ON.
assert.doesNotMatch(
  painel,
  /calendarioTerritorial === "disponivel" && estadoDoMotor.tag === "ligado"/,
);
assert.match(painel, /regimeDoCalendario === "territorial" && estadoDoMotor.tag === "ligado"/);
console.log("PASS calendário territorial: legado, fonte, localidade, validação e prévia fechada.");

assert.equal(typeof c.lerSnapshotCalendario, "function");
const uid = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  version: 1,
  location: {
    location_term_id: uid,
    municipality_code: "4209102",
    municipality_name: "Joinville",
    state_code: "SC",
  },
  days: [
    {
      date: "2026-11-02",
      status: "confirmado",
      municipality_code: "4209102",
      state_code: "SC",
      location_term_id: uid,
      holiday_ids: [uid],
      coverage_ids: [uid, uid, uid],
      day_kind: "feriado",
    },
  ],
  segments: {
    status: "intervalo_sem_horario",
    worked_minutes: 480,
    segments: [{ date: "2026-11-02", gross_minutes: 540, worked_minutes: null }],
  },
};
assert.deepEqual(c.lerSnapshotCalendario(snapshot), snapshot);
const snapshotDF = {
  ...snapshot,
  location: {
    ...snapshot.location,
    municipality_code: "5300108",
    municipality_name: "Brasília",
    state_code: "DF",
  },
  days: [
    {
      ...snapshot.days[0],
      municipality_code: "5300108",
      state_code: "DF",
      coverage_ids: [uid, uid],
    },
  ],
};
assert.deepEqual(c.lerSnapshotCalendario(snapshotDF), snapshotDF);
console.log("PASS DF: snapshot preserva Brasília/5300108 com duas coberturas.");
assert.equal(c.lerSnapshotCalendario(null), null);
assert.equal(c.lerSnapshotCalendario({ ...snapshot, version: 2 }), null);
assert.equal(
  c.lerSnapshotCalendario({ ...snapshot, location: { ...snapshot.location, state_code: "SP" } }),
  null,
);
assert.equal(
  c.lerSnapshotCalendario({ ...snapshot, days: [{ ...snapshot.days[0], day_kind: "ignorado" }] }),
  null,
);
assert.equal(
  c.lerSnapshotCalendario({ ...snapshot, segments: { ...snapshot.segments, worked_minutes: -1 } }),
  null,
);
assert.equal(
  c.lerSnapshotCalendario({
    ...snapshot,
    segments: { ...snapshot.segments, status: ["confirmado"] },
  }),
  null,
);
assert.equal(
  c.lerSnapshotCalendario({ ...snapshot, days: [{ ...snapshot.days[0], day_kind: ["util"] }] }),
  null,
);
assert.ok(
  c.validarFeriadoTerritorial({ ...f, ambito: "municipal", uf: "SC", municipio: "3509502" }).length,
);
assert.throws(() => c.lerCalendarioDaOperacao({ ...confirmado, state_code: "SP" }));
console.log(
  "PASS IBGE: vínculo UF e prefixo; snapshot territorial congelado validado sem cálculo.",
);

const motor044 = { ativo: true, consistente: true, calendario_territorial: true };
assert.equal(c.regimeCalendario({ ...motor044, resolucao_tarifas: false }, null), "legado");
assert.equal(c.regimeCalendario({ ...motor044, resolucao_tarifas: true }, null), "territorial");
assert.equal(c.regimeCalendario(motor044, null), "desconhecido");
assert.equal(
  c.regimeCalendario({ ...motor044, resolucao_tarifas: false }, { message: "rede" }),
  "desconhecido",
);
assert.equal(c.regimeCalendario({ ativo: true, consistente: true }, null), "legado");
assert.equal(
  c.regimeCalendario({ ...motor044, ativo: false, resolucao_tarifas: true }, null),
  "desconhecido",
);
assert.equal(
  c.regimeCalendario({ ...motor044, ativo: false, resolucao_tarifas: false }, null),
  "legado",
);

// Snapshot válido dispensa a cobertura atual; formato inválido ou outra data não dispensa.
assert.equal(typeof c.calendarioCongeladoNaData, "function");
assert.equal(c.calendarioCongeladoNaData(snapshot, "2026-11-02").day_kind, "feriado");
assert.equal(c.calendarioCongeladoNaData(snapshot, "2026-11-03"), null);
assert.equal(c.calendarioCongeladoNaData({ ...snapshot, version: 7 }, "2026-11-02"), null);
assert.equal(
  c.situacaoCobertura({ active: true, territory_scope: "nacional", client_confirmed: false }),
  "confirmado",
);
assert.equal(
  c.situacaoCobertura({ active: true, territory_scope: "estadual", client_confirmed: false }),
  "confirmado",
);
assert.equal(
  c.situacaoCobertura({ active: true, territory_scope: "municipal", client_confirmed: false }),
  "pendente",
);
assert.equal(
  c.situacaoCobertura({ active: false, territory_scope: "municipal", client_confirmed: true }),
  "aposentado",
);
assert.equal(c.periodoLocalValido("2026-11-02", "2026-11-02"), false);
assert.equal(c.periodoLocalValido("2026-11-02", "2026-11-01"), false);
assert.equal(c.periodoLocalValido("2026-02-30", ""), false);
assert.equal(c.periodoLocalValido("2026-11-02", "2026-11-03"), true);
assert.equal(c.periodoLocalValido("2026-11-02", ""), true);

assert.match(painel, /estadoDoCalendario: calendarioCongelado \? "pronto" : estadoDoCalendario/);
assert.ok(
  painel.indexOf("const precisaDoCalendarioAtual") < painel.indexOf("const contextoCalendario"),
);
assert.match(painel, /consultarCalendarioAtual && precisaDoCalendarioAtual/);
const telaCalendario = readFileSync(
  "src/app/(painel)/_components/calendario-territorial.tsx",
  "utf8",
);
assert.match(telaCalendario, /Fim exclusivo da vigência/);
assert.match(telaCalendario, /!periodoLocalValido\(inicio, fim\)/);
console.log("PASS edição congelada, cobertura por âmbito e fim exclusivo de vigência.");

// UX-OPERACAO-01 (A): com a resolução comercial OFF o cálculo usa a lista única de feriados e
// ignora a localidade; o bloco de localidade e o aviso "Localidade ausente" não aparecem na
// operação. Com o regime territorial (ON) ou desconhecido, o comportamento anterior continua.
const blocoLocalidade = telaCalendario.slice(
  telaCalendario.indexOf("export function LocalidadeDaOperacao"),
);
assert.match(blocoLocalidade, /const regime = useRegimeDoCalendario\(\);/);
assert.match(blocoLocalidade, /if \(regime === "legado"\) return null;/);
assert.ok(
  blocoLocalidade.indexOf('if (regime === "legado") return null;') <
    blocoLocalidade.indexOf("<p>Localidade ausente."),
  "a saída para o regime legado vem antes do aviso de localidade ausente",
);
assert.ok(
  blocoLocalidade.indexOf("const regime = useRegimeDoCalendario();") <
    blocoLocalidade.indexOf('if (capacidade === "indisponivel") return null;'),
  "o hook do regime é chamado antes de qualquer retorno antecipado (regra dos hooks)",
);
assert.match(
  telaCalendario,
  /import \{[^}]*useRegimeDoCalendario[^}]*\} from "@\/lib\/vigencias-dados";/,
);
console.log("PASS localidade da operação oculta com o regime legado (resolução OFF).");
assert.equal(
  valorDaLinha({ ...entrada, estado: { tag: "desconhecido", motivo: "rede" } }).bloqueiaSalvar,
  true,
);
assert.equal(valorDaLinha({ ...entrada, estado: { tag: "carregando" } }).bloqueiaSalvar, true);
assert.equal(typeof c.validarCoberturaTerritorial, "function");
assert.deepEqual(c.validarCoberturaTerritorial({ ...f, confirmado: false }, 2026), []);
assert.ok(
  c.validarCoberturaTerritorial(
    { ...f, ambito: "municipal", uf: "SC", municipio: "4209102", confirmado: false },
    2026,
  ).length,
);
assert.deepEqual(
  c.validarCoberturaTerritorial(
    { ...f, ambito: "municipal", uf: "SC", municipio: "4209102", confirmado: true },
    2026,
  ),
  [],
);

const financeiro043 = {
  status: "present",
  terms_origin: "valor_acordado",
  daily_rate_snapshot: 200,
  daily_cost_snapshot: 100,
  shift_hours_snapshot: 8,
  ot_factor_snapshot: 1.5,
  ot_tolerance_snapshot: 15,
  planned_minutes_snapshot: 480,
  day_kind_snapshot: "util",
  billed_amount: 200,
  cost_amount: 100,
  overtime_minutes: 0,
};
const antigaEditada = {
  ...entrada,
  gravada: true,
  tocada: true,
  gravado: financeiro043,
  estadoDoCalendario: "pendente",
  tipoDoDia: "feriado",
  diasEspeciaisV2: true,
  calcular: ({ horas }) => {
    assert.equal(horas.tipoDoDia, "util");
    return { billedAmount: 200, costAmount: 100, overtimeMinutes: 0 };
  },
};
assert.equal(valorDaLinha(antigaEditada).tipo, "previa");
assert.equal(valorDaLinha(antigaEditada).bloqueiaSalvar, false);
assert.equal(valorDaLinha({ ...entrada, status: "absent" }).billed, 0);
assert.equal(valorDaLinha({ ...entrada, status: "absent" }).bloqueiaSalvar, false);
const antigaSemClassificacao = {
  ...antigaEditada,
  gravado: { ...financeiro043, day_kind_snapshot: null },
  calendarioLegado: { estado: "erro", tipoDoDia: "util" },
};
assert.equal(valorDaLinha(antigaSemClassificacao).bloqueiaSalvar, true);
assert.equal(
  valorDaLinha({ ...antigaEditada, gravado: { ...financeiro043, terms_origin: null } })
    .bloqueiaSalvar,
  true,
);

const antigaComFallback030 = {
  ...antigaSemClassificacao,
  calendarioLegado: { estado: "pronto", tipoDoDia: "feriado" },
  tipoDoDia: "util",
  diasEspeciaisV2: false,
  calcular: ({ horas }) => {
    assert.equal(horas.tipoDoDia, "feriado");
    return { billedAmount: 200, costAmount: 100, overtimeMinutes: 0 };
  },
};
assert.equal(valorDaLinha(antigaComFallback030).tipo, "previa");
assert.equal(
  valorDaLinha({ ...entrada, gravada: true, gravado: { ...financeiro043, status: "absent" } })
    .bloqueiaSalvar,
  true,
);
console.log(
  "PASS calendário atual só em captura; falta zero; presença043 usa classificação congelada/030.",
);

await import("./test-calendario-interface-r1.mjs");
