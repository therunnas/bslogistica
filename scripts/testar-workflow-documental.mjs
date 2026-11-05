import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  validarHandoff,
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
