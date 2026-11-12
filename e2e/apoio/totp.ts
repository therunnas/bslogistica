import { createHmac } from "node:crypto";

/**
 * TOTP (RFC 6238: HMAC-SHA1, passo de 30 s, 6 dígitos) calculado no próprio teste, a partir do
 * segredo que a tela de cadastro do fator mostra. É o mesmo cálculo de um aplicativo autenticador:
 * o código vai para o GoTrue local de verdade, sem atalho no servidor.
 */
function base32(texto: string): Buffer {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const limpo = texto.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const c of limpo) {
    const i = alfabeto.indexOf(c);
    if (i < 0) throw new Error("segredo TOTP fora do alfabeto base32");
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function codigoTotp(segredo: string, instante = Date.now()): string {
  const contador = Math.floor(instante / 1000 / 30);
  const mensagem = Buffer.alloc(8);
  mensagem.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac("sha1", base32(segredo)).update(mensagem).digest();
  const deslocamento = hmac[hmac.length - 1]! & 0x0f;
  const numero = (hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 1_000_000;
  return String(numero).padStart(6, "0");
}

const usados = new Map<string, string>();

/**
 * Código válido que ainda não foi usado com este segredo nesta execução. O GoTrue recusa reusar o
 * mesmo código; quando a janela atual já foi gasta (ou está a menos de 3 s do fim), espera a próxima.
 */
export async function codigoNovo(segredo: string): Promise<string> {
  for (;;) {
    const agora = Date.now();
    const restante = 30_000 - (agora % 30_000);
    const codigo = codigoTotp(segredo, agora);
    if (usados.get(segredo) !== codigo && restante > 3_000) {
      usados.set(segredo, codigo);
      return codigo;
    }
    await new Promise((r) => setTimeout(r, restante + 250));
  }
}

/** Um código de 6 dígitos garantidamente diferente do válido agora e nas janelas vizinhas. */
export function codigoErrado(segredo: string): string {
  const agora = Date.now();
  const validos = new Set([-1, 0, 1].map((d) => codigoTotp(segredo, agora + d * 30_000)));
  for (let n = 0; ; n++) {
    const candidato = String((123456 + n * 7919) % 1_000_000).padStart(6, "0");
    if (!validos.has(candidato)) return candidato;
  }
}
