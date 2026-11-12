/**
 * Capturador LOCAL de e-mail (Mailpit do Supabase CLI, 127.0.0.1:54324). Nenhuma mensagem sai da
 * VM: o GoTrue local entrega tudo ali, e os destinatários são sempre @exemplo.test.
 */
type Resumo = { ID: string; To: { Address: string }[]; Subject: string; Created: string };

function base(): string {
  const url = process.env["E2E_MAILPIT_URL"];
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
    throw new Error("E2E_MAILPIT_URL ausente ou fora do loopback: rode pelo scripts/e2e-local.sh");
  }
  return url;
}

async function listar(): Promise<Resumo[]> {
  const r = await fetch(`${base()}/api/v1/messages?limit=200`);
  if (!r.ok) throw new Error(`Mailpit respondeu ${r.status}`);
  const corpo = (await r.json()) as { messages: Resumo[] };
  return corpo.messages;
}

/** IDs já presentes para o destinatário (para esperar só por mensagens novas). */
export async function idsPara(destinatario: string): Promise<Set<string>> {
  const todas = await listar();
  return new Set(
    todas
      .filter((m) => m.To.some((t) => t.Address.toLowerCase() === destinatario.toLowerCase()))
      .map((m) => m.ID),
  );
}

/** Espera uma mensagem NOVA (fora de `antes`) para o destinatário e devolve assunto e texto. */
export async function esperarEmail(
  destinatario: string,
  antes: Set<string>,
  limiteMs = 20_000,
): Promise<{ assunto: string; texto: string }> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const nova = (await listar()).find(
      (m) =>
        !antes.has(m.ID) &&
        m.To.some((t) => t.Address.toLowerCase() === destinatario.toLowerCase()),
    );
    if (nova) {
      const r = await fetch(`${base()}/api/v1/message/${nova.ID}`);
      const msg = (await r.json()) as { Subject: string; Text: string; HTML: string };
      return { assunto: msg.Subject, texto: `${msg.Text}\n${msg.HTML}` };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`nenhum e-mail novo para ${destinatario} em ${limiteMs} ms`);
}

/** Quantas mensagens novas chegaram para o destinatário desde `antes` (sem esperar). */
export async function novasPara(destinatario: string, antes: Set<string>): Promise<number> {
  const agora = await idsPara(destinatario);
  return [...agora].filter((id) => !antes.has(id)).length;
}

/**
 * `token_hash` do link do e-mail. O modelo de e-mail do Supabase local é o padrão do CLI e aponta
 * para `/auth/v1/verify?token=<hash>&type=…`; o modelo da Production (Dashboard) aponta para
 * `/auth/confirm?token_hash=<hash>&type=recovery`. O hash é o mesmo nos dois: o teste o extrai e
 * monta a URL no formato da Production, que é a rota que o app expõe.
 */
export function tokenDoEmail(texto: string, tipo: "recovery" | "invite"): string {
  const decodificado = texto.replace(/&amp;/g, "&");
  const m =
    decodificado.match(new RegExp(`[?&]token=([A-Za-z0-9_-]+)&type=${tipo}`)) ??
    decodificado.match(new RegExp(`[?&]token_hash=([A-Za-z0-9_-]+)&type=${tipo}`));
  if (!m) throw new Error(`link do tipo ${tipo} não encontrado no e-mail`);
  return m[1]!;
}

/**
 * Origem do link no E2E local: `localhost`, não `127.0.0.1`. O `next start` local monta o
 * redirecionamento de /auth/confirm com `request.nextUrl`, que sai como `http://localhost:3000`
 * qualquer que seja o Host recebido (conferido no CP-01); o cookie do token pendente, gravado na
 * origem do pedido, só acompanha o salto se a origem já for a mesma. Na Vercel o `nextUrl` é o
 * domínio real. Limitação do ambiente local, registrada em docs/TESTES_E2E.md.
 */
export const ORIGEM_DO_LINK = "http://localhost:3000";

export function linkDeRecuperacao(token: string): string {
  return `${ORIGEM_DO_LINK}/auth/confirm?token_hash=${token}&type=recovery`;
}
