import { BSLogo } from "./bs-logo";

type BSBrandProps = {
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  align?: "start" | "center";
  priority?: boolean;
  className?: string;
};

const tamanhos = {
  sm: "w-40 sm:w-44",
  md: "w-52 sm:w-56",
  lg: "w-64 xl:w-[360px]",
};

/**
 * Marca das telas de autenticação. A composição horizontal oficial já traz o nome "SOLUÇÕES
 * LOGÍSTICAS", então não há legenda em texto. `variant="light"` = fundo claro (logo preta);
 * `"dark"` = fundo escuro (logo branca).
 */
export function BSBrand({
  variant = "light",
  size = "sm",
  align = "start",
  priority = false,
  className = "",
}: BSBrandProps) {
  const alinhamento = align === "center" ? "items-center" : "items-start";

  return (
    <div className={`flex flex-col ${alinhamento} ${className}`}>
      <BSLogo
        fundo={variant === "dark" ? "escuro" : "claro"}
        priority={priority}
        className={tamanhos[size]}
      />
    </div>
  );
}
