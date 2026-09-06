"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ShieldCheck } from "lucide-react";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { toast } from "@/lib/notificacoes";
import { sair } from "@/app/(painel)/_acoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const NOME_DO_FATOR = "BS Logística";

/**
 * Fonte do <img> do QR.
 *
 * O campo `totp.qr_code` do Supabase já vem como data URL completo — a
 * referência oficial usa `src={data.totp.qr_code}` direto, sem montar nada.
 * O comentário do tipo em @supabase/auth-js diz o contrário, que é preciso
 * prefixar `data:image/svg+xml;utf-8,`; seguir esse comentário foi o que
 * quebrou o QR na primeira tentativa, porque o prefixo entrava duas vezes e o
 * conteúdo virava texto em vez de SVG.
 *
 * Como as duas fontes se contradizem, aqui a decisão é pelo valor recebido:
 * se já é data URL, usa como está; se for SVG cru, aí sim monta o data URL.
 * Funciona nos dois formatos e não depende de qual está certo hoje.
 */
function fonteDoQr(valor: string): string {
  if (valor.startsWith("data:")) return valor;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(valor)}`;
}

/**
 * Segundo fator por TOTP, usando exclusivamente o MFA oficial do Supabase.
 *
 * Nada de segredo é gerado, guardado ou validado aqui: `enroll` devolve o
 * segredo já criado pelo Supabase, e `challengeAndVerify` confere o código
 * contra ele no servidor. Nenhuma tabela própria, nenhum OTP caseiro.
 *
 * As duas etapas moram na mesma tela porque compartilham quase tudo — o que
 * muda é só o cadastro precisar exibir o QR antes de pedir o código:
 *
 * - `mfa-ausente`  -> a conta ainda não tem fator: cadastrar e confirmar;
 * - `mfa-pendente` -> a conta tem fator: só confirmar o código.
 *
 * O QR e o segredo não são registrados em log nem enviados a lugar nenhum:
 * ficam em estado de componente e somem quando a tela sai.
 */
export function PainelMfa({
  email,
  etapa,
}: {
  email: string;
  etapa: "mfa-ausente" | "mfa-pendente";
}) {
  const router = useRouter();
  const [idDoFator, setIdDoFator] = useState("");
  const [qr, setQr] = useState("");
  const [segredo, setSegredo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [preparando, setPreparando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState("");
  const [copiado, setCopiado] = useState(false);

  // enroll cria um fator a cada chamada. Sem esta trava, um segundo render em
  // desenvolvimento (StrictMode) deixaria fatores órfãos na conta.
  const jaPreparou = useRef(false);

  const preparar = useCallback(async () => {
    const supabase = criarClienteNavegador();
    const { data: fatores, error: erroLista } = await supabase.auth.mfa.listFactors();

    if (erroLista || !fatores) {
      setFalha(erroLista?.message ?? "Não foi possível consultar os fatores da conta.");
      setPreparando(false);
      return;
    }

    if (etapa === "mfa-pendente") {
      // listFactors devolve em `totp` apenas os fatores já verificados.
      const verificado = fatores.totp[0];
      if (!verificado) {
        setFalha("Nenhum fator verificado encontrado. Recarregue a página.");
        setPreparando(false);
        return;
      }
      setIdDoFator(verificado.id);
      setPreparando(false);
      return;
    }

    // Cadastro. Tentativas anteriores que não chegaram a ser confirmadas ficam
    // como fatores não verificados e impedem reusar o mesmo nome — some com
    // elas antes de criar o novo.
    const pendentes = fatores.all.filter(
      (fator) => fator.factor_type === "totp" && fator.status === "unverified",
    );
    for (const fator of pendentes) {
      await supabase.auth.mfa.unenroll({ factorId: fator.id });
    }

    const { data: novo, error: erroEnroll } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: NOME_DO_FATOR,
    });

    if (erroEnroll || !novo) {
      setFalha(erroEnroll?.message ?? "Não foi possível iniciar o cadastro do segundo fator.");
      setPreparando(false);
      return;
    }

    setIdDoFator(novo.id);
    setQr(novo.totp.qr_code);
    setSegredo(novo.totp.secret);
    setPreparando(false);
  }, [etapa]);

  useEffect(() => {
    if (jaPreparou.current) return;
    jaPreparou.current = true;
    void preparar();
  }, [preparar]);

  async function copiarChave() {
    try {
      await navigator.clipboard.writeText(segredo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência o texto continua selecionável.
      toast.info("Selecione a chave e copie manualmente.");
    }
  }

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: idDoFator,
      code: codigo.trim(),
    });

    if (error) {
      toast.error(error.message);
      setCodigo("");
      setEnviando(false);
      return;
    }

    toast.success(etapa === "mfa-ausente" ? "Segundo fator ativado." : "Acesso confirmado.");

    // A sessão subiu para AAL2 e o servidor precisa reavaliá-la antes da
    // navegação, senão o layout do painel ainda enxergaria o estado anterior e
    // devolveria para cá.
    router.refresh();
    router.replace("/dashboard");
  }

  const cadastrando = etapa === "mfa-ausente";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="font-display text-xl">
            {cadastrando ? "Ativar verificação em duas etapas" : "Verificação em duas etapas"}
          </CardTitle>
          <CardDescription>
            {cadastrando
              ? "O painel administrativo exige um segundo fator. Escaneie o código no seu aplicativo autenticador e confirme com os seis dígitos."
              : "Digite os seis dígitos do seu aplicativo autenticador para concluir a entrada."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {preparando && <p className="text-sm text-muted-foreground">Preparando...</p>}

          {falha && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {falha}
            </p>
          )}

          {!preparando && !falha && (
            <>
              {cadastrando && qr && (
                <div className="space-y-3">
                  <div className="grid place-items-center rounded-md border border-border bg-white p-4">
                    {/* Vai em <img>, e não inline no HTML: SVG embutido pode
                        carregar script, dentro de <img> não executa nada.
                        O alt é neutro de propósito — a referência do Supabase
                        sugere usar totp.uri ali, mas essa URI carrega o segredo
                        TOTP, que passaria a ficar legível no DOM. */}
                    <img
                      src={fonteDoQr(qr)}
                      alt="QR code para cadastrar o segundo fator"
                      className="size-44"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="segredo">Não consegue escanear? Use esta chave</Label>
                    {/* Bloco selecionável em vez de <input>: numa caixa de texto
                        estreita é fácil copiar só o pedaço visível, e uma chave
                        truncada é recusada pelo autenticador como inválida. */}
                    <p
                      id="segredo"
                      className="rounded-md border border-border bg-muted/50 p-3 font-mono text-sm break-all select-all"
                    >
                      {segredo}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={copiarChave}
                    >
                      {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copiado ? "Chave copiada" : "Copiar chave"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Conclua o cadastro nesta mesma tela: recarregar a página gera uma chave nova e
                    invalida a anterior.
                  </p>
                </div>
              )}

              <form onSubmit={confirmar} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="codigo">Código de seis dígitos</Label>
                  <Input
                    id="codigo"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={enviando || codigo.length !== 6 || !idDoFator}
                >
                  {enviando ? "Verificando..." : cadastrando ? "Ativar e entrar" : "Confirmar"}
                </Button>
              </form>
            </>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Conectado como <span className="font-medium text-foreground">{email}</span>
          </p>

          <form action={sair}>
            <Button type="submit" variant="outline" className="w-full">
              Sair
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
