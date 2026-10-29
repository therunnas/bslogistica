import Image from "next/image";

/**
 * Logo oficial da BS Soluções Logísticas.
 *
 * Os arquivos de `public/branding` são as cópias, byte a byte, dos SVGs oficiais aprovados
 * (composição horizontal e símbolo, preto e branco, sem fundo). Nada aqui redesenha, recolore
 * ou recorta a marca: só escolhe qual arquivo mostrar.
 *
 * REGRA DE COR: fundo claro → logo PRETA; fundo escuro → logo BRANCA.
 *
 *   fundo="claro"   superfície sempre clara (ex.: telas de autenticação, painel esquerdo do login)
 *   fundo="escuro"  superfície sempre escura (ex.: painel direito do login)
 *   fundo="tema"    superfície que acompanha o tema: preta no claro, branca no escuro. As duas
 *                   versões vão no HTML e o CSS (`dark:`) mostra a certa, então não há piscada
 *                   nem dependência de JavaScript para escolher.
 */
export type FundoDaLogo = "claro" | "escuro" | "tema";
export type FormaDaLogo = "horizontal" | "simbolo";

export const NOME_DA_MARCA = "BS Soluções Logísticas";

const ARQUIVOS = {
  horizontal: {
    preta: { src: "/branding/bs-logo-horizontal-preta.svg", width: 2920, height: 735 },
    branca: { src: "/branding/bs-logo-horizontal-branca.svg", width: 2920, height: 735 },
  },
  simbolo: {
    preta: { src: "/branding/bs-simbolo-preto.svg", width: 1340, height: 730 },
    branca: { src: "/branding/bs-simbolo-branco.svg", width: 1340, height: 730 },
  },
} as const;

export function BSLogo({
  fundo,
  forma = "horizontal",
  priority = false,
  className = "",
}: {
  fundo: FundoDaLogo;
  forma?: FormaDaLogo;
  priority?: boolean;
  /** Tamanho (largura) e posição. A proporção vem do arquivo: use só `w-*`, nunca `h-*`. */
  className?: string;
}) {
  const { preta, branca } = ARQUIVOS[forma];
  const base = `h-auto object-contain ${className}`;

  if (fundo === "claro") {
    return <Image {...preta} alt={NOME_DA_MARCA} priority={priority} className={base} />;
  }
  if (fundo === "escuro") {
    return <Image {...branca} alt={NOME_DA_MARCA} priority={priority} className={base} />;
  }
  return (
    <>
      <Image {...preta} alt={NOME_DA_MARCA} priority={priority} className={`${base} dark:hidden`} />
      <Image
        {...branca}
        alt={NOME_DA_MARCA}
        priority={priority}
        className={`${base} hidden dark:block`}
      />
    </>
  );
}
