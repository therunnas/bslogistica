/**
 * As decisões da tela de usuários, separadas da tela.
 *
 * Mesma separação de `operacional/_dominio.ts`: função pura, sem React, sem
 * rede, sem cliente do Supabase — o que permite exercitar cada desfecho do
 * backend do PR D (`ResultadoConvite`, `ResultadoAlteracaoDePapel`,
 * `ResultadoRevogacaoDeAcesso`, `ResultadoReativacao`,
 * `ResultadoAtribuicaoDeOperacao`, `ResultadoRemocaoDeOperacao`) em Node puro.
 *
 * Nenhuma decisão de AUTORIZAÇÃO mora aqui — isso é o backend, em
 * `src/lib/admin-usuarios/` e `_acoes.ts`. Este módulo só traduz o que o
 * backend já decidiu em algo que a tela consegue mostrar.
 */

import type {
  Papel,
  ResultadoAlteracaoDePapel,
  ResultadoAtribuicaoDeOperacao,
  ResultadoConvite,
  ResultadoReativacao,
  ResultadoRemocaoDeOperacao,
  ResultadoRevogacaoDeAcesso,
  UsuarioAdministrativo,
} from "@/lib/admin-usuarios/tipos";

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  operacional: "Operacional",
};

export type SituacaoDoUsuario = "sem-papel" | "banido" | "ativo";

/**
 * Banimento tem prioridade sobre papel: uma conta revogada por completo perde
 * os papéis, mas o que a interface precisa comunicar primeiro é que a conta
 * não consegue logar — não que ela ficou "sem papel", que soa como um estado
 * a corrigir com um clique, e não como o resultado de uma revogação.
 */
export function situacaoDoUsuario(usuario: UsuarioAdministrativo): SituacaoDoUsuario {
  if (usuario.banido) return "banido";
  if (usuario.papeis.length === 0) return "sem-papel";
  return "ativo";
}

/**
 * Fase da listagem principal, no mesmo molde de `faseDaTela` da tela
 * operacional: "sem dados" tem três causas que não podem se confundir —
 * ainda não chegou, falhou, ou chegou vazio.
 */
export type FaseDaListagem = "carregando" | "erro" | "vazio" | "pronto";

export function faseDaListagem(usuarios: {
  pendente: boolean;
  erro: boolean;
  quantidade: number | undefined;
}): FaseDaListagem {
  if (usuarios.erro) return "erro";
  if (usuarios.pendente || usuarios.quantidade === undefined) return "carregando";
  if (usuarios.quantidade === 0) return "vazio";
  return "pronto";
}

/**
 * O que qualquer ação desta tela devolve para o usuário ver.
 *
 * `tipo` tem três valores, não dois, de propósito: "parcial" não é "erro" —
 * algo persistente já mudou no servidor — e não é "sucesso" — a ação não
 * terminou o que prometeu. Tratar como qualquer um dos dois mascararia a
 * situação real da conta. Ver a nota em `servico.ts` sobre por que
 * `revogarAcesso`/`reativarUsuario` devolvem "parcial".
 */
export interface Feedback {
  tipo: "sucesso" | "parcial" | "erro";
  texto: string;
}

export function feedbackDoConvite(resultado: ResultadoConvite): Feedback {
  if (resultado.situacao === "convidado") {
    return { tipo: "sucesso", texto: "Convite enviado." };
  }
  return { tipo: "erro", texto: resultado.mensagem };
}

export function feedbackDaAlteracaoDePapel(resultado: ResultadoAlteracaoDePapel): Feedback {
  switch (resultado.situacao) {
    case "concedido":
      return { tipo: "sucesso", texto: "Papel concedido." };
    case "revogado":
      return { tipo: "sucesso", texto: "Papel revogado." };
    case "ultimo-admin":
      return { tipo: "erro", texto: resultado.mensagem };
    case "erro":
      return { tipo: "erro", texto: resultado.mensagem };
  }
}

export function feedbackDaRevogacaoDeAcesso(resultado: ResultadoRevogacaoDeAcesso): Feedback {
  switch (resultado.situacao) {
    case "revogado":
      return { tipo: "sucesso", texto: "Acesso revogado." };
    case "ultimo-admin":
      return { tipo: "erro", texto: resultado.mensagem };
    case "parcial":
      return { tipo: "parcial", texto: resultado.mensagem };
    case "erro":
      return { tipo: "erro", texto: resultado.mensagem };
  }
}

export function feedbackDaReativacao(resultado: ResultadoReativacao): Feedback {
  switch (resultado.situacao) {
    case "reativado":
      return { tipo: "sucesso", texto: "Acesso reativado." };
    case "parcial":
      return { tipo: "parcial", texto: resultado.mensagem };
    case "erro":
      return { tipo: "erro", texto: resultado.mensagem };
  }
}

export function feedbackDaAtribuicaoDeOperacao(resultado: ResultadoAtribuicaoDeOperacao): Feedback {
  if (resultado.situacao === "atribuida") {
    return { tipo: "sucesso", texto: "Operação atribuída." };
  }
  return { tipo: "erro", texto: resultado.mensagem };
}

export function feedbackDaRemocaoDeOperacao(resultado: ResultadoRemocaoDeOperacao): Feedback {
  if (resultado.situacao === "removida") {
    return { tipo: "sucesso", texto: "Operação removida." };
  }
  return { tipo: "erro", texto: resultado.mensagem };
}

/** A ação só termina de fato quando o feedback não é "parcial": aí sim o
 * fluxo pode ser dado como concluído (por exemplo, fechar um diálogo). Um
 * resultado parcial mantém a tela aberta, porque a ação não fez tudo o que
 * prometeu. */
export const concluiuPorCompleto = (feedback: Feedback): boolean => feedback.tipo === "sucesso";
