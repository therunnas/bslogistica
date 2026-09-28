/**
 * Testes do backend administrativo de usuários (PR D).
 *
 * COMO RODAR:
 *
 *   npm run test:admin-usuarios
 *
 * Mesmo formato das outras suítes: sem framework, Node executando os módulos
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * TRÊS METADES:
 *
 *   - forma literal (bloco A): que `autorizacao.ts` nunca aceita identidade
 *     por parâmetro — a mesma classe de garantia que `009_superficie_operacional`
 *     já mede no lado SQL para `operador_elegivel_aal1()`, e que `admin.ts`
 *     nunca é referenciado por um Client Component;
 *   - domínio puro (bloco B): `dominio.ts`, sem cliente nenhum;
 *   - orquestração (blocos C a G): `servico.ts` e `operacoes.ts` com um
 *     `ClienteAdministrativo`/`ClienteDeOperacoes` FALSO — objeto em memória,
 *     sem rede, sem banco —, incluindo o caminho em que o banco recusaria com
 *     `42501` a remoção do último admin, simulado pelo falso cliente.
 *
 * O que este arquivo NÃO prova: que o trigger `proteger_ultimo_admin` (017)
 * ou as policies de `admin_audit_log` funcionam de verdade no Postgres — isso
 * é `supabase/tests/013_administracao_usuarios.sql`, rodado à parte contra um
 * banco real. Aqui só se prova que `servico.ts` REAGE do jeito certo quando o
 * banco recusa.
 */

import { readFileSync } from "node:fs";

import { ACAO_AUDITORIA } from "../src/lib/admin-usuarios/tipos.ts";
import {
  combinarUsuariosEPapeis,
  DURACAO_BANIMENTO_INDEFINIDO,
  DURACAO_SEM_BANIMENTO,
  estaBanido,
  exigirAcaoDePapel,
  exigirEmailValido,
  exigirPapelValido,
  exigirUuid,
} from "../src/lib/admin-usuarios/dominio.ts";
import { ErroAdministrativo } from "../src/lib/admin-usuarios/cliente.ts";
import {
  alterarPapel,
  convidarUsuario,
  listarUsuarios,
  reativarUsuario,
  revogarAcesso,
} from "../src/lib/admin-usuarios/servico.ts";
import {
  atribuirOperacao,
  listarOperacoesAtribuidas,
  removerOperacao,
  removerTodasAsAtribuicoes,
} from "../src/lib/admin-usuarios/operacoes.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const bateu = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bateu) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
    console.log(
      `  FAIL  ${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`,
    );
  }
}

/** Executa e devolve a mensagem do erro, ou `null` se não levantou. */
async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  }
}

console.log("\nA. Forma literal — identidade nunca vem de parâmetro\n");

const autorizacao = readFileSync(
  new URL("../src/lib/admin-usuarios/autorizacao.ts", import.meta.url),
  "utf8",
);
const admin = readFileSync(
  new URL("../src/integrations/supabase/admin.ts", import.meta.url),
  "utf8",
);
const acoes = readFileSync(
  new URL("../src/app/(painel)/usuarios/_acoes.ts", import.meta.url),
  "utf8",
);
const servicoFonte = readFileSync(
  new URL("../src/lib/admin-usuarios/servico.ts", import.meta.url),
  "utf8",
);

