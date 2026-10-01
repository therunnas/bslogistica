/**
 * Testes da tela administrativa de usuários (PR E — /usuarios).
 *
 * COMO RODAR:
 *
 *   npm run test:tela-usuarios
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * DUAS METADES:
 *
 *   - comportamento das funções puras de `_dominio.ts` (blocos A a D): cada
 *     desfecho que o backend do PR D pode devolver — inclusive "parcial" e
 *     "ultimo-admin" — precisa virar o feedback certo, sem mascarar o que
 *     aconteceu de verdade;
 *   - forma literal dos arquivos da tela (blocos E a H), porque o que esta
 *     tarefa proíbe é ausência: nenhuma chamada a `service_role` ou à Admin
 *     API no lado do cliente, nenhum `signUp`, nenhuma decisão de autorização
 *     nova, e as confirmações destrutivas por `AlertDialog`, não
 *     `window.confirm`. Ausência só se mede lendo o arquivo — daí a suíte
 *     espelhar `testar-papel.mjs` e `testar-tela-operacional.mjs`.
 *
 * O que NÃO está aqui: a tela rodando contra o banco ou um navegador de
 * verdade. Não existe conta administrativa de teste neste ambiente — a prova
 * ponta a ponta é a matriz do PR G, como já registrado para a superfície
 * operacional.
 */

import { readFileSync } from "node:fs";

import {
  concluiuPorCompleto,
  faseDaListagem,
  feedbackDaAlteracaoDePapel,
  feedbackDaAtribuicaoDeOperacao,
  feedbackDaReativacao,
  feedbackDaRemocaoDeOperacao,
  feedbackDaRevogacaoDeAcesso,
  feedbackDoConvite,
  ROTULO_PAPEL,
  situacaoDoUsuario,
} from "../src/app/(painel)/usuarios/_dominio.ts";

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

const fontes = {
  dominio: ler("src/app/(painel)/usuarios/_dominio.ts"),
  hooks: ler("src/app/(painel)/usuarios/_hooks.ts"),
  pagina: ler("src/app/(painel)/usuarios/page.tsx"),
  painel: ler("src/app/(painel)/usuarios/painel-usuarios.tsx"),
  gerenciar: ler("src/app/(painel)/usuarios/gerenciar-usuario.tsx"),
  acoes: ler("src/app/(painel)/usuarios/_acoes.ts"),
  operacoesLib: ler("src/lib/admin-usuarios/operacoes.ts"),
  shell: ler("src/app/(painel)/_components/app-shell.tsx"),
  guard: ler("src/app/(painel)/_exigir-admin.tsx"),
};
const telaInteira = fontes.hooks + fontes.pagina + fontes.painel + fontes.gerenciar;

const usuario = (extra = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "pessoa@example.com",
  nomeCompleto: null,
  papeis: ["operacional"],
  banido: false,
  criadoEm: "2026-01-01T00:00:00Z",
  ultimoLoginEm: null,
  ...extra,
});

console.log("\nA. Rótulos e situação da conta\n");

verificar("A1. rótulo de admin", ROTULO_PAPEL.admin, "Administrador");
verificar("A2. rótulo de operacional", ROTULO_PAPEL.operacional, "Operacional");

verificar(
  "A3. banido tem prioridade sobre papel",
  situacaoDoUsuario(usuario({ banido: true })),
  "banido",
);
verificar(
  "A4. sem papel e sem banimento é sem-papel",
  situacaoDoUsuario(usuario({ papeis: [] })),
  "sem-papel",
);
verificar("A5. com papel e sem banimento é ativo", situacaoDoUsuario(usuario()), "ativo");
verificar(
  "A6. banido e sem papel continua sendo banido, não sem-papel",
  situacaoDoUsuario(usuario({ banido: true, papeis: [] })),
  "banido",
);

console.log("\nB. Fase da listagem: carregando, erro e vazio não se confundem\n");

