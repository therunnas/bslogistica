/**
 * Resumo do E2E a partir de e2e-results/resultado.json (reporter JSON do Playwright).
 * Escreve e2e-results/resumo.md e, na CI, o resumo do job ($GITHUB_STEP_SUMMARY).
 * Status: PASS, FAIL, FALHA CONHECIDA (defeito conhecido reproduzido, etiqueta @falha-conhecida,
 * ou test.fail esperado), PULADO.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const ARQUIVO = "e2e-results/resultado.json";
if (!existsSync(ARQUIVO)) {
  console.error("Sem resultado do Playwright para resumir.");
  process.exit(0);
}
const dados = JSON.parse(readFileSync(ARQUIVO, "utf8"));
const sha = process.env.E2E_SHA ?? "local";

const linhas = [];
/** Contexto (árvore da página) só das falhas inesperadas, para o log da CI. */
const contextos = [];
function percorrer(suite, caminho) {
  const nome = [...caminho, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const teste of spec.tests ?? []) {
      const r = teste.results?.[teste.results.length - 1];
      let status;
      if (teste.status === "skipped") status = "PULADO";
      else if (teste.expectedStatus === "failed" && teste.status === "expected")
        status = "FALHA CONHECIDA";
      // Teste que REPRODUZ um defeito conhecido e confere que ele continua lá (e2e/specs/30-…).
      else if (
        (spec.tags ?? []).some((tag) => tag.replace(/^@/, "") === "falha-conhecida") &&
        teste.status === "expected"
      )
        status = "FALHA CONHECIDA";
      else if (teste.status === "expected") status = "PASS";
      else status = "FAIL";
      if (status === "FAIL")
        for (const anexo of r?.attachments ?? [])
          if (anexo.name === "error-context" && anexo.path) contextos.push(anexo.path);
      linhas.push({
        arquivo: spec.file,
        titulo: [...nome.slice(1), spec.title].join(" › "),
        status,
        ms: r?.duration ?? 0,
        erro:
          status === "FAIL"
            ? String(r?.error?.message ?? "")
                .split("\n")[0]
                .slice(0, 200)
            : "",
      });
    }
  }
  for (const filha of suite.suites ?? []) percorrer(filha, nome);
}
for (const suite of dados.suites ?? []) percorrer(suite, []);

const contar = (s) => linhas.filter((l) => l.status === s).length;
const total = linhas.length;
const duracao = Math.round((dados.stats?.duration ?? 0) / 1000);
const md = [
  `## E2E local — ${sha}`,
  "",
  `Total ${total} · PASS ${contar("PASS")} · FAIL ${contar("FAIL")} · FALHA CONHECIDA ${contar("FALHA CONHECIDA")} · PULADO ${contar("PULADO")} · ${duracao} s`,
  "",
  "| Status | Cenário | Arquivo | ms | Erro |",
  "| --- | --- | --- | ---: | --- |",
  ...linhas.map(
    (l) =>
      `| ${l.status} | ${l.titulo.replace(/\|/g, "/")} | ${l.arquivo} | ${l.ms} | ${l.erro.replace(/\|/g, "/")} |`,
  ),
  "",
].join("\n");

writeFileSync("e2e-results/resumo.md", md);
writeFileSync("e2e-results/contextos-das-falhas.txt", contextos.map((c) => `${c}\n`).join(""));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md.split("\n").slice(0, 3).join("\n"));
