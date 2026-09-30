/**
 * Decisões do segundo fator, isoladas em funções puras.
 *
 * Elas moram aqui, e não dentro do guard e da tela, por um motivo prático: sem
 * framework de teste no projeto, lógica embutida em Server Component e em
 * `useCallback` só é exercitável clicando. Extraída, é verificável por script.
 *
 * Nenhuma destas funções fala com o Supabase. Elas recebem o que já foi lido e
 * respondem para onde ir — o que também deixa explícito que a decisão não
 * depende de e-mail, papel ou qualquer outro dado além do estado do fator.
 */

export type NivelDeGarantia = "aal1" | "aal2" | (string & {});

export interface NivelMfa {
  currentLevel: NivelDeGarantia | null;
  nextLevel: NivelDeGarantia | null;
}

export type SituacaoMfa = "mfa-indisponivel" | "mfa-ausente" | "mfa-pendente" | "liberado";

/**
 * Para onde mandar quem já tem sessão e papel **na recuperação de senha**.
 *
 * NÃO é mais a decisão do painel. Quem decide o acesso ao painel é
 * `decidirAcesso`, logo abaixo, que é role-aware e não olha `nextLevel`. Esta
 * função continua existindo porque o fluxo de recuperação tem outra pergunta:
 * ali não se concede acesso a dado nenhum, decide-se apenas se o TOTP precisa
 * ser desafiado antes do `updateUser` — e quem recusa de verdade a troca de
 * senha sem AAL2 é o próprio GoTrue, com 401. Ver a nota sobre `nextLevel` em
 * `decidirAcesso`.
 *
 * `houveErro` é o caso que motivou esta função existir. Consultar o nível é uma
 * chamada de rede; quando ela falha, não se sabe se há fator ou não. Tratar
 * "não sei" como "não tem" mandava um admin com fator verificado para o
 * cadastro, onde o `enroll` era recusado por nome duplicado e a tela travava.
 *
 * Falha e ausência passam a ser coisas diferentes. As duas continuam fechando o
 * painel — nenhuma libera acesso, nenhuma rebaixa para aal1 —, mas só a ausência
 * leva ao cadastro.
 */
export function decidirSituacaoMfa(nivel: NivelMfa | null, houveErro: boolean): SituacaoMfa {
  if (houveErro || !nivel) return "mfa-indisponivel";
  if (nivel.nextLevel !== "aal2") return "mfa-ausente";
  if (nivel.currentLevel !== "aal2") return "mfa-pendente";
  return "liberado";
}

// ---------------------------------------------------------------------------
// A decisão de acesso ao painel — role-aware (PR C)
// ---------------------------------------------------------------------------

/**
 * Papel efetivo, do ponto de vista da decisão de acesso.
 *
 * Definido aqui, e não em `_papel.ts`, só para manter a direção da dependência:
 * `src/lib/` não importa de `src/app/`. `PapelEfetivo` é um apelido deste tipo,
 * então a lista de papéis tem **uma** definição, não duas que podem divergir.
 */
export type PapelDoAcesso = "admin" | "operacional" | "sem-papel";

/**
 * O que o banco respondeu sobre o estado de MFA da conta.
 *
 * Vem de `public.mfa_bloqueia_excecao_aal1()` (migration 012), que lê
 * `auth.mfa_factors` por `SECURITY DEFINER` — fonte que o usuário não
 * manipula. **Não** vem de `nextLevel`, que é calculado a partir do cookie.
 *
 * - `sem-fator`        — o banco respondeu `false`: a conta não tem fator
 *                        verificado, existe, e a exceção de AAL1 não está
 *                        impedida;
 * - `exige-fator`      — o banco respondeu `true`: há fator verificado, ou a
 *                        conta não existe mais, ou a própria leitura falhou lá
 *                        dentro. Os três são "precisa de AAL2";
 * - `indeterminado`    — a chamada falhou, ou voltou algo que não é booleano.
 *                        Não é ausência de fator: é não saber.
 */
export type EstadoDoFator = "sem-fator" | "exige-fator" | "indeterminado";

/** Saídas possíveis da decisão de acesso, incluindo a que não é de MFA. */
export type DecisaoDeAcesso = SituacaoMfa | "sem-papel";

