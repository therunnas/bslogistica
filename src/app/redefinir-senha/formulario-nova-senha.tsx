"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notificacoes";
import { validarNovaSenha } from "@/lib/recuperacao-senha";

import { redefinirSenha } from "./actions";

/**
 * Formulário da nova senha.
 *
 * Ele não fala mais com o Supabase. Coleta os campos, faz a validação de UX e
 * entrega para a Server Action, que é quem revalida a prova de recuperação e
 * troca a senha.
 *
 * A mudança veio de um achado de revisão: enquanto o `updateUser` era chamado
 * daqui, a prova só era conferida na renderização da página. Uma aba deixada
 * aberta continuava trocando a senha depois que a prova expirava, porque a
 * chamada ia direto ao Supabase com a sessão ainda válida.
 *
 * A validação daqui é conveniência, não garantia: a action revalida tudo por
 * conta própria. Nada de token, segredo ou conteúdo da prova é enviado por
 * este componente — o cookie httpOnly viaja sozinho, pelo navegador.
 *
 * A senha vive apenas no estado do componente e some com ele: não vai para
 * log, URL, armazenamento local nem para o toast de erro.
 */
export function FormularioNovaSenha() {
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

    // No sucesso a action redireciona para o login e esta promessa não
    // devolve estado — só o caminho de erro chega de volta aqui.
    const estado = await redefinirSenha({ senha, confirmacao });

    if (estado?.situacao === "erro") {
      toast.error(estado.mensagem);
      setEnviando(false);
      return;
    }

    // A senha mudou, mas o servidor não conseguiu encerrar as demais sessões.
    // Aviso, não erro — e o botão continua desabilitado de propósito: uma
    // segunda tentativa com a mesma senha só traria `same_password`, e a senha
    // que o usuário queria já está valendo.
    if (estado?.situacao === "senha-alterada-sessoes-ativas") {
      toast.warning(estado.mensagem);
    }
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
