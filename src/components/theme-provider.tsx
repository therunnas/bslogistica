"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CHAVE_TEMA, lerPreferencia, temaAplicado, temaValido, type Tema } from "@/lib/tema";

export type { Tema };

type ContextoTema = {
  /** A PREFERÊNCIA do usuário (não o que está na tela agora: telas de login ficam sempre claras). */
  tema: Tema;
  pronto: boolean;
  definirTema: (tema: Tema) => void;
  alternarTema: () => void;
};

const TemaContext = createContext<ContextoTema | null>(null);

function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;

  raiz.classList.toggle("dark", tema === "dark");
  raiz.dataset["theme"] = tema;
  raiz.style.colorScheme = tema;
}

/**
 * Tema do painel. Regras e fonte única em `@/lib/tema`.
 *
 * - A preferência é lida UMA vez, na montagem, e só depois (`pronto`) o tema é aplicado. Antes
 *   disso o provider não toca em nada: quem pintou a página foi `theme-script.js`, e reaplicar
 *   "claro" durante a hidratação era o que apagava o escuro.
 * - Trocar de rota/módulo só reavalia `temaAplicado(caminho, preferência)`: a preferência nunca
 *   muda sozinha, nem é gravada, por navegação.
 * - Só `definirTema` (clique do usuário) grava no armazenamento.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const caminho = usePathname();

  const [preferido, setPreferido] = useState<Tema>("light");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    setPreferido(lerPreferencia(() => window.localStorage));
    setPronto(true);
  }, []);

  useEffect(() => {
    if (!pronto) return;

    aplicarTema(temaAplicado(caminho, preferido));
  }, [pronto, caminho, preferido]);

  useEffect(() => {
    function sincronizarEntreAbas(evento: StorageEvent) {
      if (evento.key !== CHAVE_TEMA) return;

      const novo = temaValido(evento.newValue);

      if (novo) setPreferido(novo);
    }

    window.addEventListener("storage", sincronizarEntreAbas);

    return () => {
      window.removeEventListener("storage", sincronizarEntreAbas);
    };
  }, []);

  const definirTema = useCallback((novoTema: Tema) => {
    try {
      localStorage.setItem(CHAVE_TEMA, novoTema);
    } catch {
      // A troca continua funcionando na sessão mesmo sem armazenamento.
    }

    setPreferido(novoTema);
  }, []);

  const alternarTema = useCallback(() => {
    definirTema(preferido === "dark" ? "light" : "dark");
  }, [definirTema, preferido]);

  const valor = useMemo(
    () => ({ tema: preferido, pronto, definirTema, alternarTema }),
    [preferido, pronto, definirTema, alternarTema],
  );

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

export function useTema() {
  const contexto = useContext(TemaContext);

  if (!contexto) {
    throw new Error("useTema deve ser usado dentro de ThemeProvider.");
  }

  return contexto;
}