verificar(
  "A1. exigirAdminAal2 não recebe parâmetro nenhum",
  /export async function exigirAdminAal2\(\)/.test(autorizacao),
  true,
);
verificar(
  "A2. exigirAdminAal2 lê o uid da sessão via getUser, não de argumento",
  /supabase\.auth\.getUser\(\)/.test(autorizacao),
  true,
);
verificar('A3. admin.ts nunca declara "use client"', !/["']use client["']/.test(admin), true);
verificar(
  "A4. toda Server Action de _acoes.ts chama exigirAdminAal2 antes de tudo",
  (acoes.match(/exigirAdminAal2\(\)/g) ?? []).length >= 8,
  true,
);
verificar(
  'A5. _acoes.ts declara "use server" logo no topo',
  acoes.trimStart().startsWith('"use server"'),
  true,
);
verificar(
  "A6. servico.ts não importa o cliente admin diretamente (recebe por parâmetro)",
  !/integrations\/supabase\/admin/.test(servicoFonte),
  true,
);
verificar(
  "A7. o último admin é tratado como recusa do banco (42501), não checado em JS antes de tentar",
  /SQLSTATE_RECUSADO = "42501"/.test(servicoFonte),
  true,
);

console.log("\nB. Domínio puro\n");

verificar("B1. sem banned_until não é banido", estaBanido(null), false);
verificar("B2. banned_until no futuro é banido", estaBanido("2999-01-01T00:00:00Z"), true);
verificar("B3. banned_until no passado não é banido", estaBanido("2000-01-01T00:00:00Z"), false);
verificar(
  "B4. data inválida não é banido (fail closed para o lado errado seria pior)",
  estaBanido("lixo"),
  false,
);

const combinados = combinarUsuariosEPapeis(
  [
    {
      id: "u1",
      email: "a@x.com",
      created_at: "2026-01-01",
      last_sign_in_at: null,
      banned_until: null,
    },
    {
      id: "u2",
      email: "b@x.com",
      created_at: "2026-01-02",
      last_sign_in_at: null,
      banned_until: null,
    },
  ],
  [
    { user_id: "u1", role: "admin" },
    { user_id: "u1", role: "operacional" },
  ],
);
verificar("B5. usuário com dois papéis carrega os dois", combinados[0].papeis, [
  "admin",
  "operacional",
]);
verificar(
  "B6. usuário sem nenhuma linha em user_roles aparece com papeis: []",
  combinados[1].papeis,
  [],
);
verificar("B7. nenhum usuário some da lista por falta de papel", combinados.length, 2);

verificar(
  "B8. e-mail válido normaliza para minúsculas",
  exigirEmailValido("Fulano@Exemplo.com"),
  "fulano@exemplo.com",
);
verificar(
  "B9. e-mail sem @ é rejeitado",
  (await erroDe(() => exigirEmailValido("invalido"))) !== null,
  true,
);
verificar(
  "B10. e-mail vazio é rejeitado",
  (await erroDe(() => exigirEmailValido(""))) !== null,
  true,
);
verificar("B11. papel admin é aceito", exigirPapelValido("admin"), "admin");
verificar("B12. papel operacional é aceito", exigirPapelValido("operacional"), "operacional");
verificar(
  "B13. papel inventado é rejeitado",
  (await erroDe(() => exigirPapelValido("root"))) !== null,
  true,
);
verificar(
  "B14. uuid bem formado passa",
  exigirUuid("11111111-1111-4111-8111-111111111111", "x"),
  "11111111-1111-4111-8111-111111111111",
);
verificar(
  "B15. uuid mal formado é rejeitado",
  (await erroDe(() => exigirUuid("123", "x"))) !== null,
  true,
);
verificar(
  "B16. duração de banimento indefinido não é 'none'",
  DURACAO_BANIMENTO_INDEFINIDO !== DURACAO_SEM_BANIMENTO,
  true,
);

// ---------------------------------------------------------------------------
// Cliente administrativo falso — em memória, sem rede.
// ---------------------------------------------------------------------------

/**
 * `falharEm` simula uma etapa específica de um fluxo multi-passo quebrando —
 * não o passo que o trigger recusaria (isso é `ultimoAdminId`), mas um passo
 * POSTERIOR, para provar que `servico.ts` reporta "parcial", nunca "erro",
 * quando algo persistente já mudou antes da falha.
 */
function criarClienteFalso({ ultimoAdminId = null, falharEm = null } = {}) {
  const usuarios = new Map();
  const papeis = []; // { user_id, role }
  const banidos = new Set();
  const auditoria = [];
  let proximoId = 1;

  function recusaSeUltimoAdmin(userId, papel) {
    if (papel !== "admin" || userId !== ultimoAdminId) return;
    const erro = new Error("Não é possível remover ou rebaixar o único administrador restante.");
    throw new ErroAdministrativo({ message: erro.message, code: "42501" }, "revogar papel");
  }

  function falharSeForAVez(etapa) {
    if (falharEm === etapa) {
      throw new Error(`Falha simulada em: ${etapa}`);
    }
  }

  return {
    _estado: { usuarios, papeis, banidos, auditoria },

    async listarUsuarios() {
      return Array.from(usuarios.values());
    },

    async convidarPorEmail(email, nomeCompleto) {
      const id = `10000000-0000-4000-8000-${String(proximoId++).padStart(12, "0")}`;
      usuarios.set(id, {
        id,
        email,
        created_at: new Date().toISOString(),
        last_sign_in_at: null,
        banned_until: null,
      });
      void nomeCompleto;
      return { userId: id };
    },

    async banirUsuario(userId) {
      falharSeForAVez("banir");
      banidos.add(userId);
      const usuario = usuarios.get(userId);
      if (usuario) usuario.banned_until = "2999-01-01T00:00:00Z";
    },

    async desbanirUsuario(userId) {
      falharSeForAVez("desbanir");
      banidos.delete(userId);
      const usuario = usuarios.get(userId);
      if (usuario) usuario.banned_until = null;
    },

    async listarPapeis() {
      return papeis.slice();
    },

    async concederPapel(userId, papel) {
      if (papeis.some((p) => p.user_id === userId && p.role === papel)) return;
      papeis.push({ user_id: userId, role: papel });
    },

    async revogarPapel(userId, papel) {
      recusaSeUltimoAdmin(userId, papel);
      const indice = papeis.findIndex((p) => p.user_id === userId && p.role === papel);
      if (indice !== -1) papeis.splice(indice, 1);
    },

    async revogarTodosOsPapeis(userId) {
      const papeisDoUsuario = papeis.filter((p) => p.user_id === userId);
      for (const p of papeisDoUsuario) recusaSeUltimoAdmin(userId, p.role);
      for (let i = papeis.length - 1; i >= 0; i--) {
        if (papeis[i].user_id === userId) papeis.splice(i, 1);
      }
    },

    async registrarAuditoria(entrada) {
      falharSeForAVez("registrarAuditoria");
      auditoria.push(entrada);
    },
  };
}

function criarClienteDeOperacoesFalso({ falharEmRemoverTodas = false } = {}) {
  const atribuicoes = [];
  return {
    _estado: atribuicoes,
    async listarAtribuidas(userId) {
      return atribuicoes
        .filter((a) => a.userId === userId)
        .map((a) => ({ operationId: a.operationId, criadoEm: a.criadoEm }));
    },
    async atribuir(userId, operationId, criadoPor) {
      if (atribuicoes.some((a) => a.userId === userId && a.operationId === operationId)) return;
      atribuicoes.push({ userId, operationId, criadoPor, criadoEm: new Date().toISOString() });
    },
    async remover(userId, operationId) {
      const indice = atribuicoes.findIndex(
        (a) => a.userId === userId && a.operationId === operationId,
      );
      if (indice !== -1) atribuicoes.splice(indice, 1);
    },
    async removerTodas(userId) {
      if (falharEmRemoverTodas) {
        throw new Error("Falha simulada em: removerTodas");
      }
      let removidas = 0;
      for (let i = atribuicoes.length - 1; i >= 0; i--) {
        if (atribuicoes[i].userId === userId) {
          atribuicoes.splice(i, 1);
          removidas++;
        }
      }
      return removidas;
    },
  };
}

const ATOR = { id: "admin-ator" };

console.log("\nC. listarUsuarios — junta identidade e papel\n");

{
  const cliente = criarClienteFalso();
  const { userId } = await cliente.convidarPorEmail("um@x.com", "Um");
  await cliente.concederPapel(userId, "operacional");
  const lista = await listarUsuarios(cliente);
  verificar("C1. usuário convidado aparece na listagem", lista.length, 1);
  verificar("C2. com o papel concedido", lista[0].papeis, ["operacional"]);
}

console.log("\nD. convidarUsuario\n");

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(
    cliente,
    { email: "novo@x.com", papel: "operacional" },
    ATOR,
  );
  verificar("D1. convite com dados válidos é aceito", resultado.situacao, "convidado");
  verificar("D2. o papel pedido foi concedido", cliente._estado.papeis, [
    { user_id: resultado.userId, role: "operacional" },
  ]);
  verificar(
    "D3. auditoria registrada com a ação certa",
    cliente._estado.auditoria[0]?.action,
    ACAO_AUDITORIA.convite,
  );
  verificar("D4. auditoria carrega o ator", cliente._estado.auditoria[0]?.actorId, ATOR.id);
}

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(
    cliente,
    { email: "invalido", papel: "operacional" },
    ATOR,
  );
  verificar("D5. e-mail inválido não convida ninguém", resultado.situacao, "erro");
  verificar("D6. e nenhum usuário foi criado", cliente._estado.usuarios.size, 0);
}

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(cliente, { email: "x@x.com", papel: "superadmin" }, ATOR);
  verificar("D7. papel inválido não convida ninguém", resultado.situacao, "erro");
}

