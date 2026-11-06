/**
 * Intenção de registro de um adicional (FIN-20D, migration 047).
 *
 * A CHAVE de idempotência identifica a INTENÇÃO "registrar este adicional", não a tela nem o clique:
 *   - duplo clique, reenvio e retry depois de timeout reutilizam a MESMA chave (o banco devolve o
 *     adicional que já gravou, sem duplicar);
 *   - dados diferentes são outra intenção e recebem outra chave (se a chave fosse reutilizada, o banco
 *     recusaria com 23505);
 *   - uma operação legítima nova (formulário reaberto ou registro bem-sucedido) parte do zero: o chamador
 *     descarta a intenção e a próxima tentativa gera chave nova.
 *
 * Só memória: este módulo não toca storage, cookie, URL nem rede. A assinatura guarda os parâmetros em forma
 * canônica apenas dentro da instância do hook, pelo mesmo tempo de vida do estado do formulário.
 */

export type IntencaoDeAdicional = { readonly chave: string; readonly assinatura: string };

type Parametros = Record<string, string | number | null | undefined>;

/** JSON canônico: mesmas chaves e valores, em qualquer ordem, dão a mesma assinatura. */
export function assinaturaDoRegistro(params: Parametros): string {
  const ordenado: Record<string, string | number | null> = {};
  for (const nome of Object.keys(params).sort()) {
    const valor = params[nome];
    if (valor !== undefined) ordenado[nome] = valor;
  }
  return JSON.stringify(ordenado);
}

/**
 * A intenção a usar nesta tentativa: a atual, se os dados são os mesmos; senão uma nova.
 * `atual = null` significa "operação nova" (formulário recém-aberto, sucesso anterior ou chave recusada).
 */
export function intencaoParaTentativa(
  atual: IntencaoDeAdicional | null,
  params: Parametros,
  gerarChave: () => string = () => crypto.randomUUID(),
): IntencaoDeAdicional {
  const assinatura = assinaturaDoRegistro(params);
  if (atual !== null && atual.assinatura === assinatura) return atual;
  return { chave: gerarChave(), assinatura };
}
