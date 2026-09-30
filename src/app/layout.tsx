import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";

import "@/styles.css";

import { Providers } from "./providers";

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
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: scriptDoTema,
          }}
        />

        <link rel="preconnect" href="https://fonts.googleapis.com" />

        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700&display=swap"
        />
      </head>

      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
