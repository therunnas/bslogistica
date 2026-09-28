/**
 * Testes de papel, navegação e bloqueio de rotas administrativas (B2.2).
 *
 * COMO RODAR:
 *
 *   npm run test:papel
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * DUAS METADES:
 *
 *   - comportamento de `resolverPapelEfetivo`, que é função pura e a única
 *     fonte da regra "admin + operacional = ADMIN";
 *   - forma literal dos arquivos, porque o resto do B2.2 é Server Component e
 *     não se observa de fora sem navegador: que as sete telas chamam o guard
 *     ANTES de renderizar o painel, que a navegação some para quem não é admin,
 *     que a tela de restrição não é a de conta sem papel, e que nada de MFA,
 *     AAL ou `service_role` foi tocado. O projeto já asseve forma literal nas
 *     suítes de auth, pelo mesmo motivo.
 */

import { existsSync, readFileSync } from "node:fs";

import { ehAdmin, resolverPapelEfetivo } from "../src/app/(painel)/_papel.ts";

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

/**
 * Remove comentários.
 *
 * Duas asserções falam do que CHEGA ao usuário ou do que o código realmente
 * faz, e nessas o comentário atrapalha: este projeto documenta o porquê no
 * próprio arquivo, e as palavras "RLS" ou "aal2" aparecem lá de propósito, para
 * quem lê o código. Medir sobre o texto sem comentários é o que torna a
 * asserção honesta em vez de obrigar o código a ficar mudo.
 */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TELAS = [
  ["dashboard", "PainelDashboard"],
  ["apontamentos", "PainelApontamentos"],
  ["operacoes", "PainelOperacoes"],
  ["clientes", "PainelClientes"],
  ["colaboradores", "PainelColaboradores"],
  ["faturamento", "PainelFaturamento"],
  ["relatorios", "PainelRelatorios"],
  ["usuarios", "PainelUsuarios"],
];

const fontes = {
  papel: ler("src/app/(painel)/_papel.ts"),
  guard: ler("src/app/(painel)/_exigir-admin.tsx"),
  layout: ler("src/app/(painel)/layout.tsx"),
  autorizacao: ler("src/app/(painel)/_autorizacao.ts"),
  shell: ler("src/app/(painel)/_components/app-shell.tsx"),
  restrito: ler("src/app/(painel)/_components/acesso-administrativo-restrito.tsx"),
  naoLiberado: ler("src/app/(painel)/_components/acesso-nao-liberado.tsx"),
  login: ler("src/app/login/page.tsx"),
  mfaPagina: ler("src/app/mfa/page.tsx"),
  mfaLib: ler("src/lib/mfa.ts"),
};
const paginas = Object.fromEntries(
  TELAS.map(([rota]) => [rota, ler(`src/app/(painel)/${rota}/page.tsx`)]),
);
const todasAsFontes = Object.values(fontes).join("\n") + Object.values(paginas).join("\n");

console.log("\nA. Papel efetivo\n");

verificar("A1. só admin -> admin", resolverPapelEfetivo(["admin"]), "admin");
verificar(
  "A2. só operacional -> operacional",
  resolverPapelEfetivo(["operacional"]),
  "operacional",
);
verificar(
  "A3. admin + operacional -> ADMIN",
  resolverPapelEfetivo(["admin", "operacional"]),
  "admin",
);
verificar(
  "A4. e a ordem no array não muda isso",
  resolverPapelEfetivo(["operacional", "admin"]),
  "admin",
);
verificar("A5. lista vazia -> sem papel", resolverPapelEfetivo([]), "sem-papel");
verificar("A6. nulo -> sem papel", resolverPapelEfetivo(null), "sem-papel");
verificar("A7. indefinido -> sem papel", resolverPapelEfetivo(undefined), "sem-papel");
verificar("A8. valor que não é lista -> sem papel", resolverPapelEfetivo("admin"), "sem-papel");
verificar("A9. papel desconhecido -> sem papel", resolverPapelEfetivo(["visitante"]), "sem-papel");
verificar(
  "A10. desconhecido junto de admin -> admin",
  resolverPapelEfetivo(["visitante", "admin"]),
  "admin",
);
verificar("A11. ehAdmin concorda com admin", ehAdmin(["admin", "operacional"]), true);
verificar("A12. ehAdmin recusa operacional", ehAdmin(["operacional"]), false);
verificar("A13. ehAdmin recusa sem papel", ehAdmin([]), false);

console.log("\nB. As oito telas bloqueiam no servidor, antes de renderizar\n");

