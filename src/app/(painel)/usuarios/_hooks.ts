"use client";

/**
 * Hooks de leitura e escrita da tela de usuários — camada fina sobre as
 * Server Actions de `_acoes.ts`.
 *
 * Nenhum hook aqui fala com Supabase diretamente: quem faz isso é o backend
 * do PR D, do outro lado da Server Action. É o que garante que a tela nunca
 * precisa de `service_role`, nunca chama a Admin API, e nunca decide
 * autorização — ela só invoca a ação e reage ao `Resultado*` que volta.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  alterarPapelAction,
  atribuirOperacaoAction,
  convidarUsuarioAction,
  listarOperacoesAtribuidasAction,
  listarOperacoesDisponiveisAction,
  listarUsuariosAction,
  reativarUsuarioAction,
  removerOperacaoAction,
  revogarAcessoAction,
} from "./_acoes";

const CHAVES = {
  usuarios: () => ["usuarios-admin"] as const,
  operacoes: (userId: string | null) => ["usuarios-admin", "operacoes", userId] as const,
  operacoesDisponiveis: () => ["usuarios-admin", "operacoes-disponiveis"] as const,
};

export function useUsuarios() {
  return useQuery({
    queryKey: CHAVES.usuarios(),
    queryFn: () => listarUsuariosAction(),
  });
}

export function useOperacoesDoUsuario(userId: string | null) {
  return useQuery({
    queryKey: CHAVES.operacoes(userId),
    queryFn: () => listarOperacoesAtribuidasAction({ userId }),
    enabled: userId !== null,
  });
}

/**
 * Todas as operações existentes, para o picker de atribuição.
 *
 * Via Server Action (`listarOperacoesDisponiveisAction`), NÃO pelo
 * `useOperations()` de `@/lib/queries` — aquele hook lê `operations` direto do
 * navegador com `criarClienteNavegador()`, e o contrato desta tela é consumir
 * só a camada administrativa do PR D/PR E, nunca uma tabela de negócio pelo
 * cliente.
 */
export function useOperacoesDisponiveis() {
  return useQuery({
    queryKey: CHAVES.operacoesDisponiveis(),
    queryFn: () => listarOperacoesDisponiveisAction(),
  });
}

export function useConvidarUsuario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { email: unknown; papel: unknown; nomeCompleto?: unknown }) =>
      convidarUsuarioAction(entrada),
    onSuccess: (resultado) => {
      if (resultado.situacao === "convidado") {
        void queryClient.invalidateQueries({ queryKey: CHAVES.usuarios() });
      }
    },
  });
}

export function useAlterarPapel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { userId: unknown; papel: unknown; acao: unknown }) =>
      alterarPapelAction(entrada),
    onSuccess: (resultado) => {
      if (resultado.situacao === "concedido" || resultado.situacao === "revogado") {
        void queryClient.invalidateQueries({ queryKey: CHAVES.usuarios() });
      }
    },
  });
}

export function useRevogarAcesso() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { userId: unknown }) => revogarAcessoAction(entrada),
    onSuccess: (resultado, entrada) => {
      // "parcial" também muda estado persistente (o papel já saiu) — a
      // listagem precisa refletir isso tanto quanto no caminho "revogado".
      if (resultado.situacao === "revogado" || resultado.situacao === "parcial") {
        void queryClient.invalidateQueries({ queryKey: CHAVES.usuarios() });
        const userId = typeof entrada.userId === "string" ? entrada.userId : null;
        void queryClient.invalidateQueries({ queryKey: CHAVES.operacoes(userId) });
      }
    },
  });
}

export function useReativarUsuario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { userId: unknown; papel: unknown }) => reativarUsuarioAction(entrada),
    onSuccess: (resultado) => {
      if (resultado.situacao === "reativado" || resultado.situacao === "parcial") {
        void queryClient.invalidateQueries({ queryKey: CHAVES.usuarios() });
      }
    },
  });
}

export function useAtribuirOperacao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { userId: unknown; operationId: unknown }) =>
      atribuirOperacaoAction(entrada),
    onSuccess: (resultado, entrada) => {
      if (resultado.situacao === "atribuida") {
        const userId = typeof entrada.userId === "string" ? entrada.userId : null;
        void queryClient.invalidateQueries({ queryKey: CHAVES.operacoes(userId) });
      }
    },
  });
}

export function useRemoverOperacao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { userId: unknown; operationId: unknown }) =>
      removerOperacaoAction(entrada),
    onSuccess: (resultado, entrada) => {
      if (resultado.situacao === "removida") {
        const userId = typeof entrada.userId === "string" ? entrada.userId : null;
        void queryClient.invalidateQueries({ queryKey: CHAVES.operacoes(userId) });
      }
    },
  });
}
