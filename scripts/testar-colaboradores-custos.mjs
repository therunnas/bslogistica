/**
 * Regressão dos defeitos do CP-03 (QA-BS-01) — colaboradores, custos e vigências.
 *
 * COMO RODAR:
 *
 *   npm run test:colaboradores-custos
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. Cada bloco
 * corresponde a um defeito reproduzido no E2E local (e2e/specs/60-colaboradores-custos) antes da
 * correção. A leitura dos custos em lotes (414 com muitos colaboradores) é provada em
 * `test:vigencias-paginacao` (bloco F), com o transporte do PostgREST simulado.
 */

import { readFileSync } from "node:fs";

import {
  MENSAGEM_CUSTO_INVALIDO,
  MENSAGEM_CUSTO_NEGATIVO,
  errosDoCusto,
  nomeLimpo,
  nomeValido,
} from "../src/app/(painel)/colaboradores/_dominio.ts";
import { manterDigitados } from "../src/lib/vigencias-ui.ts";

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
const tela = semComentarios(ler("src/app/(painel)/colaboradores/painel-colaboradores.tsx"));
const alterar = semComentarios(ler("src/app/(painel)/_components/valor-atual.tsx"));
const dados = semComentarios(ler("src/lib/vigencias-dados.ts"));

// ---------------------------------------------------------------------------------------------
// A. D2 — "Alterar custo": trocar a data não apaga o que foi digitado
// ---------------------------------------------------------------------------------------------

