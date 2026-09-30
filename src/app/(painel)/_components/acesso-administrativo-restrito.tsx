import { Lock } from "lucide-react";

export function AcessoAdministrativoRestrito() {
  return (
    <section className="mx-auto mt-16 w-full max-w-md">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 text-center text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.07]">
          <Lock className="h-5 w-5 text-primary" />
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-[-0.025em] text-foreground">
          Área administrativa restrita
        </h1>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Seu perfil não possui permissão para acessar esta área.
        </p>
      </div>
    </section>
  );
}
