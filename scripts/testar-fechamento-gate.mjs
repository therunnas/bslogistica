/**
 * Gate de disponibilidade do Fechamento (C05-B8.21).
 *
 * COMO RODAR:  npm run test:fechamento-gate
 *
 * O Fechamento depende das migrations 029/030 e do motor novo ligado. Production está na 028 com
 * o motor OFF: o módulo não pode aparecer nem falhar com erro de função inexistente. A decisão é
 * do SERVIDOR (página e as duas APIs), pela consulta oficial `estado_motor_vigencia`.
 *
 * As respostas abaixo foram CAPTURADAS de bancos locais descartáveis, aplicando as migrations até
 * a 028 (`supabase db reset --local --version 20261023120000`) e até a 030, com um admin AAL2:
 *
 *   028, motor OFF  {"ativo": false, "consistente": true, ...}            sem `regras_definitivas`
 *   028, motor ON   {"ativo": true,  "consistente": true, ...}            sem `regras_definitivas`
 *   030, motor OFF  {"ativo": false, "regras_bs": true, "regras_definitivas": true, ...}
 *   030, motor ON   {"ativo": true,  "regras_bs": true, "regras_definitivas": true, ...}
 *
 * e as recusas reais: admin AAL1 e operacional recebem 42501 na própria consulta. Na 028
 * `resumo_financeiro_periodo` não existe: por isso a verificação vem ANTES de qualquer leitura.
 */

import { readFileSync } from "node:fs";

import {
  decidirDisponibilidade,
  MENSAGEM_DE_INDISPONIBILIDADE,
  verificarDisponibilidade,
} from "../src/lib/fechamento/disponibilidade.ts";
import { negarSeIndisponivel } from "../src/lib/fechamento/http.ts";
import {
  mensagemDoErro,
  podeTentarDeNovo,
  ErroDaApiDoFechamento,
} from "../src/lib/fechamento/buscar.ts";

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
const fonte = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const semComentarios = (f) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const motivo = (d) => (d.disponivel ? "ok" : d.motivo);

const E028_OFF = {
  ativo: false,
  motivo: null,
  ativada_em: null,
  alterado_em: "2026-10-28T16:18:43+00:00",
  consistente: true,
};
const E028_ON = {
  ativo: true,
  motivo: "teste",
  ativada_em: "2026-10-28",
  alterado_em: "2026-10-28T16:18:45+00:00",
  consistente: true,
};
const E030_OFF = {
  ativo: false,
  motivo: null,
  regras_bs: true,
  ativada_em: null,
  alterado_em: "2026-10-28T16:18:04+00:00",
  consistente: true,
  regras_definitivas: true,
};
const E030_ON = {
  ativo: true,
  motivo: "teste",
  regras_bs: true,
  ativada_em: "2026-10-28",
  alterado_em: "2026-10-28T16:18:08+00:00",
  consistente: true,
  regras_definitivas: true,
};

console.log("\nA. Decisão pela resposta real do banco\n");
verificar(
  "A1. banco na 028, motor OFF: indisponível (sem a 030)",
  motivo(decidirDisponibilidade(E028_OFF, null)),
  "sem-regras-definitivas",
);
verificar(
  "A2. banco na 028 com motor ON: continua indisponível (sem a 030)",
  motivo(decidirDisponibilidade(E028_ON, null)),
  "sem-regras-definitivas",
);
verificar(
  "A3. banco na 030 com motor OFF: indisponível",
  motivo(decidirDisponibilidade(E030_OFF, null)),
  "motor-desligado",
);
verificar(
  "A4. banco na 030 com motor ON: DISPONÍVEL",
  motivo(decidirDisponibilidade(E030_ON, null)),
  "ok",
);
verificar(
  "A5. erro 42501 (operacional ou admin sem MFA recusados pelo banco): nega",
  motivo(decidirDisponibilidade(null, { code: "42501" })),
  "verificacao-falhou",
);
verificar(
  "A6. função inexistente / rede: nega",
  motivo(decidirDisponibilidade(null, { code: "42883", message: "function does not exist" })),
  "verificacao-falhou",
);
verificar(
  "A7. erro com dado presente: o erro manda",
  motivo(decidirDisponibilidade(E030_ON, { code: "XX000" })),
  "verificacao-falhou",
);
for (const [nome, valor] of [
  ["null", null],
  ["texto", "ok"],
  ["lista", [E030_ON]],
  ["número", 1],
  ["undefined", undefined],
]) {
  verificar(
    `A8. resposta desconhecida (${nome}): nega`,
    motivo(decidirDisponibilidade(valor, null)),
    "estado-desconhecido",
  );
}
verificar(
  "A9. 'ativo' que não é booleano: nega",
  motivo(decidirDisponibilidade({ ...E030_ON, ativo: "true" }, null)),
  "estado-desconhecido",
);
verificar(
  "A10. estado inconsistente (gatilhos): nega mesmo ligado",
  motivo(decidirDisponibilidade({ ...E030_ON, consistente: false }, null)),
  "estado-desconhecido",
);
verificar(
  "A11. 'consistente' ausente: nega",
  motivo(decidirDisponibilidade({ ativo: true, regras_definitivas: true }, null)),
  "estado-desconhecido",
);
verificar(
  "A12. 'regras_definitivas' como texto não vale",
  motivo(decidirDisponibilidade({ ...E030_ON, regras_definitivas: "true" }, null)),
  "sem-regras-definitivas",
);
verificar(
  "A13. 'regras_definitivas' falso: nega",
  motivo(decidirDisponibilidade({ ...E030_ON, regras_definitivas: false }, null)),
  "sem-regras-definitivas",
);

