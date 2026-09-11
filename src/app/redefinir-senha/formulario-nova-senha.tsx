"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";
import {
  MENSAGEM_FALHA_AO_TROCAR,
  ROTA_LOGIN_SENHA_REDEFINIDA,
  traduzirErroDeSenha,
  validarNovaSenha,
} from "@/lib/recuperacao-senha";

/**
 * Formulário da nova senha.
 *
 * Três pontos de segurança, nesta ordem obrigatória:
 *
 * 1. a troca é feita com `updateUser`, que age sobre a sessão de recuperação.
 *    Nada de MFA é tocado: nenhum `unenroll`, nenhum fator novo, nenhum
 *    rebaixamento de AAL. O fator TOTP continua exatamente como estava;
 * 2. logo após o sucesso vem `signOut`, ainda antes de qualquer navegação. A
 *    sessão de recuperação não pode sobreviver à troca — ela nasceu de um link
 *    de e-mail e não passou por segundo fator;
 * 3. só então o usuário volta para o login, onde entra com a senha nova e
 *    responde ao TOTP pelo fluxo normal.
 *
 * A senha vive apenas no estado do componente e some com ele: não vai para
 * log, URL, armazenamento local nem para o toast de erro.
 */
export function FormularioNovaSenha() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function redefinir(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando) return;

    const validacao = validarNovaSenha(senha, confirmacao);
    if (!validacao.valida) {
      toast.error(validacao.mensagem);
      return;
    }

    setEnviando(true);
    const supabase = criarClienteNavegador();

    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      // Nunca `error.message`: o texto do GoTrue é livre, em inglês, e pode
      // carregar detalhe de implementação. Traduzimos pelo código estável.
      toast.error(traduzirErroDeSenha(error.code));
      setEnviando(false);
      return;
    }

    // Encerra a sessão de recuperação antes de sair desta tela. O escopo
    // padrão é global, então as demais sessões da conta também caem — que é o
    // comportamento desejado depois de uma troca de senha.
    //
    // O cookie `bs_recovery_proof` não é apagado aqui de propósito: é httpOnly
    // e o cliente não alcança. Criar uma rota só para limpá-lo seria
    // complexidade sem ganho — a prova está amarrada ao `session_id`, e este
    // signOut global revoga justamente essa sessão. Sem a sessão a prova não
    // valida mais, e em 10 minutos ela expira sozinha.
    const { error: erroAoSair } = await supabase.auth.signOut();

    if (erroAoSair) {
      // A senha já mudou, mas a sessão de recuperação continua de pé. Não dá
      // para deixar o usuário seguir com ela: avisa e mantém nesta tela, sem
      // navegar para lugar nenhum autenticado.
      toast.error(MENSAGEM_FALHA_AO_TROCAR);
      setEnviando(false);
      return;
    }

    // refresh antes de navegar para o servidor reavaliar a ausência de sessão.
    router.refresh();
    router.replace(ROTA_LOGIN_SENHA_REDEFINIDA);
  }

  return (
    <form onSubmit={redefinir} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="senha">Nova senha</Label>
        <Input
          id="senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmacao">Confirmar nova senha</Label>
        <Input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Aguarde..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
