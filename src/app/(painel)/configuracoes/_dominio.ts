/**
 * As decisões da tela de Configurações → Segurança — PR F.
 *
 * Função pura, sem React, sem Supabase, no mesmo molde de todo `_dominio.ts`
 * do projeto. A tela sabe só duas coisas de fora — se há um fator TOTP
 * verificado, e o papel de quem está olhando — e é daqui que saem o texto e a
 * fase certos. Nenhuma decisão de AUTORIZAÇÃO mora aqui: quem decide se a
 * conta chega até esta tela é `lerAcesso()`/`decidirAcesso()`, em
 * `src/lib/mfa.ts` e `_autorizacao.ts` — este módulo nunca reimplementa isso.
 */

import type { PapelEfetivo } from "../_papel";

/**
 * Em que ponto do fluxo a tela está.
 *
 * "erro" e "sem-fator"/"com-fator" não podem se confundir pelo mesmo motivo de
 * sempre neste projeto: uma falha ao listar fatores não é "conta sem MFA", é
 * "não sei". Tratar como sem-fator ofereceria "ativar" sobre uma conta que já
 * pode ter um fator verificado, e cadastrar por engano trava a conta.
 */
export type FaseDeSeguranca = "carregando" | "erro" | "sem-fator" | "ativando" | "com-fator";

export function faseAposListarFatores(erro: boolean, temFatorVerificado: boolean): FaseDeSeguranca {
  if (erro) return "erro";
  return temFatorVerificado ? "com-fator" : "sem-fator";
}

/** Só `admin` e `operacional` têm o que ver aqui — `sem-papel` nunca deveria
 * chegar a esta tela (o layout já intercepta antes), mas a função existe para
 * a página fechar por conta própria em vez de confiar na ordem de renderização,
 * no mesmo espírito de `exigirAdmin()`/`exigirOperacional()`. */
export const papelTemAcessoAConfiguracoes = (papel: PapelEfetivo): boolean => papel !== "sem-papel";

export interface TextoDoEstado {
  titulo: string;
  corpo: string;
}

/**
 * O texto de ausência de fator é o mesmo para os dois papéis (AUTH-01D.R1): o segundo fator protege só
 * o login e a própria conta, e nenhuma funcionalidade o exige. Ativá-lo é uma recomendação, sobretudo
 * para administradores: sem ele a conta fica protegida apenas pela senha.
 */
export function textoSemFator(papel: PapelEfetivo): TextoDoEstado {
  if (papel === "admin") {
    return {
      titulo: "Verificação em duas etapas não configurada",
      corpo:
        "É opcional e nenhuma função do sistema depende dela. Sem ela, sua conta fica protegida apenas pela senha; recomendamos ativar. Depois de ativar, todo login passa a pedir o código do seu aplicativo autenticador.",
    };
  }
  return {
    titulo: "Verificação em duas etapas não configurada",
    corpo:
      "É opcional: você pode continuar usando o sistema sem ativar. Se ativar, todo login passa a pedir o código do seu aplicativo autenticador.",
  };
}

/** O código TOTP tem exatamente seis dígitos; qualquer outra coisa nem chega ao Supabase. */
export function codigoTotpCompleto(codigo: string): boolean {
  return /^[0-9]{6}$/.test(codigo.trim());
}

/** Código recusado pelo Supabase vira texto claro; outros erros mantêm a mensagem original. */
export function mensagemDeCodigoInvalido(erro: {
  code?: string | undefined;
  message: string;
}): string {
  return erro.code === "mfa_verification_failed"
    ? "Código inválido. Confira o aplicativo autenticador e tente novamente."
    : erro.message;
}

/** O fator só é gerenciado pelo próprio titular: nada aqui recebe um identificador de outra conta. */
export const NOME_DO_FATOR = "BS Soluções Logísticas";
