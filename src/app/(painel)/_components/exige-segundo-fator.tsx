import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Tela de uma operação CRÍTICA acessada sem segundo fator (AUTH-01B).
 *
 * O segundo fator é opcional para o uso cotidiano, mas administração de usuários e a implantação do
 * cálculo financeiro exigem AAL2. Quem não tem fator verificado não está "sem permissão": só precisa
 * ativar o seu, em Configurações > Segurança. Quem TEM fator e está em AAL1 nem chega aqui (o painel
 * o manda para o código antes).
 */
export function ExigeSegundoFator() {
  return (
    <section className="mx-auto mt-16 w-full max-w-md">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 text-center text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.07]">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-[-0.025em] text-foreground">
          Esta área exige a verificação em duas etapas
        </h1>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Para sua segurança, a administração de usuários e a implantação financeira só abrem com a
          verificação em duas etapas ativa. Ative em Segurança e volte aqui.
        </p>

        <Link
          href="/configuracoes"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Ativar em Segurança
        </Link>
      </div>
    </section>
  );
}