console.log("\nE. alterarPapel — e a proteção do último admin\n");

const U1 = "11111111-1111-4111-8111-111111111111";

{
  const cliente = criarClienteFalso();
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "operacional", acao: "conceder" },
    ATOR,
  );
  verificar("E1. conceder papel funciona", resultado.situacao, "concedido");
  verificar(
    "E2. auditoria registrada",
    cliente._estado.auditoria[0]?.action,
    ACAO_AUDITORIA.papelConcedido,
  );
}

{
  const cliente = criarClienteFalso();
  await cliente.concederPapel(U1, "admin");
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "admin", acao: "revogar" },
    ATOR,
  );
  verificar(
    "E3. revogar papel funciona quando não é o último admin",
    resultado.situacao,
    "revogado",
  );
}

{
  const cliente = criarClienteFalso({ ultimoAdminId: U1 });
  await cliente.concederPapel(U1, "admin");
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "admin", acao: "revogar" },
    ATOR,
  );
  verificar(
    "E4. revogar o último admin é recusado, não uma exceção crua",
    resultado.situacao,
    "ultimo-admin",
  );
  verificar(
    "E5. e o papel continua lá — a recusa do banco realmente impediu a escrita",
    cliente._estado.papeis,
    [{ user_id: U1, role: "admin" }],
  );
  verificar(
    "E6. nenhuma auditoria é gravada para uma ação recusada",
    cliente._estado.auditoria.length,
    0,
  );
}