/**
 * Traduz a resposta crua da RPC de MFA para o estado do fator.
 *
 * Só dois valores concedem qualquer coisa, e os dois são booleanos literais.
 * `null`, `undefined`, string, número, objeto — tudo isso é `indeterminado`,
 * porque significa que a resposta não foi entendida. A alternativa comum,
 * `Boolean(data)`, transformaria `null` em `false`, que é exatamente o valor
 * que abriria a exceção de AAL1: uma falha de leitura viraria concessão.
 *
 * O `houveErro` tem precedência sobre qualquer `data`, pelo mesmo motivo pelo
 * qual a `012` não captura exceção por dentro.
 */
export function interpretarBloqueioDeExcecao(data: unknown, houveErro: boolean): EstadoDoFator {
  if (houveErro) return "indeterminado";
  if (data === true) return "exige-fator";
  if (data === false) return "sem-fator";
  return "indeterminado";
}

/**
 * A decisão de acesso ao painel, por papel e nível de garantia.
 *
 * REGRA, na ordem em que é avaliada:
 *
 * 1. sem papel reconhecido -> `sem-papel`. Não se decide MFA de quem não tem
 *    papel;
 * 2. sessão em `aal2` -> `liberado`, para admin e para operacional. É o mesmo
 *    que a migration `015` passou a aceitar no banco: a superfície operacional
 *    atende o operador elegível em AAL1 **ou** em AAL2;
 * 3. nível que não é `aal1` nem `aal2` -> `mfa-indisponivel`. Claim ausente,
 *    nula ou desconhecida é falha fechada, nunca AAL1 presumido. O banco decide
 *    igual: em `operador_elegivel_operacional()` um JWT sem a claim `aal`
 *    devolveria NULL, e o `coalesce(..., false)` fecha;
 * 4. estado do fator indeterminado -> `mfa-indisponivel`. Não saber se há fator
 *    não é não ter fator — e mandar para o cadastro nesse caso trava a conta
 *    que já tem um, defeito real já registrado neste projeto;
 * 5. fator verificado (ou conta inexistente) em `aal1` -> `mfa-pendente`, para
 *    os dois papéis. **É aqui que o operacional que optou por MFA é barrado em
 *    AAL1**: MFA opcional não é MFA dispensável;
 * 6. `aal1` sem fator verificado -> `liberado` para `operacional`,
 *    `mfa-ausente` para `admin`.
 *
 * O passo 6 é a única assimetria entre os papéis, e é a política inteira do PR
 * C: o administrador nunca recebe exceção de AAL1 — sem fator, ele vai
 * cadastrar um —, e o operacional sem fator trabalha em AAL1 pela superfície
 * estreita de RPC da `013`, sem ser obrigado a cadastrar MFA.
 *
 * `admin` + `operacional` não aparece aqui porque já chega resolvido: o papel
 * efetivo de quem acumula os dois é `admin`, como em `resolverPapelEfetivo` e
 * como no banco, onde `operador_elegivel_operacional()` exige **não** ser
 * admin.
 *
 * SOBRE `nextLevel`: ele não entra nesta decisão, nem como desempate. É
 * derivado de `session.user.factors`, que vem do cookie e não da claim
 * assinada, e por isso não serve de condição para **conceder** nada. O que
 * substitui esse papel é `estadoDoFator`, lido do banco. `currentLevel`
 * continua sendo usado, e pode: é a claim `aal` do token já validado contra o
 * servidor por `getUser()`.
 *
 * E o mais importante: isto decide o que a interface entrega. Quem recusa os
 * dados é o banco — as 11 policies `*_exige_aal2` e as cinco RPCs, que
 * revalidam papel, nível e estado de MFA por dentro, com ou sem este arquivo.
 */
export function decidirAcesso(
  papel: PapelDoAcesso,
  nivelAtual: NivelDeGarantia | null | undefined,
  estadoDoFator: EstadoDoFator,
): DecisaoDeAcesso {
  if (papel === "sem-papel") return "sem-papel";
  if (nivelAtual === "aal2") return "liberado";
  if (nivelAtual !== "aal1") return "mfa-indisponivel";
  if (estadoDoFator === "indeterminado") return "mfa-indisponivel";
  if (estadoDoFator === "exige-fator") return "mfa-pendente";
  return papel === "operacional" ? "liberado" : "mfa-ausente";
}