verificar(
  "B1. pendente é carregando, mesmo sem erro",
  faseDaListagem({ pendente: true, erro: false, quantidade: undefined }),
  "carregando",
);
verificar(
  "B2. sem quantidade ainda (nem que pendente já tenha virado falso) é carregando",
  faseDaListagem({ pendente: false, erro: false, quantidade: undefined }),
  "carregando",
);
verificar(
  "B3. erro é erro, mesmo que quantidade exista de uma leitura anterior",
  faseDaListagem({ pendente: false, erro: true, quantidade: 3 }),
  "erro",
);
verificar(
  "B4. zero usuários é vazio, não erro",
  faseDaListagem({ pendente: false, erro: false, quantidade: 0 }),
  "vazio",
);
verificar(
  "B5. com dados é pronto",
  faseDaListagem({ pendente: false, erro: false, quantidade: 5 }),
  "pronto",
);

console.log("\nC. Feedback de cada Resultado do backend do PR D\n");

verificar(
  "C1. convite aceito é sucesso",
  feedbackDoConvite({ situacao: "convidado", userId: "x" }).tipo,
  "sucesso",
);
verificar(
  "C2. convite com erro devolve a mensagem do backend, não uma genérica",
  feedbackDoConvite({ situacao: "erro", mensagem: "E-mail inválido." }).texto,
  "E-mail inválido.",
);

verificar(
  "C3. papel concedido é sucesso",
  feedbackDaAlteracaoDePapel({ situacao: "concedido" }).tipo,
  "sucesso",
);
verificar(
  "C4. papel revogado é sucesso",
  feedbackDaAlteracaoDePapel({ situacao: "revogado" }).tipo,
  "sucesso",
);
verificar(
  "C5. último admin é recusa, não sucesso mascarado",
  feedbackDaAlteracaoDePapel({ situacao: "ultimo-admin", mensagem: "não pode" }).tipo,
  "erro",
);
verificar(
  "C6. erro de alteração de papel preserva a mensagem",
  feedbackDaAlteracaoDePapel({ situacao: "erro", mensagem: "falhou X" }).texto,
  "falhou X",
);

verificar(
  "C7. revogação completa é sucesso",
  feedbackDaRevogacaoDeAcesso({ situacao: "revogado" }).tipo,
  "sucesso",
);
verificar(
  "C8. revogação recusada por último admin é erro",
  feedbackDaRevogacaoDeAcesso({ situacao: "ultimo-admin", mensagem: "m" }).tipo,
  "erro",
);
// O caso que a Checkout #13.1 corrigiu no backend: "parcial" nunca pode virar
// "sucesso" nem "erro" na tela — um dos dois mascararia que o papel já saiu.
verificar(
  "C9. revogação parcial NÃO é sucesso",
  feedbackDaRevogacaoDeAcesso({ situacao: "parcial", mensagem: "m" }).tipo !== "sucesso",
  true,
);
verificar(
  "C10. revogação parcial NÃO é erro",
  feedbackDaRevogacaoDeAcesso({ situacao: "parcial", mensagem: "m" }).tipo !== "erro",
  true,
);
verificar(
  "C11. revogação parcial tem tipo próprio",
  feedbackDaRevogacaoDeAcesso({ situacao: "parcial", mensagem: "m" }).tipo,
  "parcial",
);
verificar(
  "C12. e preserva a mensagem exata do backend",
  feedbackDaRevogacaoDeAcesso({
    situacao: "parcial",
    mensagem: "O papel já foi removido, mas a revogação não terminou.",
  }).texto,
  "O papel já foi removido, mas a revogação não terminou.",
);

verificar(
  "C13. reativação completa é sucesso",
  feedbackDaReativacao({ situacao: "reativado" }).tipo,
  "sucesso",
);
verificar(
  "C14. reativação parcial não é sucesso nem erro",
  feedbackDaReativacao({ situacao: "parcial", mensagem: "m" }).tipo,
  "parcial",
);
verificar(
  "C15. erro de reativação preserva mensagem",
  feedbackDaReativacao({ situacao: "erro", mensagem: "falhou Y" }).texto,
  "falhou Y",
);

