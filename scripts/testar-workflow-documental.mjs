import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  validarHandoff,
  validarCheckpointAlterado,
  validarReferenciasLocais,
  validarRepositorio,
} from "./validar-workflow-documental.mjs";

const root = resolve(import.meta.dirname, "..");

const handoffValido = `# Handoff ativo

<!-- workflow-handoff:v1 -->

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | WORKFLOW-01 |
| Gate atual | Entrega em PR Draft |
| Último gate concluído | Gate 1 — desenvolvimento |
| Worktree | /tmp/bs-workflow-01 |
| Branch | docs/workflow-01 |
| Base | abc123 |
| HEAD validado | 0e1848ae9cbdcf34a33497a20ef9fc66119b63ee; local = remoto |
| Alterações não commitadas | Nenhuma |
| PR | Pendente de abertura |
| Ambiente-alvo | Nenhum ambiente remoto |
| Última ação comprovada | Validação local concluída |
| Próxima ação exata | Abrir PR Draft |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | WORKFLOW-01 |
| Resultados e testes comprovados | Teste documental local aprovado |
| Código e PR afetados | Documentação; PR ainda não aberto |
| Ambientes envolvidos | Local |
| Pendências e decisões | Publicação pendente |
| Próxima ação exata | Aguardar autorização |
| Autorizações e proibições | Só local; sem publicação |

## Evidências

- Teste documental aprovado.

## Migrations por ambiente

- Local: nenhuma migration executada.

## Autorizações

- Documentação e CI local.

## Proibições

- Sem deploy.

## Bloqueios e riscos

- Publicação automática de main.

## Retomada

1. Confirmar o HEAD.
`;

test("handoff válido expõe checkpoint, autorização e próxima ação", () => {
  assert.deepEqual(validarHandoff(handoffValido), []);
});

test("handoff incompleto recusa campo vazio e seção operacional ausente", () => {
  const invalido = handoffValido
    .replace("| Próxima ação exata | Abrir PR Draft |", "| Próxima ação exata |  |")
    .replace("## Proibições", "## Limites");
  const erros = validarHandoff(invalido);
  assert.ok(erros.some((erro) => erro.includes("Próxima ação exata")));
  assert.ok(erros.some((erro) => erro.includes("Proibições")));
});

test("handoff exige worktree, estado não commitado, último gate e SHA completo", () => {
  const semContinuidade = handoffValido
    .replace(/^\| Worktree \|.*\n/m, "")
    .replace(/^\| Alterações não commitadas \|.*\n/m, "")
    .replace(/^\| Último gate concluído \|.*\n/m, "")
    .replace("0e1848ae9cbdcf34a33497a20ef9fc66119b63ee", "0e1848a");
  const erros = validarHandoff(semContinuidade);
  for (const campo of ["Worktree", "Alterações não commitadas", "Último gate concluído"]) {
    assert.ok(
      erros.some((erro) => erro.includes(campo)),
      campo,
    );
  }
  assert.ok(erros.some((erro) => erro.includes("HEAD validado") && erro.includes("SHA")));
});

test("cada tarefa exige resultado, código/PR, ambiente, decisões e limites próprios", () => {
  const invalido = handoffValido
    .replace("| Resultados e testes comprovados | Teste documental local aprovado |", "")
    .replace("| Autorizações e proibições | Só local; sem publicação |", "");
  const erros = validarHandoff(invalido);
  assert.ok(erros.some((erro) => erro.includes("Resultados e testes comprovados")));
  assert.ok(erros.some((erro) => erro.includes("Autorizações e proibições")));
});

test("publicação de tarefa exige HANDOFF no mesmo conjunto de alterações", () => {
  assert.deepEqual(validarCheckpointAlterado([]), []);
  assert.deepEqual(validarCheckpointAlterado(["docs/HANDOFF.md", "src/example.ts"]), []);
  assert.ok(validarCheckpointAlterado(["src/example.ts"]).length > 0);
  assert.ok(validarCheckpointAlterado(["docs/WORKFLOW.md"]).length > 0);
});

test("Claude e Codex recebem o mesmo contrato versionado por tarefa", () => {
  const contracts = ["AGENTS.md", "CLAUDE.md"].map((file) => {
    const text = readFileSync(join(root, file), "utf8");
    const section = text.split("## Continuidade entre agentes\n")[1];
    assert.ok(section?.includes("Ao concluir ou interromper **cada tarefa**"));
    assert.ok(section.includes("sete campos"));
    assert.ok(section.includes("Sem autorização"));
    return section.split("Retome por")[0].trim();
  });
  assert.equal(contracts[0], contracts[1]);
});

test("referências locais quebradas falham sem tratar URL externa ou âncora como arquivo", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-links-"));
  try {
    mkdirSync(join(dir, "docs"));
    writeFileSync(
      join(dir, "docs", "origem.md"),
      "[Existe](destino.md) [Ausente](faltante.md) [Âncora](#secao) [Web](https://example.com)",
    );
    writeFileSync(join(dir, "docs", "destino.md"), "# Destino\n");
    assert.deepEqual(validarReferenciasLocais(dir, ["docs/origem.md"]), [
      "docs/origem.md: referência local inexistente: docs/faltante.md",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repositório mantém documentos canônicos, handoff válido e referências locais íntegras", () => {
  assert.deepEqual(validarRepositorio(root), []);
});
