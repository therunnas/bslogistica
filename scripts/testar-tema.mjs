/**
 * Tema claro/escuro (VIS-02): a preferência nunca muda sozinha.
 *
 * COMO RODAR:  npm run test:tema
 *
 * Executa o `theme-script.js` de verdade (num contexto simulado) e confere que ele decide igual
 * a `src/lib/tema.ts`; o resto confere a forma do provider.
 *
 *   A  regras puras (sem preferência = claro, nunca o sistema operacional)
 *   B  toda rota do painel recebe o tema (inclui /fechamento: a causa raiz)
 *   C  o script de pré-hidratação, executado
 *   D  o provider: não sobrescreve na hidratação e não grava por navegação
 */
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

import {
  CHAVE_TEMA,
  ROTAS_SEM_TEMA,
  lerPreferencia,
  rotaUsaTemaDoPainel,
  temaAplicado,
  temaDaPreferencia,
  temaValido,
} from "../src/lib/tema.ts";

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
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("\nA. Regras\n");
verificar(
  "A1. sem preferência = claro",
  [temaDaPreferencia(null), temaDaPreferencia(undefined), temaDaPreferencia("")],
  ["light", "light", "light"],
);
verificar(
  "A2. preferência válida é respeitada",
  [temaDaPreferencia("dark"), temaDaPreferencia("light")],
  ["dark", "light"],
);
verificar(
  "A3. valor inválido é ignorado (claro)",
  ["DARK", "auto", "1", 1, {}].map(temaDaPreferencia),
  ["light", "light", "light", "light", "light"],
);
verificar("A4. temaValido só aceita light e dark", ["light", "dark", "x", null].map(temaValido), [
  "light",
  "dark",
  null,
  null,
]);
verificar(
  "A5. armazenamento que lança erro = sem preferência = claro",
  lerPreferencia(() => ({
    getItem() {
      throw new Error("bloqueado");
    },
  })),
  "light",
);
verificar(
  "A6. lê a chave certa do armazenamento",
  lerPreferencia(() => ({ getItem: (c) => (c === CHAVE_TEMA ? "dark" : null) })),
  "dark",
);
verificar(
  "A5b. o ACESSO ao armazenamento lançando (SecurityError) também vira claro, sem estourar",
  lerPreferencia(() => {
    throw new DOMException("negado", "SecurityError");
  }),
  "light",
);
verificar(
  "A5c. armazenamento ausente (null/undefined) = claro",
  [lerPreferencia(() => null), lerPreferencia(() => undefined)],
  ["light", "light"],
);
verificar(
  "A7. no painel vale a preferência; fora dele, sempre claro",
  [
    temaAplicado("/dashboard", "dark"),
    temaAplicado("/login", "dark"),
    temaAplicado("/mfa", "dark"),
    temaAplicado("/esqueci-senha", "dark"),
    temaAplicado("/", "dark"),
  ],
  ["dark", "light", "light", "light", "light"],
);

