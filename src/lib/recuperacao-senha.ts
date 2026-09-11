/**
 * Decisões da recuperação de senha, isoladas em funções puras.
 *
 * Mesma razão de `src/lib/mfa.ts`: sem framework de teste no projeto, lógica
 * embutida em Route Handler e em `onSubmit` só é exercitável clicando.
 * Extraída, é verificável por script — e é justamente aqui que moram as
 * decisões de segurança do fluxo.
 *
 * Nenhuma destas funções fala com o Supabase, com a rede ou com o navegador.
 */

/** Rota da tela que pede o e-mail de recuperação. */
export const ROTA_ESQUECI_SENHA = "/esqueci-senha";

/** Rota do formulário de nova senha, fora do layout protegido do painel. */
export const ROTA_REDEFINIR_SENHA = "/redefinir-senha";

/** Rota de entrada. */
export const ROTA_LOGIN = "/login";

/** Marca o retorno de um link já consumido, expirado ou adulterado. */
export const BUSCA_LINK_INVALIDO = "?status=link-invalido";

/** Marca o retorno de quem acabou de trocar a senha com sucesso. */
export const BUSCA_SENHA_REDEFINIDA = "?senha-redefinida=1";

/**
 * Destino final do fluxo, já montado.
 *
 * Literal em vez de concatenação porque `typedRoutes` do Next valida rota em
 * tempo de compilação, e um template string vira `string` e perde a checagem.
 */
export const ROTA_LOGIN_SENHA_REDEFINIDA = "/login?senha-redefinida=1";

/**
 * Resposta pública da solicitação.
 *
 * Deliberadamente igual para conta existente e inexistente: a tela não pode
 * virar um oráculo que diz quem tem acesso ao painel.
 */
export const MENSAGEM_SOLICITACAO_ENVIADA =
  "Se existir uma conta associada a este e-mail, você receberá as instruções para redefinir sua senha.";

/** Indisponibilidade real (rede, SMTP, limite). Não fala de contas. */
export const MENSAGEM_FALHA_GENERICA =
  "Não foi possível processar a solicitação agora. Tente novamente em alguns instantes.";

export const MENSAGEM_LINK_INVALIDO =
  "Este link de recuperação é inválido ou expirou. Solicite um novo link.";

export const MENSAGEM_SENHA_REDEFINIDA =
  "Senha redefinida com sucesso. Entre novamente para continuar.";

export const MENSAGEM_SENHAS_DIFERENTES = "As duas senhas precisam ser iguais.";

export const MENSAGEM_SENHA_VAZIA = "Informe a nova senha.";

export const MENSAGEM_SENHA_FRACA =
  "A senha não atende aos requisitos mínimos de segurança. Escolha uma senha mais forte.";

export const MENSAGEM_SENHA_REPETIDA = "A nova senha precisa ser diferente da senha atual.";

export const MENSAGEM_FALHA_AO_TROCAR =
  "Não foi possível redefinir a senha agora. Solicite um novo link e tente novamente.";

/* ------------------------------------------------------------------ */
/* Confirmação do link                                                 */
/* ------------------------------------------------------------------ */

export interface ParametrosDeConfirmacao {
  tokenHash: string | null | undefined;
  type: string | null | undefined;
}

export type DecisaoDeConfirmacao = "verificar" | "recusar";

/**
 * O que fazer com os parâmetros que chegaram em /auth/confirm.
 *
 * Só `type=recovery` passa. Esta etapa não trata convite, troca de e-mail nem
 * magic link: aceitar outros tipos aqui abriria caminhos de autenticação que
 * ninguém revisou, e o `verifyOtp` criaria sessão do mesmo jeito.
 *
 * Token vazio ou só espaços é recusado antes de virar chamada de rede.
 */
export function decidirConfirmacao({
  tokenHash,
  type,
}: ParametrosDeConfirmacao): DecisaoDeConfirmacao {
  if (typeof tokenHash !== "string" || tokenHash.trim() === "") return "recusar";
  if (type !== "recovery") return "recusar";
  return "verificar";
}

export interface DestinoDeConfirmacao {
  pathname: string;
  search: string;
}