verificar(
  "C16. atribuição de operação é sucesso",
  feedbackDaAtribuicaoDeOperacao({ situacao: "atribuida" }).tipo,
  "sucesso",
);
verificar(
  "C17. falha na atribuição é erro",
  feedbackDaAtribuicaoDeOperacao({ situacao: "erro", mensagem: "m" }).tipo,
  "erro",
);
verificar(
  "C18. remoção de operação é sucesso",
  feedbackDaRemocaoDeOperacao({ situacao: "removida" }).tipo,
  "sucesso",
);
verificar(
  "C19. falha na remoção é erro",
  feedbackDaRemocaoDeOperacao({ situacao: "erro", mensagem: "m" }).tipo,
  "erro",
);

console.log("\nD. Só 'sucesso' fecha o fluxo por completo\n");

verificar("D1. sucesso conclui", concluiuPorCompleto({ tipo: "sucesso", texto: "" }), true);
verificar("D2. parcial NÃO conclui", concluiuPorCompleto({ tipo: "parcial", texto: "" }), false);
verificar("D3. erro NÃO conclui", concluiuPorCompleto({ tipo: "erro", texto: "" }), false);

console.log("\nE. A rota bloqueia no servidor, como as outras sete\n");

verificar(
  "E1. a página importa o guard central",
  /from "\.\.\/_exigir-admin"/.test(fontes.pagina),
  true,
);
verificar(
  "E2. chama exigirAdmin e devolve o bloqueio",
  /const bloqueio = await exigirAdmin\(\);\s*\n\s*if \(bloqueio\) return bloqueio;/.test(
    fontes.pagina,
  ),
  true,
);
verificar(
  "E3. o guard vem antes do painel administrativo",
  fontes.pagina.includes("await exigirAdmin()") &&
    fontes.pagina.indexOf("await exigirAdmin()") < fontes.pagina.indexOf("<PainelUsuarios />"),
  true,
);
verificar(
  "E4. nenhuma cópia local da regra de papel",
  /papeis\.includes|user_roles|role === "admin"/.test(fontes.pagina),
  false,
);
verificar(
  "E5. a tela existe como entrada da área de conta do admin (não da navegação principal)",
  /href: "\/usuarios",\s*label: "Usuários"/.test(fontes.shell),
  true,
);
// A contagem completa de links da navegação principal e do menu de conta é
// asseverada em scripts/testar-papel.mjs (blocos E e E'); aqui só confere que
// esta tela não duplicou a decisão de onde ela mora.
verificar(
  "E5b. usuários não está dentro do mapa NAVEGACAO (é ITEM_USUARIOS, à parte)",
  /admin: \[([\s\S]*?)\],\n  operacional:/.exec(fontes.shell)?.[1]?.includes("/usuarios") ?? false,
  false,
);

console.log("\nF. Nenhuma lógica de segurança nova no lado do cliente\n");