export type DecisaoMfaNaRecuperacao = "desafiar-mfa" | "prosseguir" | "falhar";

/**
 * O que a recuperação de senha deve fazer, dada a situação do segundo fator.
 *
 * POR QUE ISTO EXISTE
 *
 * O `verifyOtp({ type: "recovery" })` cria a sessão em aal1. Quando a conta tem
 * TOTP verificado, o próprio Supabase recusa a troca de senha nessa sessão:
 * `PUT /user` devolve 401 "AAL2 session is required to update email or password
 * when MFA is enabled". Não é regra nossa, é do GoTrue — e a resposta certa é
 * satisfazer o segundo fator, nunca contorná-lo.
 *
 * A exigência é CONDICIONAL, e é por isso que esta função existe separada de
 * um simples `aal === "aal2"`:
 *
 * - `mfa-pendente` (aal1, mas a conta tem fator) -> desafiar, e só então trocar;
 * - `liberado` (já aal2) -> o fator já foi satisfeito, segue;
 * - `mfa-ausente` (a conta não tem fator) -> o 401 não acontece, segue em aal1.
 *   Exigir aal2 aqui travaria a recuperação de quem nunca cadastrou MFA;
 * - `mfa-indisponivel` -> falha fechada. Não saber se há fator não é o mesmo que
 *   não haver: seguir levaria ao mesmo 401, agora sem diagnóstico.
 */
export function decidirMfaNaRecuperacao(situacao: SituacaoMfa): DecisaoMfaNaRecuperacao {
  if (situacao === "mfa-pendente") return "desafiar-mfa";
  if (situacao === "mfa-indisponivel") return "falhar";
  return "prosseguir";
}

export type FluxoMfa = "desafio" | "cadastro" | "sem-fator-esperado";

/**
 * O que a tela de MFA deve fazer, uma vez que já leu os fatores da conta.
 *
 * O fator verificado manda no fluxo, venha o que vier na etapa calculada pelo
 * guard: se existe um, o caminho é desafio. É isso que impede chamar `enroll`
 * sobre uma conta que já tem fator — a origem do travamento anterior.
 *
 * `sem-fator-esperado` é a incoerência: o guard afirmou que há fator, a lista
 * não trouxe nenhum verificado. Não é caso de cadastrar por conta própria; é
 * caso de avisar e deixar recarregar.
 */
export function decidirFluxoMfa(
  temFatorVerificado: boolean,
  etapa: "mfa-ausente" | "mfa-pendente",
): FluxoMfa {
  if (temFatorVerificado) return "desafio";
  if (etapa === "mfa-pendente") return "sem-fator-esperado";
  return "cadastro";
}

/**
 * Fonte de um `<img>` para o QR do cadastro de TOTP.
 *
 * O campo `totp.qr_code` do Supabase já vem como data URL completo — a
 * referência oficial usa `src={data.totp.qr_code}` direto, sem montar nada.
 * O comentário do tipo em `@supabase/auth-js` diz o contrário, que é preciso
 * prefixar `data:image/svg+xml;utf-8,`; seguir esse comentário foi o que
 * quebrou o QR na primeira tentativa (`/mfa`), porque o prefixo entrava duas
 * vezes e o conteúdo virava texto em vez de SVG.
 *
 * Como as duas fontes se contradizem, a decisão aqui é pelo valor recebido:
 * se já é data URL, usa como está; se for SVG cru, monta o data URL. Funciona
 * nos dois formatos e não depende de qual está certo hoje.
 *
 * Extraída para cá (PR F) porque `/mfa` (cadastro/desafio obrigatório) e
 * `/configuracoes` (ativação opcional do operacional) precisam do mesmo QR, e
 * duas cópias da mesma decisão divergiriam no dia em que uma delas mudasse.
 */
export function fonteDoQrTotp(valor: string): string {
  if (valor.startsWith("data:")) return valor;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(valor)}`;
}
