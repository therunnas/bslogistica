import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
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
    default: "BS Soluções Logísticas",
    template: "%s | BS Soluções Logísticas",
  },
  description: "Painel interno de gestão operacional e financeira de mão de obra terceirizada.",
  // Favicon oficial aprovado (BS-favicon.svg e PNGs 16/32/512 de 04_AVATARES-E-ICONES), copiado sem alteração.
  icons: {
    icon: [
      { url: "/branding/bs-favicon.svg", type: "image/svg+xml" },
      { url: "/branding/bs-favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/bs-favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/branding/bs-app-icon-512x512.png", sizes: "512x512", type: "image/png" }],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Lê um header de requisição só para forçar renderização dinâmica: é isso
  // que faz o Next embutir, em cada resposta, o nonce que o proxy.ts gerou
  // para ESTA requisição nos scripts internos que ele injeta (streaming do
  // RSC). Página estática não recebe nonce novo a cada request — ficaria
  // presa ao nonce do build, e a CSP pararia de bater.
  await headers();

  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${dmSans.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        {/* Arquivo estático, não inline: evita dangerouslySetInnerHTML e
            dispensa nonce/hash na CSP (script-src 'self' já cobre). Roda
            antes da hidratação, do mesmo jeito que o inline rodava, para
            não piscar o tema errado. */}
        <script src="/theme-script.js" />
      </head>

      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
