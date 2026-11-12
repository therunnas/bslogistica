/**
 * Regressão dos defeitos do CP-04 (QA-BS-01) — operações, turnos e equipes.
 *
 * COMO RODAR:
 *
 *   npm run test:operacoes-turnos
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. Cada bloco
 * corresponde a um defeito reproduzido no E2E local (e2e/specs/70-operacoes-turnos-equipes) antes
 * da correção; aqui ficam as regras puras e a forma do código.
 */

import { readFileSync } from "node:fs";

import {
  AVISO_TERMINA_NO_DIA_SEGUINTE,
  AVISO_TURNO_DE_24_HORAS,
  MENSAGEM_HORARIO_OBRIGATORIO,
  MENSAGEM_INTERVALO_MAIOR,
  MENSAGEM_INTERVALO_NEGATIVO,
  MENSAGEM_VIRA_COM_FIM_DEPOIS,
  avisosDoTurno,
  consequenciasDaExclusaoDaOperacao,
  consequenciasDaExclusaoDoTurno,
  errosDoTurno,
  rotuloDoCliente,
  situacaoDoContrato,
} from "../src/app/(painel)/operacoes/_dominio.ts";
import { shiftPlannedMinutes } from "../src/lib/billing.ts";

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
const tela = semComentarios(ler("src/app/(painel)/operacoes/painel-operacoes.tsx"));

const t = (inicio, fim, intervalo = 60, viraAMeiaNoite = false) => ({
  inicio,
  fim,
  intervalo,
  viraAMeiaNoite,
});

// ---------------------------------------------------------------------------------------------
// A. Turnos: horários impossíveis bloqueados, meia-noite legítima aceita, cálculo intacto
// ---------------------------------------------------------------------------------------------

verificar("A1. 06:00–15:00 é aceito", errosDoTurno(t("06:00", "15:00")), []);
verificar("A2. 15:00–00:00 sem marcar é aceito", errosDoTurno(t("15:00", "00:00")), []);
verificar("A3. 15:00–00:00 avisa que termina no dia seguinte", avisosDoTurno(t("15:00", "00:00")), [
  AVISO_TERMINA_NO_DIA_SEGUINTE,
]);
verificar("A4. 22:00–07:00 marcado é aceito", errosDoTurno(t("22:00", "07:00", 60, true)), []);
verificar(
  "A5. 08:00–17:00 com “Vira a meia-noite” é bloqueado (33 h no cálculo)",
  errosDoTurno(t("08:00", "17:00", 60, true)),
  [MENSAGEM_VIRA_COM_FIM_DEPOIS],
);
verificar("A6. intervalo maior que o turno", errosDoTurno(t("08:00", "10:00", 180)), [
  MENSAGEM_INTERVALO_MAIOR,
]);
verificar("A7. intervalo negativo", errosDoTurno(t("08:00", "17:00", -5)), [
  MENSAGEM_INTERVALO_NEGATIVO,
]);
verificar("A8. horário vazio", errosDoTurno(t("", "17:00")), [MENSAGEM_HORARIO_OBRIGATORIO]);
verificar(
  "A9. início igual ao fim: só aviso de 24 h (jornada atípica é decisão)",
  [errosDoTurno(t("07:00", "07:00")), avisosDoTurno(t("07:00", "07:00"))],
  [[], [AVISO_TURNO_DE_24_HORAS]],
);
verificar(
  "A10. a regra de duração é a do cálculo: 15:00–00:00 e 22:00–07:00 dão 8 h no billing",
  [
    shiftPlannedMinutes({
      start_time: "15:00",
      end_time: "00:00",
      break_minutes: 60,
      crosses_midnight: false,
    }),
    shiftPlannedMinutes({
      start_time: "22:00",
      end_time: "07:00",
      break_minutes: 60,
      crosses_midnight: true,
    }),
    shiftPlannedMinutes({
      start_time: "08:00",
      end_time: "17:00",
      break_minutes: 60,
      crosses_midnight: true,
    }),
  ],
  // O terceiro é o caso que a tela passou a bloquear: 32 h líquidas.
  [480, 480, 1920],
);

// ---------------------------------------------------------------------------------------------
// B. Cliente e contrato inativos/encerrados identificados (sem bloquear: DEC-CP02-01)
// ---------------------------------------------------------------------------------------------

