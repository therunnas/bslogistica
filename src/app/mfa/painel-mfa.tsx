"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ShieldCheck } from "lucide-react";

import { sair } from "@/app/(painel)/_acoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { decidirFluxoMfa, fonteDoQrTotp } from "@/lib/mfa";
import { toast } from "@/lib/notificacoes";

const NOME_DO_FATOR = "BS Soluções Logística";

/**
 * Segundo fator por TOTP usando exclusivamente o MFA oficial do Supabase.
 *
 * Existem dois fluxos:
 *
 * - mfa-ausente: cadastra o segundo fator e confirma;
 * - mfa-pendente: solicita apenas o código do fator já existente.
 *
 * QR, segredo e código permanecem somente no estado do componente.
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

  const [modo, setModo] = useState<"mfa-ausente" | "mfa-pendente">(etapa);

  /**
   * enroll cria um fator novo a cada chamada.
   * A trava evita duplicação durante renders extras em desenvolvimento.
   */
  const jaPreparou = useRef(false);

  const preparar = useCallback(async () => {
    const supabase = criarClienteNavegador();

    const { data: fatores, error: erroLista } = await supabase.auth.mfa.listFactors();

    if (erroLista || !fatores) {
      setFalha(erroLista?.message ?? "Não foi possível consultar os fatores da conta.");

      setPreparando(false);
      return;
    }

    /**
     * listFactors devolve em totp somente fatores já verificados.
     */
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

    /**
     * Cadastro.
     *
     * Tentativas anteriores que não chegaram a ser confirmadas ficam
     * como fatores não verificados. Eles são removidos antes da criação
     * do novo fator.
     *
     * Fatores já verificados nunca são removidos neste fluxo.
     */
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
    if (jaPreparou.current) {
      return;
    }

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

    /**
     * A sessão agora está em AAL2.
     *
     * O servidor precisa reavaliar a sessão antes de navegar para o painel.
     */
    router.refresh();
    router.replace("/dashboard");
  }

  const cadastrando = modo === "mfa-ausente";

  return (
    <main className="flex min-h-screen flex-col bg-[#f4f7fa] px-6 py-8">
      {/* Marca */}
      <div className="mx-auto flex w-full max-w-6xl">
        <Image
          src="/branding/bs-logo-oficial.png"
          alt="BS Soluções Logística"
          width={1000}
          height={625}
          priority
          className="h-auto w-28 object-contain sm:w-32"
        />
      </div>

      {/* Conteúdo */}
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
            {/* Cabeçalho */}
            <div className="mb-7">
              <div className="mb-5 grid size-11 place-items-center rounded-xl bg-[#722F37]/10 text-[#722F37]">
                <ShieldCheck className="size-5" />
              </div>

              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Verificação de segurança
              </p>

              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {cadastrando ? "Ativar verificação em duas etapas" : "Verificação em duas etapas"}
              </h1>

              <p className="mt-3 text-sm leading-6 text-slate-500">
                {cadastrando
                  ? "Escaneie o código com seu aplicativo autenticador e confirme usando os seis dígitos."
                  : "Digite os seis dígitos do seu aplicativo autenticador para concluir a entrada."}
              </p>
            </div>

            <div className="space-y-6">
              {preparando ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm text-slate-600">Preparando verificação...</p>
                </div>
              ) : null}

              {falha ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm leading-6 text-red-800">{falha}</p>
                </div>
              ) : null}

              {!preparando && !falha ? (
                <>
                  {cadastrando && qr ? (
                    <div className="space-y-5">
                      {/* QR */}
                      <div className="grid place-items-center rounded-xl border border-slate-200 bg-white p-5">
                        {/*
                         * O QR fica em <img>, não inline no HTML.
                         * A URI TOTP não é colocada no alt nem exposta como texto.
                         */}
                        <img
                          src={fonteDoQrTotp(qr)}
                          alt="QR code para cadastrar o segundo fator"
                          className="size-44"
                        />
                      </div>

                      {/* Chave manual */}
                      <div className="space-y-2">
                        <Label htmlFor="segredo" className="text-sm font-medium text-slate-900">
                          Não consegue escanear? Use esta chave
                        </Label>

                        <p
                          id="segredo"
                          className="select-all break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-700"
                        >
                          {segredo}
                        </p>

                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 w-full rounded-lg border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                          onClick={copiarChave}
                        >
                          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}

                          {copiado ? "Chave copiada" : "Copiar chave"}
                        </Button>
                      </div>

                      <p className="text-xs leading-5 text-slate-500">
                        Conclua o cadastro nesta mesma tela. Recarregar a página gera uma nova chave
                        e invalida a anterior.
                      </p>
                    </div>
                  ) : null}

                  {/* Código */}
                  <form onSubmit={confirmar} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="codigo" className="text-sm font-medium text-slate-900">
                        Código de seis dígitos
                      </Label>

                      <Input
                        id="codigo"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="000000"
                        value={codigo}
                        onChange={(evento) => setCodigo(evento.target.value.replace(/\D/g, ""))}
                        required
                        autoFocus
                        className="h-12 rounded-lg border-slate-300 bg-white px-4 text-center text-lg tracking-[0.35em] shadow-sm"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={enviando || codigo.length !== 6 || !idDoFator}
                      className="h-12 w-full rounded-lg bg-[#722F37] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#823B43] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {enviando ? "Verificando..." : cadastrando ? "Ativar e entrar" : "Confirmar"}
                    </Button>
                  </form>
                </>
              ) : null}

              {/* Conta */}
              <div className="border-t border-slate-200 pt-5">
                <p className="text-center text-xs text-slate-500">
                  Conectado como <span className="font-medium text-slate-700">{email}</span>
                </p>
              </div>

              {/* Sair */}
              <form action={sair}>
                <Button
                  type="submit"
                  variant="outline"
                  className="h-11 w-full rounded-lg border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                >
                  Sair
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <p className="text-center text-xs text-slate-500">
        © {new Date().getFullYear()} BS Soluções Logística
      </p>
    </main>
  );
}
