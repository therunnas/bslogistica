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

/**
 * Segundo fator dentro da recuperação, quando a conta tem TOTP verificado.
 *
 * Fica **sob** `/redefinir-senha` de propósito: o cookie `bs_recovery_proof` é
 * emitido com `Path=/redefinir-senha`, e pela RFC 6265 §5.1.4 esse path cobre a
 * subárvore. Uma rota irmã como `/auth/mfa-recuperacao` não receberia a prova —
 * e a alternativa, ampliar o cookie para `Path=/`, entregaria a prova a toda a
 * aplicação para resolver um problema de roteamento.
 */
export const ROTA_REDEFINIR_SENHA_MFA = "/redefinir-senha/mfa";

/** Rota de entrada. */
export const ROTA_LOGIN = "/login";

/**
 * Tela intermediária que pede a confirmação deliberada antes de consumir o
 * token de recuperação.
 *
 * Existe por causa de um achado de revisão: o token de uso único era consumido
 * no próprio GET do link, então um scanner de gateway de e-mail — Safe Links,
 * Proofpoint, Mimecast — gastava o token na varredura automática e o clique
 * real do usuário chegava a um link já inválido. GET não pode mutar estado.
 */
export const ROTA_CONFIRMAR_RECUPERACAO = "/auth/confirmar-recuperacao";

/**
 * Cookie que carrega o `token_hash` entre o GET do link e a confirmação.
 *
 * Cookie, e não campo escondido do formulário: assim o token nunca entra no
 * HTML da página, não fica alcançável por extensão de navegador e não aparece
 * no `FormData`. `httpOnly` mantém o JavaScript da página fora disso.
 */
export const NOME_DO_COOKIE_PENDENTE = "bs_recovery_pending";

/**
 * Validade do cookie intermediário: 5 minutos.
 *
 * Menor que a da prova (10 min) de propósito — é só o tempo de ler uma frase e
 * clicar em um botão. Se expirar, o link do e-mail continua válido, porque
 * ainda não foi consumido; basta abri-lo de novo.
 */
export const VALIDADE_DO_PENDENTE_EM_SEGUNDOS = 300;

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
 * Nome do parâmetro que marca o desfecho parcial da redefinição.
 *
 * Lido em dois lugares do login: para escolher a mensagem do card e para
 * suspender o redirecionamento automático de quem já tem sessão.
 */
export const PARAM_SESSOES_ATIVAS = "sessoes-ativas";

/**
 * Destino do desfecho parcial: senha trocada, sessões não encerradas.
 *
 * Separado do sucesso normal de propósito. Carrega `senha-redefinida=1`, porque
 * a senha realmente mudou, e acrescenta `sessoes-ativas=1`, que é o que muda a
 * mensagem e impede o auto-redirect para o painel — sem isso, a sessão residual
 * que sobreviveu ao `signOut` mandaria o usuário direto ao /dashboard, e ele
 * nunca leria o aviso nem entraria com a senha nova.
 *
 * Literal pelo mesmo motivo das outras rotas com query: concatenar perderia a
 * checagem do `typedRoutes`.
 */
export const ROTA_LOGIN_SESSOES_ATIVAS = "/login?senha-redefinida=1&sessoes-ativas=1";

/**
 * Retorno de link inválido, já montado.
 *
 * Literal pelo mesmo motivo de `ROTA_LOGIN_SENHA_REDEFINIDA`: concatenar
 * `ROTA_ESQUECI_SENHA` com `BUSCA_LINK_INVALIDO` produziria `string` e perderia
 * a checagem de rota do `typedRoutes`.
 */
export const ROTA_ESQUECI_SENHA_LINK_INVALIDO = "/esqueci-senha?status=link-invalido";

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

/** Título da tela de segundo fator dentro da recuperação. */
export const TITULO_MFA_RECUPERACAO = "Confirme o segundo fator";

/** Texto da tela de segundo fator. Não menciona conta, e-mail nem fator. */
export const MENSAGEM_MFA_RECUPERACAO =
  "Sua conta tem verificação em duas etapas. Informe o código do aplicativo autenticador para definir a nova senha.";

/** Falha do código informado. Não distingue código errado de código expirado. */
export const MENSAGEM_MFA_RECUPERACAO_INVALIDA =
  "Código inválido. Confira o aplicativo autenticador e tente novamente.";

/**
 * Falha ao consultar o segundo fator.
 *
 * Mensagem própria porque não saber se há fator não é o mesmo que não haver —
 * e prosseguir levaria o usuário a um erro sem explicação na troca da senha.
 */
export const MENSAGEM_MFA_INDISPONIVEL =
  "Não foi possível verificar a segunda etapa agora. Tente novamente em alguns instantes.";

/**
 * O envio chegou sem o segundo fator satisfeito.
 *
 * Acontece quando a sessão perde o aal2 entre abrir o formulário e enviá-lo.
 * A tela manda o usuário de volta ao desafio em vez de deixá-lo colher o 401.
 */
export const MENSAGEM_MFA_EXIGIDO =
  "Confirme a verificação em duas etapas antes de definir a nova senha.";

/** Título da tela intermediária de confirmação. */
export const TITULO_CONFIRMAR_RECUPERACAO = "Redefinir sua senha";

/** Texto da tela intermediária. Não menciona conta, e-mail nem token. */
export const MENSAGEM_CONFIRMAR_RECUPERACAO =
  "Para continuar com a redefinição da senha, confirme abaixo.";

/** Rótulo do único botão da tela intermediária. */
export const ROTULO_CONFIRMAR_RECUPERACAO = "Continuar";

export const MENSAGEM_SENHA_REDEFINIDA =
  "Senha redefinida com sucesso. Entre novamente para continuar.";

