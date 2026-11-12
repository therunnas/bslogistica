/**
 * Regressão dos defeitos do CP-02 (QA-BS-01) — clientes e contratos.
 *
 * COMO RODAR:
 *
 *   npm run test:clientes-contratos
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto via
 * `--experimental-strip-types`. Sai com código diferente de zero em qualquer falha.
 *
 * Cada bloco corresponde a um defeito reproduzido no E2E local (e2e/specs/50-clientes-contratos)
 * antes da correção; o comportamento ponta a ponta é provado lá. Aqui ficam as regras puras e a
 * forma do código, para a regressão ser pega antes do E2E.
 */

import { readFileSync } from "node:fs";

import {
  ANO_MAXIMO,
  ANO_MINIMO,
  MENSAGEM_FIM_ANTES_DO_INICIO,
  MENSAGEM_FIM_INVALIDO,
  MENSAGEM_INICIO_INVALIDO,
  MENSAGEM_INICIO_OBRIGATORIO,
  consequenciasDaExclusaoDoCliente,
  errosDasDatasDoContrato,
  nomeLimpo,
  nomeValido,
} from "../src/app/(painel)/clientes/_dominio.ts";
import { MENSAGEM_FALHA_DE_REDE, mensagemDoErro } from "../src/lib/erros-banco.ts";

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
const tela = semComentarios(ler("src/app/(painel)/clientes/painel-clientes.tsx"));
const plano = tela.replace(/\s+/g, " ");

// ---------------------------------------------------------------------------------------------
// A. Nome (cliente e contrato): obrigatório sem contar espaços, gravado sem as pontas
// ---------------------------------------------------------------------------------------------

verificar("A1. só espaços não é nome", nomeValido("   "), false);
verificar("A2. nome com texto é válido", nomeValido(" Cliente "), true);
verificar(
  "A3. o nome é gravado sem os espaços das pontas",
  nomeLimpo("  Cliente A  "),
  "Cliente A",
);
verificar(
  "A4. a tela grava o nome do cliente limpo e só salva nome válido",
  /name: nomeLimpo\(clientForm\.name\)/.test(tela) &&
    /disabled=\{!nomeValido\(clientForm\.name\) \|\| salvandoCliente\}/.test(tela),
  true,
);
verificar(
  "A5. a tela grava o nome do contrato limpo e só salva nome válido",
  /name: nomeLimpo\(contractForm\.name\)/.test(tela) &&
    /!nomeValido\(contractForm\.name\) \|\|/.test(tela),
  true,
);

// ---------------------------------------------------------------------------------------------
// B. Datas do contrato
// ---------------------------------------------------------------------------------------------

