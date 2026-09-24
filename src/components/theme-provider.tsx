"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Tema = "light" | "dark";

const CHAVE_TEMA = "bs-theme";

type ContextoTema = {
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>("dark");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    const temaAtual: Tema = document.documentElement.classList.contains("dark") ? "dark" : "light";

    setTema(temaAtual);
    setPronto(true);

    function sincronizarEntreAbas(evento: StorageEvent) {
      if (evento.key !== CHAVE_TEMA) return;

      if (evento.newValue !== "light" && evento.newValue !== "dark") {
        return;
      }

      aplicarTema(evento.newValue);
      setTema(evento.newValue);
    }

    window.addEventListener("storage", sincronizarEntreAbas);

    return () => {
      window.removeEventListener("storage", sincronizarEntreAbas);
    };
  }, []);

  const definirTema = useCallback((novoTema: Tema) => {
    aplicarTema(novoTema);
    localStorage.setItem(CHAVE_TEMA, novoTema);
    setTema(novoTema);
  }, []);

  const alternarTema = useCallback(() => {
    definirTema(tema === "dark" ? "light" : "dark");
  }, [definirTema, tema]);

  const valor = useMemo(
    () => ({
      tema,
      pronto,
      definirTema,
      alternarTema,
    }),
    [tema, pronto, definirTema, alternarTema],
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
