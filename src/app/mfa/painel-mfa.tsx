"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowRight, Check, Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from "lucide-react";

import { sair } from "@/app/(painel)/_acoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { decidirFluxoMfa } from "@/lib/mfa";
import { toast } from "@/lib/notificacoes";

const NOME_DO_FATOR = "BS Logística";

function fonteDoQr(valor: string): string {
  if (valor.startsWith("data:")) {
    return valor;
  }

  return `data:image/svg+xml;utf-8,${encodeURIComponent(valor)}`;
}

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

  const [modo, setModo] = useState<"mfa-ausente" | "mfa-pendente">(etapa);

  const jaPreparou = useRef(false);

  const preparar = useCallback(async () => {
    const supabase = criarClienteNavegador();

    const { data: fatores, error: erroLista } = await supabase.auth.mfa.listFactors();

    if (erroLista || !fatores) {
      setFalha(erroLista?.message ?? "Não foi possível consultar os fatores da conta.");

      setPreparando(false);
      return;
    }

    const verificado = fatores.totp[0];

    const fluxo = decidirFluxoMfa(Boolean(verificado), etapa);

    if (fluxo === "desafio") {
      setIdDoFator(verificado!.id);
      setModo("mfa-pendente");
      setPreparando(false);
      return;
    }

    if (fluxo === "sem-fator-esperado") {
      setFalha("Nenhum fator verificado encontrado. Recarregue a página.");

      setPreparando(false);
      return;
    }

    const pendentes = fatores.all.filter(
      (fator) => fator.factor_type === "totp" && fator.status === "unverified",
    );

    for (const fator of pendentes) {
      await supabase.auth.mfa.unenroll({
        factorId: fator.id,
      });
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

      setTimeout(() => {
        setCopiado(false);
      }, 2000);
    } catch {
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

    toast.success(modo === "mfa-ausente" ? "Segundo fator ativado." : "Acesso confirmado.");

    router.refresh();
    router.replace("/dashboard");
  }

  const cadastrando = modo === "mfa-ausente";

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-primary/[0.08] blur-[120px]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-primary/[0.05] blur-[120px]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex min-h-16 items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              BS Soluções Logísticas
            </p>

            <p className="text-xs text-muted-foreground">Sistema interno</p>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur-xl sm:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Verificação protegida
          </div>
        </header>

        <div className="grid flex-1 items-center gap-16 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-8">
          <section className="hidden max-w-2xl lg:block">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Segurança da conta
            </div>

            <h1 className="max-w-[11ch] text-5xl font-semibold leading-[0.98] tracking-[-0.05em] text-foreground xl:text-7xl">
              Mais uma camada de proteção.
            </h1>

            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground xl:text-lg">
              A verificação em duas etapas protege o acesso ao ambiente administrativo mesmo que uma
              senha seja comprometida.
            </p>

            <div className="mt-10 grid max-w-lg gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60">
                  <Smartphone className="h-4 w-4 text-primary" />
                </div>
                Código temporário gerado pelo seu autenticador
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60">
                  <KeyRound className="h-4 w-4 text-primary" />
                </div>
                Acesso confirmado antes de abrir o painel
              </div>
            </div>
          </section>

          <section className="mx-auto w-full max-w-[460px]">
            <div className="relative overflow-hidden rounded-[22px] border border-border bg-card/95 shadow-[0_32px_100px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

              <div className="p-6 sm:p-8 lg:p-9">
                <div className="mb-8">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary/70">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>

                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                    {cadastrando
                      ? "Ativar verificação em duas etapas"
                      : "Verificação em duas etapas"}
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {cadastrando
                      ? "Escaneie o QR Code no seu aplicativo autenticador e confirme o cadastro com os seis dígitos."
                      : "Digite os seis dígitos do seu aplicativo autenticador para concluir a entrada."}
                  </p>
                </div>

                {preparando && (
                  <div className="rounded-xl border border-border bg-secondary/60 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />

                      <p className="text-sm text-muted-foreground">Preparando verificação...</p>
                    </div>
                  </div>
                )}

                {falha && (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm leading-6 text-destructive"
                  >
                    {falha}
                  </div>
                )}

                {!preparando && !falha && (
                  <>
                    {cadastrando && qr && (
                      <div className="mb-6 space-y-5">
                        <div className="rounded-2xl border border-border bg-secondary/50 p-4">
                          <div className="grid place-items-center rounded-xl bg-white p-5">
                            <img
                              src={fonteDoQr(qr)}
                              alt="QR code para cadastrar o segundo fator"
                              className="size-44"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="segredo" className="text-sm font-medium text-foreground">
                            Não consegue escanear?
                          </Label>

                          <p className="text-xs leading-5 text-muted-foreground">
                            Use a chave abaixo diretamente no seu aplicativo autenticador.
                          </p>

                          <p
                            id="segredo"
                            className="rounded-xl border border-border bg-secondary/60 p-3 font-mono text-sm break-all text-foreground select-all"
                          >
                            {segredo}
                          </p>

                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-full rounded-xl"
                            onClick={copiarChave}
                          >
                            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}

                            {copiado ? "Chave copiada" : "Copiar chave"}
                          </Button>
                        </div>
                      </div>
                    )}

                    <form onSubmit={confirmar} className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="codigo" className="text-sm font-medium text-foreground">
                          Código de seis dígitos
                        </Label>

                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

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
                            className="h-12 rounded-xl border-input bg-secondary/70 pl-10 tracking-[0.3em] text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={enviando || codigo.length !== 6 || !idDoFator}
                        className="group h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground"
                      >
                        {enviando ? (
                          "Verificando..."
                        ) : (
                          <>
                            {cadastrando ? "Ativar e entrar" : "Confirmar"}

                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                          </>
                        )}
                      </Button>
                    </form>
                  </>
                )}

                <div className="mt-7 border-t border-border pt-6">
                  <p className="text-center text-xs leading-5 text-muted-foreground">
                    Conectado como <span className="font-medium text-foreground">{email}</span>
                  </p>

                  <form action={sair} className="mt-4">
                    <Button type="submit" variant="outline" className="h-11 w-full rounded-xl">
                      <LogOut className="h-4 w-4" />
                      Sair
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
