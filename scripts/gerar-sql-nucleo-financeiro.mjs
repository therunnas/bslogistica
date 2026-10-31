/**
 * Gera `supabase/tests/035_nucleo_financeiro_puro.sql` (FIN-PR-01).
 *
 * COMO RODAR:  node scripts/gerar-sql-nucleo-financeiro.mjs
 *
 * O arquivo gerado é versionado; `test:nucleo-isolamento` confere que ele continua igual ao que
 * este gerador produz (sem deriva). Os valores esperados NÃO vêm do núcleo:
 *   - casos de referência: calculados à mão (`scripts/fixtures/nucleo-financeiro-golden.json`);
 *   - grade v2: oráculo independente (`scripts/_oraculo-financeiro.mjs`);
 *   - legado: o próprio trigger do banco (`scripts/fixtures/paridade-financeira-sql.json`);
 *   - arredondamento: tabela à mão, abaixo.
 * Os corpos das funções EXISTENTES são fixados por md5 do texto da migration que as define por
 * último: a 035 não pode ter mudado nenhuma delas.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CAMPOS_V2, gradeV2, oraculoV2 } from "./_oraculo-financeiro.mjs";

const raiz = new URL("../", import.meta.url);
const ler = (caminho) => readFileSync(new URL(caminho, raiz), "utf8");

export const CAMINHO_DO_SQL = "supabase/tests/035_nucleo_financeiro_puro.sql";
export const MIGRATION_DO_NUCLEO = "20261102120000_035_nucleo_financeiro_puro.sql";
export const SEMENTE_DA_GRADE_SQL = 35;
export const TAMANHO_DA_GRADE_SQL = 600;

/** Funções existentes cujo corpo a 035 não pode alterar. */
export const FUNCOES_FIXADAS = [
  "arredondar_minutos_extras",
  "derivar_valores_por_vigencia",
  "derivar_valores_financeiros",
  "motor_fonte_do_dia",
  "motor_custo_do_dia",
  "gerar_fatura",
  "ajustes_de_arredondamento_acumulado",
  "condicoes_exigir_admin",
  "mfa_cotidiano_ok",
];

/** Arredondamento da HE do modo diário, calculado à mão (minutos -> minutos cobrados). */
export const ARREDONDAMENTO_A_MAO = [
  [0, 0],
  [14, 0],
  [15, 30],
  [16, 30],
  [44, 30],
  [45, 60],
  [46, 60],
  [59, 60],
  [60, 60],
  [74, 60],
  [75, 90],
  [76, 90],
  [104, 90],
  [105, 120],
  [106, 120],
  [119, 120],
  [120, 120],
  [179, 180],
];

/** Meio centavo para cima, à mão: [numerador, denominador, esperado]. */
export const CENTAVOS_A_MAO = [
  [0, 1, 0],
  [1, 2, 1],
  [1, 3, 0],
  [2, 3, 1],
  [5, 10, 1],
  [14, 10, 1],
  [15, 10, 2],
  [500025, 100, 5000],
  [500050, 100, 5001],
];

// ---------------------------------------------------------------------------
// Corpos das funções existentes
// ---------------------------------------------------------------------------

function migrationsEmOrdem() {
  return readdirSync(new URL("supabase/migrations/", raiz))
    .filter((nome) => nome.endsWith(".sql") && nome !== MIGRATION_DO_NUCLEO)
    .sort();
}

