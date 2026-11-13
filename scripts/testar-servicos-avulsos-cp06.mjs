/**
 * Regressão dos defeitos do CP-06 (QA-BS-01) — serviços avulsos, contêiner legado e adicionais.
 *
 * COMO RODAR:
 *
 *   npm run test:servicos-avulsos-cp06
 *
 * Mesmo formato das outras suítes: sem framework, Node executando TypeScript direto. O
 * comportamento foi reproduzido no E2E local (e2e/specs/90-servicos-avulsos) antes da correção;
 * aqui ficam a regra pura do aviso de duplicidade e a forma do código.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO,
  adicionaisDeContainerEmDuplicidade,
  cadastroDeContainerEncerrado,
} from "../src/lib/container-servico-ui.ts";

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

// ---------------------------------------------------------------------------------------------
// A. Aviso de duplicidade: registro antigo de contêiner + apontamentos da mesma operação
// ---------------------------------------------------------------------------------------------

const servicos = [
  { id: "s1", billing_additional_id: "a1", situacao: "disponivel" },
  { id: "s2", billing_additional_id: "a2", situacao: "cancelado" },
  { id: "s3", billing_additional_id: "a3", situacao: "disponivel" },
];
const adicionais = [
  { id: "a1", operation_id: "op-conteiner" }, // registro antigo ligado à operação com apontamento
  { id: "a2", operation_id: "op-conteiner" }, // cancelado: já não cobra
  { id: "a3", operation_id: null }, // sem operação: nada a comparar
  { id: "a9", operation_id: "op-conteiner" }, // adicional comum (não é de contêiner)
];
verificar(
  "A1. só o registro antigo disponível ligado a operação com apontamento é sinalizado",
  adicionaisDeContainerEmDuplicidade(adicionais, servicos, new Set(["op-conteiner"])),
  [{ adicionalId: "a1", servicoId: "s1", operacaoId: "op-conteiner" }],
);
verificar(
  "A2. sem apontamento da operação no período, nada é sinalizado",
  adicionaisDeContainerEmDuplicidade(adicionais, servicos, new Set(["outra"])),
  [],
);

// ---------------------------------------------------------------------------------------------
// B. D7: o cadastro NOVO pelo caminho legado está encerrado (tela e servidor)
// ---------------------------------------------------------------------------------------------

verificar(
  "B1. a recusa do servidor manda para a operação avulsa e preserva os registros antigos",
  [
    cadastroDeContainerEncerrado().ok,
    cadastroDeContainerEncerrado().codigo,
    /Operações → Nova operação → tipo Avulsa/.test(MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO),
    /registros antigos continuam/.test(MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO),
  ],
  [false, "encerrado", true, true],
);
const acoes = semComentarios(ler("src/app/(painel)/containers/_acoes.ts"));
verificar(
  "B2. registrarContainerAction confere o admin e recusa sem chamar a RPC",
  /export async function registrarContainerAction\([\s\S]*?\{[\s\S]*?await exigirAdminAtor\(\);[\s\S]*?return cadastroDeContainerEncerrado\(\);\s*\}/.test(
    acoes,
  ) && !/acoes\(\)\.registrar\(/.test(acoes),
  true,
);
verificar(
  "B3. correção e cancelamento dos registros antigos continuam disponíveis",
  /acoes\(\)\.corrigir\(entrada\)/.test(acoes) && /acoes\(\)\.cancelar\(entrada\)/.test(acoes),
  true,
);
const novo =
  semComentarios(ler("src/app/(painel)/containers/novo/page.tsx")) +
  semComentarios(ler("src/app/(painel)/containers/cadastro-encerrado.tsx"));
verificar(
  "B4. /containers/novo não oferece mais o formulário; leva às Operações",
  [/FormularioContainer/.test(novo), /href="\/operacoes"/.test(novo), /exigirAdmin\(\)/.test(novo)],
  [false, true, true],
);
function arquivos(dir) {
  return readdirSync(join(raiz, dir)).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(join(raiz, caminho)).isDirectory()
      ? arquivos(caminho)
      : /\.(tsx?|mjs)$/.test(nome)
        ? [caminho]
        : [];
  });
}
verificar(
  "B5. nenhum link interno abre o cadastro antigo (/containers/novo)",
  arquivos("src")
    .filter((f) => /["'`]\/containers\/novo/.test(semComentarios(ler(f))))
    .join(","),
  "",
);
const lista = semComentarios(ler("src/app/(painel)/containers/lista-containers.tsx"));
verificar(
  "B6. a lista se apresenta como registros antigos, sem botão de cadastro",
  /Estes são registros antigos\./.test(lista) && !/Novo serviço/.test(lista),
  true,
);

// ---------------------------------------------------------------------------------------------
// C. Faturamento: aviso de duplicidade, rótulos e envio único do adicional
// ---------------------------------------------------------------------------------------------

const adicionaisTela = semComentarios(ler("src/app/(painel)/faturamento/adicionais.tsx"));
const faturamento = semComentarios(ler("src/app/(painel)/faturamento/painel-faturamento.tsx"));
verificar(
  "C1. a tela calcula a duplicidade com os apontamentos do período e avisa",
  [
    /operacoesComApontamento=\{operacoesComApontamento\}/.test(faturamento),
    /new Set\(period\.map\(\(row\) => row\.operationId\)\)/.test(faturamento),
    /adicionaisDeContainerEmDuplicidade\(/.test(adicionaisTela),
    /Possível cobrança em duplicidade/.test(adicionaisTela),
  ],
  [true, true, true, true],
);
verificar(
  "C2. o link do adicional de contêiner diz que é registro antigo",
  /Ver registro antigo de contêiner/.test(adicionaisTela) &&
    !/>\s*Ver container\s*</.test(adicionaisTela),
  true,
);
verificar(
  "C3. adicional não é apresentado como lugar de serviço avulso",
  /Serviço avulso[\s\S]{0,40}\(contêiner, etiquetagem, limpeza…\) não é adicional/.test(
    adicionaisTela,
  ) && !/Valores extras do período \(etiquetagem, separação, contêiner…\)/.test(adicionaisTela),
  true,
);
verificar(
  "C4. D-CP06-02: “Registrar adicional” com trava de diálogo (só o erro e a reabertura soltam)",
  [
    /const travaNovo = useTravaDoDialogo\(novoOpen\);/.test(adicionaisTela),
    /if \(!travaNovo\.tentar\(\)\) return;\s*registrar\.mutate\(formulario, \{\s*onError: travaNovo\.liberar,\s*onSuccess: \(\) => setNovoOpen\(false\),/.test(
      adicionaisTela,
    ),
  ],
  [true, true],
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
