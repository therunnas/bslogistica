import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CAMPOS_HANDOFF = [
  "Etapa",
  "Gate atual",
  "Último gate concluído",
  "Worktree",
  "Branch",
  "Base",
  "HEAD validado",
  "Alterações não commitadas",
  "PR",
  "Ambiente-alvo",
  "Última ação comprovada",
  "Próxima ação exata",
];

const SECOES_HANDOFF = [
  "Identificação",
  "Evidências",
  "Migrations por ambiente",
  "Autorizações",
  "Proibições",
  "Bloqueios e riscos",
  "Retomada",
];

const ARQUIVOS_CANONICOS = [
  "AGENTS.md",
  "CLAUDE.md",
  "PROGRESS.md",
  "docs/ESTADO_DO_PROJETO.md",
  "docs/ARQUITETURA.md",
  "docs/SEGURANCA.md",
  "docs/WORKFLOW.md",
  "docs/AMBIENTES.md",
  "docs/HANDOFF.md",
  "docs/PADRAO_DE_PROMPTS.md",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
];

const ARQUIVOS_COM_REFERENCIAS = [
  "AGENTS.md",
  "CLAUDE.md",
  "PROGRESS.md",
  "docs/ESTADO_DO_PROJETO.md",
  "docs/ARQUITETURA.md",
  "docs/SEGURANCA.md",
  "docs/WORKFLOW.md",
  "docs/AMBIENTES.md",
  "docs/HANDOFF.md",
  "docs/PADRAO_DE_PROMPTS.md",
  ".github/pull_request_template.md",
];

function camposDaTabela(markdown) {
  const campos = new Map();
  for (const linha of markdown.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)) {
    const campo = linha[1].trim();
    const valor = linha[2].trim();
    if (campo !== "Campo" && !/^-+$/.test(campo)) campos.set(campo, valor);
  }
  return campos;
}

export function validarHandoff(markdown) {
  const erros = [];
  if (!markdown.includes("<!-- workflow-handoff:v1 -->")) {
    erros.push("docs/HANDOFF.md: marcador workflow-handoff:v1 ausente");
  }

  for (const secao of SECOES_HANDOFF) {
    if (!new RegExp(`^## ${secao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(markdown)) {
      erros.push(`docs/HANDOFF.md: seção obrigatória ausente: ${secao}`);
    }
  }

  const campos = camposDaTabela(markdown);
  for (const campo of CAMPOS_HANDOFF) {
    const valor = campos.get(campo) ?? "";
    if (valor === "" || /^(?:-|tbd|a definir|indefinido|\?+)$/i.test(valor)) {
      erros.push(`docs/HANDOFF.md: campo obrigatório sem valor: ${campo}`);
    }
  }

  const headValidado = campos.get("HEAD validado") ?? "";
  if (headValidado !== "" && !/\b[0-9a-f]{40}\b/.test(headValidado)) {
    erros.push("docs/HANDOFF.md: HEAD validado precisa do SHA completo de 40 caracteres");
  }
  return erros;
}

function alvoLocal(link) {
  const limpo = link.replace(/^<|>$/g, "").split("#", 1)[0].split("?", 1)[0];
  if (limpo === "" || limpo.startsWith("/") || /^(?:https?:|mailto:|tel:|data:)/i.test(limpo)) {
    return null;
  }
  try {
    return decodeURIComponent(limpo);
  } catch {
    return limpo;
  }
}

export function validarReferenciasLocais(root, arquivos) {
  const erros = [];
  const raiz = resolve(root);
  for (const arquivo of arquivos) {
    const absoluto = resolve(raiz, arquivo);
    if (!existsSync(absoluto)) continue;
    const markdown = readFileSync(absoluto, "utf8");
    for (const resultado of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = alvoLocal(resultado[1]);
      if (link === null) continue;
      const destino = resolve(dirname(absoluto), link);
      const foraDaRaiz = destino !== raiz && !destino.startsWith(`${raiz}${sep}`);
      if (foraDaRaiz || !existsSync(destino)) {
        const exibido = foraDaRaiz ? link : relative(raiz, destino);
        erros.push(`${arquivo}: referência local inexistente: ${exibido}`);
      }
    }
  }
  return [...new Set(erros)].sort();
}

export function validarRepositorio(root) {
  const erros = [];
  for (const arquivo of ARQUIVOS_CANONICOS) {
    if (!existsSync(resolve(root, arquivo))) erros.push(`arquivo obrigatório ausente: ${arquivo}`);
  }

  const handoff = resolve(root, "docs/HANDOFF.md");
  if (existsSync(handoff)) erros.push(...validarHandoff(readFileSync(handoff, "utf8")));
  erros.push(...validarReferenciasLocais(root, ARQUIVOS_COM_REFERENCIAS));

  for (const arquivo of ["AGENTS.md", "CLAUDE.md"]) {
    const absoluto = resolve(root, arquivo);
    if (!existsSync(absoluto)) continue;
    const conteudo = readFileSync(absoluto, "utf8");
    for (const referencia of [
      "docs/WORKFLOW.md",
      "docs/AMBIENTES.md",
      "docs/HANDOFF.md",
      "docs/PADRAO_DE_PROMPTS.md",
    ]) {
      if (!conteudo.includes(referencia)) {
        erros.push(`${arquivo}: referência canônica ausente: ${referencia}`);
      }
    }
  }
  return [...new Set(erros)].sort();
}

const executadoDiretamente =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (executadoDiretamente) {
  const erros = validarRepositorio(process.cwd());
  if (erros.length > 0) {
    for (const erro of erros) console.error(`ERRO: ${erro}`);
    process.exitCode = 1;
  } else {
    console.log("PASS: workflow documental, handoff e referências locais válidos.");
  }
}