/** Corpo (prosrc) da ÚLTIMA definição de `public.<nome>` no texto, ou null. */
export function corpoDaFuncao(texto, nome) {
  const cabecalho = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${nome}\\s*\\(`,
    "gi",
  );
  let corpo = null;
  for (const m of texto.matchAll(cabecalho)) {
    const resto = texto.slice(m.index);
    const abre = /\bas\s+(\$[a-z_]*\$)/i.exec(resto);
    if (!abre) continue;
    const inicio = abre.index + abre[0].length;
    const fim = resto.indexOf(abre[1], inicio);
    if (fim < 0) continue;
    corpo = resto.slice(inicio, fim);
  }
  return corpo;
}

export function corposFixados() {
  const arquivos = migrationsEmOrdem();
  return FUNCOES_FIXADAS.map((nome) => {
    let origem = null;
    let corpo = null;
    for (const arquivo of arquivos) {
      const c = corpoDaFuncao(ler(`supabase/migrations/${arquivo}`), nome);
      if (c !== null) {
        origem = arquivo;
        corpo = c;
      }
    }
    if (corpo === null) throw new Error(`definição de ${nome} não encontrada`);
    return { nome, origem, md5: createHash("md5").update(corpo, "utf8").digest("hex") };
  });
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? "null" : String(v));

export function esperadoV2(resultado) {
  if (resultado.erro) return `erro:${resultado.erro}`;
  return CAMPOS_V2.map((campo) => String(resultado[campo])).join("|");
}

export function casosDeReferencia() {
  const golden = JSON.parse(ler("scripts/fixtures/nucleo-financeiro-golden.json"));
  return golden.casos.map((c) => {
    const entrada = { ...golden.padrao, ...c.entrada };
    const esperado = c.esperado.erro
      ? { erro: c.esperado.erro }
      : Object.fromEntries(
          CAMPOS_V2.map((campo) => [
            campo,
            c.esperado[campo] ?? (campo === "cruzaMeiaNoite" ? false : 0),
          ]),
        );
    return { codigo: c.codigo, entrada, esperado };
  });
}

function linhaV2(codigo, e, esperado) {
  return `  (${q(codigo)}, ${q(e.status)}, ${q(e.tipoDoDia)}, ${q(e.entrada)}, ${q(e.saida)}, ${n(
    e.intervaloMinutos,
  )}, ${n(e.diariaCentavos)}, ${n(e.fatorHeCentesimos)}, ${n(e.fatorEspecialCentesimos)}, ${n(
    e.toleranciaMinutos,
  )}, ${q(e.modoHe)}, ${q(e.arredondamentoEspecial)}, ${n(e.adicionalCentavos)}, ${n(
    e.custoDiarioCentavos,
  )}, ${n(e.custoHoraHeCentavos)}, ${q(esperado)})`;
}

const centesimos = (texto) => {
  const [i, d = ""] = texto.split(".");
  return Number(i) * 100 + Number((d + "00").slice(0, 2));
};

function linhaLegado(c) {
  const turno = c.shift
    ? `public.nucleo_minutos_previstos(${q(c.shift.start)}, ${q(c.shift.end)}, ${n(
        c.shift.brk,
      )}, ${c.shift.cross ? "true" : "false"})`
    : "0";
  const esperado = `${c.sql.worked}|${c.sql.ot}|${c.sql.billed}|${c.sql.cost}`;
  return `  (${c.i}, ${q(c.status)}, ${q(c.in)}, ${q(c.out)}, ${n(c.brk)}, ${turno}, ${centesimos(
    c.dr,
  )}, ${centesimos(c.dc)}, ${centesimos(c.sh)}, ${centesimos(c.f)}, ${n(c.tol)}, ${q(esperado)})`;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export function gerarSqlDoNucleo() {
  const referencia = casosDeReferencia();
  const grade = gradeV2(TAMANHO_DA_GRADE_SQL, SEMENTE_DA_GRADE_SQL);
  const legado = JSON.parse(ler("scripts/fixtures/paridade-financeira-sql.json")).casos;
  const fixados = corposFixados();

  const linhasV2 = [
    ...referencia.map((c) => linhaV2(c.codigo, c.entrada, esperadoV2(c.esperado))),
    ...grade.map((e, i) =>
      linhaV2(`R${String(i + 1).padStart(4, "0")}`, e, esperadoV2(oraculoV2(e))),
    ),
  ];

  return `-- GERADO por scripts/gerar-sql-nucleo-financeiro.mjs. NÃO EDITAR À MÃO: altere o gerador e
-- rode \`node scripts/gerar-sql-nucleo-financeiro.mjs\`. \`test:nucleo-isolamento\` acusa deriva.
--
-- Migration 035 — núcleo financeiro puro (FIN-PR-01).
--
-- COMO RODAR: \`scripts/testar-sql-local.sh\` (Supabase LOCAL descartável). Uma transação que termina
-- em \`rollback\`; não escreve em tabela de negócio, só em tabelas temporárias.
--
-- O QUE ESTE ARQUIVO PROVA
--   A  arredondamento da HE diária e do centavo contra tabelas calculadas à mão
--   G  ${referencia.length} casos de referência das regras v2, calculados à mão
--   R  ${grade.length} casos sintéticos v2 (semente ${SEMENTE_DA_GRADE_SQL}) contra o oráculo independente
--   L  ${legado.length} casos do motor antigo (010): a aritmética exata reproduz o trigger REAL
--   K  isolamento: funções puras, sem acesso pela API, sem uso por nenhuma função ou gatilho
--   F  ${fixados.length} funções existentes com o corpo idêntico ao da migration que as define

begin;

create temporary table _resultado (
  ordem serial, caso text, esperado text, obtido text, situacao text
) on commit drop;

create or replace function pg_temp.registrar(_caso text, _esperado text, _obtido text) returns void
language plpgsql as $$
begin
  insert into _resultado (caso, esperado, obtido, situacao)
  values (_caso, _esperado, coalesce(_obtido, 'nulo'),
          case when _esperado = coalesce(_obtido, 'nulo') then 'PASS' else 'FAIL' end);
end;
$$;

create or replace function pg_temp.codigo_do_erro(_mensagem text) returns text language sql as $$
  select 'erro:' || coalesce(substring(_mensagem from '^nucleo:([a-z_0-9]+):'), 'desconhecido')
$$;

create or replace function pg_temp.obter_v2(
  _status text, _tipo text, _entrada time, _saida time, _intervalo integer, _diaria bigint,
  _fator_he integer, _fator_especial integer, _tolerancia integer, _modo text, _arred text,
  _adicional bigint, _custo bigint, _custo_hora bigint
) returns text language plpgsql as $$
declare _r text;
begin
  select concat_ws('|', r.minutos_trabalhados, r.cruza_meia_noite::text, r.he_minutos_cobrados,
                   r.he_minutos_pagos, r.especial_minutos_cobrados, r.base_centavos, r.he_centavos,
                   r.especial_centavos, r.adicional_centavos, r.total_centavos,
                   r.custo_base_centavos, r.custo_he_centavos, r.custo_especial_centavos,
                   r.custo_total_centavos)
    into _r
    from public.nucleo_componentes_v2(_status, _tipo, _entrada, _saida, _intervalo, _diaria,
      _fator_he, _fator_especial, _tolerancia, _modo, _arred, _adicional, _custo, _custo_hora) r;
  return _r;
exception when sqlstate '22023' then
  return pg_temp.codigo_do_erro(sqlerrm);
end;
$$;

-- ---------------------------------------------------------------------------
-- A. Arredondamento (tabelas à mão)
-- ---------------------------------------------------------------------------

select pg_temp.registrar('A1. HE diária ' || m || ' min', e::text, public.nucleo_arredondar_he_diaria(m)::text)
  from (values ${ARREDONDAMENTO_A_MAO.map(([m, e]) => `(${m}, ${e})`).join(", ")}) t(m, e);

select pg_temp.registrar('A2. centavos ' || a || '/' || b, e::text, public.nucleo_arredondar_centavos(a, b)::text)
  from (values ${CENTAVOS_A_MAO.map(([a, b, e]) => `(${a}, ${b}, ${e})`).join(", ")}) t(a, b, e);

create or replace function pg_temp.erro_da_he(_minutos integer) returns text language plpgsql as $$
begin
  perform public.nucleo_arredondar_he_diaria(_minutos);
  return 'sem erro';
exception when sqlstate '22023' then
  return pg_temp.codigo_do_erro(sqlerrm);
end;
$$;

select pg_temp.registrar('A3. HE diária negativa é recusada', 'erro:parametro_invalido', pg_temp.erro_da_he(-1));

select pg_temp.registrar('A4. divisor 8 no sábado: 30 min de HE sobre 200,00 = 1875 (divisor 4 daria 3750)', '1875',
  (select he_centavos::text from public.nucleo_componentes_v2('present', 'sabado', '08:00', '12:15', 0,
     20000, 150, 200, 10, 'diario', 'minutos', 0, 12000, null)));

-- ---------------------------------------------------------------------------
-- G e R. Regras v2: casos à mão e grade do oráculo
-- ---------------------------------------------------------------------------

create temporary table _casos_v2 (
  codigo text, status text, tipo text, entrada time, saida time, intervalo integer, diaria bigint,
  fator_he integer, fator_especial integer, tolerancia integer, modo text, arred text,
  adicional bigint, custo bigint, custo_hora bigint, esperado text
) on commit drop;

insert into _casos_v2 values
${linhasV2.join(",\n")};

select pg_temp.registrar(c.codigo, c.esperado,
         pg_temp.obter_v2(c.status, c.tipo, c.entrada, c.saida, c.intervalo, c.diaria, c.fator_he,
           c.fator_especial, c.tolerancia, c.modo, c.arred, c.adicional, c.custo, c.custo_hora))
  from _casos_v2 c order by c.codigo;

select pg_temp.registrar('G0. identidade: total = base + HE + especial + adicional em todos os casos sem erro', '0',
  (select count(*)::text
     from _casos_v2 c
     cross join lateral public.nucleo_componentes_v2(c.status, c.tipo, c.entrada, c.saida, c.intervalo,
       c.diaria, c.fator_he, c.fator_especial, c.tolerancia, c.modo, c.arred, c.adicional, c.custo,
       c.custo_hora) r
    where c.esperado not like 'erro:%'
      and (r.total_centavos <> r.base_centavos + r.he_centavos + r.especial_centavos + r.adicional_centavos
        or r.custo_total_centavos <> r.custo_base_centavos + r.custo_he_centavos + r.custo_especial_centavos
        or (r.especial_centavos > 0 and (r.base_centavos <> 0 or r.he_centavos <> 0)))));

-- ---------------------------------------------------------------------------
-- L. Motor antigo (010): o resultado do trigger REAL, gravado na fixture
-- ---------------------------------------------------------------------------

create temporary table _casos_legado (
  i integer, status text, entrada time, saida time, intervalo integer, previsto integer,
  diaria bigint, custo bigint, jornada integer, fator integer, tolerancia integer, esperado text
) on commit drop;

insert into _casos_legado values
${legado.map(linhaLegado).join(",\n")};

select pg_temp.registrar('L1. motor antigo: ' || count(*) || ' casos iguais ao trigger real', '0',
  count(*) filter (
    where concat_ws('|', r.minutos_trabalhados, r.minutos_extras, r.cobrado_centavos, r.custo_centavos)
          <> c.esperado)::text)
  from _casos_legado c
  cross join lateral public.nucleo_componentes_legado_010(c.status, c.entrada, c.saida, c.intervalo,
    c.previsto, c.diaria, c.custo, c.jornada, c.fator, c.tolerancia) r;

select pg_temp.registrar('L2. a fixture do trigger tem ${legado.length} casos', '${legado.length}',
  (select count(*)::text from _casos_legado));

-- ---------------------------------------------------------------------------
-- K. Isolamento e segurança das funções novas
-- ---------------------------------------------------------------------------

create temporary table _nucleo on commit drop as
  select p.oid, p.proname, p.provolatile, p.prosecdef, p.proconfig, p.prosrc, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'nucleo\\_%';

select pg_temp.registrar('K1. as seis funções do núcleo existem',
  'nucleo_arredondar_centavos,nucleo_arredondar_he_diaria,nucleo_componentes_legado_010,nucleo_componentes_v2,nucleo_minutos_previstos,nucleo_minutos_trabalhados',
  (select string_agg(proname, ',' order by proname) from _nucleo));
select pg_temp.registrar('K2. todas IMMUTABLE', '0', (select count(*)::text from _nucleo where provolatile <> 'i'));
select pg_temp.registrar('K3. nenhuma SECURITY DEFINER', '0', (select count(*)::text from _nucleo where prosecdef));
select pg_temp.registrar('K4. todas com search_path = pg_catalog', '0',
  (select count(*)::text from _nucleo where not coalesce('search_path=pg_catalog' = any(proconfig), false)));
select pg_temp.registrar('K5. sem EXECUTE para anon, authenticated e service_role', '0',
  (select count(*)::text from _nucleo
    where has_function_privilege('anon', oid, 'execute')
       or has_function_privilege('authenticated', oid, 'execute')
       or has_function_privilege('service_role', oid, 'execute')));
select pg_temp.registrar('K6. sem EXECUTE para PUBLIC', '0',
  (select count(*)::text from _nucleo, aclexplode(coalesce(proacl, acldefault('f', 10))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select pg_temp.registrar('K7. o corpo não lê tabela, auth nem outra função de public', '0',
  (select count(*)::text from _nucleo
    where prosrc ~* '\\mauth\\.' or prosrc ~* 'public\\.(?!nucleo_)'
       or prosrc ~* '\\m(select|insert|update|delete|perform|execute|copy|now|current_)\\M'));
-- FIN-PR-02: a única função que chama o núcleo é o motor por vigência (migration 036). Antes da 036,
-- nenhuma chamava. Este caso trocou "nenhuma" por "só a derivação do motor", sem abrir mais ninguém.
-- Conta CHAMADAS ('nucleo_xxx('): a chave 'nucleo_v2' do estado do motor é texto, não chamada.
select pg_temp.registrar('K8. só o motor por vigência chama o núcleo (nenhuma outra função, nenhum gatilho de leitura)', '',
  (select coalesce(string_agg(p.proname, ',' order by p.proname) filter (where p.proname <> 'derivar_valores_por_vigencia'), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_temp\\_%'
      and p.proname not like 'nucleo\\_%' and p.prosrc ~ 'nucleo_[a-z_0-9]+\\s*\\('));
select pg_temp.registrar('K8b. a derivação do motor chama nucleo_componentes_v2 (ligação da 036)', '1',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'derivar_valores_por_vigencia' and p.prosrc ~ 'nucleo_componentes_v2'));
select pg_temp.registrar('K9. nenhum gatilho usa o núcleo', '0',
  (select count(*)::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where p.proname like 'nucleo\\_%'));

-- ---------------------------------------------------------------------------
-- F. Funções existentes intocadas (corpo = texto da migration que as define por último)
-- ---------------------------------------------------------------------------

${fixados
  .map(
    (f) => `select pg_temp.registrar('F. ${f.nome} (${f.origem.slice(0, 18)})', '1|${f.md5}',
  (select count(*)::text || '|' || coalesce(max(md5(p.prosrc)), '-') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '${f.nome}'));`,
  )
  .join("\n")}

-- ---------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------

select ordem, situacao, caso, esperado, obtido from _resultado where situacao = 'FAIL' order by ordem limit 50;

select count(*) filter (where situacao = 'PASS') as passou,
       count(*) filter (where situacao = 'FAIL') as falhou,
       count(*)                                  as total
  from _resultado;

do $veredito$
declare _falhas int;
begin
  select count(*) into _falhas from _resultado where situacao = 'FAIL';
  if _falhas > 0 then
    raise exception '035_nucleo_financeiro_puro: % caso(s) FALHARAM', _falhas;
  end if;
end;
$veredito$;

rollback;
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL(CAMINHO_DO_SQL, raiz), gerarSqlDoNucleo());
  console.log(`gerado: ${CAMINHO_DO_SQL}`);
}