for (const arquivo of ["hooks", "painel", "gerenciar"]) {
  verificar(
    `F1.${arquivo} — sem service_role`,
    /service_role|SERVICE_ROLE/.test(semComentarios(fontes[arquivo])),
    false,
  );
  verificar(
    `F2.${arquivo} — sem Admin API do GoTrue`,
    /auth\.admin\./.test(fontes[arquivo]),
    false,
  );
  verificar(`F3.${arquivo} — sem signUp`, /\bsignUp\b/.test(fontes[arquivo]), false);
  verificar(
    `F4.${arquivo} — sem criarClienteAdmin`,
    /criarClienteAdmin\b/.test(fontes[arquivo]),
    false,
  );
  verificar(
    `F5.${arquivo} — sem exigirAdminAal2 duplicado (isso é do backend)`,
    /exigirAdminAal2/.test(fontes[arquivo]),
    false,
  );
}
verificar(
  "F6. os hooks só chamam as Server Actions de _acoes, não criam cliente",
  /criarClienteNavegador|createClient|createBrowserClient/.test(semComentarios(fontes.hooks)),
  false,
);
verificar(
  "F7. a tela consome exclusivamente as nove ações do backend do PR D/PR E",
  [
    "listarUsuariosAction",
    "convidarUsuarioAction",
    "alterarPapelAction",
    "revogarAcessoAction",
    "reativarUsuarioAction",
    "atribuirOperacaoAction",
    "removerOperacaoAction",
    "listarOperacoesAtribuidasAction",
    "listarOperacoesDisponiveisAction",
  ].every((acao) => fontes.hooks.includes(acao)),
  true,
);
verificar(
  "F8. nenhum from(...) direto em tabela de negócio na tela",
  /\.from\("(clients|contracts|employees|operations|shifts|timesheets|timesheet_entries|invoices|invoice_items|user_roles)"\)/.test(
    telaInteira,
  ),
  false,
);
verificar(
  "F9. _acoes.ts não foi alterado para pular a autorização (chama exigirAdminAal2 em toda ação)",
  (fontes.acoes.match(/await exigirAdminAal2\(\)/g) ?? []).length,
  9,
);

console.log(
  "\nF'. A lista de operações do picker vem de uma Server Action, não de useOperations\n",
);

verificar(
  "F10. gerenciar-usuario.tsx NÃO importa useOperations de @/lib/queries",
  /from "@\/lib\/queries"/.test(fontes.gerenciar),
  false,
);
verificar(
  "F11. nenhum arquivo da tela usa o hook genérico useOperations",
  /\buseOperations\(/.test(fontes.painel + fontes.gerenciar),
  false,
);
verificar(
  "F12. o picker de operações consome o hook próprio da tela",
  /\buseOperacoesDisponiveis\(/.test(fontes.gerenciar),
  true,
);
verificar(
  "F13. o hook próprio chama a Server Action, não cria cliente de navegador",
  /useOperacoesDisponiveis[\s\S]{0,120}listarOperacoesDisponiveisAction\(\)/.test(fontes.hooks),
  true,
);
verificar(
  "F14. a Server Action de operações disponíveis exige admin em AAL2",
  /export async function listarOperacoesDisponiveisAction\(\)[\s\S]{0,120}await exigirAdminAal2\(\)/.test(
    fontes.acoes,
  ),
  true,
);
verificar(
  "F15. e não usa service_role para isso (sessão RLS do admin)",
  /listarOperacoesDisponiveisAction[\s\S]{0,200}criarClienteAdmin/.test(fontes.acoes),
  false,
);
verificar(
  "F16. nenhuma leitura de 'operations' pelo navegador na superfície /usuarios",
  /criarClienteNavegador\([^)]*\)[\s\S]{0,80}\.from\("operations"\)/.test(telaInteira),
  false,
);
verificar(
  "F17. listarOperacoesDisponiveis projeta só id e name, nada financeiro",
  /\.from\("operations"\)\s*\.select\("id, name"\)/.test(fontes.operacoesLib),
  true,
);
verificar(
  "F18. e não usa service_role — sessão de admin já basta (RLS)",
  /export async function listarOperacoesDisponiveis[\s\S]{0,400}\}/
    .exec(fontes.operacoesLib)?.[0]
    ?.includes("service_role") ?? false,
  false,
);

console.log("\nG. Confirmações destrutivas usam AlertDialog, não window.confirm\n");