{
  const cliente = criarClienteFalso();
  const resultado = await alterarPapel(
    cliente,
    { userId: "não-é-uuid", papel: "admin", acao: "conceder" },
    ATOR,
  );
  verificar("E7. userId inválido é rejeitado antes de tocar o cliente", resultado.situacao, "erro");
}

console.log("\nF. revogarAcesso — papel, TODAS as operações, e ban\n");

const OP1 = "22222222-2222-4222-8222-222222222222";
const OP2 = "33333333-3333-4333-8333-333333333333";
const OP3 = "44444444-4444-4444-8444-444444444444";

{
  const cliente = criarClienteFalso();
  const operacoesCliente = criarClienteDeOperacoesFalso();
  await cliente.concederPapel(U1, "operacional");
  await operacoesCliente.atribuir(U1, OP1, ATOR.id);
  await operacoesCliente.atribuir(U1, OP2, ATOR.id);
  await operacoesCliente.atribuir(U1, OP3, ATOR.id);

  const resultado = await revogarAcesso(cliente, operacoesCliente, { userId: U1 }, ATOR);
  verificar("F1. revogar acesso remove o papel", resultado.situacao, "revogado");
  verificar("F2. e bane a conta", cliente._estado.banidos.has(U1), true);
  verificar("F3. nenhum papel sobra", cliente._estado.papeis.length, 0);
  verificar(
    "F3b. usuário com VÁRIAS operações fica com ZERO após revogação",
    (await listarOperacoesAtribuidas(operacoesCliente, { userId: U1 })).length,
    0,
  );
  verificar(
    "F3c. a auditoria registra quantas operações saíram",
    cliente._estado.auditoria.at(-1)?.details?.operacoesRemovidas,
    3,
  );
}

