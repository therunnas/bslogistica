/**
 * Identidade visual (VIS-01, VIS-02): a logo oficial, sem alteração, escolhida pela cor do fundo.
 *
 * COMO RODAR:  npm run test:marca
 *
 *   A  arquivos oficiais íntegros (SHA-256 das cópias = o dos originais aprovados) e sem fundo
 *   B  regra de cor do manual: fundo claro = LIGHT, fundo escuro = DARK (B sempre vermelho)
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
// SHA-256 dos originais aprovados do kit de marca: logos e símbolos de
// `07_APLICACOES/07_SISTEMA-INTERNO`; favicon e ícone de `04_AVATARES-E-ICONES`.
const OFICIAIS = {
  "public/branding/bs-logo-horizontal-light.svg":
    "41bc0d468e691a5888af3814556bb7c84f031b1294349a228199d9d3967fcafb",
  "public/branding/bs-logo-horizontal-dark.svg":
    "f737f2f0d8e7b9dce2e552cc9342440b99f6b5d7e9e4cc394857d99a7a8cf36c",
  "public/branding/bs-simbolo-light.svg":
    "c14c33ff2ff44f60afd4ad7b92582ed35ee618475598e62a74245ef172ed13ef",
  "public/branding/bs-simbolo-dark.svg":
    "9b9517da8b5564852777b5c28d4f07ed0a9f2db1fada52a36fa9d1e42f779607",
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
const light = ler("public/branding/bs-logo-horizontal-light.svg");
const dark = ler("public/branding/bs-logo-horizontal-dark.svg");
const simLight = ler("public/branding/bs-simbolo-light.svg");
const simDark = ler("public/branding/bs-simbolo-dark.svg");
const cores = (svg) =>
  [
    ...new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase())),
  ].sort();
verificar(
  "A2. nenhum SVG da marca tem fundo (sem <rect>, <image>, gradiente ou filtro)",
  [light, dark, simLight, simDark].some((s) => /<rect|<image|Gradient|<filter/i.test(s)),
  false,
);
verificar(
  "A3. só cores oficiais: vermelho, preto, branco (e o #333333 de inspeção do grupo-pai)",
  [light, dark, simLight, simDark].every((s) =>
    cores(s).every((c) => ["#E51B23", "#000000", "#FFFFFF", "#333333"].includes(c)),
  ),
  true,
);
verificar(
  "A4. LIGHT: B vermelho; S e wordmark pretos (o grupo-pai é sobrescrito pelos filhos)",
  [
    /<g id="letter-b" fill="#E51B23"/.test(light),
    /<g id="letter-s" fill="#000000"/.test(light),
    /id="horizontal-signature"[^>]*fill="#000000"/.test(light),
  ],
  [true, true, true],
);
verificar(
  "A5. DARK: B vermelho; S e wordmark brancos",
  [
    /<g id="letter-b" fill="#E51B23"/.test(dark),
    /<g id="letter-s" fill="#FFFFFF"/.test(dark),
    /id="horizontal-signature"[^>]*fill="#FFFFFF"/.test(dark),
  ],
  [true, true, true],
);
verificar(
  "A6. símbolo LIGHT e DARK: B vermelho; S #000000 e #FFFFFF",
  [
    /id="letter-b" fill="#E51B23"/.test(simLight) && /id="letter-s" fill="#000000"/.test(simLight),
    /id="letter-b" fill="#E51B23"/.test(simDark) && /id="letter-s" fill="#FFFFFF"/.test(simDark),
  ],
  [true, true],
);
verificar(
  "A7. proporção declarada = a do arquivo (horizontal 2920x735, símbolo 1340x730)",
  [
    /viewBox="0 0 2920 735"/.test(light) && /viewBox="0 0 2920 735"/.test(dark),
    /viewBox="0 0 1340 730"/.test(simLight) && /viewBox="0 0 1340 730"/.test(simDark),
  ],
  [true, true],
);
verificar(
  "A8. as cópias monocromáticas (preta/branca) saíram do painel",
  [
    "bs-logo-horizontal-preta.svg",
    "bs-logo-horizontal-branca.svg",
    "bs-simbolo-preto.svg",
    "bs-simbolo-branco.svg",
  ].map((a) => existsSync(new URL(`../public/branding/${a}`, import.meta.url))),
  [false, false, false, false],
);

console.log("\nB. Regra de cor\n");
const logo = semComentarios(ler("src/components/branding/bs-logo.tsx"));
verificar(
  "B1. fundo claro → arquivo LIGHT; fundo escuro → arquivo DARK",
  /fundo === "claro"\) \{\s*return <Image \{\.\.\.light\}/.test(logo) &&
    /fundo === "escuro"\) \{\s*return <Image \{\.\.\.dark\}/.test(logo),
  true,
);
verificar(
  "B2. fundo do tema: LIGHT no claro (dark:hidden) e DARK no escuro (hidden dark:block)",
  /\{\.\.\.light\}[\s\S]*?dark:hidden/.test(logo) &&
    /\{\.\.\.dark\}[\s\S]*?hidden dark:block/.test(logo),
  true,
);
verificar(
  "B3. os quatro arquivos apontam para os SVGs oficiais",
  [
    "bs-logo-horizontal-light.svg",
    "bs-logo-horizontal-dark.svg",
    "bs-simbolo-light.svg",
    "bs-simbolo-dark.svg",
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
  "C1. login: mobile (claro) usa a horizontal LIGHT; painel direito (escuro), o símbolo DARK",
  /if \(mobile\) \{\s*return <BSLogo fundo="claro"/.test(login) &&
    /<BSLogo fundo="escuro" forma="simbolo"/.test(login),
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
  "C5. telas de senha/MFA (fundo claro): BSBrand → logo LIGHT, sem legenda em texto",
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
// O rótulo do autenticador (AUTH-01) é o único nome curto que fica, de propósito.
verificar(
  "D5. nenhum título de página nem metadado (openGraph) usa o nome curto 'BS Logística'",
  fontes.filter(
    (f) =>
      f !== "src/app/(painel)/configuracoes/painel-configuracoes.tsx" &&
      /BS Logística/.test(ler(f)),
  ),
  [],
);
verificar(
  "D6. as páginas do painel com openGraph usam 'BS Soluções Logísticas' no título",
  fontes.filter(
    (f) => /openGraph/.test(ler(f)) && !/title: "[^"]+ \| BS Soluções Logísticas"/.test(ler(f)),
  ),
  [],
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
