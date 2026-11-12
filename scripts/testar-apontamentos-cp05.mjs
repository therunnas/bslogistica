/**
 * Regressão dos defeitos do CP-05 (QA-BS-01) — apontamentos e regras financeiras.
 *
 * COMO RODAR:
 *
 *   npm run test:apontamentos-cp05
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. Cada bloco
 * corresponde a um defeito reproduzido no E2E local (e2e/specs/80-apontamentos-financeiro) antes
 * da correção; aqui ficam as regras puras, a forma do código e a prova do D6.
 */

import { readFileSync } from "node:fs";

import {
  basesAposEdicao,
  basesDasSujas,
  linhasEmConflito,
  mensagemDeConflito,
  VERSAO_NOVA,
  versaoDoGravado,
} from "../src/lib/apontamentos-salvar.ts";
import { arredondarMinutosExtras, workedMinutes } from "../src/lib/billing.ts";
import {
  chaveDaConfirmacaoDeVirada,
  saidaAntesDaEntradaForaDoTurno,
  turnoViraODia,
} from "../src/lib/horarios.ts";
import { arredondarHoraExtraDiaria } from "../src/lib/nucleo-financeiro.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const a = typeof obtido === "string" ? obtido : JSON.stringify(obtido);
  const b = typeof esperado === "string" ? esperado : JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const admin = semComentarios(ler("src/app/(painel)/apontamentos/painel-apontamentos.tsx"));
const operador = semComentarios(ler("src/app/(painel)/operacional/painel-operacional.tsx"));

const DIURNO = { start_time: "08:00:00", end_time: "17:00:00", crosses_midnight: false };
const NOTURNO = { start_time: "22:00:00", end_time: "07:00:00", crosses_midnight: true };
const ATE_MEIA_NOITE = { start_time: "15:00:00", end_time: "00:00:00", crosses_midnight: false };
const CEDO = { start_time: "06:00:00", end_time: "15:00:00", crosses_midnight: false };

// ---------------------------------------------------------------------------------------------
// A. D1/B3: saída antes da entrada só é sinalizada fora de turno que vira o dia
// ---------------------------------------------------------------------------------------------

