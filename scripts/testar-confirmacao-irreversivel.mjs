/**
 * Regressão S19D-DEF-001: emitir fatura e excluir cliente/contrato disparavam em um clique, sem
 * confirmação. A emissão vincula o lastro de forma irreversível; a exclusão apaga o cadastro quando
 * o banco não a recusa. Agora cada ação passa por uma confirmação explícita, com Cancelar e
 * Confirmar, e só a confirmação dispara a mutação. As validações de negócio existentes continuam
 * (o botão de fatura segue desabilitado fora de 'pronto'; o banco continua recusando exclusões com
 * histórico). Não há regra comercial nova. Não acessa banco, rede, sessão ou credenciais.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const ler = (arquivo) => readFileSync(path.join(root, arquivo), "utf8");
const COMPONENTE = "src/app/(painel)/_components/confirmar-acao-irreversivel.tsx";
const semEspacos = (texto) => texto.replace(/\s+/g, " ");

test("componente único de confirmação: título, descrição, Cancelar e Confirmar", () => {
  assert.ok(existsSync(path.join(root, COMPONENTE)), "componente de confirmação ausente");
  const c = semEspacos(ler(COMPONENTE));
  assert.match(c, /export function ConfirmarAcaoIrreversivel/);
  assert.match(c, /<AlertDialogTitle>\{titulo\}<\/AlertDialogTitle>/);
  assert.match(c, /<AlertDialogDescription/);
  assert.match(c, /<AlertDialogCancel[^>]*>Cancelar<\/AlertDialogCancel>/);
  assert.match(c, /<AlertDialogAction[^>]*onClick=\{onConfirmar\}[^>]*>\s*\{rotuloConfirmar\}/);
});

test("Gerar fatura abre a confirmação; só a confirmação emite", () => {
  const f = semEspacos(ler("src/app/(painel)/faturamento/painel-faturamento.tsx"));
  assert.doesNotMatch(f, /onClick=\{\(\) => generate\.mutate\(\)\}/, "emissão direta no botão");
  assert.match(f, /onClick=\{\(\) => setConfirmarFatura\(true\)\}/);
  // A trava existente do botão continua (ledger pronto, nada a gerar, emissão em curso).
  assert.match(
    f,
    /disabled=\{semNadaParaGerar \|\| !exibicao\.podeAgir \|\| generate\.isPending\}/,
  );
  assert.match(f, /<ConfirmarAcaoIrreversivel[^>]*open=\{confirmarFatura\}/);
  assert.match(f, /rotuloConfirmar="Emitir fatura"/);
  assert.match(
    f,
    /onConfirmar=\{\(\) => \{ setConfirmarFatura\(false\); generate\.mutate\(\); \}\}/,
  );
  assert.match(f, /não pode ser desfeita/);
});

test("Excluir cliente abre a confirmação; só a confirmação exclui", () => {
  const f = semEspacos(ler("src/app/(painel)/clientes/painel-clientes.tsx"));
  assert.doesNotMatch(f, /onClick=\{\(\) => removeClient\.mutate\(client\.id\)\}/);
  assert.match(f, /onClick=\{\(\) => setClienteParaExcluir\(client\)\}/);
  assert.match(f, /open=\{clienteParaExcluir !== null\}/);
  assert.match(f, /removeClient\.mutate\(alvo\.id\)/);
  assert.match(f, /rotuloConfirmar="Excluir cliente"/);
});

test("Excluir contrato abre a confirmação; só a confirmação exclui", () => {
  const f = semEspacos(ler("src/app/(painel)/clientes/painel-clientes.tsx"));
  assert.doesNotMatch(f, /onClick=\{\(\) => removeContract\.mutate\(contract\.id\)\}/);
  assert.match(f, /onClick=\{\(\) => setContratoParaExcluir\(contract\)\}/);
  assert.match(f, /open=\{contratoParaExcluir !== null\}/);
  assert.match(f, /removeContract\.mutate\(alvo\.id\)/);
  assert.match(f, /rotuloConfirmar="Excluir contrato"/);
});

// S19E: a mesma classe de risco nas exclusões de colaborador, operação e turno.
for (const [tela, botao, estado, mutacao, rotulo] of [
  [
    "src/app/(painel)/colaboradores/painel-colaboradores.tsx",
    /onClick=\{\(\) => remove\.mutate\(employee\.id\)\}/,
    /onClick=\{\(\) => setColaboradorParaExcluir\(employee\)\}/,
    /remove\.mutate\(alvo\.id\)/,
    'rotuloConfirmar="Excluir colaborador"',
  ],
  [
    "src/app/(painel)/operacoes/painel-operacoes.tsx",
    /onClick=\{\(\) => removeOperation\.mutate\(operation\.id\)\}/,
    /onClick=\{\(\) => setOperacaoParaExcluir\(operation\)\}/,
    /removeOperation\.mutate\(alvo\.id\)/,
    'rotuloConfirmar="Excluir operação"',
  ],
  [
    "src/app/(painel)/operacoes/painel-operacoes.tsx",
    /onClick=\{\(\) => removeShift\.mutate\(shift\.id\)\}/,
    /onClick=\{\(\) => setTurnoParaExcluir\(shift\)\}/,
    /removeShift\.mutate\(alvo\.id\)/,
    'rotuloConfirmar="Excluir turno"',
  ],
]) {
  test(`${rotulo}: só a confirmação exclui`, () => {
    const f = semEspacos(ler(tela));
    assert.doesNotMatch(f, botao);
    assert.match(f, estado);
    assert.match(f, mutacao);
    assert.ok(f.includes(rotulo));
  });
}