{
  const cliente = criarClienteFalso({ ultimoAdminId: U1 });
  const operacoesCliente = criarClienteDeOperacoesFalso();
  await cliente.concederPapel(U1, "admin");
  await operacoesCliente.atribuir(U1, OP1, ATOR.id);

  const resultado = await revogarAcesso(cliente, operacoesCliente, { userId: U1 }, ATOR);
  verificar("F4. revogar acesso do último admin é recusado", resultado.situacao, "ultimo-admin");
  verificar(
    "F5. e a conta NÃO fica banida — revogação não é parcial",
    cliente._estado.banidos.has(U1),
    false,
  );
  verificar(
    "F5b. e as operações do último admin recusado NÃO são tocadas",
    (await listarOperacoesAtribuidas(operacoesCliente, { userId: U1 })).length,
    1,
  );
  verificar("F5c. papel do último admin continua intacto", cliente._estado.papeis, [
    { user_id: U1, role: "admin" },
  ]);
}

console.log("\nG-bis. reativarUsuario — papel antes de desbanir, sem restaurar operações\n");

{
  const cliente = criarClienteFalso();
  const operacoesCliente = criarClienteDeOperacoesFalso();
  const { userId } = await cliente.convidarPorEmail("u1@x.com", null);
  await cliente.concederPapel(userId, "operacional");
  await operacoesCliente.atribuir(userId, OP1, ATOR.id);
  await operacoesCliente.atribuir(userId, OP2, ATOR.id);

  await revogarAcesso(cliente, operacoesCliente, { userId }, ATOR);
  const resultado = await reativarUsuario(cliente, { userId, papel: "operacional" }, ATOR);

  verificar("G-bis.1. reativar desbane a conta", resultado.situacao, "reativado");
  verificar(
    "G-bis.2. e a conta não aparece mais banida",
    cliente._estado.banidos.has(userId),
    false,
  );
  verificar("G-bis.3. e recebe o papel informado", cliente._estado.papeis, [
    { user_id: userId, role: "operacional" },
  ]);
  verificar(
    "G-bis.4. NENHUMA operação antiga reaparece — reativação não é 'desfazer'",
    (await listarOperacoesAtribuidas(operacoesCliente, { userId })).length,
    0,
  );
}

console.log("\nG. Atribuição de operações — cliente separado, RLS, não service_role\n");

{
  const operacoesCliente = criarClienteDeOperacoesFalso();
  const registrador = criarClienteFalso();
  const resultado = await atribuirOperacao(
    operacoesCliente,
    registrador,
    {
      userId: "11111111-1111-4111-8111-111111111111",
      operationId: "22222222-2222-4222-8222-222222222222",
    },
    ATOR,
  );
  verificar("G1. atribuir operação funciona", resultado.situacao, "atribuida");
  verificar(
    "G2. e passa a listar",
    (
      await listarOperacoesAtribuidas(operacoesCliente, {
        userId: "11111111-1111-4111-8111-111111111111",
      })
    ).length,
    1,
  );
  verificar(
    "G3. auditoria registrada pelo cliente administrativo, não pelo de operações",
    registrador._estado.auditoria.length,
    1,
  );

  const remocao = await removerOperacao(
    operacoesCliente,
    registrador,
    {
      userId: "11111111-1111-4111-8111-111111111111",
      operationId: "22222222-2222-4222-8222-222222222222",
    },
    ATOR,
  );
  verificar("G4. remover operação funciona", remocao.situacao, "removida");
  verificar(
    "G5. e some da listagem",
    (
      await listarOperacoesAtribuidas(operacoesCliente, {
        userId: "11111111-1111-4111-8111-111111111111",
      })
    ).length,
    0,
  );
}

{
  const operacoesCliente = criarClienteDeOperacoesFalso();
  const registrador = criarClienteFalso();
  const resultado = await atribuirOperacao(
    operacoesCliente,
    registrador,
    { userId: "não-é-uuid", operationId: "também-não" },
    ATOR,
  );
  verificar("G6. uuid inválido não atribui nada", resultado.situacao, "erro");
  verificar("G7. e não grava auditoria", registrador._estado.auditoria.length, 0);
}

console.log('\nH. Validação de "acao" em runtime — não é só o tipo do TypeScript\n');

verificar("H1. exigirAcaoDePapel aceita conceder", exigirAcaoDePapel("conceder"), "conceder");
verificar("H2. exigirAcaoDePapel aceita revogar", exigirAcaoDePapel("revogar"), "revogar");
verificar(
  "H3. qualquer outro valor é rejeitado",
  (await erroDe(() => exigirAcaoDePapel("apagar"))) !== null,
  true,
);
verificar(
  "H4. undefined é rejeitado",
  (await erroDe(() => exigirAcaoDePapel(undefined))) !== null,
  true,
);
verificar("H5. null é rejeitado", (await erroDe(() => exigirAcaoDePapel(null))) !== null, true);
verificar(
  "H6. um objeto (payload malicioso simulando string) é rejeitado",
  (await erroDe(() => exigirAcaoDePapel({ toString: () => "conceder" }))) !== null,
  true,
);