verificar(
  "A1. o cálculo continua contando 08:00 → 07:50 como 22h50 (a correção não muda o cálculo)",
  workedMinutes("08:00", "07:50", 60),
  1370,
);
verificar(
  "A2. 08:00 → 07:50 no turno 08–17: sinalizado (erro provável ou jornada excepcional)",
  saidaAntesDaEntradaForaDoTurno("present", "08:00", "07:50", DIURNO),
  true,
);
verificar(
  "A3. jornadas noturnas legítimas não são sinalizadas: 22→07 e 15→00",
  [
    saidaAntesDaEntradaForaDoTurno("present", "22:00", "07:00", NOTURNO),
    saidaAntesDaEntradaForaDoTurno("present", "15:00", "00:00", ATE_MEIA_NOITE),
    saidaAntesDaEntradaForaDoTurno("replacement", "22:30", "06:10", NOTURNO),
  ],
  [false, false, false],
);
verificar(
  "A4. o turno que vira o dia segue a regra do cálculo: marcado OU fim ≤ início",
  [turnoViraODia(NOTURNO), turnoViraODia(ATE_MEIA_NOITE), turnoViraODia(CEDO), turnoViraODia(null)],
  [true, true, false, false],
);
verificar(
  "A5. jornadas normais, falta, horário vazio e entrada = saída não são esta regra",
  [
    saidaAntesDaEntradaForaDoTurno("present", "06:00", "15:00", CEDO),
    saidaAntesDaEntradaForaDoTurno("absent", "08:00", "07:50", DIURNO),
    saidaAntesDaEntradaForaDoTurno("present", "08:00", "", DIURNO),
    saidaAntesDaEntradaForaDoTurno("present", "08:00", "08:00", DIURNO),
  ],
  [false, false, false, false],
);
verificar(
  "A6. folha sem turno: sem prova de jornada noturna, a virada é sinalizada",
  saidaAntesDaEntradaForaDoTurno("present", "08:00", "07:50", null),
  true,
);
verificar(
  "A7. a confirmação vale só para o colaborador e o par de horários confirmados",
  [
    chaveDaConfirmacaoDeVirada("e1", "08:00:00", "07:50"),
    chaveDaConfirmacaoDeVirada("e1", "08:00", "06:30") ===
      chaveDaConfirmacaoDeVirada("e1", "08:00", "07:50"),
  ],
  ["e1|08:00|07:50", false],
);
verificar(
  "A8. tela administrativa: bloqueia o botão e o envio sem a confirmação, e mostra a caixa na linha",
  [
    /saidaAntesDaEntradaForaDoTurno\(row\.status, row\.checkIn, row\.checkOut, shift\)/.test(admin),
    /!!viradasPendentes\.length \|\|/.test(admin),
    /if \(viradasPendentes\.length\) \{\s*throw new Error\(MENSAGEM_SAIDA_ANTES_DA_ENTRADA\);/.test(
      admin,
    ),
    /Confirmo que a jornada atravessou a meia-noite/.test(admin),
  ],
  [true, true, true, true],
);
verificar(
  "A9. tela do operador: a mesma regra, pelo turno da folha, no botão e no envio",
  [
    /saidaAntesDaEntradaForaDoTurno\(linha\.status, linha\.check_in, linha\.check_out, turno\)/.test(
      operador,
    ),
    /viradasPendentes\.length > 0\s*\n?\s*\}/.test(operador) ||
      /horariosIguais\.length > 0 \|\|\s*viradasPendentes\.length > 0/.test(operador),
    /if \(viradasPendentes\.length > 0\) \{\s*toast\.error\(MENSAGEM_SAIDA_ANTES_DA_ENTRADA\);/.test(
      operador,
    ),
    /Confirmo que a jornada atravessou a meia-noite/.test(operador),
  ],
  [true, true, true, true],
);

// ---------------------------------------------------------------------------------------------
// B. D-CP05-02: duas abas — conflito de versão antes de gravar
// ---------------------------------------------------------------------------------------------

const vazio = new Map();
verificar(
  "B1. linha nova que outra aba gravou nesse meio-tempo: conflito",
  linhasEmConflito(["bia"], vazio, vazio, new Map([["bia", "t1"]])),
  ["bia"],
);
verificar(
  "B2. linha editada sobre a versão t1 e o servidor já está em t2: conflito",
  linhasEmConflito(
    ["bia"],
    new Map([["bia", "t1"]]),
    new Map([["bia", "t2"]]),
    new Map([["bia", "t2"]]),
  ),
  ["bia"],
);
verificar(
  "B3. sem gravação concorrente: nenhum conflito (nova, e editada sobre a versão atual)",
  linhasEmConflito(
    ["ana", "bia"],
    new Map([["bia", "t1"]]),
    new Map([["bia", "t1"]]),
    new Map([["bia", "t1"]]),
  ),
  [],
);
verificar(
  "B4. a 1ª edição registra a versão vista; outra edição não a troca; desfazer a esquece",
  (() => {
    let b = basesAposEdicao(new Map(), "bia", true, "t1");
    b = basesAposEdicao(b, "bia", true, "t2");
    const depois = b.get("bia");
    b = basesAposEdicao(b, "bia", false, "t2");
    return [depois, b.has("bia")];
  })(),
  ["t1", false],
);
verificar(
  "B5. depois de salvar, só ficam as bases das linhas que continuam sujas",
  [
    ...basesDasSujas(
      new Map([
        ["ana", "t1"],
        ["bia", "t1"],
      ]),
      new Set(["bia"]),
    ).keys(),
  ],
  ["bia"],
);
verificar(
  "B6. versão: updated_at do gravado, ou nova",
  [
    versaoDoGravado({ updated_at: "2026-11-12T10:00:00Z" }),
    versaoDoGravado(undefined),
    VERSAO_NOVA,
  ],
  ["2026-11-12T10:00:00Z", "novo", "novo"],
);
verificar(
  "B7. a mensagem diz que nada foi gravado e manda recarregar",
  /Nada foi gravado\. Recarregue a página/.test(mensagemDeConflito(["Bia"])) &&
    /Ana, Bia, Caio e mais 1/.test(mensagemDeConflito(["Ana", "Bia", "Caio", "Davi"])),
  true,
);
verificar(
  "B8. a tela confere a versão ANTES da RPC e não envia em conflito",
  /linhasEmConflito\([\s\S]{0,400}?\);\s*if \(emConflito\.length\) \{\s*throw new Error\([\s\S]{0,200}?\}\s*const \{ error \} = await cliente\.rpc\("salvar_apontamento_admin"/.test(
    admin,
  ),
  true,
);

// ---------------------------------------------------------------------------------------------
// C. D-CP05-01: a tela diz o que "salvar o dia" grava
// ---------------------------------------------------------------------------------------------

verificar(
  "C1. administrador: linha sem apontamento marcada “Não gravado” e o total de não gravadas",
  [
    /!row\.entryId \? \(\s*<Badge[\s\S]{0,300}?Não gravado/.test(admin),
    /colaboradores ainda sem apontamento neste dia\./.test(admin),
  ],
  [true, true],
);
verificar(
  "C2. operador: aviso de presenças novas sem horário antes de salvar",
  /serão gravados como presentes sem horário\./.test(operador),
  true,
);

// ---------------------------------------------------------------------------------------------
// D. D6: as duas regras de arredondamento e onde cada uma vale (sem alterar cálculo)
// ---------------------------------------------------------------------------------------------

const limites = [14, 15, 16, 44, 45, 46, 70];
verificar(
  "D1. V2 (aprovada; dia útil e sábado no banco): 15 → 30 e 45 → 60",
  limites.map(arredondarHoraExtraDiaria),
  [0, 30, 30, 30, 60, 60, 60],
);
verificar(
  "D2. 030 (legado): 15 → 0 e 45 → 30 — diverge só em 15 e 45",
  limites.map(arredondarMinutosExtras),
  [0, 0, 30, 30, 30, 60, 60],
);
const sql030 = ler("supabase/migrations/20261028120000_030_regras_definitivas_bs.sql");
const sql035 = ler("supabase/migrations/20261102120000_035_nucleo_financeiro_puro.sql");
verificar(
  "D3. cada espelho TS bate com o seu SQL: billing ≡ 030 (<= 15/<= 45); núcleo ≡ 035 (< 15/< 45)",
  [
    /p_minutos % 60 <= 15 then[\s\S]{0,80}p_minutos % 60 <= 45 then/.test(sql030),
    /p_minutos % 60 < 15 then[\s\S]{0,80}p_minutos % 60 < 45 then/.test(sql035),
  ],
  [true, true],
);
const sql051 = ler("supabase/migrations/20261118120000_051_domingo_feriado_em_dobro.sql");
verificar(
  "D4. no motor vigente (051), a regra 030 só roda em domingo/feriado com o dobro E a resolução desligados",
  [
    /_legado030 := \(_dia = 'feriado' or extract\(isodow from _work_date\) = 7\) and not _esp;/.test(
      sql051,
    ),
    /_esp := _res or public\.dias_especiais_em_dobro_ativo\(\);/.test(sql051),
    /then public\.arredondar_minutos_extras\(_excesso_cob::integer\)/.test(sql051),
  ],
  [true, true, true],
);
const financeiro = semComentarios(ler("src/lib/apontamentos-financeiro.ts"));
verificar(
  "D5. com o dobro ligado, a prévia de domingo/feriado não usa a regra 030: só depois de salvar",
  /if \(especialV2\) return INDISPONIVEL\(avisoEspecial, false\);/.test(financeiro) &&
    /Domingo ou feriado: o valor aparece depois de salvar\./.test(financeiro),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
