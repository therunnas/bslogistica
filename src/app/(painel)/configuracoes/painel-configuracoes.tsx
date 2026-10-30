"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ShieldCheck, ShieldOff } from "lucide-react";

import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { fonteDoQrTotp } from "@/lib/mfa";
import { toast } from "@/lib/notificacoes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { PageHeader } from "../_components/app-shell";
import type { PapelEfetivo } from "../_papel";
import {
  codigoTotpCompleto,
  faseAposListarFatores,
  mensagemDeCodigoInvalido,
  textoSemFator,
  NOME_DO_FATOR,
  type FaseDeSeguranca,
  type TextoDoEstado,
} from "./_dominio";

interface FatorVerificado {
  id: string;
  friendlyName: string | null;
}

/**
 * Configurações → Segurança — ativação e desativação opcionais de MFA (PR F).
 *
 * Autosserviço completo para os DOIS papéis: cada titular ativa OU desativa o próprio fator. O
 * segundo fator protege só o LOGIN (AUTH-01D.R1): nenhuma funcionalidade o exige. Nada aqui recebe o
 * identificador de um fator de outra conta: a lista vem da própria sessão e o `unenroll` só aceita
 * fator dela (o Supabase recusa o resto).
 *
 * Desativar pede um código NOVO (`challengeAndVerify` antes do `unenroll`): ver `ComFator`, com o
 * limite que o Supabase impõe a essa garantia.
 *
 * O desafio do segundo fator de LOGIN continua inteiramente em `/mfa` — esta tela só chama
 * `challengeAndVerify` para confirmar um cadastro NOVO ou uma desativação, iniciados aqui mesmo.
 *
 * O enroll só começa quando a pessoa clica em "Ativar": listar fatores ao
 * carregar a tela não cria nada, então só visitar esta página nunca deixa um
 * fator "unverified" órfão na conta.
 */