const erros = (i, f) => errosDasDatasDoContrato(i, f).join(" | ");
verificar("B1. início e fim coerentes", erros("2026-10-01", "2026-10-31"), "");
verificar("B2. sem fim é permitido", erros("2026-10-01", ""), "");
verificar("B3. fim igual ao início é permitido", erros("2026-10-01", "2026-10-01"), "");
verificar(
  "B4. fim antes do início",
  erros("2026-10-01", "2026-09-30"),
  MENSAGEM_FIM_ANTES_DO_INICIO,
);
verificar(
  "B5. fim no ano 0001 (ano digitado pela metade)",
  erros("2026-10-01", "0001-01-01"),
  MENSAGEM_FIM_INVALIDO,
);
verificar("B6. início no ano 0001", erros("0001-01-01", ""), MENSAGEM_INICIO_INVALIDO);
verificar("B7. início vazio", erros("", ""), MENSAGEM_INICIO_OBRIGATORIO);
verificar(
  "B8. limites do ano aceito",
  [
    erros(`${ANO_MINIMO}-01-01`, ""),
    erros(`${ANO_MAXIMO}-12-31`, ""),
    erros(`${ANO_MINIMO - 1}-12-31`, ""),
  ].join(" / "),
  ` /  / ${MENSAGEM_INICIO_INVALIDO}`,
);
verificar(
  "B9. a tela bloqueia o salvar e mostra os erros das datas",
  /errosDasDatas\.length > 0 \|\|/.test(tela) && /errosDasDatas\.map\(/.test(tela),
  true,
);
verificar(
  "B10. o submit também recusa datas inválidas (não depende só do botão)",
  /function submitContract\(\) \{\s*if \(!nomeValido\(contractForm\.name\) \|\| errosDasDatas\.length > 0\) return;/.test(
    tela,
  ),
  true,
);

// ---------------------------------------------------------------------------------------------
// C. D3: envio único em "Salvar cliente" e "Salvar contrato"
// ---------------------------------------------------------------------------------------------

verificar(
  "C1. salvar cliente passa pela trava e a libera no onSettled",
  /travaCliente\.tentar\(\)[\s\S]{0,700}saveClient\.mutate\(payload, \{\s*onSettled: travaCliente\.liberar,/.test(
    tela,
  ),
  true,
);
const mutacoesDoContrato = [...tela.matchAll(/(saveContract|criarContratoComVigencia)\.mutate\(/g)]
  .length;
const liberadasDoContrato = [...tela.matchAll(/onSettled: travaContrato\.liberar/g)].length;
verificar(
  "C2. salvar contrato passa pela trava e todo caminho que envia a libera",
  `${/if \(!travaContrato\.tentar\(\)\) return;/.test(tela)}:${mutacoesDoContrato}:${liberadasDoContrato}`,
  "true:3:3",
);
verificar(
  "C3. caminho que não envia nada também libera a trava",
  /if \(!enviado\) travaContrato\.liberar\(\);/.test(tela),
  true,
);
verificar(
  "C4. os botões mostram o carregamento",
  /salvandoCliente \? "Salvando\.\.\." : "Salvar cliente"/.test(tela) &&
    /salvandoContrato \? "Salvando\.\.\." : "Salvar contrato"/.test(tela),
  true,
);

// ---------------------------------------------------------------------------------------------
// D. Exclusão do cliente diz o que vai junto (ON DELETE CASCADE)
// ---------------------------------------------------------------------------------------------

verificar(
  "D1. cliente sem dependência: nada a acrescentar",
  consequenciasDaExclusaoDoCliente(0, 0),
  "",
);
verificar(
  "D2. com operação: cita operações e apontamentos",
  consequenciasDaExclusaoDoCliente(1, 1),
  "Também serão excluídos 1 contrato e 1 operação, com os turnos, a equipe e os apontamentos ainda não faturados dessas operações.",
);
verificar(
  "D3. plural",
  consequenciasDaExclusaoDoCliente(2, 3).startsWith(
    "Também serão excluídos 2 contratos e 3 operações,",
  ),
  true,
);
verificar(
  "D4. só contrato",
  consequenciasDaExclusaoDoCliente(1, 0),
  "Também será excluído o cadastro de 1 contrato.",
);
verificar(
  "D5. a lixeira do cliente usa a confirmação com as consequências",
  /onClick=\{\(\) => excluirCliente\(client\)\}/.test(tela) &&
    /consequenciasDaExclusaoDoCliente\(contratosDoCliente\.length, operacoesDoCliente\.length\)/.test(
      plano,
    ),
  true,
);

// ---------------------------------------------------------------------------------------------
// E. Lista de contratos não mostra a coluna do cadastro como valor de hoje sem as vigências
// ---------------------------------------------------------------------------------------------

verificar(
  "E1. a lista usa o estado da consulta das vigências",
  /useValoresDeHojeComEstado\(\s*"contrato",/.test(tela) &&
    /condicaoDeHojeDesconhecida =\s*modoDeTaxa === "por-vigencia" && \(condicoesDeHoje\.carregando \|\| condicoesDeHoje\.erro\)/.test(
      tela,
    ),
  true,
);
verificar(
  "E2. diária, fator e tolerância caem em 'Indisponível'/'Carregando…' nesse estado",
  [
    ...tela.matchAll(
      /condicaoDeHojeDesconhecida \? \(\s*<CondicaoDesconhecida erro=\{condicoesDeHoje\.erro\} \/>/g,
    ),
  ].length,
  3,
);
const dados = semComentarios(ler("src/lib/vigencias-dados.ts"));
verificar(
  "E3. useValoresDeHoje (colaboradores e operações) mantém a assinatura e o comportamento",
  /export function useValoresDeHoje\([\s\S]{0,200}\): ReadonlyMap<string, VersaoDeVigencia> \{\s*return useValoresDeHojeComEstado\(tipo, ids, habilitado\)\.valores;/.test(
    dados,
  ),
  true,
);

// ---------------------------------------------------------------------------------------------
// F. Falha de rede e exclusão recusada em português
// ---------------------------------------------------------------------------------------------

verificar(
  "F1. falha de rede do navegador vira texto da tela",
  [
    mensagemDoErro({ message: "TypeError: Failed to fetch" }),
    mensagemDoErro({ message: "NetworkError when attempting to fetch resource." }),
    mensagemDoErro({ message: "Load failed" }),
  ].every((m) => m === MENSAGEM_FALHA_DE_REDE),
  true,
);
verificar(
  "F2. erro com código do banco não é confundido com rede",
  mensagemDoErro({ code: "XX000", message: "Failed to fetch" }),
  "Failed to fetch",
);
verificar(
  "F3. mensagem do banco em português continua passando",
  mensagemDoErro({
    code: "42501",
    message: "Cliente com histórico faturado não pode ser excluído. Inative-o.",
  }),
  "Cliente com histórico faturado não pode ser excluído. Inative-o.",
);
verificar(
  "F4. a exclusão usa a mesma tradução do salvar",
  /onError: \(error: Error\) => toast\.error\(mensagemDoErro\(error\)\),\s*\}\);\s*\}\s*$/.test(
    semComentarios(ler("src/lib/mutations.ts")).split("export function useDeleteRow")[1] ?? "",
  ),
  true,
);

// ---------------------------------------------------------------------------------------------
// G. Rótulos ligados aos campos (leitor de tela, clique no rótulo, teclado)
// ---------------------------------------------------------------------------------------------

const rotulos = [
  ["cliente-nome", "Nome"],
  ["cliente-cnpj", "CNPJ"],
  ["cliente-contato", "Contato"],
  ["cliente-email", "E-mail"],
  ["cliente-telefone", "Telefone"],
  ["cliente-observacoes", "Observações"],
  ["cliente-status", "Status"],
  ["contrato-cliente", "Cliente"],
  ["contrato-nome", "Nome do contrato"],
  ["contrato-diaria", "Valor da diária \\(R\\$\\)"],
  ["contrato-fator", "Hora extra \\(fator\\)"],
  ["contrato-tolerancia", "Tolerância antes da hora extra \\(min\\)"],
  ["contrato-inicio", "Início do contrato"],
  ["contrato-fim", "Fim do contrato \\(opcional\\)"],
];
verificar(
  "G1. cada rótulo dos dois formulários aponta para o id do seu campo",
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
