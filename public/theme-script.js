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
      "/configuracoes",
    ];

    const caminho = window.location.pathname;

    const usaTemaDoPainel = rotasComTema.some(
      (rota) => caminho === rota || caminho.startsWith(rota + "/"),
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
