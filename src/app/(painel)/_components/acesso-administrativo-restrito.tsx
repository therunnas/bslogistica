import { Lock } from "lucide-react";

/**
 * Tela de quem está autenticado e autorizado no sistema, mas não na ÁREA
 * ADMINISTRATIVA.
 *
 * Não confundir com `AcessoNaoLiberado`, que é para conta sem papel nenhum e
 * diz que o acesso ainda não foi liberado. Aqui a conta tem papel e tem uso
 * legítimo do sistema — só não este. Reaproveitar aquela mensagem diria ao
 * operacional que ele não tem acesso a nada, o que é falso.
 *
 * Renderiza dentro do `AppShell`, e não em tela cheia como as outras duas: a
 * sessão continua válida, a marca e o botão Sair seguem onde estavam, e quem
 * chegou aqui só errou de endereço.
 *
 * A mensagem não cita tabela, papel do banco, RLS nem qualquer detalhe de
 * implementação. Quem lê isto quer saber que não é aqui, não como o sistema
 * decidiu.
 */
export function AcessoAdministrativoRestrito() {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-5 font-display text-xl font-semibold">Área administrativa restrita</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Seu perfil não possui permissão para acessar esta área.
      </p>
    </div>
  );
}