console.log("\nB. Resposta controlada\n");
const negado = negarSeIndisponivel({ disponivel: false, motivo: "sem-regras-definitivas" });
verificar(
  "B1. 503 com código estável, nunca 500",
  `${negado.status}|${negado.corpo.erro.codigo}`,
  "503|fechamento-indisponivel",
);
verificar(
  "B2. a mensagem é a frase fixa do motivo",
  negado.corpo.erro.mensagem,
  MENSAGEM_DE_INDISPONIBILIDADE["sem-regras-definitivas"],
);
verificar("B3. disponível: não nega", negarSeIndisponivel({ disponivel: true }), null);
verificar(
  "B4. nenhuma mensagem vaza função, tabela, migration ou erro do banco",
  Object.values(MENSAGEM_DE_INDISPONIBILIDADE).some((m) =>
    /resumo_financeiro|estado_motor|42\d{3}|SELECT|migration|supabase|function/i.test(m),
  ),
  false,
);
verificar(
  "B5. todos os motivos têm mensagem",
  ["verificacao-falhou", "estado-desconhecido", "sem-regras-definitivas", "motor-desligado"].every(
    (m) => (MENSAGEM_DE_INDISPONIBILIDADE[m] ?? "") !== "",
  ),
  true,
);
const erroApi = new ErroDaApiDoFechamento(
  503,
  "fechamento-indisponivel",
  MENSAGEM_DE_INDISPONIBILIDADE["motor-desligado"],
);
verificar(
  "B6. a tela mostra a frase do servidor e não oferece 'tentar novamente'",
  `${mensagemDoErro(erroApi)}|${podeTentarDeNovo(erroApi)}`,
  `${MENSAGEM_DE_INDISPONIBILIDADE["motor-desligado"]}|false`,
);

console.log("\nC. Consulta ao banco: nunca lança, só a consulta do motor\n");
const clienteFalso = (rpc) => ({ rpc });
const chamadas = [];
verificar(
  "C1. resposta 030 ligada: disponível",
  motivo(
    await verificarDisponibilidade(
      clienteFalso(async (n) => {
        chamadas.push(n);
        return { data: E030_ON, error: null };
      }),
    ),
  ),
  "ok",
);
verificar("C2. só `estado_motor_vigencia` é chamada (nenhuma função do Fechamento)", chamadas, [
  "estado_motor_vigencia",
]);
verificar(
  "C3. erro do banco: nega",
  motivo(
    await verificarDisponibilidade(
      clienteFalso(async () => ({ data: null, error: { code: "42883" } })),
    ),
  ),
  "verificacao-falhou",
);
verificar(
  "C4. exceção de rede: nega, sem lançar",
  motivo(
    await verificarDisponibilidade(
      clienteFalso(async () => {
        throw new Error("rede");
      }),
    ),
  ),
  "verificacao-falhou",
);
verificar(
  "C5. exceção síncrona: nega, sem lançar",
  motivo(
    await verificarDisponibilidade(
      clienteFalso(() => {
        throw new Error("x");
      }),
    ),
  ),
  "verificacao-falhou",
);

