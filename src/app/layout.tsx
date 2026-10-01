import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";

import "@/styles.css";

import { Providers } from "./providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BS Soluções Logística",
    template: "%s | BS Soluções Logística",
  },
  description: "Painel interno de gestão operacional e financeira de mão de obra terceirizada.",
  robots: {
    index: false,
    follow: false,
  },
};

const scriptDoTema = `
(() => {
  try {
    const chave = "bs-theme";

    const rotasComTema = [
      "/dashboard",
      "/apontamentos",
      "/operacoes",
      "/clientes",
      "/colaboradores",
      "/faturamento",
      "/relatorios",
      "/operacional",
      "/usuarios",
      "/configuracoes"
    ];

    const caminho = window.location.pathname;

    const usaTemaDoPainel = rotasComTema.some(
      (rota) => caminho === rota || caminho.startsWith(rota + "/")
    );

    let tema = "light";

    if (usaTemaDoPainel) {
      const salvo = localStorage.getItem(chave);

      tema =
        salvo === "light" || salvo === "dark"
          ? salvo
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }

    const raiz = document.documentElement;

    raiz.classList.toggle("dark", tema === "dark");
    raiz.dataset.theme = tema;
    raiz.style.colorScheme = tema;
  } catch {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${dmSans.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: scriptDoTema,
          }}
        />
      </head>

      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