const daVersao = { daily_cost: "150", ot_hourly_cost: "" };
verificar(
  "A1. campo digitado fica; campo não tocado acompanha a versão da data",
  manterDigitados(daVersao, { daily_cost: "199", ot_hourly_cost: "30" }, new Set(["daily_cost"])),
  { daily_cost: "199", ot_hourly_cost: "" },
);
verificar(
  "A2. sem nada digitado, a versão da data preenche tudo (corrigir/antecipar partindo do existente)",
  manterDigitados(daVersao, { daily_cost: "120", ot_hourly_cost: "" }, new Set()),
  daVersao,
);
verificar(
  "A3. campo digitado vazio continua vazio (apagar também é digitar)",
  manterDigitados(daVersao, { daily_cost: "" }, new Set(["daily_cost"])),
  { daily_cost: "", ot_hourly_cost: "" },
);
verificar(
  "A4. trocar a data usa manterDigitados; os dois tipos de campo marcam o que foi digitado",
  [
    /setValores\(\(atuais\) =>\s*manterDigitados\(valoresDe\(igual \?\? \(antes \? primeira : vigente\)\), atuais, tocados\),?\s*\)/.test(
      alterar,
    ),
    (alterar.match(/onChange=\{\(e\) => digitar\(campo\.chave, e\.target\.value\)\}/g) ?? [])
      .length,
    /onChange=\{\(e\) => setValores\(/.test(alterar),
  ],
  [true, 2, false],
);
verificar(
  "A5. abrir o formulário zera o que foi digitado (Cancelar e reabrir parte do valor de hoje)",
  /function abrir\(\) \{\s*if \(!podeAbrir\) return;[\s\S]*?setValores\(valoresDe\(vigente\)\);\s*setTocados\(new Set\(\)\);/.test(
    alterar,
  ),
  true,
);
// D-CP07-07: o formulário só abre com o valor atual carregado (nunca nasce vazio).
verificar(
  "A5b. “Alterar” só habilita com o valor atual lido",
  /const podeAbrir = liberado && versoes\.isSuccess;/.test(alterar) &&
    /onClick=\{abrir\} disabled=\{!podeAbrir\}/.test(alterar),
  true,
);

verificar(
  "A6. salvar do 'Alterar' tem envio único (duplo clique não chama mutate duas vezes)",
  /function salvar\(\) \{\s*if \(!trava\.tentar\(\)\) return;\s*const fechar = \{ onError: trava\.liberar, onSuccess: \(\) => setAberto\(false\) \};/.test(
    alterar,
  ) && /const trava = useTravaDoDialogo\(aberto\);/.test(alterar),
  true,
);

// ---------------------------------------------------------------------------------------------
// B. Cadastro: nome, custo, envio único, rótulo
// ---------------------------------------------------------------------------------------------

verificar("B1. só espaços não é nome", nomeValido("   "), false);
verificar("B2. nome gravado sem as pontas", nomeLimpo("  Zeca  "), "Zeca");
verificar("B3. custo negativo", errosDoCusto(-10), [MENSAGEM_CUSTO_NEGATIVO]);
verificar("B4. custo não numérico", errosDoCusto(Number.NaN), [MENSAGEM_CUSTO_INVALIDO]);
verificar("B5. zero e positivo são aceitos", [errosDoCusto(0), errosDoCusto(150.5)], [[], []]);
verificar(
  "B6. a tela grava o nome limpo e só salva nome válido e custo válido",
  /name: nomeLimpo\(form\.name\)/.test(tela) &&
    /!nomeValido\(form\.name\) \|\|\s*errosDoFormulario\.length > 0 \|\|/.test(tela),
  true,
);
const envios = [...tela.matchAll(/(save|criarComVigencia)\.mutate\(/g)].length;
const liberadas = [...tela.matchAll(/onError: trava\.liberar/g)].length;
// Depois do sucesso o diálogo ainda fecha (animação): só o erro libera; reabrir também.
const travaDoDialogo =
  /const trava = useTravaDoDialogo\(open\);/.test(tela) && !/onSettled: trava\.liberar/.test(tela);
verificar(
  "B7. envio único: trava no submit, liberada em todo caminho que envia e no que não envia",
  [
    /if \(!nomeValido\(form\.name\) \|\| errosDoFormulario\.length > 0 \|\| !trava\.tentar\(\)\) return;/.test(
      tela,
    ),
    envios,
    liberadas,
    /if \(!enviado\) trava\.liberar\(\);/.test(tela),
    travaDoDialogo,
  ],
  // 4 mutates: edição, cadastro com vigência, gravação da função depois do cadastro (dentro do
  // onSuccess, já protegida) e motor desligado; 3 deles enviam pelo submit e liberam a trava.
  [true, 4, 3, true, true],
);
verificar(
  "B8. o rótulo Status nomeia o seletor",
  /<Label htmlFor="employee-status">Status<\/Label>/.test(tela) &&
    /<SelectTrigger id="employee-status"/.test(tela),
  true,
);

// ---------------------------------------------------------------------------------------------
// C. Lista: sem os custos de hoje, nunca o custo do cadastro como atual
// ---------------------------------------------------------------------------------------------

verificar(
  "C1. a lista usa o estado da consulta das vigências",
  /useValoresDeHojeComEstado\(\s*"colaborador",/.test(tela) &&
    /custoDeHojeDesconhecido =\s*modoDeCusto === "por-vigencia" && \(custosDeHoje\.carregando \|\| custosDeHoje\.erro\)/.test(
      tela,
    ),
  true,
);
verificar(
  "C2. célula de custo e cartão do custo médio caem em 'Indisponível'/'Carregando…'",
  [
    /custoDeHojeDesconhecido \? \(\s*<CustoDesconhecido erro=\{custosDeHoje\.erro\} \/>/.test(tela),
    /custoDeHojeDesconhecido\s*\?\s*custosDeHoje\.erro\s*\?\s*"Indisponível"\s*:\s*"Carregando…"\s*:\s*brl\(custoMedio\)/.test(
      tela,
    ),
  ],
  [true, true],
);
verificar(
  "C3. a leitura dos custos é feita em lotes de no máximo 100 colaboradores",
  /export const COLABORADORES_POR_CONSULTA = 100;/.test(dados) &&
    /lotes\.map\(\(lote\) => lerCustosDeUmLote\(db, lote, somenteAtivas\)\)/.test(dados),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
