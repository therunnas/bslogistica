// O Next.js processa o Tailwind 4 por aqui. A aplicação Vite usa o plugin
// @tailwindcss/vite e ignora este arquivo — vite.config.ts desliga a busca
// automática de configuração do PostCSS para as duas não se sobreporem.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
