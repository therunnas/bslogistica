import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar | BS Logística" },
      {
        name: "description",
        content:
          "Acesse o painel da BS Logística para controlar apontamentos, diárias, horas extras e faturamento das operações.",
      },
      { property: "og:title", content: "Entrar | BS Logística" },
      {
        property: "og:description",
        content: "Painel interno de gestão operacional e financeira de mão de obra terceirizada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      // Painel interno: fora do índice dos buscadores.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

/**
 * Tela de entrada do painel.
 *
 * Sistema interno: não há criação de conta por aqui. Os acessos são criados
 * pelo administrador no painel do Supabase, e o papel em user_roles é o que
 * libera os dados — quem entra sem papel não enxerga nada, por causa da RLS.
 */
function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível autenticar.");
    } finally {
      setLoading(false);
    }
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
          <form onSubmit={handleSubmit} className="space-y-3">
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
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Aguarde..." : "Entrar"}
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
