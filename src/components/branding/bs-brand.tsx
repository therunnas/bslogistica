import Image from "next/image";

type BSBrandProps = {
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  align?: "start" | "center";
  priority?: boolean;
  className?: string;
};

const tamanhos = {
  sm: {
    imagem: "w-36 sm:w-40",
    texto: "text-xs",
    espacamento: "mt-2",
  },
  md: {
    imagem: "w-48 sm:w-52",
    texto: "text-sm",
    espacamento: "mt-2",
  },
  lg: {
    imagem: "w-64 xl:w-[360px]",
    texto: "text-base xl:text-lg",
    espacamento: "mt-3",
  },
};

export function BSBrand({
  variant = "light",
  size = "sm",
  align = "start",
  priority = false,
  className = "",
}: BSBrandProps) {
  const tamanho = tamanhos[size];

  const alinhamento = align === "center" ? "items-center text-center" : "items-start text-left";

  const corDoTexto = variant === "dark" ? "text-white/90" : "text-slate-900";

  return (
    <div className={`flex flex-col ${alinhamento} ${className}`}>
      <Image
        src="/branding/bs-simbolo-retangular.png"
        alt="BS Soluções Logística"
        width={1774}
        height={887}
        priority={priority}
        className={`h-auto object-contain ${tamanho.imagem}`}
      />

      <p
        className={`${tamanho.espacamento} ${tamanho.texto} font-semibold tracking-[0.08em] ${corDoTexto}`}
      >
        BS SOLUÇÕES LOGÍSTICA
      </p>
    </div>
  );
}
