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

export type Tema = "light" | "dark";

const CHAVE_TEMA = "bs-theme";

const ROTAS_COM_TEMA = [
  "/dashboard",
  "/apontamentos",
  "/operacoes",
  "/clientes",
  "/colaboradores",
  "/faturamento",
  "/relatorios",
  "/operacional",
  "/usuarios",
  "/configuracoes",
] as const;

type ContextoTema = {
  tema: Tema;
  pronto: boolean;
  definirTema: (tema: Tema) => void;
  alternarTema: () => void;
};

const TemaContext = createContext<ContextoTema | null>(null);

function rotaUsaTemaDoPainel(caminho: string) {
  return ROTAS_COM_TEMA.some((rota) => caminho === rota || caminho.startsWith(`${rota}/`));
}

function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;

  raiz.classList.toggle("dark", tema === "dark");
  raiz.dataset["theme"] = tema;
  raiz.style.colorScheme = tema;
}

function lerTemaDoSistema(): Tema {
  try {
    if (typeof window.matchMedia !== "function") {
      return "light";
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function lerTemaPreferido(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA);

    if (salvo === "light" || salvo === "dark") {
      return salvo;
    }
  } catch {
    return lerTemaDoSistema();
  }

  return lerTemaDoSistema();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const usaTemaDoPainel = rotaUsaTemaDoPainel(caminho);

  const [tema, setTema] = useState<Tema>("light");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!usaTemaDoPainel) {
      aplicarTema("light");
      setTema("light");
      setPronto(true);
      return;
    }

    const temaPreferido = lerTemaPreferido();

    aplicarTema(temaPreferido);
    setTema(temaPreferido);
    setPronto(true);
  }, [usaTemaDoPainel]);

  useEffect(() => {
    function sincronizarEntreAbas(evento: StorageEvent) {
      if (!usaTemaDoPainel || evento.key !== CHAVE_TEMA) {
        return;
      }

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
  }, [usaTemaDoPainel]);

  const definirTema = useCallback(
    (novoTema: Tema) => {
      try {
        localStorage.setItem(CHAVE_TEMA, novoTema);
      } catch {
        // Mantém a troca de tema funcional mesmo sem armazenamento persistente.
      }

      setTema(novoTema);

      if (usaTemaDoPainel) {
        aplicarTema(novoTema);
      }
    },
    [usaTemaDoPainel],
  );

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
