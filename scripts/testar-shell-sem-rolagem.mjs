/**
 * Regressão S19C-DEF-002: o brilho decorativo do shell fica 14rem para fora da
 * área de conteúdo. Com `overflow-hidden` o invólucro continua sendo um
 * contêiner rolável: ao abrir um diálogo pelo cabeçalho da página o conteúdo
 * desliza 224 px para a esquerda e não volta. `overflow-clip` recorta sem
 * permitir rolagem programática. Não há layout de navegador em Node, então a
 * suíte confere a forma do invólucro. Não acessa banco, rede ou sessão.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const shell = readFileSync(path.join(root, "src/app/(painel)/_components/app-shell.tsx"), "utf8");

function invólucroDoBrilho() {
  const brilho = shell.indexOf("right-[-14rem]");
  assert.ok(brilho > 0, "brilho decorativo não encontrado");
  const abertura = shell.lastIndexOf("<div", shell.lastIndexOf("<div", brilho) - 1);
  return shell.slice(abertura, shell.indexOf(">", abertura) + 1);
}

test("invólucro do brilho recorta sem ser rolável", () => {
  const invólucro = invólucroDoBrilho();
  assert.match(invólucro, /\boverflow-clip\b/);
  assert.doesNotMatch(invólucro, /\boverflow-(hidden|auto|scroll)\b/);
});

test("brilho continua decorativo e fora da interação", () => {
  assert.match(
    shell,
    /aria-hidden="true"\s+className="pointer-events-none absolute[^"]*right-\[-14rem\]/,
  );
});
