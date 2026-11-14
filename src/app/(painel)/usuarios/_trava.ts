/**
 * A trava de envio único da tela de usuários (CP-01) mora em `src/lib/trava.ts`, compartilhada
 * com clientes e contratos (CP-02). Este módulo continua exportando os mesmos nomes. Import
 * relativo de propósito: a suíte `test:mensagens-auth` roda no Node, que não conhece o `@/`.
 */
export { criarTrava, useTrava, type Trava } from "../../../lib/trava";
