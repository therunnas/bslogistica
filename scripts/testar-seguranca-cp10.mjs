/**
 * Regressão do CP-10 (QA-BS-01) — segurança da aplicação, pela forma do código.
 *
 * COMO RODAR:
 *
 *   npm run test:seguranca-cp10
 *
 * Mesmo formato das outras suítes: sem framework, Node lendo os arquivos. O comportamento é
 * provado no E2E local (e2e/specs/99-cp10-matriz-api: matriz de tabelas e RPCs pela API, JWT
 * depois do logout, cabeçalhos) e no SQL local (supabase/tests/090_cp10_integridade_e_riscos).
 * Aqui ficam as garantias que só se medem lendo o código.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

const raiz = new URL("../", import.meta.url).pathname;
const ler = (caminho) => readFileSync(join(raiz, caminho), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(join(raiz, dir))) {
    const caminho = join(dir, nome);
    if (statSync(join(raiz, caminho)).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}
const fontes = arquivos("src").map((caminho) => ({
  caminho,
  codigo: semComentarios(ler(caminho)),
}));

console.log("\nA. Cabeçalhos\n");

const config = semComentarios(ler("next.config.ts"));
verificar(
  "A1. D-CP10-01: o Next não anuncia o framework (poweredByHeader: false)",
  /poweredByHeader: false,/.test(config),
  true,
);
verificar(
  "A2. os cabeçalhos de segurança valem para todas as rotas",
  /source: "\/:path\*", headers: cabecalhosDeSeguranca/.test(config),
  true,
);

console.log("\nB. Segredos e navegador\n");

const nomesPublicos = [
  ...new Set(
    fontes.flatMap(({ codigo }) =>
      [...codigo.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)].map((m) => m[1]),
    ),
  ),
].sort();
verificar(
  "B1. nenhuma variável NEXT_PUBLIC_ com nome de segredo (SECRET, SERVICE, PASSWORD, TOKEN)",
  nomesPublicos.filter((n) => /SECRET|SERVICE|PASSWORD|TOKEN|PRIVATE/.test(n)),
  [],
);
const usaServiceRole = fontes
  .filter(({ codigo }) => /SUPABASE_SERVICE_ROLE_KEY/.test(codigo))
  .map(({ caminho }) => caminho);
verificar(
  'B2. a chave service_role só é lida por módulos de servidor (nenhum "use client")',
  usaServiceRole.filter((c) => /^\s*["']use client["']/m.test(ler(c))),
  [],
);
const html = fontes.filter(({ codigo }) =>
  /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(codigo),
);
verificar(
  "B3. dangerouslySetInnerHTML só no componente de gráfico do shadcn (configuração do desenvolvedor)",
  html.map(({ caminho }) => caminho),
  ["src/components/ui/chart.tsx"],
);
verificar(
  "B4. e esse componente não é usado por nenhuma tela",
  fontes.filter(
    ({ caminho, codigo }) =>
      caminho.startsWith("src/app/") && /ChartContainer|ChartStyle/.test(codigo),
  ).length,
  0,
);

console.log("\nC. Sessão e caminhos encerrados\n");

const sair = semComentarios(ler("src/app/(painel)/_acoes.ts"));
verificar(
  "C1. o logout do painel encerra a sessão no servidor com o escopo padrão (global)",
  /await supabase\.auth\.signOut\(\);/.test(sair),
  true,
);
const acoesContainer = semComentarios(ler("src/app/(painel)/containers/_acoes.ts"));
verificar(
  "C2. o cadastro novo de contêiner pela aplicação continua encerrado no servidor (a RPC do banco não: AUT-CP06-01)",
  /export async function registrarContainerAction[\s\S]*?return cadastroDeContainerEncerrado\(\);/.test(
    acoesContainer,
  ),
  true,
);
verificar(
  "C3. nenhum redirect da aplicação usa destino vindo da URL (next, redirect_to, returnTo)",
  fontes
    .filter(({ codigo }) =>
      /searchParams\.get\(["'](next|redirect_to|redirectTo|returnTo)["']\)/.test(codigo),
    )
    .map(({ caminho }) => caminho),
  [],
);

console.log("\nD. Testes do CP-10 registrados\n");

const pacote = JSON.parse(ler("package.json"));
const ci = ler(".github/workflows/ci.yml");
verificar(
  "D1. a suíte roda na CI",
  /npm run test:seguranca-cp10/.test(ci) && Boolean(pacote.scripts["test:seguranca-cp10"]),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
