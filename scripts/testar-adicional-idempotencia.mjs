/**
 * FIN-20D — idempotência do registro de adicionais no frontend.
 *
 * COMO RODAR:  npm run test:adicional-idempotencia
 *
 * Sem rede e sem banco. O banco é a barreira (migration 047, suíte SQL 047); aqui se prova que o
 * frontend usa essa barreira do jeito certo:
 *   A  a CHAVE acompanha a intenção: duplo clique e retry com os mesmos dados reutilizam a chave;
 *      dados diferentes, nova abertura do formulário ou sucesso geram outra;
 *   B  o TRANSPORTE chama a RPC idempotente; só cai na antiga quando a nova NÃO EXISTE (banco
 *      anterior à 047, PGRST202); nenhum outro erro contorna a proteção;
 *   C  módulos puros não acessam storage global; recuperação persiste somente marcador opaco;
 *   D  a integração: hook, formulário, constantes e tipos.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";

let falhas = 0;
let total = 0;
function verificar(descricao, obtido, esperado) {
  total += 1;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (ok) console.log(`  PASS  ${descricao}`);
  else {
    falhas += 1;
    console.log(
      `  FAIL  ${descricao}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`,
    );
  }
}
const ler = (p) => readFileSync(p, "utf8");
async function carregar(caminho) {
  try {
    return await import(caminho);
  } catch (erro) {
    return { erroDeImport: String(erro?.message ?? erro).slice(0, 90) };
  }
}

const PARAMS = {
  p_client_id: "5c47c000-0000-4000-8000-000000000001",
  p_period_start: "2026-02-01",
  p_period_end: "2026-02-15",
  p_description: "Etiquetagem",
  p_amount: 100,
  p_reference: null,
  p_operation_id: null,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

console.log("A. A chave acompanha a intenção");
const intencao = await carregar("../src/lib/adicional-intencao.ts");
if (intencao.erroDeImport) {
  verificar("módulo adicional-intencao existe", intencao.erroDeImport, "importável");
} else {
  const { intencaoParaTentativa } = intencao;
  let n = 0;
  const gerar = () => `chave-${++n}`;
  const primeira = intencaoParaTentativa(null, PARAMS, gerar);
  verificar("1ª tentativa gera uma chave", primeira.chave, "chave-1");
  const duploClique = intencaoParaTentativa(primeira, { ...PARAMS }, gerar);
  verificar("duplo clique (mesmos dados) reutiliza a MESMA chave", duploClique.chave, "chave-1");
  const outraOrdem = intencaoParaTentativa(
    primeira,
    Object.fromEntries(Object.entries(PARAMS).reverse()),
    gerar,
  );
  verificar(
    "retry com as mesmas chaves em outra ordem reutiliza a chave",
    outraOrdem.chave,
    "chave-1",
  );
  const alterado = intencaoParaTentativa(primeira, { ...PARAMS, p_amount: 101 }, gerar);
  verificar("dado alterado (valor) é OUTRA intenção: chave nova", alterado.chave, "chave-2");
  const descricaoAlterada = intencaoParaTentativa(
    primeira,
    { ...PARAMS, p_description: "Outra" },
    gerar,
  );
  verificar(
    "dado alterado (descrição) é outra intenção",
    descricaoAlterada.chave === "chave-1",
    false,
  );
  const aposReinicio = intencaoParaTentativa(null, PARAMS, gerar);
  verificar(
    "depois de reiniciar (null), os MESMOS dados geram chave nova",
    aposReinicio.chave.startsWith("chave-"),
    true,
  );
  verificar(
    "a chave gerada por padrão é um UUID v4",
    UUID.test(intencaoParaTentativa(null, PARAMS).chave),
    true,
  );
  verificar(
    "duas intenções independentes com os mesmos dados têm chaves diferentes",
    intencaoParaTentativa(null, PARAMS).chave !== intencaoParaTentativa(null, PARAMS).chave,
    true,
  );
}

console.log("B. Transporte: a RPC idempotente; a antiga só quando a nova NÃO existe");
const registro = await carregar("../src/lib/adicionais-registro.ts");
if (registro.erroDeImport) {
  verificar("módulo adicionais-registro existe", registro.erroDeImport, "importável");
} else {
  const { registrarAdicional } = registro;
  const ID = "5c47aaaa-0000-4000-8000-000000000001";
  function cliente(respostas) {
    const chamadas = [];
    return {
      chamadas,
      chamar: async (nome, args) => {
        chamadas.push({ nome, args });
        return respostas[nome] ?? { data: null, error: { message: "sem resposta" } };
      },
    };
  }
  const CHAVE = "5c47d000-0000-4000-8000-000000000001";

  let c = cliente({ registrar_adicional_idempotente: { data: ID, error: null } });
  verificar("sucesso devolve o id", await registrarAdicional(c.chamar, PARAMS, CHAVE), ID);
  verificar(
    "chama SÓ a RPC idempotente",
    c.chamadas.map((x) => x.nome),
    ["registrar_adicional_idempotente"],
  );
  verificar(
    "envia a chave e os parâmetros nomeados (referência e operação nulas omitidas)",
    c.chamadas[0].args,
    {
      p_idempotency_key: CHAVE,
      p_client_id: PARAMS.p_client_id,
      p_period_start: "2026-02-01",
      p_period_end: "2026-02-15",
      p_description: "Etiquetagem",
      p_amount: 100,
    },
  );

  c = cliente({ registrar_adicional_idempotente: { data: ID, error: null } });
  await registrarAdicional(
    c.chamar,
    {
      ...PARAMS,
      p_reference: "REF",
      p_operation_id: "5c47e000-0000-4000-8000-000000000001",
      p_billing_period_start: "2026-02-01",
      p_billing_period_end: "2026-02-15",
    },
    CHAVE,
  );
  verificar(
    "referência, operação e competência presentes são enviadas",
    Object.keys(c.chamadas[0].args).sort(),
    [
      "p_amount",
      "p_billing_period_end",
      "p_billing_period_start",
      "p_client_id",
      "p_description",
      "p_idempotency_key",
      "p_operation_id",
      "p_period_end",
      "p_period_start",
      "p_reference",
    ],
  );

  c = cliente({
    registrar_adicional_idempotente: {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    },
    registrar_adicional: { data: ID, error: null },
  });
  verificar(
    "banco anterior à 047 (PGRST202): usa a RPC antiga e devolve o id",
    await registrarAdicional(c.chamar, PARAMS, CHAVE),
    ID,
  );
  verificar(
    "…tentou a nova primeiro e depois a antiga",
    c.chamadas.map((x) => x.nome),
    ["registrar_adicional_idempotente", "registrar_adicional"],
  );
  verificar(
    "…a antiga NÃO recebe chave (o parâmetro não existe nela)",
    "p_idempotency_key" in c.chamadas[1].args,
    false,
  );

  for (const [rotulo, erro] of [
    [
      "chave já usada com outro payload (23505)",
      { code: "23505", message: "Chave de idempotência já usada com outro payload." },
    ],
    ["sem permissão (42501)", { code: "42501", message: "permission denied" }],
    ["validação (22023)", { code: "22023", message: "valor" }],
    ["falha de rede", { message: "Failed to fetch" }],
  ]) {
    c = cliente({
      registrar_adicional_idempotente: { data: null, error: erro },
      registrar_adicional: { data: ID, error: null },
    });
    let lancou = null;
    try {
      await registrarAdicional(c.chamar, PARAMS, CHAVE);
    } catch (e) {
      lancou = e?.code ?? e?.message ?? String(e);
    }
    verificar(`${rotulo}: propaga o erro`, lancou, erro.code ?? erro.message);
    verificar(
      `${rotulo}: NÃO cai na RPC antiga (nada contorna a proteção)`,
      c.chamadas.map((x) => x.nome),
      ["registrar_adicional_idempotente"],
    );
  }

  c = cliente({
    registrar_adicional_idempotente: { data: null, error: { code: "PGRST202", message: "x" } },
    registrar_adicional: { data: null, error: { code: "42501", message: "permission denied" } },
  });
  let erroDaAntiga = null;
  try {
    await registrarAdicional(c.chamar, PARAMS, CHAVE);
  } catch (e) {
    erroDaAntiga = e?.code;
  }
  verificar("o erro da RPC antiga (fallback) também é propagado", erroDaAntiga, "42501");
}

console.log("C. Módulos puros não acessam armazenamento global");
for (const arquivo of ["src/lib/adicional-intencao.ts", "src/lib/adicionais-registro.ts"]) {
  let fonte = "";
  try {
    fonte = ler(arquivo);
  } catch {
    fonte = "<ausente>";
  }
  verificar(
    `${arquivo}: sem localStorage, sessionStorage, cookie, IndexedDB nem URL`,
    fonte !== "<ausente>" &&
      !/localStorage|sessionStorage|document\.cookie|indexedDB|location\.|history\./i.test(fonte),
    true,
  );
}

console.log("D. Integração");
const adicionais = ler("src/lib/adicionais.ts");
verificar(
  "RPC_ADICIONAIS: nova idempotente e antiga separadas",
  [
    /registrar:\s*"registrar_adicional_idempotente"/.test(adicionais),
    /registrarAntiga:\s*"registrar_adicional"/.test(adicionais),
  ],
  [true, true],
);
const dados = ler("src/lib/adicionais-dados.ts");
verificar(
  "o hook usa o transporte e a intenção",
  [/registrarAdicional\(/.test(dados), /executarIntencaoDeAdicional\(/.test(dados)],
  [true, true],
);
verificar(
  "o hook NÃO chama mais a RPC direto",
  /\.rpc\(\s*RPC_ADICIONAIS\.registrar\b/.test(dados),
  false,
);
verificar(
  "o hook preserva marcador no fechamento e usa recuperação persistente",
  [!/reiniciarIntencao/.test(dados), /storage: sessionStorage/.test(dados)],
  [true, true],
);
verificar(
  "chave recusada (23505) preserva a intenção para reconciliação",
  [registro.CODIGO_DE_CHAVE_REUTILIZADA, !/intencao\.current\s*=\s*null/.test(dados)],
  ["23505", true],
);
const tela = ler("src/app/(painel)/faturamento/adicionais.tsx");
verificar(
  "o formulário não descarta a intenção ao abrir e ao fechar",
  [
    !/function abrirNovo\(\)[\s\S]{0,400}registrar\.reiniciarIntencao\(\)/.test(tela),
    !/onOpenChange=\{[^}]*reiniciarIntencao/.test(tela),
  ],
  [true, true],
);
const emSrc = (() => {
  const achados = [];
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = `${dir}/${nome}`;
      if (statSync(p).isDirectory()) varrer(p);
      else if (/\.(ts|tsx)$/.test(nome) && /"registrar_adicional"/.test(ler(p))) achados.push(p);
    }
  };
  varrer("src");
  return achados;
})();
verificar(
  "a string da RPC antiga só aparece na constante de adicionais.ts (nenhuma chamada direta no app)",
  emSrc.sort(),
  ["src/lib/adicionais.ts"],
);
const tipos = ler("src/integrations/supabase/types.ts");
verificar(
  "tipos conhecem a RPC nova e as colunas novas",
  [/registrar_adicional_idempotente/.test(tipos), /idempotency_key/.test(tipos)],
  [true, true],
);

console.log(`\n${total - falhas} de ${total} asserções passaram.`);
process.exit(falhas === 0 ? 0 : 1);
