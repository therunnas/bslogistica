"use strict";
/**
 * Trava de rede do servidor do app no E2E. Carregada com `node --require` só no `next start`
 * dos testes: toda conexão TCP/TLS que não seja loopback (127.0.0.1, ::1, localhost) ou socket
 * local é RECUSADA antes de qualquer DNS, e a tentativa é registrada em `E2E_REDE_LOG`.
 * O Supabase local e o próprio app continuam acessíveis; HML, Production, Vercel e qualquer
 * outro host ficam inalcançáveis, mesmo que alguma variável aponte para lá.
 *
 * Não é carregada no build nem fora do E2E.
 */
const fs = require("node:fs");
const net = require("node:net");

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function hostDosArgumentos(args) {
  const primeiro = args[0];
  if (Array.isArray(primeiro)) return hostDosArgumentos(primeiro);
  if (primeiro && typeof primeiro === "object") {
    if (typeof primeiro.path === "string" && primeiro.path !== "") return { local: true };
    return { host: primeiro.host ?? primeiro.hostname ?? "localhost" };
  }
  if (typeof primeiro === "string" && Number.isNaN(Number(primeiro))) return { local: true };
  return { host: typeof args[1] === "string" ? args[1] : "localhost" };
}

function registrar(host) {
  const arquivo = process.env.E2E_REDE_LOG;
  if (!arquivo) return;
  try {
    fs.appendFileSync(arquivo, `${new Date().toISOString()} BLOQUEADO ${String(host)}\n`);
  } catch {
    // sem registro: a recusa continua valendo
  }
}

const conectarOriginal = net.Socket.prototype.connect;
net.Socket.prototype.connect = function conectarSomenteLocal(...args) {
  const alvo = hostDosArgumentos(args);
  if (alvo.local || HOSTS_LOCAIS.has(String(alvo.host).toLowerCase())) {
    return conectarOriginal.apply(this, args);
  }
  registrar(alvo.host);
  const erro = new Error(`E2E: conexão externa bloqueada (${String(alvo.host)})`);
  erro.code = "E2E_REDE_BLOQUEADA";
  process.nextTick(() => this.destroy(erro));
  return this;
};
