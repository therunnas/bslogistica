import type { ReactNode } from "react";

import { lerAcesso } from "./_autorizacao";
import { resolverPapelEfetivo } from "./_papel";
import { AcessoOperacionalRestrito } from "./_components/acesso-operacional-restrito";

/**
 * Guarda server-side da área operacional. Espelho do `exigirAdmin()`.
 *
 * Devolve `null` quando o papel efetivo é `operacional`, e a tela de restrição
 * para todo o resto — administrador incluído.
 *
 * **A decisão passa por `resolverPapelEfetivo`, e não por
 * `papeis.includes("operacional")`.** A diferença é exatamente a conta que
 * acumula os dois papéis: pela lista ela entraria aqui, e pela regra central
 * ela é ADMIN e não entra. O banco decide igual — `operador_elegivel_aal1()`
 * exige **não** ser admin —, então a lista daria à interface uma resposta que
 * a RPC recusaria em seguida.
 *
 * Fecha em qualquer situação que não seja `liberado`, pelo mesmo motivo do
 * guard administrativo: layout e página renderizam na mesma passada, e confiar
 * na ordem seria confiar em coincidência.
 */
export async function exigirOperacional(): Promise<ReactNode | null> {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado" || resolverPapelEfetivo(acesso.papeis) !== "operacional") {
    return <AcessoOperacionalRestrito />;
  }

  return null;
}