export function PainelConfiguracoes({ email, papel }: { email: string; papel: PapelEfetivo }) {
  const [fase, setFase] = useState<FaseDeSeguranca>("carregando");
  const [fator, setFator] = useState<FatorVerificado | null>(null);
  const [erroListagem, setErroListagem] = useState("");

  const carregarFatores = useCallback(async () => {
    setFase("carregando");
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.auth.mfa.listFactors();

    if (error || !data) {
      setErroListagem(
        error?.message ?? "Não foi possível consultar o estado da verificação em duas etapas.",
      );
      setFase(faseAposListarFatores(true, false));
      return;
    }

    // listFactors devolve em `totp` apenas os fatores já verificados.
    const verificado = data.totp[0] ?? null;
    setFator(
      verificado ? { id: verificado.id, friendlyName: verificado.friendly_name ?? null } : null,
    );
    setFase(faseAposListarFatores(false, Boolean(verificado)));
  }, []);

  useEffect(() => {
    void carregarFatores();
  }, [carregarFatores]);

  const texto = textoSemFator(papel);

  return (
    <div>
      <PageHeader title="Segurança" description="Verificação em duas etapas desta conta." />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="size-5" />
            Verificação em duas etapas
          </CardTitle>
          <CardDescription>
            Conectado como <span className="font-medium text-foreground">{email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fase === "carregando" && <p className="text-sm text-muted-foreground">Carregando...</p>}

          {fase === "erro" && (
            <div className="space-y-3">
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {erroListagem}
              </p>
              <Button variant="outline" onClick={() => void carregarFatores()}>
                Tentar novamente
              </Button>
            </div>
          )}

          {fase === "com-fator" && fator && (
            <ComFator fator={fator} aoRemover={() => void carregarFatores()} />
          )}

          {fase === "sem-fator" && <SemFator texto={texto} aoAtivar={() => setFase("ativando")} />}

          {fase === "ativando" && (
            <AtivarSegundoFator
              aoConcluir={() => {
                toast.success("Verificação em duas etapas ativada.");
                void carregarFatores();
              }}
              aoCancelar={() => setFase("sem-fator")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Estado "ativo" e a desativação (AUTH-01D.R1), para os dois papéis.
 *
 * Desativar o PRÓPRIO fator é a única ação do sistema que pede um segundo código, e pede o código
 * NOVO: `challengeAndVerify` com o fator que será removido acontece ANTES do `unenroll`, e um código
 * inválido impede a remoção (nada de `unenroll` sem a verificação ter dado certo). A autenticação do
 * login não é reaproveitada.
 *
 * LIMITE REAL DO SUPABASE (não é uma garantia do servidor): o GoTrue só exige sessão AAL2 para
 * remover um fator verificado. Quem tem uma sessão AAL2 e chama a API direto consegue `unenroll`
 * sem este código. A exigência do código novo é imposta por ESTA INTERFACE, não pelo servidor Auth.
 * Ver docs/SEGURANCA.md (risco residual).
 *
 * Perdeu o aplicativo? Sem o código não há como entrar nem remover o fator por esta tela — o
 * procedimento seguro está em docs/SEGURANCA.md e não existe atalho por senha.
 */
function ComFator({ fator, aoRemover }: { fator: FatorVerificado; aoRemover: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [codigo, setCodigo] = useState("");

  function fecharConfirmacao(aberto: boolean) {
    if (removendo) return;
    setConfirmando(aberto);
    if (!aberto) setCodigo("");
  }

  async function desativar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!codigoTotpCompleto(codigo)) return;
    setRemovendo(true);

    const supabase = criarClienteNavegador();

    // 1. Código NOVO, verificado agora contra o fator que será removido.
    const { error: erroVerificacao } = await supabase.auth.mfa.challengeAndVerify({
      factorId: fator.id,
      code: codigo.trim(),
    });

    if (erroVerificacao) {
      // Código inválido: o fator permanece e `unenroll` NÃO é chamado.
      toast.error(mensagemDeCodigoInvalido(erroVerificacao));
      setCodigo("");
      setRemovendo(false);
      return;
    }

    // 2. Só depois da verificação, a remoção.
    const { error: erroUnenroll } = await supabase.auth.mfa.unenroll({ factorId: fator.id });

    if (erroUnenroll) {
      toast.error(erroUnenroll.message);
      setCodigo("");
      setRemovendo(false);
      return;
    }

    setConfirmando(false);
    setCodigo("");

    // A partir daqui o fator já foi removido no servidor — o estado
    // persistente principal já mudou, e nenhuma falha NESTE PONTO EM DIANTE
    // pode voltar a tratar essa remoção como se não tivesse acontecido.
    // refreshSession() só tenta refletir o AAL atualizado o quanto antes;
    // se falhar, quem decide de verdade continua sendo o servidor na
    // próxima requisição.
    const { error: erroRefresh } = await supabase.auth.refreshSession();

    aoRemover();
    setRemovendo(false);

    if (erroRefresh) {
      toast.warning(
        "Verificação em duas etapas removida. Pode ser necessário recarregar a página para atualizar sua sessão.",
      );
      return;
    }

    toast.success("Verificação em duas etapas removida.");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge>Ativo</Badge>
        <span className="text-sm text-muted-foreground">
          {fator.friendlyName ?? "Aplicativo autenticador"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        A verificação em duas etapas protege o seu acesso: todo login pede o código do aplicativo
        autenticador. Para desativá-la, é preciso informar um código atual.
      </p>
      <Button variant="destructive" onClick={() => setConfirmando(true)} disabled={removendo}>
        {removendo ? "Desativando..." : "Desativar autenticação em duas etapas"}
      </Button>

      <AlertDialog open={confirmando} onOpenChange={fecharConfirmacao}>
        <AlertDialogContent>
          <form onSubmit={(e) => void desativar(e)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Desativar verificação em duas etapas</AlertDialogTitle>
              <AlertDialogDescription>
                Sua conta deixa de pedir o código do aplicativo autenticador nos próximos acessos e
                passa a ser protegida só pela senha. Informe um código novo do aplicativo para
                confirmar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="codigo-desativacao">Código de seis dígitos</Label>
              <Input
                id="codigo-desativacao"
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
            <AlertDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => fecharConfirmacao(false)}
                disabled={removendo}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={removendo || !codigoTotpCompleto(codigo)}
              >
                {removendo ? "Verificando..." : "Desativar"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SemFator({ texto, aoAtivar }: { texto: TextoDoEstado; aoAtivar: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">
          <ShieldOff className="mr-1 size-3" />
          Não configurado
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{texto.corpo}</p>
      <Button onClick={aoAtivar}>Ativar autenticação em duas etapas</Button>
    </div>
  );
}

/**
 * O cadastro em si — enroll + confirmação do código, usando exclusivamente a
 * API oficial do MFA do Supabase, com as mesmas cautelas de `/mfa`: fatores
 * "unverified" de tentativas anteriores são removidos antes de criar um novo
 * (evita acumular lixo na conta), e só a confirmação bem-sucedida do código
 * conta como "ativo" — nunca o enroll sozinho.
 */
function AtivarSegundoFator({
  aoConcluir,
  aoCancelar,
}: {
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const [idDoFator, setIdDoFator] = useState("");
  const [qr, setQr] = useState("");
  const [segredo, setSegredo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [preparando, setPreparando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState("");
  const [copiado, setCopiado] = useState(false);

  // enroll cria um fator a cada chamada — sem esta trava, um segundo render
  // (StrictMode) deixaria fatores órfãos na conta.
  const jaPreparou = useRef(false);

  useEffect(() => {
    if (jaPreparou.current) return;
    jaPreparou.current = true;

    void (async () => {
      const supabase = criarClienteNavegador();
      const { data: fatores, error: erroLista } = await supabase.auth.mfa.listFactors();

      if (erroLista || !fatores) {
        setFalha(erroLista?.message ?? "Não foi possível consultar os fatores da conta.");
        setPreparando(false);
        return;
      }

      // Tentativas anteriores não confirmadas ficam como "unverified" e
      // impedem reusar o mesmo nome de fator.
      const pendentes = fatores.all.filter(
        (f) => f.factor_type === "totp" && f.status === "unverified",
      );
      for (const pendente of pendentes) {
        await supabase.auth.mfa.unenroll({ factorId: pendente.id });
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
    })();
  }, []);

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
    // A ativação só conta depois desta chamada dar certo — nada antes dela é
    // considerado "MFA ativo", nem aqui nem em lugar nenhum da tela.
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

    aoConcluir();
  }

  if (preparando) {
    return <p className="text-sm text-muted-foreground">Preparando...</p>;
  }

  if (falha) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {falha}
        </p>
        <Button variant="outline" onClick={aoCancelar}>
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid place-items-center rounded-md border border-border bg-white p-4">
        {/* Vai em <img>, e não inline no HTML: SVG embutido pode carregar
            script, dentro de <img> não executa nada. */}
        <img
          src={fonteDoQrTotp(qr)}
          alt="QR code para cadastrar o segundo fator"
          className="size-44"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="segredo-configuracoes">Não consegue escanear? Use esta chave</Label>
        <p
          id="segredo-configuracoes"
          className="rounded-md border border-border bg-muted/50 p-3 font-mono text-sm break-all select-all"
        >
          {segredo}
        </p>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={copiarChave}>
          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copiado ? "Chave copiada" : "Copiar chave"}
        </Button>
      </div>

      <form onSubmit={confirmar} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="codigo-configuracoes">Código de seis dígitos</Label>
          <Input
            id="codigo-configuracoes"
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
        <div className="flex gap-2">
          <Button
            type="submit"
            className="flex-1"
            disabled={enviando || codigo.length !== 6 || !idDoFator}
          >
            {enviando ? "Verificando..." : "Ativar"}
          </Button>
          <Button type="button" variant="outline" onClick={aoCancelar} disabled={enviando}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
