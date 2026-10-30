/**
 * Testes da tela Configurações → Segurança — PR F (MFA opcional do
 * operacional).
 *
 * COMO RODAR:
 *
 *   npm run test:configuracoes
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * TRÊS METADES:
 *
 *   - a POLÍTICA (bloco A): reafirma, a partir desta suíte, os pontos exatos
 *     que o Checkout #17 pediu como cobertura mínima — admin nunca em AAL1,
 *     operacional sem MFA liberado em AAL1, operacional com fator pendente em
 *     AAL1, sem papel bloqueado, estado indeterminado fechado. `decidirAcesso`
 *     já é testado em `testar-mfa.mjs`; repetir aqui não é redundância boba, é
 *     a garantia de que ESTA tela não passou a decidir nada por conta própria
 *     nem reimplementou a regra em paralelo;
 *   - a LÓGICA PURA da tela (bloco B): `_dominio.ts` — fase depois de listar
 *     fatores, texto por papel, quem tem acesso à rota;
 *   - a FORMA LITERAL (blocos C a G): guard da rota, navegação por papel, o
 *     fluxo de ativação usando a API oficial do Supabase, e a ausência do que
 *     está proibido — `service_role`, cookie de "trusted device", migration
 *     nova, mudança na política de sessão.
 *
 * O que NÃO está aqui: o enroll/verify rodando contra o banco. Não existe
 * conta operacional real neste ambiente, e a prova ponta a ponta continua
 * sendo a matriz do PR G.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";

import { decidirAcesso } from "../src/lib/mfa.ts";
import {
  faseAposListarFatores,
  papelTemAcessoAConfiguracoes,
  textoSemFator,
} from "../src/app/(painel)/configuracoes/_dominio.ts";

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

const ler = (caminho) => (existsSync(caminho) ? readFileSync(caminho, "utf8") : "");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const fontes = {
  pagina: ler("src/app/(painel)/configuracoes/page.tsx"),
  dominio: ler("src/app/(painel)/configuracoes/_dominio.ts"),
  painel: ler("src/app/(painel)/configuracoes/painel-configuracoes.tsx"),
  shell: ler("src/app/(painel)/_components/app-shell.tsx"),
  mfaLib: ler("src/lib/mfa.ts"),
  mfaPainel: ler("src/app/mfa/painel-mfa.tsx"),
  autorizacao: ler("src/app/(painel)/_autorizacao.ts"),
  layout: ler("src/app/(painel)/layout.tsx"),
};
const telaInteira = fontes.pagina + fontes.dominio + fontes.painel;

console.log("\nA. A política do PR F, reafirmada a partir desta tela\n");

verificar(
  "A1. operacional sem MFA continua liberado em AAL1",
  decidirAcesso("operacional", "aal1", "sem-fator"),
  "liberado",
);
verificar(
  "A2. operacional com fator verificado em AAL1 fica mfa-pendente",
  decidirAcesso("operacional", "aal1", "exige-fator"),
  "mfa-pendente",
);
verificar(
  "A3. operacional com MFA em AAL2 fica liberado",
  decidirAcesso("operacional", "aal2", "exige-fator"),
  "liberado",
);
verificar(
  "A4. admin em AAL1 SEM fator é liberado (AUTH-01B: MFA opcional); o que é crítico exige AAL2 por conta própria",
  decidirAcesso("admin", "aal1", "sem-fator"),
  "liberado",
);
verificar(
  "A4b. admin em AAL1 com fator pendente também continua bloqueado",
  decidirAcesso("admin", "aal1", "exige-fator") !== "liberado",
  true,
);
verificar("A5. admin AAL2 liberado", decidirAcesso("admin", "aal2", "sem-fator"), "liberado");
verificar(
  "A6. conta sem papel bloqueada",
  decidirAcesso("sem-papel", "aal2", "sem-fator"),
  "sem-papel",
);
verificar(
  "A7. estado indeterminado fecha, mesmo em AAL1 para o operacional",
  decidirAcesso("operacional", "aal1", "indeterminado"),
  "mfa-indisponivel",
);
verificar(
  "A8. e fecha também para o admin",
  decidirAcesso("admin", "aal1", "indeterminado"),
  "mfa-indisponivel",
);

console.log("\nB. Lógica pura de _dominio.ts\n");

verificar(
  "B1. sem erro e sem fator -> sem-fator",
  faseAposListarFatores(false, false),
  "sem-fator",
);
verificar("B2. sem erro e com fator -> com-fator", faseAposListarFatores(false, true), "com-fator");
verificar(
  "B3. erro é erro, mesmo que o argumento diga que há fator (a leitura falhou, não se sabe)",
  faseAposListarFatores(true, true),
  "erro",
);
verificar("B4. erro sem fator também é erro", faseAposListarFatores(true, false), "erro");

verificar("B5. admin tem acesso à rota", papelTemAcessoAConfiguracoes("admin"), true);
verificar("B6. operacional tem acesso à rota", papelTemAcessoAConfiguracoes("operacional"), true);
verificar("B7. sem-papel NÃO tem acesso à rota", papelTemAcessoAConfiguracoes("sem-papel"), false);

verificar(
  "B8. o texto do admin explica o que continua fechado sem o fator (operações críticas)",
  /críticas/i.test(textoSemFator("admin").corpo),
  true,
);
verificar(
  "B9. o texto para operacional diz que é opcional",
  /opcional/i.test(textoSemFator("operacional").corpo),
  true,
);
verificar(
  "B10. o texto do admin também diz 'opcional' (AUTH-01B)",
  /opcional/i.test(textoSemFator("admin").corpo),
  true,
);
verificar(
  "B11. os dois papéis têm título igual (o que muda é o corpo, não o fato de faltar)",
  textoSemFator("admin").titulo === textoSemFator("operacional").titulo,
  true,
);

console.log("\nC. A rota é acessível por admin liberado e por operacional liberado\n");

verificar(
  "C1. a página lê a decisão central, não reimplementa nada",
  /const acesso = await lerAcesso\(\);/.test(fontes.pagina),
  true,
);
verificar(
  "C2. fecha em qualquer situação que não seja liberado",
  /if \(acesso\.situacao !== "liberado"\)/.test(fontes.pagina),
  true,
);
verificar(
  "C3. o papel vem de resolverPapelEfetivo, não de papeis.includes",
  /resolverPapelEfetivo\(acesso\.papeis\)/.test(fontes.pagina) &&
    !/papeis\.includes/.test(semComentarios(fontes.pagina)),
  true,
);
verificar(
  "C4. usa papelTemAcessoAConfiguracoes em vez de comparar o papel na mão",
  /papelTemAcessoAConfiguracoes\(papel\)/.test(fontes.pagina),
  true,
);
verificar(
  "C5. nenhuma cópia local da regra de papel (user_roles direto, ou 'role ===')",
  /user_roles|role === "admin"|role === "operacional"/.test(semComentarios(fontes.pagina)),
  false,
);
verificar(
  "C6. falha ao determinar papel/acesso cai numa tela de restrição, não no painel",
  /return <AcessoNaoLiberado/.test(fontes.pagina),
  true,
);
verificar(
  "C7. o painel só é renderizado depois das duas checagens",
  fontes.pagina.indexOf("<PainelConfiguracoes") >
    Math.max(
      fontes.pagina.indexOf('if (acesso.situacao !== "liberado")'),
      fontes.pagina.indexOf("papelTemAcessoAConfiguracoes(papel)"),
    ),
  true,
);

console.log("\nD. Navegação: quem vê o quê no menu de conta\n");

verificar(
  "D1. admin continua vendo 'Usuários'",
  /admin: \[ITEM_USUARIOS, ITEM_SEGURANCA\]/.test(fontes.shell),
  true,
);
verificar(
  "D2. operacional NÃO vê 'Usuários'",
  /operacional: \[ITEM_USUARIOS/.test(fontes.shell),
  false,
);
verificar(
  "D3. operacional vê 'Segurança'",
  /operacional: \[ITEM_SEGURANCA\]/.test(fontes.shell),
  true,
);
verificar(
  "D4. o rótulo do item é 'Segurança', apontando para /configuracoes",
  /\{\s*href: "\/configuracoes",\s*label: "Segurança"/.test(fontes.shell),
  true,
);
verificar(
  "D5. a navegação PRINCIPAL (NAVEGACAO) não ganhou item novo por isso",
  (/admin: \[([\s\S]*?)\],\n  operacional:/.exec(fontes.shell)?.[1] ?? "").includes(
    "/configuracoes",
  ),
  false,
);

console.log("\nE. O fluxo de ativação usa exclusivamente a API oficial de MFA do Supabase\n");

verificar(
  "E1. lista fatores ao carregar, sem side effect",
  /supabase\.auth\.mfa\.listFactors\(\)/.test(fontes.painel),
  true,
);
verificar(
  "E2. o enroll só acontece dentro do fluxo de ativação, não no carregamento inicial",
  /function AtivarSegundoFator/.test(fontes.painel) &&
    fontes.painel.indexOf("supabase.auth.mfa.enroll(") >
      fontes.painel.indexOf("function AtivarSegundoFator"),
  true,
);
verificar(
  "E3. limpa fatores 'unverified' antes de cadastrar um novo",
  /status === "unverified"[\s\S]{0,120}unenroll\(\{ factorId: pendente\.id \}\)/.test(
    fontes.painel,
  ),
  true,
);
verificar(
  "E4. a confirmação usa challengeAndVerify, não uma verificação caseira",
  /supabase\.auth\.mfa\.challengeAndVerify\(\{/.test(fontes.painel),
  true,
);
verificar(
  "E5. nenhum segredo TOTP é gerado localmente — vem do enroll do Supabase",
  /gerarSegredo|generateSecret|otplib|speakeasy/i.test(telaInteira),
  false,
);
verificar(
  "E6. MFA só é considerado ativo DEPOIS do challengeAndVerify dar certo",
  /if \(error\) \{[\s\S]{0,150}return;\s*\}\s*\n\s*aoConcluir\(\);/.test(fontes.painel),
  true,
);
verificar(
  "E7. o sucesso da ativação relê os fatores do servidor (não seta 'ativo' na mão)",
  /aoConcluir=\{\(\) => \{\s*toast\.success\([^)]*\);\s*void carregarFatores\(\);/.test(
    fontes.painel,
  ),
  true,
);
verificar(
  "E8. nenhum estado 'ativo' é setado direto a partir do retorno do enroll",
  /setFase\("com-fator"\)/.test(
    fontes.painel.slice(0, fontes.painel.indexOf("challengeAndVerify")),
  ),
  false,
);
verificar(
  "E9. esta tela reutiliza a mesma fonte de QR de /mfa (fonteDoQrTotp), não duplica a decisão",
  /fonteDoQrTotp/.test(fontes.painel) && fontes.mfaLib.includes("export function fonteDoQrTotp("),
  true,
);
verificar(
  "E10. /mfa também passou a usar a versão compartilhada — zero cópias divergentes",
  /fonteDoQrTotp/.test(fontes.mfaPainel) && !/function fonteDoQr\(/.test(fontes.mfaPainel),
  true,
);
verificar(
  "E11. o desafio de quem está entrando continua só em /mfa — esta tela não chama challengeAndVerify fora do fluxo de ativação nova",
  (semComentarios(fontes.painel).match(/challengeAndVerify/g) ?? []).length,
  1,
);

console.log("\nF. Desativação de MFA — autosserviço do operacional, achado P1 do Codex\n");

verificar(
  "F1. nenhuma chamada a unenroll sobre um fator ainda 'unverified' durante a ativação usa o fator já verificado (continua só limpando pendentes)",
  /fatores\.totp\[0\][\s\S]{0,300}unenroll/.test(fontes.painel),
  false,
);
verificar(
  "F2. quem tem fator (admin ou operacional) vê a ação de desativação, sem ramo por papel",
  /Desativar autenticação em duas etapas/.test(fontes.painel) &&
    !/papel === "operacional" \? \(/.test(fontes.painel),
  true,
);
verificar(
  "F3. a tela não diz mais que o MFA do admin é obrigatório nem esconde a desativação dele",
  !/obrigatória para administradores|não pode ser desativada/.test(fontes.painel),
  true,
);
verificar(
  "F4. a desativação exige confirmação por AlertDialog, não window.confirm",
  /<AlertDialog open=\{confirmando\}/.test(fontes.painel) &&
    /<AlertDialogAction onClick=\{\(\) => void desativar\(\)\}>Desativar<\/AlertDialogAction>/.test(
      fontes.painel,
    ),
  true,
);
verificar(
  "F4b. nenhum window.confirm em lugar nenhum da tela",
  /window\.confirm/.test(fontes.painel),
  false,
);
verificar(
  "F5. a desativação usa supabase.auth.mfa.unenroll, a API oficial",
  /async function desativar\(\)[\s\S]{0,300}supabase\.auth\.mfa\.unenroll\(\{ factorId: fator\.id \}\)/.test(
    fontes.painel,
  ),
  true,
);
verificar(
  "F6. usa o factorId do fator ATUAL (prop), não um id arbitrário ou de outro fator",
  /unenroll\(\{ factorId: fator\.id \}\)/.test(fontes.painel),
  true,
);
verificar(
  "F7. sucesso relê os fatores do servidor via aoRemover (carregarFatores), não seta 'sem-fator' na mão",
  /aoRemover\(\);\s*setRemovendo\(false\);/.test(fontes.painel) &&
    /aoRemover=\{\(\) => void carregarFatores\(\)\}/.test(fontes.painel),
  true,
);
verificar(
  "F8. refreshSession() roda depois do unenroll, antes de reler os fatores",
  /const \{ error: erroUnenroll \} = await supabase\.auth\.mfa\.unenroll\(\{ factorId: fator\.id \}\);[\s\S]{0,900}const \{ error: erroRefresh \} = await supabase\.auth\.refreshSession\(\);[\s\S]{0,150}aoRemover\(\);/.test(
    fontes.painel,
  ),
  true,
);
verificar(
  "F9. falha do unenroll NÃO mostra sucesso nem relê fatores — sai antes de aoRemover()",
  /if \(erroUnenroll\) \{\s*toast\.error\(erroUnenroll\.message\);\s*setRemovendo\(false\);\s*return;\s*\}/.test(
    fontes.painel,
  ),
  true,
);
verificar(
  "F10. falha do refreshSession DEPOIS do unenroll não mascara a remoção já persistida — ainda relê fatores e avisa, não trata como erro",
  /if \(erroRefresh\) \{\s*toast\.warning\(/.test(fontes.painel),
  true,
);
verificar(
  "F10b. o aviso de falha de refresh não usa toast.error (a remoção não falhou)",
  /if \(erroRefresh\) \{\s*toast\.error\(/.test(fontes.painel),
  false,
);
verificar(
  "F11. nenhum service_role/Admin API na desativação",
  /async function desativar\(\)[\s\S]{0,600}\n  \}/
    .exec(fontes.painel)?.[0]
    ?.match(/service_role|auth\.admin\./i) ?? null,
  null,
);

console.log("\nG. Segurança: nada proibido entrou por este PR\n");

verificar(
  "G1. nenhum service_role em lugar nenhum da tela",
  /service_role|SERVICE_ROLE/.test(semComentarios(telaInteira)),
  false,
);
verificar("G2. nenhuma chamada à Admin API do GoTrue", /auth\.admin\./.test(telaInteira), false);
verificar("G3. nenhum signUp", /\bsignUp\b/.test(telaInteira), false);
verificar(
  "G4. nenhum cookie 'trusted device' ou equivalente, em lugar nenhum da tela",
  /document\.cookie|trusted.?device|trustedDevice|dispositivo.?confiavel/i.test(telaInteira),
  false,
);
verificar(
  "G5. nenhuma leitura/escrita de localStorage ou sessionStorage como fronteira de decisão",
  /localStorage|sessionStorage/.test(telaInteira),
  false,
);
verificar(
  "G6. nenhuma tabela de negócio é lida por esta tela",
  /\.from\("(clients|contracts|employees|operations|shifts|timesheets|timesheet_entries|invoices|invoice_items|user_roles)"\)/.test(
    telaInteira,
  ),
  false,
);
verificar(
  "G7. o guard central (_autorizacao.ts) não foi tocado por este PR",
  /export const lerAcesso = cache\(async \(\): Promise<Acesso> => \{/.test(fontes.autorizacao),
  true,
);
verificar(
  "G8. decidirAcesso, em src/lib/mfa.ts, continua com a mesma assinatura de sempre",
  /export function decidirAcesso\(\s*papel: PapelDoAcesso,\s*nivelAtual: NivelDeGarantia \| null \| undefined,\s*estadoDoFator: EstadoDoFator,\s*\): DecisaoDeAcesso \{/.test(
    fontes.mfaLib,
  ),
  true,
);
verificar(
  "G9. o layout do painel não foi alterado para dar exceção a /configuracoes",
  !/configuracoes/.test(fontes.layout),
  true,
);
verificar(
  "G10. conjunto de migrations contém 38 arquivos, até a 033 (taxas legadas exigem vigência com o motor ligado, AUTH-01C.1), a 032 (MFA opcional, AUTH-01B) e, antes dela, até a 031 (integridade da folha, C06/C07; local, ainda não aplicada) e, antes dela, até a 030 (a 025 é o motor por vigência; a 026, o cadastro atômico, C05-B5.1; a 027, a ativação que recusa divergência, C05-B5.5; a 028, o contrato da operação protegido, C05-B5.6; a 029, as regras financeiras da BS, C05-B8.10; a 030, as regras definitivas, C05-B8.15)",
  readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).length,
  38,
);
verificar(
  "G10b. a migration mais recente é a 033 (taxas legadas exigem vigência, AUTH-01C.1)",
  readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .at(-1)
    .includes("_033_"),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
