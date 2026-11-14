/**
 * Mensagens da tela de login. Nenhuma `error.message` crua do SDK/GoTrue chega ao usuário (mesma
 * regra de `traduzirErroDeSenha`, em recuperacao-senha.ts): o texto do provedor é em inglês e
 * pode mudar entre versões.
 *
 * CONTA REVOGADA (user_banned) RECEBE A MESMA MENSAGEM DA SENHA ERRADA
 *
 * O GoTrue confere o banimento ANTES da senha: qualquer senha devolve `user_banned` para uma conta
 * revogada (comprovado no E2E local do CP-01). Uma mensagem própria para esse caso diria a quem
 * tenta adivinhar que o e-mail existe e foi revogado. Por isso as duas recusas têm um único texto,
 * que também orienta quem teve o acesso revogado a procurar o administrador. E-mail inexistente
 * já chega como `invalid_credentials`, o mesmo código da senha errada.
 *
 * Arquivo sem import de `@/`: o teste Node o importa direto.
 */

export const MENSAGEM_LOGIN_RECUSADO =
  "E-mail ou senha incorretos, ou acesso não liberado. Se o problema continuar, fale com o administrador.";

export const MENSAGEM_LOGIN_EMAIL_NAO_CONFIRMADO =
  "Este e-mail ainda não foi confirmado. Use o link recebido por e-mail ou fale com o administrador.";

export const MENSAGEM_LOGIN_MUITAS_TENTATIVAS =
  "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";

export const MENSAGEM_LOGIN_FALHA = "Não foi possível entrar agora. Tente novamente em instantes.";

export interface ErroDeLogin {
  code?: string | undefined;
  status?: number | undefined;
}

export function mensagemDeErroDeLogin(erro: ErroDeLogin): string {
  switch (erro.code) {
    case "invalid_credentials":
    case "user_banned":
      return MENSAGEM_LOGIN_RECUSADO;
    case "email_not_confirmed":
      return MENSAGEM_LOGIN_EMAIL_NAO_CONFIRMADO;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return MENSAGEM_LOGIN_MUITAS_TENTATIVAS;
    default:
      return erro.status === 429 ? MENSAGEM_LOGIN_MUITAS_TENTATIVAS : MENSAGEM_LOGIN_FALHA;
  }
}