verificar(
  "G1. nenhum window.confirm em lugar nenhum da tela",
  /window\.confirm/.test(telaInteira),
  false,
);
verificar(
  "G2. revogar papel tem AlertDialog de confirmação",
  /papelParaRevogar !== null[\s\S]{0,900}AlertDialogAction onClick=\{confirmarRevogacaoDePapel\}/.test(
    fontes.gerenciar,
  ),
  true,
);
verificar(
  "G3. revogar acesso tem AlertDialog de confirmação",
  /open=\{confirmandoRevogacaoDeAcesso\}[\s\S]{0,900}AlertDialogAction onClick=\{confirmarRevogacaoDeAcesso\}/.test(
    fontes.gerenciar,
  ),
  true,
);
verificar(
  "G4. remover operação tem AlertDialog de confirmação",
  /operacaoParaRemover !== null[\s\S]{0,900}AlertDialogAction onClick=\{confirmarRemocaoDeOperacao\}/.test(
    fontes.gerenciar,
  ),
  true,
);
verificar(
  "G5. o texto obrigatório sobre reativação está presente, ao pé da letra",
  fontes.gerenciar.includes("REATIVAR ACESSO NÃO RESTAURA OPERAÇÕES ANTIGAS"),
  true,
);

console.log("\nH. Feedback não mascarado e prevenção de envio duplicado\n");

verificar(
  "H1. o resultado 'parcial' é tratado como caso próprio na tela (toast.warning)",
  /tipo === "parcial"[\s\S]{0,80}toast\.warning/.test(fontes.gerenciar),
  true,
);
verificar(
  "H2. parcial e erro deixam um banner visível, não só um toast que some",
  /definirBanner\(feedback\)/.test(fontes.gerenciar),
  true,
);
verificar(
  "H3. o botão de convidar desabilita durante o envio (evita duplo clique)",
  /disabled=\{!convite\.email \|\| convidar\.isPending\}/.test(fontes.painel),
  true,
);
verificar(
  "H4. conceder/revogar papel desabilita durante a mutação",
  /disabled=\{alterarPapel\.isPending\}/.test(fontes.gerenciar),
  true,
);
verificar(
  "H5. atribuir operação desabilita durante a mutação",
  /disabled=\{!operationIdParaAtribuir \|\| atribuir\.isPending\}/.test(fontes.gerenciar),
  true,
);
verificar(
  "H6. o convite só fecha o diálogo quando o resultado é sucesso, não em qualquer resposta",
  /if \(feedback\.tipo === "sucesso"\)[\s\S]{0,80}setConvidarAberto\(false\)/.test(fontes.painel),
  true,
);
// Achado real de revisão (chatgpt-codex-connector, PR #47): um convite pode
// criar a conta e falhar só depois, ao conceder o papel — devolvendo "erro"
// mesmo com uma linha persistente e nova em auth.users. Sem invalidar a
// lista nesse caso, a conta fica escondida e o reenvio esbarra num e-mail já
// cadastrado. A invalidação precisa ser incondicional, não presa a
// `situacao === "convidado"`.
verificar(
  "H7. useConvidarUsuario invalida a lista de usuários em QUALQUER resultado, não só em 'convidado'",
  /onSuccess: \(\) => \{\s*void queryClient\.invalidateQueries\(\{ queryKey: CHAVES\.usuarios\(\) \}\);\s*\},/.test(
    fontes.hooks,
  ),
  true,
);
verificar(
  "H8. e não existe mais a condição que escondia a conta parcialmente criada",
  /if \(resultado\.situacao === "convidado"\)/.test(fontes.hooks),
  false,
);

console.log("\nI. Nada de MFA, sessão ou login foi tocado por este PR\n");

verificar(
  "I1. a tela não importa nada de mfa.ts",
  /from "@\/lib\/mfa"/.test(telaInteira + fontes.pagina),
  false,
);
verificar(
  "I2. a tela não referencia aal1/aal2 (isso é decisão do guard e do backend)",
  /aal1|aal2/i.test(semComentarios(telaInteira + fontes.pagina)),
  false,
);
verificar(
  "I3. o guard central (_exigir-admin.tsx) não foi alterado por este PR",
  /lerAcesso\(\)/.test(fontes.guard) && /ehAdmin\(acesso\.papeis\)/.test(fontes.guard),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