/**
 * Para onde /auth/confirm manda o navegador.
 *
 * O destino é constante nos dois casos. Nada vem da query da requisição, então
 * não existe `next` para apontar para fora do domínio — a rota não tem como
 * virar open redirect nem com a URL adulterada.
 *
 * `search` volta vazio no sucesso: é o que tira `token_hash` e `type` da barra
 * de endereços, do histórico do navegador e do cabeçalho Referer.
 */
export function montarDestinoConfirmacao(resultado: "ok" | "falha"): DestinoDeConfirmacao {
  return resultado === "ok"
    ? { pathname: ROTA_REDEFINIR_SENHA, search: "" }
    : { pathname: ROTA_ESQUECI_SENHA, search: BUSCA_LINK_INVALIDO };
}

/* ------------------------------------------------------------------ */
/* Solicitação do e-mail                                               */
/* ------------------------------------------------------------------ */

export type RespostaDaSolicitacao = "generica" | "falha-temporaria";

/**
 * O que a tela mostra depois de pedir o e-mail de recuperação.
 *
 * Regra: qualquer resultado que possa depender da existência da conta vira a
 * mesma mensagem genérica. Só indisponibilidade evidente — limite de envio,
 * erro do servidor — ganha a mensagem de "tente de novo", e mesmo essa não
 * menciona conta nenhuma.
 *
 * Um 400 do GoTrue (e-mail malformado, por exemplo) cai no genérico de
 * propósito: é melhor o usuário reenviar do que a tela confirmar, por
 * diferença de mensagem, que aquele endereço não serve.
 *
 * Erro sem status HTTP é caso à parte e NÃO entra no genérico — ver o
 * comentário no corpo da função.
 */
export function decidirRespostaDaSolicitacao(
  erro: { status?: number | undefined } | null | undefined,
): RespostaDaSolicitacao {
  if (!erro) return "generica";

  const status = erro.status;

  // Sem status positivo não houve resposta HTTP: navegador offline, DNS, CORS,
  // transporte interrompido. A requisição pode nem ter chegado ao Supabase, e
  // dizer "você receberá as instruções" seria mentira. Como o servidor não
  // respondeu, também não há nada a vazar sobre a conta — esta classificação
  // não enfraquece a anti-enumeração.
  if (typeof status !== "number" || status <= 0) return "falha-temporaria";

  if (status === 429 || status >= 500) return "falha-temporaria";

  // Os 4xx com resposta real continuam mascarados.
  return "generica";
}

/* ------------------------------------------------------------------ */
/* Acesso ao formulário de nova senha                                  */
/* ------------------------------------------------------------------ */

/**
 * O único método de autenticação que abre o formulário de nova senha.
 *
 * Allowlist, não denylist. Uma regra por exclusão ("nega password, permite o
 * resto") deixaria passar qualquer método futuro ou desconhecido, o que não é
 * o requisito: só sessão nascida de recuperação de senha pode entrar aqui.
 *
 * `recovery` não aparece no array literal `AMRMethods` de @supabase/auth-js,
 * mas isso não o torna inválido — o tipo é `(typeof AMRMethods)[number] |
 * (string & {})`, aberto de propósito, e o Supabase Auth reconhece `recovery`
 * como authentication method. A ausência na lista do TypeScript não é
 * argumento para afrouxar a regra.
 */
export const METODO_DE_RECUPERACAO = "recovery";

/**
 * Achata o claim `amr` para uma lista simples de métodos.
 *
 * O claim vem em dois formatos: `AMREntry[]` (`{ method, timestamp }`) ou
 * `string[]` no formato RFC-8176. O tipo do SDK declara os dois, então tratar
 * só um deles deixaria a verificação cega metade das vezes.
 *
 * A normalização apara espaços e baixa a caixa. Isso tolera variação de
 * formatação sem criar permissividade: o `amr` vem dentro de um JWT assinado e
 * já verificado, então ninguém de fora escolhe esse valor — e como a comparação
 * é por igualdade com um único literal, aparar `" recovery "` ou baixar
 * `"RECOVERY"` não tem como deixar `password` passar.
 *
 * Entrada inesperada vira lista vazia, que o `decidirAcessoRedefinicao` nega.
 */
export function normalizarAmr(amr: unknown): string[] {
  if (!Array.isArray(amr)) return [];

  return amr
    .map((entrada) => {
      if (typeof entrada === "string") return entrada;
      if (entrada && typeof entrada === "object" && "method" in entrada) {
        const metodo = (entrada as { method: unknown }).method;
        return typeof metodo === "string" ? metodo : null;
      }
      return null;
    })
    .filter((metodo): metodo is string => metodo !== null)
    .map((metodo) => metodo.trim().toLowerCase())
    .filter((metodo) => metodo !== "");
}

