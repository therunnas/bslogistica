/**
 * Custo do colaborador editado no próprio cadastro (UX-SIMPLIFICACAO-01).
 *
 * Com o motor de vigências ligado, alterar o custo diário NÃO reescreve o cadastro: registra uma nova
 * vigência pelo mecanismo já existente (`montarRegistro` → `registrar_custo_colaborador`), com motivo na
 * trilha e encerrando a versão em aberto. Este módulo só PLANEJA esse registro, sem falar com o banco:
 *   - custo igual ao atual: nada a registrar;
 *   - data anterior a hoje: recusada (mudança retroativa só pelo histórico de vigências, com o aviso de
 *     "Retroativa" que ele exibe);
 *   - já existe vigência começando na mesma data, ou um custo futuro programado: recusado (o atalho não
 *     sobrepõe nem reescreve versões; o histórico continua disponível para isso);
 *   - o valor-hora acordado (029) da versão vigente é mantido, para não sumir em silêncio.
 * O banco revalida tudo; lançamentos já gravados mantêm seus snapshots.
 */
import { brl, dateBR } from "./format";
import {
  camposDaVigencia,
  lerNumero,
  situacaoDaVersao,
  validarNovaVigencia,
  type FormularioDeVigencia,
  type TermoDeCusto,
} from "./vigencias-ui";

export interface EntradaDeNovoCusto {
  versoes: readonly TermoDeCusto[];
  /** Custo do cadastro; só usado se não houver versão vigente hoje. */
  custoAtual: number | string;
  /** Texto digitado (aceita vírgula). */
  novoCusto: string;
  inicio: string;
  motivo: string;
  hoje: string;
  regrasBs: boolean;
  regrasDefinitivas: boolean;
  periodoContratual: boolean;
}

export interface PlanoDeNovoCusto {
  muda: boolean;
  /** Formulário pronto para `useRegistrarVigencia("colaborador")`; nulo se não muda ou se há erro. */
  form: FormularioDeVigencia | null;
  erros: string[];
  inicio: string;
  novoCusto: number | null;
}

const centavos = (v: number) => Math.round(v * 100);

/**
 * Custo por diária em vigor hoje, por colaborador, a partir das versões ATIVAS. Com o motor por vigência é
 * esse o custo que o banco usa (`employees.daily_cost` é só o valor do cadastro e não acompanha as
 * vigências). Colaborador sem versão vigente hoje fica fora do mapa: a tela mostra a pendência, sem
 * inventar valor.
 */
export function custosVigentesPorColaborador(
  versoes: readonly (TermoDeCusto & { employee_id: string })[],
  hoje: string,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const v of versoes) {
    if (situacaoDaVersao(v, hoje) !== "vigente") continue;
    const valor = Number(v.daily_cost);
    if (Number.isFinite(valor)) mapa.set(v.employee_id, valor);
  }
  return mapa;
}

export function planejarNovoCusto(e: EntradaDeNovoCusto): PlanoDeNovoCusto {
  const novo = lerNumero(e.novoCusto);
  const ativas = e.versoes.filter((v) => v.active);
  const vigente = ativas.find((v) => situacaoDaVersao(v, e.hoje) === "vigente") ?? null;
  // A comparação é com o custo em vigor (o que o banco usa), não com o valor legado do cadastro.
  const atual = Number(vigente ? vigente.daily_cost : e.custoAtual);
  const vazio = { form: null, inicio: e.inicio, novoCusto: novo };

  if (novo !== null && Number.isFinite(atual) && centavos(novo) === centavos(atual)) {
    return { muda: false, erros: [], ...vazio };
  }

  const erros: string[] = [];
  if (e.inicio < e.hoje) {
    erros.push(
      "A data de aplicação não pode ser anterior a hoje. Para corrigir períodos passados, use o histórico de vigências.",
    );
  }
  if (ativas.some((v) => v.valid_from === e.inicio)) {
    erros.push(
      "Já existe um custo começando na mesma data. Escolha outra data ou ajuste pelo histórico de vigências.",
    );
  }
  if (ativas.some((v) => situacaoDaVersao(v, e.hoje) === "futura")) {
    erros.push(
      "Há um custo futuro programado para este colaborador. Ajuste pelo histórico de vigências.",
    );
  }

  const campos = camposDaVigencia(
    "colaborador",
    e.regrasBs,
    e.regrasDefinitivas,
    e.periodoContratual,
  );
  const valores: Record<string, string> = {};
  for (const campo of campos) {
    const atualDoCampo = (vigente as Record<string, unknown> | null)?.[campo.chave];
    valores[campo.chave] =
      atualDoCampo === null || atualDoCampo === undefined ? "" : String(atualDoCampo);
  }
  valores["daily_cost"] = e.novoCusto;

  const form: FormularioDeVigencia = {
    inicio: e.inicio,
    motivo: e.motivo,
    valores,
    encerrarAnterior: true,
    fim: "",
    regrasBs: e.regrasBs,
    regrasDefinitivas: e.regrasDefinitivas,
    periodoContratual: e.periodoContratual,
  };
  erros.push(...validarNovaVigencia("colaborador", form));

  return {
    muda: true,
    form: erros.length === 0 ? form : null,
    erros,
    inicio: e.inicio,
    novoCusto: novo,
  };
}

/** Frase da confirmação: valor novo, data de aplicação e o que NÃO muda. */
export function textoDaConfirmacao(plano: PlanoDeNovoCusto, nome: string): string {
  const quando = plano.inicio > "" ? dateBR(plano.inicio) : "—";
  return (
    `O custo por diária de ${nome || "este colaborador"} passa a ser ${brl(plano.novoCusto)} ` +
    `a partir de ${quando}. Os apontamentos anteriores mantêm o custo antigo e nada já faturado ou ` +
    `fechado é recalculado. O valor anterior fica no histórico.`
  );
}
