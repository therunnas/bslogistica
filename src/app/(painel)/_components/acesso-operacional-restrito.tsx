import { Lock } from "lucide-react";

/**
 * Tela de quem é administrador e abriu a área operacional.
 *
 * Não é falta de privilégio: é o contrário. A área operacional existe para o
 * perfil operacional, e o administrador tem um painel próprio, mais completo.
 *
 * Bloquear aqui não é zelo decorativo. As cinco RPCs da migration 013 recusam
 * administrador por desenho — `operador_elegivel_aal1()` exige explicitamente
 * **não** ser admin —, então esta tela, aberta por um admin, não teria dado
 * nenhum para mostrar. Melhor dizer isso do que exibir uma sequência de erros.
 */
export function AcessoOperacionalRestrito() {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-5 font-display text-xl font-semibold">Área operacional restrita</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Esta área é destinada ao perfil operacional. Utilize o painel administrativo.
      </p>
    </div>
  );
}