export const MENSAGEM_SENHAS_DIFERENTES = "As duas senhas precisam ser iguais.";

export const MENSAGEM_SENHA_VAZIA = "Informe a nova senha.";

export const MENSAGEM_SENHA_FRACA =
  "A senha não atende aos requisitos mínimos de segurança. Escolha uma senha mais forte.";

export const MENSAGEM_SENHA_REPETIDA = "A nova senha precisa ser diferente da senha atual.";

/**
 * Desfecho parcial: a senha mudou, mas o `signOut` global não respondeu.
 *
 * Não pode reusar `MENSAGEM_FALHA_AO_TROCAR`. Dizer "não foi possível redefinir
 * a senha" seria mentira num caminho em que o `updateUser` já teve sucesso — e
 * mandaria o usuário tentar de novo com a mesma senha, recebendo
 * `same_password` sem entender por quê.
 *
 * Aparece no card do login, e não em toast: um toast some em segundos e deixava
 * o usuário sem explicação nem saída, que foi o achado da rodada anterior.
 */
export const MENSAGEM_SENHA_ALTERADA_SESSOES_ATIVAS =
  "Senha alterada com sucesso. Não foi possível encerrar todas as sessões abertas. Entre novamente com sua nova senha.";

export const MENSAGEM_FALHA_AO_TROCAR =
  "Não foi possível redefinir a senha agora. Solicite um novo link e tente novamente.";

export const MENSAGEM_RECUPERACAO_INVALIDA =
  "Seu link de recuperação expirou ou não é mais válido. Solicite um novo link.";

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
  // dizer "você receberá as instruções" seria mentira. Falha de transporte não
  // depende da existência da conta, então este é o único caso que pode ter
  // mensagem própria sem virar oráculo.
  if (typeof status !== "number" || status <= 0) return "falha-temporaria";

  // QUALQUER resposta HTTP vira a mensagem genérica — 429 e 5xx inclusive.
  //
  // O motivo é sutil e custou um achado de revisão: o /recover mascara conta
  // inexistente com resposta de sucesso, mas conta EXISTENTE entra no caminho
  // de envio e é lá que aparecem o cooldown por usuário (429) e a falha de
  // SMTP (5xx). Ou seja, esses status só ocorrem para quem tem conta. Dar a
  // eles um texto diferente transformaria o formulário num oráculo: bastaria
  // reenviar o mesmo endereço e observar se a mensagem muda.
  return "generica";
}

/* ------------------------------------------------------------------ */
/* Acesso ao formulário de nova senha                                  */
/* ------------------------------------------------------------------ */

export type AcessoARedefinicao = "permitir" | "negar";

/**
 * Quem pode abrir o formulário de nova senha.
 *
 * O problema que isto resolve: exigir apenas "existe usuário autenticado" é
 * fraco demais. Uma sessão comum de `signInWithPassword`, mesmo em aal1,
 * também é autenticada — e `updateUser({ password })` aceitaria a troca.
 *
 * A identificação NÃO usa o AMR. A regra anterior exigia `recovery` ali e
 * estava errada: o `verifyOtp({ type: "recovery" })` cria a sessão como
 * `models.OTP`, então `recovery` nunca aparece no AMR. Aceitar `otp` no lugar
 * também não serve, porque `otp` não identifica recuperação de senha com
 * exclusividade. Quem prova a origem agora é a prova assinada emitida em
 * /auth/confirm — ver `lib/prova-recuperacao.ts`.
 *
 * As três condições valem juntas: usuário validado contra o servidor, claims
 * verificados do JWT e prova íntegra, no prazo e amarrada a essa sessão.
 * Qualquer falha nega.
 *
 * NÃO se exige aal2 aqui de propósito. Sessão de recuperação é naturalmente
 * aal1, e pedir segundo fator travaria justamente quem precisa recuperar. O
 * painel continua exigindo aal2 no seu próprio guard, que não foi tocado.
 */
export function decidirAcessoRedefinicao({
  temUsuario,
  temClaims,
  resultadoDaProva,
}: {
  temUsuario: boolean;
  temClaims: boolean;
  resultadoDaProva: string;
}): AcessoARedefinicao {
  if (!temUsuario) return "negar";
  if (!temClaims) return "negar";
  return resultadoDaProva === "valida" ? "permitir" : "negar";
}

export type DecisaoDeTroca = "prosseguir" | "recuperacao-invalida" | "senha-invalida";

/**
 * Se a troca de senha pode acontecer, decidida no instante do envio.
 *
 * Por que existe separado do `decidirAcessoRedefinicao`: aquele responde se a
 * página pode ser RENDERIZADA; este responde se a senha pode ser TROCADA. São
 * dois momentos, e tratá-los como um só era o defeito apontado na revisão —
 * a prova vale 10 minutos, mas se a única checagem fosse na renderização, o
 * formulário aberto continuaria trocando a senha depois de a prova expirar.
 *
 * A autorização vem antes da validação de formato: enquanto a recuperação não
 * estiver provada, nem se olha para o que foi digitado.
 */
export function decidirTrocaDeSenha({
  temUsuario,
  temClaims,
  resultadoDaProva,
  senhaValida,
}: {
  temUsuario: boolean;
  temClaims: boolean;
  resultadoDaProva: string;
  senhaValida: boolean;
}): DecisaoDeTroca {
  if (!temUsuario) return "recuperacao-invalida";
  if (!temClaims) return "recuperacao-invalida";
  if (resultadoDaProva !== "valida") return "recuperacao-invalida";
  if (!senhaValida) return "senha-invalida";
  return "prosseguir";
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