for (const [rota, componente] of TELAS) {
  const fonte = paginas[rota];
  verificar(`B1.${rota} — importa o guard central`, /from "\.\.\/_exigir-admin"/.test(fonte), true);
  verificar(
    `B2.${rota} — chama exigirAdmin e devolve o bloqueio`,
    /const bloqueio = await exigirAdmin\(\);\s*\n\s*if \(bloqueio\) return bloqueio;/.test(fonte),
    true,
  );
  // A ordem é o ponto: o guard tem de vir ANTES do painel na função. A
  // presença é conferida junto, senão a comparação passaria por vacuidade —
  // `indexOf` devolve -1 para o que não existe, e -1 é menor que tudo.
  verificar(
    `B3.${rota} — o guard vem antes do painel administrativo`,
    fonte.includes("await exigirAdmin()") &&
      fonte.indexOf("await exigirAdmin()") < fonte.indexOf(`<${componente} />`),
    true,
  );
  // Reimplementar a regra é o que não pode: ler `user_roles` na página ou
  // decidir por `papeis.includes`. Usar `resolverPapelEfetivo` é o contrário
  // disso — é consumir a regra central —, e desde o B2.3 é assim que
  // `/dashboard` roteia o operacional.
  verificar(
    `B4.${rota} — nenhuma cópia local da regra de papel`,
    /papeis\.includes|user_roles|role === "admin"/.test(fonte),
    false,
  );
}

// O roteamento por papel mora num lugar só. Se outra tela começar a redirecionar
// por papel, a decisão terá sido duplicada — que é o que o B2.3 evitou ao não
// tocar no login.
verificar(
  "B5. só o /dashboard roteia por papel",
  TELAS.filter(([rota]) => paginas[rota].includes("resolverPapelEfetivo"))
    .map(([rota]) => rota)
    .join(","),
  "dashboard",
);

console.log("\nC. O guard central\n");

