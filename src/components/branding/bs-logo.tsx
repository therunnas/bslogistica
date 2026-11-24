import Image from "next/image";

/**
 * Logo oficial da BS Soluções Logísticas.
 *
 * Os arquivos de `public/branding` são as cópias, byte a byte, dos SVGs oficiais aprovados do
 * pacote `07_APLICACOES/07_SISTEMA-INTERNO` do kit de marca (composição horizontal e símbolo,
 * LIGHT e DARK, sem fundo). Nada aqui redesenha, recolore ou recorta a marca: só escolhe qual
 * arquivo mostrar.
 *
 * REGRA DE COR (manual da marca): o B é sempre vermelho #E51B23.
 *   LIGHT, para fundo claro: S e "SOLUÇÕES LOGÍSTICAS" pretos.
 *   DARK, para fundo escuro: S e "SOLUÇÕES LOGÍSTICAS" brancos, sem caixa branca atrás.
 *
 *   fundo="claro"   superfície sempre clara (ex.: telas de autenticação, login no celular)
 *   fundo="escuro"  superfície sempre escura (ex.: painel direito do login)
 *   fundo="tema"    superfície que acompanha o tema: LIGHT no claro, DARK no escuro. As duas
 *                   versões vão no HTML e o CSS (`dark:`) mostra a certa, então não há piscada
 *                   nem dependência de JavaScript para escolher.
 */
export type FundoDaLogo = "claro" | "escuro" | "tema";
export type FormaDaLogo = "horizontal" | "simbolo";

export const NOME_DA_MARCA = "BS Soluções Logísticas";

const ARQUIVOS = {
  horizontal: {
    light: { src: "/branding/bs-logo-horizontal-light.svg", width: 2920, height: 735 },
    dark: { src: "/branding/bs-logo-horizontal-dark.svg", width: 2920, height: 735 },
  },
  simbolo: {
    light: { src: "/branding/bs-simbolo-light.svg", width: 1340, height: 730 },
    dark: { src: "/branding/bs-simbolo-dark.svg", width: 1340, height: 730 },
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
  const { light, dark } = ARQUIVOS[forma];
  const base = `h-auto object-contain ${className}`;

  if (fundo === "claro") {
    return <Image {...light} alt={NOME_DA_MARCA} priority={priority} className={base} />;
  }
  if (fundo === "escuro") {
    return <Image {...dark} alt={NOME_DA_MARCA} priority={priority} className={base} />;
  }
  return (
    <>
      <Image {...light} alt={NOME_DA_MARCA} priority={priority} className={`${base} dark:hidden`} />
      <Image
        {...dark}
        alt={NOME_DA_MARCA}
        priority={priority}
        className={`${base} hidden dark:block`}
      />
    </>
  );
}
