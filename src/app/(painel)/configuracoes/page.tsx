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
 * pelos DOIS papéis, admin e operacional. É aqui que o operacional ativa o
 * segundo fator por vontade própria; o admin só vê o próprio estado, que já
 * chega sempre "ativo" (ele não alcança `liberado` sem ter passado por AAL2).
 *
 * O `(painel)/layout.tsx` já garante `liberado` antes de qualquer página
 * deste grupo renderizar — sem sessão vai para `/login`, sem papel para a
 * tela de conta sem papel, e `mfa-ausente`/`mfa-pendente` para `/mfa`. Esta
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