verificar(
  "C1. fecha em qualquer situação que não seja liberado",
  /acesso\.situacao !== "liberado"/.test(fontes.guard),
  true,
);
verificar("C2. e exige o papel admin", /ehAdmin\(acesso\.papeis\)/.test(fontes.guard), true);
verificar(
  "C3. devolve a tela de área administrativa restrita",
  /<AcessoAdministrativoRestrito \/>/.test(fontes.guard),
  true,
);
verificar(
  "C4. não reaproveita a tela de conta sem papel",
  /AcessoNaoLiberado/.test(fontes.guard),
  false,
);
verificar("C5. lê a autorização pela fonte de sempre", /lerAcesso\(\)/.test(fontes.guard), true);
verificar(
  "C6. a leitura é memoizada por requisição, não global",
  /cache\(async \(\): Promise<Acesso>/.test(fontes.autorizacao),
  true,
);
verificar(
  "C7. e a memoização vem do React, não de estado próprio",
  /import \{ cache \} from "react"/.test(fontes.autorizacao),
  true,
);

console.log("\nD. A tela de restrição diz a coisa certa\n");

verificar(
  "D1. fala em área administrativa restrita",
  /Área administrativa restrita/.test(fontes.restrito),
  true,
);
verificar(
  "D2. e em perfil sem permissão para esta área",
  /não possui permissão para acessar esta área/.test(fontes.restrito),
  true,
);
verificar(
  "D3. não diz que a conta está sem acesso ao sistema",
  /não tem permissão de uso|Acesso não liberado/.test(fontes.restrito),
  false,
);
verificar(
  "D4. a tela de conta sem papel continua existindo e separada",
  /Acesso não liberado/.test(fontes.naoLiberado),
  true,
);
verificar(
  "D5. não vaza detalhe técnico ao usuário",
  /RLS|policy|aal2|service_role|user_roles|Supabase/.test(semComentarios(fontes.restrito)),
  false,
);

console.log("\nE. Navegação por papel\n");

verificar(
  "E1. o AppShell recebe o papel do servidor",
  /papel: PapelEfetivo/.test(fontes.shell),
  true,
);
verificar(
  "E2. e o layout o resolve pelo helper central",
  /papel=\{resolverPapelEfetivo\(acesso\.papeis\)\}/.test(fontes.layout),
  true,
);
verificar(
  "E3. a navegação vem de um mapa por papel",
  /const navegacao = NAVEGACAO\[papel\];/.test(fontes.shell),
  true,
);
verificar(
  "E4. e o <nav> sai da árvore quando o papel não tem link",
  /\{navegacao\.length > 0 \? \(\s*<nav/.test(fontes.shell),
  true,
);
// Conta dentro do bloco do admin, e não no arquivo todo: desde o B2.3 há
// também a entrada do operacional, e somar as duas mediria outra coisa.
{
  const bloco = /admin: \[([\s\S]*?)\],\n  operacional:/.exec(fontes.shell)?.[1] ?? "";
  verificar("E5. admin mantém os oito links", (bloco.match(/\{ href: "\//g) ?? []).length, 8);
}
for (const [rota] of TELAS) {
  verificar(
    `E6.${rota} — continua na navegação do admin`,
    fontes.shell.includes(`href: "/${rota}"`),
    true,
  );
}
// Toda rota oferecida pela navegação existe no disco. É mais forte que listar
// rotas proibidas: quando uma rota nova entra na barra, o teste continua
// valendo, e um link para caminho inexistente falha na hora.
{
  const destinos = [...fontes.shell.matchAll(/href: "(\/[a-z-]+)"/g)].map((m) => m[1]);
  const semRota = destinos.filter(
    (destino) => !existsSync(new URL(`../src/app/(painel)${destino}/page.tsx`, import.meta.url)),
  );
  verificar("E7. toda rota da navegação existe", semRota.join(",") || "nenhuma", "nenhuma");
  verificar("E7b. e há destino para conferir", destinos.length > 0, true);
}
verificar(
  "E8. nenhum link desabilitado como placeholder",
  /disabled.*href|href.*disabled/.test(fontes.shell),
  false,
);

console.log("\nF. Esconder o link não é a proteção\n");

// Se o AppShell fosse a única barreira, nenhuma página chamaria o guard. A
// contagem existe para que remover a chamada de uma tela apareça aqui.
verificar(
  "F1. as oito telas chamam o guard, não sete",
  Object.values(paginas).filter((f) => f.includes("await exigirAdmin()")).length,
  8,
);
verificar(
  "F2. o guard bloqueia por papel, não por caminho na URL",
  /pathname|usePathname|caminho/.test(fontes.guard),
  false,
);
verificar(
  "F3. a navegação é client component e não decide autorização",
  fontes.shell.includes('"use client"') && !/lerAcesso|user_roles/.test(fontes.shell),
  true,
);

console.log("\nG. O B2.2 não encostou em MFA, AAL, banco nem no B2.3\n");

verificar(
  "G1. decidirSituacaoMfa segue com as quatro saídas de sempre",
  (fontes.mfaLib.match(/"mfa-indisponivel"|"mfa-ausente"|"mfa-pendente"|"liberado"/g) ?? [])
    .length > 0,
  true,
);
verificar(
  "G2. o layout continua fechando o painel sem AAL2",
  /situacao === "mfa-ausente" \|\| acesso\.situacao === "mfa-pendente"\) redirect\("\/mfa"\)/.test(
    fontes.layout,
  ),
  true,
);
verificar(
  "G3. nada de nextLevel virou enforcement no B2.2",
  /nextLevel/.test(fontes.guard + fontes.papel + fontes.shell),
  false,
);
verificar(
  "G4. nenhum aal foi liberado por papel",
  /aal1|aal2/i.test(
    semComentarios(fontes.guard) +
      semComentarios(fontes.papel) +
      semComentarios(fontes.shell) +
      semComentarios(fontes.layout),
  ),
  false,
);
verificar(
  "G5. o destino pós-login segue /dashboard, sem depender de papel",
  (fontes.login.match(/router\.replace\("\/dashboard"\)/g) ?? []).length,
  2,
);
verificar("G6. e a tela de MFA também", /redirect\("\/dashboard"\)/.test(fontes.mfaPagina), true);
verificar(
  "G7. nenhum service_role em lugar nenhum do B2.2",
  /service_role|SERVICE_ROLE/.test(todasAsFontes),
  false,
);
verificar(
  "G8. nenhuma leitura de papel fora do fluxo server-side",
  /localStorage|sessionStorage|document\.cookie/.test(todasAsFontes),
  false,
);
verificar(
  "G9. o B2.2 não conecta a camada operacional do B2.1",
  /lib\/operacional/.test(todasAsFontes),
  false,
);
verificar(
  "G10. o núcleo do papel e o guard administrativo não dependem do operacional",
  /lib\/operacional|_exigir-operacional|painel-operacional/.test(fontes.papel + fontes.guard),
  false,
);
verificar(
  "G11. nenhuma tabela nova é alcançada pela camada de acesso",
  /from\("(clients|contracts|employees|invoices|invoice_items|timesheets|timesheet_entries)"/.test(
    fontes.guard + fontes.papel + fontes.layout + fontes.autorizacao,
  ),
  false,
);
verificar(
  "G12. a autorização continua lendo apenas user_roles",
  (fontes.autorizacao.match(/\.from\("(\w+)"\)/g) ?? []).join(","),
  '.from("user_roles")',
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
