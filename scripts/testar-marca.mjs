/**
 * Identidade visual (VIS-01): a logo oficial, sem alteração, escolhida pela cor do fundo.
 *
 * COMO RODAR:  npm run test:marca
 *
 *   A  arquivos oficiais íntegros (SHA-256 das cópias = o dos originais aprovados) e sem fundo
 *   B  regra de cor: fundo claro = logo preta, fundo escuro = logo branca
 *   C  pontos de uso: login, sidebar/mobile, autenticação, favicon e metadata
 *   D  nome no plural e nenhuma referência à marca antiga
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

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
const lerBin = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const ler = (p) => lerBin(p).toString("utf8");
const sha = (p) => createHash("sha256").update(lerBin(p)).digest("hex");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("\nA. Arquivos oficiais\n");
// SHA-256 dos originais aprovados em `01_LOGO-MASTER`/`03_VARIACOES`/`04_AVATARES-E-ICONES`.
const OFICIAIS = {
  "public/branding/bs-logo-horizontal-preta.svg":
    "23bd1f7937b4677bb140d80171d1aa033a7c748ee0d8f45a41b6e713093c56ab",
  "public/branding/bs-logo-horizontal-branca.svg":
    "a348bc41273720eb0c1b1f3da72813f272157b1e63d0f897601980d308591071",
  "public/branding/bs-simbolo-preto.svg":
    "b237ce3f9bda71f20072ffcc2ea4a5b35561983556101bdfc91d68f20a712af2",
  "public/branding/bs-simbolo-branco.svg":
    "a4199a3f9706d3e208d527fca95488a3029a945b1b04733edf25bda825994217",
  "public/branding/bs-favicon.svg":
    "c35642aeabb31cab40b1543749a235b753c93dd242b4d040c312dab22d4bba95",
  "public/branding/bs-favicon-32x32.png":
    "67c321f3185729f4e02766da83badaccef4197b8adf40033bbeaab55c4387566",
  "public/branding/bs-favicon-16x16.png":
    "3178f8ba426ac28d3a25884d09c0c4a91a748316d351c9ae195da78270b52ac3",
  "public/branding/bs-app-icon-512x512.png":
    "6376e40b5cd1c75c40fe2c22f53944435ff56da73fd6ab067946a80da7756c0e",
};
for (const [arquivo, hash] of Object.entries(OFICIAIS)) {
  verificar(
    `A1. ${arquivo.split("/").pop()} é idêntico ao original aprovado`,
    existsSync(new URL(`../${arquivo}`, import.meta.url)) && sha(arquivo),
    hash,
  );
}
const preta = ler("public/branding/bs-logo-horizontal-preta.svg");
const branca = ler("public/branding/bs-logo-horizontal-branca.svg");
const simPreto = ler("public/branding/bs-simbolo-preto.svg");
const simBranco = ler("public/branding/bs-simbolo-branco.svg");
const cores = (svg) =>
  [
    ...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase())),
  ].sort();
verificar(
  "A2. nenhum SVG da marca tem fundo (sem <rect>, <image>, gradiente ou filtro)",
  [preta, branca, simPreto, simBranco].some((s) => /<rect|<image|Gradient|<filter/i.test(s)),
  false,
);
verificar("A3. logo preta usa só preto (#000000)", cores(preta), ["#000000"]);
verificar(
  "A4. logo branca desenha só em branco (o preto do grupo-pai é sobrescrito pelos filhos)",
  [
    /<g id="letter-b" fill="#FFFFFF"/.test(branca),
    /<g id="letter-s" fill="#FFFFFF"/.test(branca),
    /id="horizontal-signature"[^>]*fill="#FFFFFF"/.test(branca),
  ],
  [true, true, true],
);
verificar(
  "A5. símbolo preto e branco: letras #000000 e #FFFFFF",
  [
    /id="letter-b" fill="#000000"/.test(simPreto) && /id="letter-s" fill="#000000"/.test(simPreto),
    /id="letter-b" fill="#FFFFFF"/.test(simBranco) &&
      /id="letter-s" fill="#FFFFFF"/.test(simBranco),
  ],
  [true, true],
);
verificar(
  "A6. proporção declarada = a do arquivo (horizontal 2920x735, símbolo 1340x730)",
  [
    /viewBox="0 0 2920 735"/.test(preta) && /viewBox="0 0 2920 735"/.test(branca),
    /viewBox="0 0 1340 730"/.test(simPreto) && /viewBox="0 0 1340 730"/.test(simBranco),
  ],
  [true, true],
);

console.log("\nB. Regra de cor\n");
const logo = semComentarios(ler("src/components/branding/bs-logo.tsx"));
verificar(
  "B1. fundo claro → arquivo PRETO; fundo escuro → arquivo BRANCO",
  /fundo === "claro"\) \{\s*return <Image \{\.\.\.preta\}/.test(logo) &&
    /fundo === "escuro"\) \{\s*return <Image \{\.\.\.branca\}/.test(logo),
  true,
);
verificar(
  "B2. fundo do tema: preta no claro (dark:hidden) e branca no escuro (hidden dark:block)",
  /\{\.\.\.preta\}[\s\S]*?dark:hidden/.test(logo) &&
    /\{\.\.\.branca\}[\s\S]*?hidden dark:block/.test(logo),
  true,
);
verificar(
  "B3. os quatro arquivos apontam para os SVGs oficiais",
  [
    "bs-logo-horizontal-preta.svg",
    "bs-logo-horizontal-branca.svg",
    "bs-simbolo-preto.svg",
    "bs-simbolo-branco.svg",
  ].every((a) => logo.includes(`/branding/${a}`)),
  true,
);
verificar(
  "B4. o componente não recolore, filtra nem inverte a imagem",
  /filter|invert|brightness|mix-blend|fill=|stroke=/.test(logo),
  false,
);
verificar(
  "B5. dimensões do componente = viewBox dos arquivos (sem distorcer)",
  /width: 2920, height: 735/.test(logo) && /width: 1340, height: 730/.test(logo),
  true,
);

console.log("\nC. Pontos de uso\n");
const login = semComentarios(ler("src/app/login/page.tsx"));
verificar(
  "C1. login: painel direito (preto) usa logo BRANCA e o claro/mobile usa a PRETA",
  /fundo=\{mobile \? "claro" : "escuro"\}/.test(login),
  true,
);
verificar(
  "C2. login: legenda em texto redundante removida (a composição oficial já traz o nome)",
  /text-slate-600">\s*Soluções Logística/.test(login),
  false,
);
const shell = semComentarios(ler("src/app/(painel)/_components/app-shell.tsx"));
verificar(
  "C3. sidebar (e o menu móvel, que reaproveita o conteúdo) usa a logo do tema",
  /<BSLogo fundo="tema" priority/.test(shell),
  true,
);
verificar(
  "C4. moldura de autenticação usa a logo do tema",
  /<BSLogo\s+fundo="tema"/.test(semComentarios(ler("src/components/moldura-auth.tsx"))),
  true,
);
const brand = semComentarios(ler("src/components/branding/bs-brand.tsx"));
verificar(
  "C5. telas de senha/MFA (fundo claro): BSBrand → logo preta, sem legenda em texto",
  /fundo=\{variant === "dark" \? "escuro" : "claro"\}/.test(brand) && !/<p/.test(brand),
  true,
);
const layout = semComentarios(ler("src/app/layout.tsx"));
verificar(
  "C6. favicon oficial declarado no metadata (SVG, 32, 16 e ícone 512)",
  [
    "bs-favicon.svg",
    "bs-favicon-32x32.png",
    "bs-favicon-16x16.png",
    "bs-app-icon-512x512.png",
  ].every((a) => layout.includes(a)),
  true,
);
verificar(
  "C7. o título do site é BS Soluções Logísticas",
  /default: "BS Soluções Logísticas"/.test(layout) &&
    /template: "%s \| BS Soluções Logísticas"/.test(layout),
  true,
);

console.log("\nD. Nome e marca antiga\n");
function arquivos(dir) {
  const raiz = new URL(`../${dir}/`, import.meta.url);
  return readdirSync(raiz).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? arquivos(rel) : [rel];
  });
}
const fontes = arquivos("src").filter((f) => /\.(ts|tsx)$/.test(f));
verificar(
  "D1. nenhuma tela escreve 'Soluções Logística' no singular",
  fontes.filter((f) => /Soluções Logística(?!s)/i.test(ler(f))),
  [],
);
verificar(
  "D2. nenhuma fonte referencia a logo antiga (bs-simbolo-retangular) nem favicon.ico",
  fontes.filter(
    (f) =>
      /bs-simbolo-retangular|favicon\.ico/.test(semComentarios(ler(f))) && f !== "src/proxy.ts",
  ),
  [],
);
verificar(
  "D3. os arquivos da marca antiga e o favicon antigo foram removidos",
  [
    existsSync(new URL("../public/branding/bs-simbolo-retangular.png", import.meta.url)),
    existsSync(new URL("../public/favicon.ico", import.meta.url)),
  ],
  [false, false],
);
verificar(
  "D4. nenhuma tela usa <Image> com a marca antiga nem fixa a logo por tamanho de altura",
  fontes.some((f) => /<BSLogo[^>]*className="[^"]*\bh-\d/.test(semComentarios(ler(f)))),
  false,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
