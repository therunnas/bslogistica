import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // `pointer-events-none` no contêiner e `pointer-events-auto` no toast:
      // o `<ol>` do sonner é `position: fixed` com largura fixa e sem regra
      // própria de pointer-events, então ele capturaria cliques na faixa que
      // ocupa mesmo sem nenhuma notificação à vista. Só o toast em si fica
      // clicável.
      className="toaster group pointer-events-none"
      // Largura enxuta e sempre dentro da tela: 20rem no desktop, 92vw quando a
      // janela é menor que isso. O sonner aplica `--width` ao `<ol>`, e os
      // toasts são absolutos dentro dele — por isso o valor vai aqui, e não
      // numa classe do toast.
      style={{ "--width": "min(92vw, 20rem)" } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast:
            "group toast pointer-events-auto group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