verificar("B1. cliente ativo sem marca", rotuloDoCliente({ name: "X", status: "active" }), "X");
verificar(
  "B2. cliente inativo marcado",
  rotuloDoCliente({ name: "X", status: "inactive" }),
  "X (inativo)",
);
const HOJE = "2026-11-12";
verificar(
  "B3. situações do contrato",
  [
    situacaoDoContrato({ status: "active", valid_from: "2026-10-01", valid_to: null }, HOJE),
    situacaoDoContrato(
      { status: "active", valid_from: "2026-09-01", valid_to: "2026-09-30" },
      HOJE,
    ),
    situacaoDoContrato({ status: "inactive", valid_from: "2026-09-01", valid_to: null }, HOJE),
    situacaoDoContrato({ status: "active", valid_from: "2026-12-01", valid_to: null }, HOJE),
    situacaoDoContrato({ status: "active", valid_from: "2026-10-01", valid_to: HOJE }, HOJE),
  ],
  ["", "encerrado em 30/09/2026", "inativo", "começa em 01/12/2026", ""],
);
verificar(
  "B4. os seletores usam os rótulos e a escolha não é filtrada",
  /\{rotuloDoCliente\(client\)\}/.test(tela) &&
    /const situacao = situacaoDoContrato\(contract, hoje\);/.test(tela) &&
    /clientContracts\.map\(\(contract\) =>/.test(tela) &&
    !/clientContracts\.filter/.test(tela),
  true,
);

// ---------------------------------------------------------------------------------------------
// C. Exclusões dizem o que vai junto
// ---------------------------------------------------------------------------------------------

verificar(
  "C1. turno com equipe",
  [
    consequenciasDaExclusaoDoTurno(0),
    consequenciasDaExclusaoDoTurno(1),
    consequenciasDaExclusaoDoTurno(3),
  ],
  ["", "1 colaborador sai da equipe deste turno.", "3 colaboradores saem da equipe deste turno."],
);
verificar(
  "C2. operação com turnos e equipe",
  [consequenciasDaExclusaoDaOperacao(0, 0), consequenciasDaExclusaoDaOperacao(2, 1)],
  ["", "Também serão excluídos 2 turnos e 1 alocação da equipe."],
);

// ---------------------------------------------------------------------------------------------
// D. D3 em turno e operação: envio único; nomes limpos; carregamento
// ---------------------------------------------------------------------------------------------

const liberadasOperacao = [...tela.matchAll(/onSettled: travaOperacao\.liberar/g)].length;
const enviosOperacao = [...tela.matchAll(/(saveOperation|criarOperacaoComVigencia)\.mutate\(/g)]
  .length;
verificar(
  "D1. salvar operação: trava e liberação em todo caminho que envia",
  [/!travaOperacao\.tentar\(\)\) return;/.test(tela), enviosOperacao, liberadasOperacao],
  [true, 3, 3],
);
verificar(
  "D2. salvar turno (D3): trava, liberação e botão desabilitado durante o envio",
  [
    /!travaTurno\.tentar\(\)\s*\)\s*return;/.test(tela),
    /saveShift\.mutate\(payload, \{\s*onSettled: travaTurno\.liberar,/.test(tela),
    /saveShift\.isPending\s*\}/.test(tela),
    /\{saveShift\.isPending \? "Salvando\.\.\." : "Salvar turno"\}/.test(tela),
  ],
  [true, true, true, true],
);
verificar(
  "D3. nomes de operação e turno gravados limpos e validados",
  /name: nomeLimpo\(opForm\.name\)/.test(tela) &&
    /name: nomeLimpo\(shiftForm\.name\)/.test(tela) &&
    /!nomeValido\(opForm\.name\)/.test(tela) &&
    /!nomeValido\(shiftForm\.name\)/.test(tela),
  true,
);

// ---------------------------------------------------------------------------------------------
// E. Valores de hoje com estado; erros traduzidos; rótulos
// ---------------------------------------------------------------------------------------------

verificar(
  "E1. os três valores de hoje usam a forma com estado",
  (tela.match(/useValoresDeHojeComEstado\(/g) ?? []).length === 3 &&
    !/useValoresDeHoje\(/.test(tela),
  true,
);
verificar(
  "E2. cartão, seletor de contrato e custo da equipe tratam carregando/erro",
  [
    /!operation\.contract_id && desconhecido\(valoresDasOperacoes\)/.test(tela),
    /desconhecido\(contratosDeHoje\)/.test(tela),
    /desconhecido\(custosDeHoje\)/.test(tela),
  ],
  [true, true, true],
);
verificar(
  "E3. alocar e desalocar traduzem o erro (nada de error.message cru)",
  /onError: \(error: Error\) => toast\.error\(mensagemDoErro\(error\)\)/.test(tela) &&
    /: mensagemDoErro\(error\),/.test(tela) &&
    !/error\.message/.test(tela),
  true,
);
const rotulos = [
  ["op-cliente", "Cliente"],
  ["op-tipo", "Tipo"],
  ["op-nome", "Nome da operação"],
  ["op-local", "Local \\(opcional\\)"],
  ["op-contrato", "Contrato"],
  ["op-valor", "Valor por diária \\(R\\$\\)"],
  ["op-data", "Data do serviço"],
  ["op-observacoes", "Observações"],
  ["turno-nome", "Nome do turno"],
  ["turno-inicio", "Início"],
  ["turno-fim", "Fim"],
  ["turno-intervalo", "Intervalo \\(min\\)"],
];
verificar(
  "E4. cada rótulo dos formulários de operação e turno aponta para o seu campo",
  rotulos
    .filter(
      ([id, rotulo]) =>
        !new RegExp(`<Label htmlFor="${id}">${rotulo}</Label>`).test(tela) ||
        !new RegExp(`id="${id}"`).test(tela),
    )
    .map(([id]) => id)
    .join(","),
  "",
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
