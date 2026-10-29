// Aplica o tema ANTES da hidratação (sem piscar). Espelha src/lib/tema.ts: a mesma chave, a mesma
// lista de rotas fora do painel e a mesma regra (sem preferência = claro, sem consultar o sistema).
// scripts/testar-tema.mjs executa este arquivo e confere que ele decide como o módulo.
(() => {
  try {
    const chave = "bs-theme";
    const rotasSemTema = ["/", "/login", "/mfa", "/esqueci-senha", "/redefinir-senha", "/auth"];
    const caminho = window.location.pathname;

    const foraDoPainel = rotasSemTema.some((rota) =>
      rota === "/" ? caminho === "/" : caminho === rota || caminho.startsWith(rota + "/"),
    );

    let tema = "light";

    if (!foraDoPainel) {
      try {
        const salvo = localStorage.getItem(chave);
        if (salvo === "light" || salvo === "dark") tema = salvo;
      } catch {}
    }

    const raiz = document.documentElement;

    raiz.classList.toggle("dark", tema === "dark");
    raiz.dataset.theme = tema;
    raiz.style.colorScheme = tema;
  } catch {}
})();