{
  // O caso que motivou a correção: antes de exigirAcaoDePapel, qualquer valor
  // DIFERENTE de "conceder" caía implicitamente no branch de revogação — um
  // payload runtime com acao: "apagar-tudo" revogaria o papel do usuário.
  const cliente = criarClienteFalso();
  await cliente.concederPapel(U1, "admin");
  await cliente.concederPapel(U1, "operacional"); // acumulador, não é o único admin
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "admin", acao: "apagar-tudo" },
    ATOR,
  );
  verificar("H7. acao runtime inválida não concede nem revoga nada", resultado.situacao, "erro");
  verificar(
    "H8. e o papel admin continua exatamente como estava",
    cliente._estado.papeis.some((p) => p.user_id === U1 && p.role === "admin"),
    true,
  );
  verificar("H9. nenhuma auditoria é gravada", cliente._estado.auditoria.length, 0);
}

console.log('\nI. Estados "parcial" — nunca dizer "erro" quando algo já mudou\n');

{
  // revogarTodosOsPapeis funciona, mas o banimento falha depois: o papel já
  // saiu de verdade, e reportar "erro" faria o admin tentar de novo achando
  // que nada aconteceu.
  const cliente = criarClienteFalso({ falharEm: "banir" });
  const operacoesCliente = criarClienteDeOperacoesFalso();
  await cliente.concederPapel(U1, "operacional");
  const resultado = await revogarAcesso(cliente, operacoesCliente, { userId: U1 }, ATOR);
  verificar(
    "I1. falha no banimento após revogar papel volta como 'parcial'",
    resultado.situacao,
    "parcial",
  );
  verificar(
    "I2. e o papel FOI removido de verdade — não é um 'erro' comum",
    cliente._estado.papeis.length,
    0,
  );
}

{
  // O mesmo, mas a falha é ao limpar as operações — papel já saiu.
  const cliente = criarClienteFalso();
  const operacoesCliente = criarClienteDeOperacoesFalso({ falharEmRemoverTodas: true });
  await cliente.concederPapel(U1, "operacional");
  const resultado = await revogarAcesso(cliente, operacoesCliente, { userId: U1 }, ATOR);
  verificar(
    "I3. falha ao limpar operações também volta como 'parcial'",
    resultado.situacao,
    "parcial",
  );
  verificar("I4. o papel continua removido", cliente._estado.papeis.length, 0);
  verificar("I5. e a conta não chegou a ser banida", cliente._estado.banidos.has(U1), false);
}

{
  // reativarUsuario: concede o papel, mas desbanir falha depois.
  const cliente = criarClienteFalso({ falharEm: "desbanir" });
  await cliente.banirUsuario(U1);
  const resultado = await reativarUsuario(cliente, { userId: U1, papel: "operacional" }, ATOR);
  verificar(
    "I6. desbanir falhando após conceder papel volta como 'parcial'",
    resultado.situacao,
    "parcial",
  );
  verificar(
    "I7. o papel FOI concedido de verdade, mesmo com o resultado 'parcial'",
    cliente._estado.papeis,
    [{ user_id: U1, role: "operacional" }],
  );
  verificar(
    "I8. a conta continua banida (estado seguro, não o contrário)",
    cliente._estado.banidos.has(U1),
    true,
  );
}

{
  // Auditoria falhando NUNCA pode transformar sucesso real em "erro".
  const cliente = criarClienteFalso({ falharEm: "registrarAuditoria" });
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "operacional", acao: "conceder" },
    ATOR,
  );
  verificar(
    "I9. auditoria falhando não esconde um sucesso real de alterarPapel",
    resultado.situacao,
    "concedido",
  );
  verificar(
    "I10. e o papel foi mesmo concedido",
    cliente._estado.papeis.some((p) => p.user_id === U1 && p.role === "operacional"),
    true,
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
