/**
 * Leitor mínimo de ZIP para as suítes de exportação.
 *
 * Um .xlsx é um ZIP; as suítes precisam abrir o arquivo REAL e olhar o XML.
 * Para não depender de uma biblioteca de terceiros nos testes (e não instalar
 * nada além do que a etapa aprovou), isto lê o diretório central do ZIP e
 * descomprime cada entrada com `node:zlib`. Só entende o que o gerador usa:
 * entradas "stored" ou "deflate", sem ZIP64 e sem criptografia.
 */

import { inflateRawSync } from "node:zlib";

const FIM_DO_DIRETORIO = 0x06054b50;
const ENTRADA_DO_DIRETORIO = 0x02014b50;

/** Devolve `Map<caminho, string UTF-8>`. */
export function lerZip(buffer) {
  let fim = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === FIM_DO_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("ZIP sem diretório central.");

  const total = buffer.readUInt16LE(fim + 10);
  let posicao = buffer.readUInt32LE(fim + 16);
  const arquivos = new Map();

  for (let n = 0; n < total; n++) {
    if (buffer.readUInt32LE(posicao) !== ENTRADA_DO_DIRETORIO) {
      throw new Error("Entrada de ZIP corrompida.");
    }
    const metodo = buffer.readUInt16LE(posicao + 10);
    const tamanhoComprimido = buffer.readUInt32LE(posicao + 20);
    const tamanhoNome = buffer.readUInt16LE(posicao + 28);
    const tamanhoExtra = buffer.readUInt16LE(posicao + 30);
    const tamanhoComentario = buffer.readUInt16LE(posicao + 32);
    const deslocamento = buffer.readUInt32LE(posicao + 42);
    const nome = buffer.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome);

    const nomeLocal = buffer.readUInt16LE(deslocamento + 26);
    const extraLocal = buffer.readUInt16LE(deslocamento + 28);
    const inicio = deslocamento + 30 + nomeLocal + extraLocal;
    const dados = buffer.subarray(inicio, inicio + tamanhoComprimido);

    if (metodo === 0) arquivos.set(nome, dados.toString("utf8"));
    else if (metodo === 8) arquivos.set(nome, inflateRawSync(dados).toString("utf8"));
    else throw new Error(`Método de compressão ${metodo} não suportado.`);

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }
  return arquivos;
}
