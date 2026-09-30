import type { CookieOptions } from "@supabase/ssr";

/**
 * Mantém Secure consistente nos clientes SSR sem sobrescrever os defaults
 * de HttpOnly, SameSite, Path e MaxAge definidos por @supabase/ssr.
 */
export function obterOpcoesCookieSupabase(
  ambiente: string | undefined = process.env.NODE_ENV,
): CookieOptions {
  return { secure: ambiente === "production" };
}