console.log("\nB. Todo módulo do painel recebe o tema\n");
const modulos = readdirSync(new URL("../src/app/(painel)/", import.meta.url), {
  withFileTypes: true,
})
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => `/${d.name}`);
verificar(
  "B1. existem módulos a conferir (incluindo fechamento e implantação)",
  [
    modulos.length >= 10,
    modulos.includes("/fechamento"),
    modulos.includes("/implantacao-vigencias"),
  ],
  [true, true, true],
);
verificar(
  "B2. TODA pasta de src/app/(painel) usa o tema, com preferência escura preservada",
  modulos.filter(
    (m) =>
      !(
        rotaUsaTemaDoPainel(m) &&
        temaAplicado(m, "dark") === "dark" &&
        temaAplicado(`${m}/sub`, "dark") === "dark"
      ),
  ),
  [],
);
verificar(
  "B3. nenhuma pasta do painel está na lista de rotas sem tema",
  modulos.filter((m) => ROTAS_SEM_TEMA.includes(m)),
  [],
);
const fora = readdirSync(new URL("../src/app/", import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !/^(\(|_|api$)/.test(d.name))
  .map((d) => `/${d.name}`);
verificar(
  "B4. as telas fora do painel (login, mfa, recuperação, auth) estão todas na lista sem tema",
  fora.filter((r) => rotaUsaTemaDoPainel(r)),
  [],
);

console.log("\nC. Script de pré-hidratação (executado)\n");
const script = ler("public/theme-script.js");
function rodar(caminho, armazenado, { falhaNoArmazenamento = false, sistemaEscuro = true } = {}) {
  const classes = new Set();
  const raiz = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    dataset: {},
    style: {},
  };
  const contexto = {
    window: { location: { pathname: caminho }, matchMedia: () => ({ matches: sistemaEscuro }) },
    document: { documentElement: raiz },
    localStorage: {
      getItem: (c) => {
        if (falhaNoArmazenamento) throw new Error("x");
        return c === CHAVE_TEMA ? armazenado : null;
      },
    },
  };
  vm.runInNewContext(script, contexto);
  return { tema: raiz.dataset.theme, dark: classes.has("dark"), esquema: raiz.style.colorScheme };
}
verificar(
  "C1. primeira visita, SO escuro, sem preferência → CLARO",
  rodar("/dashboard", null, { sistemaEscuro: true }),
  { tema: "light", dark: false, esquema: "light" },
);
verificar(
  "C2. escolha escura é preservada em todos os módulos (inclui Fechamento)",
  modulos.map((m) => rodar(m, "dark").tema),
  modulos.map(() => "dark"),
);
verificar(
  "C3. escolha clara é preservada mesmo com SO escuro",
  modulos.map((m) => rodar(m, "light", { sistemaEscuro: true }).tema),
  modulos.map(() => "light"),
);
verificar(
  "C4. telas de autenticação ficam claras mesmo com preferência escura",
  [
    "/login",
    "/mfa",
    "/esqueci-senha",
    "/redefinir-senha",
    "/redefinir-senha/mfa",
    "/auth/confirmar-recuperacao",
    "/",
  ].map((r) => rodar(r, "dark").tema),
  ["light", "light", "light", "light", "light", "light", "light"],
);
verificar(
  "C5. armazenamento indisponível não quebra: claro",
  rodar("/dashboard", "dark", { falhaNoArmazenamento: true }).tema,
  "light",
);
verificar("C6. valor adulterado = claro", rodar("/dashboard", "roxo").tema, "light");
verificar(
  "C7. o script decide igual ao módulo em toda combinação (rota × preferência)",
  ["/dashboard", "/fechamento", "/implantacao-vigencias", "/login", "/mfa", "/"]
    .flatMap((r) =>
      [null, "light", "dark", "x"].map(
        (p) => rodar(r, p).tema === temaAplicado(r, temaDaPreferencia(p)),
      ),
    )
    .every(Boolean),
  true,
);
verificar(
  "C8. o script não consulta o sistema operacional e usa a mesma chave",
  [/matchMedia|prefers-color-scheme/.test(script), script.includes(`"${CHAVE_TEMA}"`)],
  [false, true],
);
verificar(
  "C9. a lista de rotas do script é a do módulo",
  ROTAS_SEM_TEMA.every((r) => script.includes(`"${r}"`)) &&
    (script.match(/rotasSemTema = \[([^\]]*)\]/)?.[1].match(/"/g) ?? []).length ===
      ROTAS_SEM_TEMA.length * 2,
  true,
);

console.log("\nD. Provider\n");
const prov = semComentarios(ler("src/components/theme-provider.tsx"));
verificar(
  "D1. não há lista própria de rotas nem consulta ao sistema operacional",
  /ROTAS_COM_TEMA|matchMedia|prefers-color-scheme/.test(prov),
  false,
);
verificar(
  "D2. só aplica o tema depois de ler a preferência (não sobrescreve a hidratação)",
  /if \(!pronto\) return;\s*aplicarTema\(temaAplicado\(caminho, preferido\)\)/.test(prov),
  true,
);
verificar(
  "D3. a preferência é lida uma vez, na montagem",
  /useEffect\(\(\) => \{\s*setPreferido\(lerPreferencia\(\(\) => window\.localStorage\)\);\s*setPronto\(true\);\s*\}, \[\]\)/.test(
    prov,
  ),
  true,
);
verificar(
  "D3b. nenhum acesso direto a localStorage fora de try: só dentro da função passada a lerPreferencia e no try de definirTema",
  (prov.match(/localStorage/g) ?? []).length === 2 &&
    /lerPreferencia\(\(\) => window\.localStorage\)/.test(prov) &&
    /try \{\s*localStorage\.setItem/.test(prov),
  true,
);
verificar(
  "D4. só definirTema grava no armazenamento",
  (prov.match(/localStorage\.setItem/g) ?? []).length === 1 &&
    /definirTema = useCallback\(\(novoTema: Tema\) => \{\s*try \{\s*localStorage\.setItem/.test(
      prov,
    ),
  true,
);
verificar(
  "D5. navegar não força 'claro' no estado (não existe setPreferido('light') por rota)",
  /setPreferido\("light"\)|setTema\("light"\)/.test(prov),
  false,
);
verificar(
  "D6. a sincronização entre abas aceita só valores válidos",
  /temaValido\(evento\.newValue\)/.test(prov),
  true,
);
const prv = semComentarios(ler("src/app/providers.tsx"));
verificar(
  "D7. o aviso (toast) segue o tema aplicado, não só a preferência",
  /theme=\{temaAplicado\(caminho, tema\)\}/.test(prv),
  true,
);
verificar(
  "D8. há um único script de tema, carregado no layout",
  /src="\/theme-script\.js"/.test(ler("src/app/layout.tsx")),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
