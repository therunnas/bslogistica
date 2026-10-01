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

export default function RootLayout({ children }: { children: ReactNode }) {
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