export type AcessoARedefinicao = "permitir" | "negar";

/**
 * Quem pode abrir o formulário de nova senha.
 *
 * O problema que isto resolve: exigir apenas "existe usuário autenticado" é
 * fraco demais. Uma sessão comum de `signInWithPassword`, mesmo em aal1,
 * também é autenticada — e `updateUser({ password })` aceitaria a troca. A
 * página precisa aceitar SOMENTE sessão nascida do link de recuperação.
 *
 * A regra é uma allowlist de um item só: o AMR precisa conter, explicitamente,
 * `recovery`. Tudo o mais nega — `password`, `password`+`totp`, `otp`,
 * `magiclink`, `email`, `invite`, `signup`, `oauth`, `sso`, `anonymous`,
 * `token_refresh` e qualquer método desconhecido ou futuro. Claim ausente,
 * vazio ou malformado também nega.
 *
 * A exigência é de PRESENÇA, não de exclusividade: `recovery` acompanhado de
 * outro método ainda passa. Só entra `recovery` no AMR quem consumiu um token
 * válido enviado ao e-mail da conta, e essa prova de posse não é anulada pelo
 * que mais estiver na lista. O ataque que este guard fecha é a sessão comum
 * SEM recovery — essa é negada em qualquer combinação.
 *
 * Isso vale inclusive depois de um refresh de token: o guard continua
 * procurando a mesma evidência. Se um refresh real remover essa evidência, o
 * acesso fecha — e o teste ponta a ponta expõe o problema, em vez de a regra
 * ser afrouxada para "qualquer coisa que não seja password".
 *
 * NÃO se exige aal2 aqui de propósito. Sessão de recuperação é naturalmente
 * aal1, e pedir segundo fator travaria justamente quem precisa recuperar. O
 * painel continua exigindo aal2 no seu próprio guard, que não foi tocado.
 */
export function decidirAcessoRedefinicao({
  temUsuario,
  amr,
}: {
  temUsuario: boolean;
  amr: unknown;
}): AcessoARedefinicao {
  if (!temUsuario) return "negar";

  const metodos = normalizarAmr(amr);
  const possuiRecovery = metodos.some((metodo) => metodo === METODO_DE_RECUPERACAO);

  return possuiRecovery ? "permitir" : "negar";
}

/* ------------------------------------------------------------------ */
/* Nova senha                                                          */
/* ------------------------------------------------------------------ */

export type ValidacaoDeSenha = { valida: true } | { valida: false; mensagem: string };

/**
 * Checagem local do formulário, antes de gastar uma ida ao servidor.
 *
 * De propósito não replica a política de força do Supabase. O projeto não
 * conhece a política configurada no Dashboard, e adivinhar aqui criaria uma
 * segunda regra divergente da real — ou recusando senha que o servidor
 * aceitaria, ou dando falsa aprovação. Quem decide força é o Supabase; esta
 * função só cobre o que o servidor não tem como saber: se o usuário digitou
 * a mesma coisa duas vezes.
 */
export function validarNovaSenha(senha: string, confirmacao: string): ValidacaoDeSenha {
  if (senha === "") return { valida: false, mensagem: MENSAGEM_SENHA_VAZIA };
  if (senha !== confirmacao) return { valida: false, mensagem: MENSAGEM_SENHAS_DIFERENTES };
  return { valida: true };
}

/**
 * Traduz o código de erro do GoTrue para texto de tela.
 *
 * Existe para que nenhuma `error.message` crua do SDK chegue ao usuário. O
 * código é estável e documentado; a mensagem é texto livre do servidor, em
 * inglês, e às vezes carrega detalhe de implementação.
 *
 * Qualquer código desconhecido cai na mensagem genérica — fail-closed também
 * na comunicação.
 */
export function traduzirErroDeSenha(codigo: string | null | undefined): string {
  if (codigo === "weak_password") return MENSAGEM_SENHA_FRACA;
  if (codigo === "same_password") return MENSAGEM_SENHA_REPETIDA;
  return MENSAGEM_FALHA_AO_TROCAR;
}
