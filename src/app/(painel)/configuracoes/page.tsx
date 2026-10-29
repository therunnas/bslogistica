import type { Metadata } from "next";

import { lerAcesso } from "../_autorizacao";
import { resolverPapelEfetivo } from "../_papel";
import { AcessoNaoLiberado } from "../_components/acesso-nao-liberado";
import { papelTemAcessoAConfiguracoes } from "./_dominio";
import { PainelConfiguracoes } from "./painel-configuracoes";

export const metadata: Metadata = {
  title: "Segurança",
  description: "Estado da verificação em duas etapas desta conta.",
};

/**
 * Configurações → Segurança (PR F) — a única tela administrativa acessível
 * pelos DOIS papéis, admin e operacional. É aqui que cada titular ativa ou
 * desativa o próprio segundo fator, por vontade própria (AUTH-01B: opcional
 * para os dois). O que continua exigindo AAL2 são as operações críticas.
 *
 * O `(painel)/layout.tsx` já garante `liberado` antes de qualquer página
 * deste grupo renderizar — sem sessão vai para `/login`, sem papel para a
 * tela de conta sem papel, e `mfa-pendente` (fator ativo sem o código) para `/mfa`. Esta
 * checagem não confia nessa ordem, no mesmo espírito de
 * `exigirAdmin()`/`exigirOperacional()`: fecha de novo, por conta própria, e
 * não reimplementa a decisão — só chama `lerAcesso()` e `resolverPapelEfetivo()`,
 * as mesmas fontes de sempre.
 */
export default async function Configuracoes() {
  const acesso = await lerAcesso();

  if (acesso.situacao !== "liberado") {
    const email = "email" in acesso ? acesso.email : "";
    return <AcessoNaoLiberado email={email} />;
  }

  const papel = resolverPapelEfetivo(acesso.papeis);
  if (!papelTemAcessoAConfiguracoes(papel)) {
    return <AcessoNaoLiberado email={acesso.email} />;
  }

  return <PainelConfiguracoes email={acesso.email} papel={papel} />;
}
