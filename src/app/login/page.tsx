"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/lib/notificacoes";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  // Quem já tem sessão não precisa ver esta tela.
  useEffect(() => {
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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-md bg-primary font-display font-bold text-primary-foreground">
            BS
          </div>
          <CardTitle className="font-display text-xl">Entrar</CardTitle>
          <CardDescription>
            Painel interno de gestão de diárias, horas extras e faturamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <p className="text-center text-sm text-muted-foreground">
            Precisa de acesso? Fale com o administrador do sistema.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
