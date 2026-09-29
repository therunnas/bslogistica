"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "@/lib/notificacoes";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS,
  MENSAGEM_SENHA_REDEFINIDA,
  PARAM_SESSOES_ATIVAS,
  ROTA_ESQUECI_SENHA,
} from "@/lib/recuperacao-senha";

/**
 * Confirmação de senha redefinida, vinda de /redefinir-senha.
 *
 * Em componente próprio porque `useSearchParams` obriga um limite de Suspense
 * — sem ele o build falha ao pré-renderizar esta rota estática.
 */
function AvisoSenhaRedefinida() {
  const parametros = useSearchParams();
  if (parametros.get("senha-redefinida") !== "1") return null;

  // Desfecho parcial: a senha mudou, mas o `signOut` global não respondeu e
  // podem ter sobrado sessões abertas. Mensagem própria — a de sucesso normal
  // omitiria justamente o que o usuário precisa saber.
  const sessoesAtivas = parametros.get(PARAM_SESSOES_ATIVAS) === "1";

  return (
    <p
      role="status"
      className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
    >
      {sessoesAtivas ? MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS : MENSAGEM_SENHA_REDEFINIDA}
    </p>
  );
}

/**
 * Tela de entrada do painel.
 *
 * Sistema interno: não há criação de conta por aqui. Os acessos são criados
 * pelo administrador no Supabase, e o papel em user_roles é o que libera os
 * dados — quem entra sem papel não enxerga nada, por causa da RLS.
 */
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  /**
   * Quem já tem sessão não precisa ver esta tela — com uma exceção.
   *
   * No desfecho parcial da redefinição (`sessoes-ativas=1`) a sessão que
   * sobreviveu ao `signOut` é exatamente o problema, não um atalho: mandar esse
   * usuário ao painel o faria pular o aviso e seguir com a sessão antiga, sem
   * nunca usar a senha nova. Nesse estado ele fica aqui e entra de novo.
   *
   * O parâmetro é lido de `window.location` em vez de `useSearchParams` porque
   * este efeito já só roda no cliente. Trazer o hook para cá obrigaria a
   * envolver o componente inteiro em Suspense — sem isso o build falha ao
   * pré-renderizar esta rota estática, que é o motivo de `AvisoSenhaRedefinida`
   * existir separado.
   */
  useEffect(() => {
    const sessoesAtivas =
      new URLSearchParams(window.location.search).get(PARAM_SESSOES_ATIVAS) === "1";

    if (sessoesAtivas) return;

    const supabase = criarClienteNavegador();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
    });
  }, [router]);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      toast.error(error.message);
      setEnviando(false);
      return;
    }

    // refresh faz o servidor reavaliar a sessão recém-criada antes de navegar,
    // para o layout protegido já enxergar o usuário autenticado.
    router.refresh();
    router.replace("/dashboard");
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-12">
      {/* Marca fora do card, com espaço próprio.
          Em telas largas ela sai do fluxo e ancora no canto superior esquerdo
          da página; o card continua centralizado como sempre esteve.
          Abaixo de lg volta ao fluxo, empilhada acima do card — absoluta em
          tela estreita ela passaria por cima dele.
          `self-start` alinha a marca pela borda esquerda do card no empilhado,
          já que o container centraliza os filhos. */}
      <Image
        src="/branding/bs-logo-oficial.png"
        alt="BS Soluções Logísticas"
        width={1000}
        height={625}
        priority
        className="h-auto w-36 self-start object-contain lg:absolute lg:top-8 lg:left-10 lg:w-40"
      />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-xl">Entrar</CardTitle>
          <CardDescription>
            Painel interno de gestão de diárias, horas extras e faturamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <AvisoSenhaRedefinida />
          </Suspense>
          <form onSubmit={entrar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Aguarde..." : "Entrar"}
            </Button>
          </form>
          <p className="text-center text-sm">
            <Link
              href={ROTA_ESQUECI_SENHA}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Esqueci minha senha
            </Link>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Precisa de acesso? Fale com o administrador do sistema.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