console.log("\nD. Servidor: página, GET e POST negam antes de ler\n");
const rotaGet = semComentarios(fonte("src/app/api/fechamento/route.ts"));
const rotaXlsx = semComentarios(fonte("src/app/api/fechamento/xlsx/route.ts"));
const pagina = semComentarios(fonte("src/app/(painel)/fechamento/page.tsx"));
const ordem = (f, a, b) => f.indexOf(a) > -1 && f.indexOf(a) < f.indexOf(b);
verificar(
  "D1. GET: acesso (401/403) → disponibilidade → filtros → carregamento",
  ordem(rotaGet, "decidirAcesso(", "verificarDisponibilidade(") &&
    ordem(rotaGet, "verificarDisponibilidade(", "extrairFiltros(") &&
    ordem(rotaGet, "verificarDisponibilidade(", "carregarFechamento("),
  true,
);
verificar(
  "D2. POST do XLSX: acesso → disponibilidade → corpo → carregamento → arquivo",
  ordem(rotaXlsx, "decidirAcesso(", "verificarDisponibilidade(") &&
    ordem(rotaXlsx, "verificarDisponibilidade(", "lerCorpo(request)") &&
    ordem(rotaXlsx, "verificarDisponibilidade(", "carregarFechamento(") &&
    ordem(rotaXlsx, "carregarFechamento(", "gerarXlsxDoFechamento("),
  true,
);
verificar(
  "D3. as duas rotas negam com negarSeIndisponivel (503)",
  rotaGet.includes("negarSeIndisponivel(") && rotaXlsx.includes("negarSeIndisponivel("),
  true,
);
verificar(
  "D4. a página exige admin ANTES e só monta o painel se disponível",
  ordem(pagina, "exigirAdmin()", "verificarDisponibilidadeNoServidor(") &&
    ordem(pagina, "verificarDisponibilidadeNoServidor(", "<PainelFechamento />") &&
    /!disponibilidade\.disponivel/.test(pagina),
  true,
);
verificar(
  "D5. a página mostra a frase fixa, não o erro do banco",
  pagina.includes("MENSAGEM_DE_INDISPONIBILIDADE[disponibilidade.motivo]"),
  true,
);
verificar(
  "D6. admin AAL2 e cliente da sessão: nenhum service_role nem cliente administrativo",
  /service_role|integrations\/supabase\/admin|criarClienteAdmin|SUPABASE_SERVICE/i.test(
    rotaGet +
      rotaXlsx +
      pagina +
      semComentarios(fonte("src/lib/fechamento/disponibilidade.ts")) +
      semComentarios(fonte("src/lib/fechamento/disponibilidade-servidor.ts")),
  ),
  false,
);
verificar(
  "D7. o módulo de disponibilidade não chama nenhuma função/tabela do Fechamento",
  /resumo_financeiro_periodo|ajustes_de_arredondamento|saldo_de_horas|billing_additionals|invoice_items|\.from\(/.test(
    semComentarios(fonte("src/lib/fechamento/disponibilidade.ts")),
  ),
  false,
);
verificar(
  "D8. a decisão de acesso continua a de sempre (lerAcesso + ehAdmin) nas duas rotas",
  [rotaGet, rotaXlsx].every((r) => /lerAcesso\(\)/.test(r) && /ehAdmin\(acesso\.papeis\)/.test(r)),
  true,
);

console.log("\nE. Menu e regressão de escopo\n");
const shell = semComentarios(fonte("src/app/(painel)/_components/app-shell.tsx"));
verificar(
  "E1. o link só aparece com o Fechamento disponível (e só consulta para admin)",
  /useFechamentoDisponivel\(papel === "admin"\)/.test(shell) &&
    /item\.href !== "\/fechamento" \|\| fechamentoDisponivel/.test(shell),
  true,
);
verificar(
  "E2. os demais itens do menu não são filtrados",
  (shell.match(/\.filter\(/g) ?? []).length === 1,
  true,
);
const dados = semComentarios(fonte("src/lib/vigencias-dados.ts"));
verificar(
  "E3. a consulta do motor é a mesma (mesma chave), só ganhou 'enabled'",
  /function useConsultaDoMotor\(habilitado = true\)/.test(dados) &&
    dados.includes("queryKey: CHAVE_DO_MOTOR") &&
    /enabled: habilitado/.test(dados),
  true,
);
verificar(
  "E4. os hooks anteriores seguem chamando a consulta sem argumento",
  /useConsultaDoMotor\(\);/.test(dados),
  true,
);
verificar(
  "E5. a migration 030 anuncia `regras_definitivas` em estado_motor_vigencia (o gate depende disso)",
  /'regras_definitivas'/.test(
    fonte("supabase/migrations/20261028120000_030_regras_definitivas_bs.sql"),
  ),
  true,
);
verificar(
  "E6. a migration 028 NÃO anuncia (é o que mantém Production indisponível)",
  /regras_definitivas/.test(
    fonte("supabase/migrations/20261023120000_028_protege_contrato_da_operacao.sql"),
  ),
  false,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
