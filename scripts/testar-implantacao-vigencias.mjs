/**
 * Testes da tela de implantação das vigências (C05-B5.7).
 *
 * COMO RODAR:
 *
 *   npm run test:implantacao-vigencias
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo TypeScript direto.
 * Duas metades: o comportamento das funções puras (`vigencias-implantacao.ts`) e a forma literal
 * dos arquivos (a tela é só leitura, protegida por `exigirAdmin`, fora do menu do operacional,
 * sem valor financeiro e sem escrita).
 */

import { readFileSync } from "node:fs";

import {
  MOTIVO_DA_PENDENCIA,
  ROTA_DO_TIPO,
  lerDivergencias,
  lerPendencias,
  motivoDaDivergencia,
  resumirImplantacao,
  rotuloDosCampos,
  textoDosApontamentosLegados,
} from "../src/lib/vigencias-implantacao.ts";
import { RPC_VIGENCIAS } from "../src/lib/vigencias.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ID = "5c900000-0000-4000-8000-0000000000d1";

// ---------------------------------------------------------------------------
// A. Leitura das respostas
// ---------------------------------------------------------------------------

console.log("A. Leitura das respostas das RPCs");

verificar("A1. lista vazia é válida e vazia", lerPendencias([]), []);
verificar("A2. pendência válida", lerPendencias([{ tipo: "contrato", id: ID, nome: "KL" }]), [
  { tipo: "contrato", id: ID, nome: "KL" },
]);
verificar(
  "A3. resposta que não é lista é inválida (null), nunca 'sem pendência'",
  lerPendencias(null),
  null,
);
verificar("A4. objeto no lugar da lista é inválido", lerPendencias({ tipo: "contrato" }), null);
verificar(
  "A5. tipo desconhecido invalida a resposta inteira",
  lerPendencias([{ tipo: "fatura", id: ID, nome: "x" }]),
  null,
);
verificar(
  "A6. id ausente invalida a resposta",
  lerPendencias([{ tipo: "contrato", nome: "x" }]),
  null,
);
verificar(
  "A7. divergência traz os campos",
  lerDivergencias([{ tipo: "colaborador", id: ID, nome: "EL", campos: ["daily_cost"] }]),
  [{ tipo: "colaborador", id: ID, nome: "EL", campos: ["daily_cost"] }],
);
verificar(
  "A8. divergência sem campos é inválida",
  lerDivergencias([{ tipo: "colaborador", id: ID, nome: "EL" }]),
  null,
);
verificar(
  "A9. campos que não são texto invalidam",
  lerDivergencias([{ tipo: "contrato", id: ID, nome: "K", campos: [1] }]),
  null,
);

// ---------------------------------------------------------------------------
// B. Textos e resumo
// ---------------------------------------------------------------------------

console.log("B. Textos e resumo");

verificar(
  "B1. campos em português",
  rotuloDosCampos(["daily_rate", "ot_factor"]),
  "diária, fator de hora extra",
);
verificar("B2. campo desconhecido aparece como veio", rotuloDosCampos(["x_novo"]), "x_novo");
verificar(
  "B3. o resumo conta e só libera quando não há nada",
  [
    resumirImplantacao([], []).semBloqueios,
    resumirImplantacao([{ tipo: "contrato", id: ID, nome: "K" }], []).semBloqueios,
    resumirImplantacao([], [{ tipo: "contrato", id: ID, nome: "K", campos: ["daily_rate"] }])
      .semBloqueios,
  ],
  [true, false, false],
);
verificar(
  "B4. a pendência diz que nada é presumido e que a data e o motivo são de quem decide",
  /nada é presumido/.test(MOTIVO_DA_PENDENCIA) &&
    /data de início e o motivo/.test(MOTIVO_DA_PENDENCIA),
  true,
);
verificar(
  "B5. a divergência cita o campo e as duas saídas, sem escolher",
  /diária/.test(motivoDaDivergencia(["daily_rate"])) &&
    /corrigir a coluna/.test(motivoDaDivergencia(["daily_rate"])) &&
    /registrar a vigência desejada/.test(motivoDaDivergencia(["daily_rate"])),
  true,
);
verificar(
  "B6. apontamentos legados: erro, zero e quantidade; nunca prometem recálculo",
  [
    textoDosApontamentosLegados(null),
    textoDosApontamentosLegados(0),
    /nada é recalculado/.test(textoDosApontamentosLegados(3)),
  ],
  [
    "Não foi possível contar os apontamentos legados.",
    "Nenhum apontamento legado (sem origem de preço).",
    true,
  ],
);
verificar("B7. cada tipo aponta para a tela do próprio cadastro", ROTA_DO_TIPO, {
  contrato: "/clientes",
  colaborador: "/colaboradores",
  operacao_sem_contrato: "/operacoes",
});

// ---------------------------------------------------------------------------
// C. Forma dos arquivos
// ---------------------------------------------------------------------------

console.log("C. Forma dos arquivos");

const page = ler("src/app/(painel)/implantacao-vigencias/page.tsx");
const painel = semComentarios(ler("src/app/(painel)/implantacao-vigencias/painel-implantacao.tsx"));
const dados = ler("src/lib/vigencias-dados.ts");
const hook = dados.slice(dados.indexOf("export function useImplantacaoDasVigencias"));
const shell = ler("src/app/(painel)/_components/app-shell.tsx");

verificar(
  "C1. a página chama o guard crítico (exigirAdminAal2Tela) ANTES de renderizar o painel",
  /const bloqueio = await exigirAdminAal2Tela\(\);\s+if \(bloqueio\) return bloqueio;[\s\S]*?return \(\s*<PainelImplantacaoVigencias/.test(
    page,
  ),
  true,
);
verificar(
  "C2. a rota é técnica (FIN-01): fora do menu de conta de TODOS os papéis; a proteção é o servidor",
  /admin: \[ITEM_USUARIOS, ITEM_SEGURANCA\]/.test(shell) &&
    /operacional: \[ITEM_SEGURANCA\]/.test(shell) &&
    !/ITEM_IMPLANTACAO/.test(shell),
  true,
);
verificar(
  "C3. as duas RPCs da tela existem no módulo de RPCs",
  [RPC_VIGENCIAS.motor.pendencias, RPC_VIGENCIAS.motor.divergencias],
  ["pendencias_implantacao_vigencias", "divergencias_implantacao_vigencias"],
);
verificar(
  "C4. a consulta é só leitura: sem insert, update, delete, upsert nem RPC de escrita",
  !/\.(insert|update|delete|upsert)\(/.test(hook) &&
    !/motor\.(alterar|sincronizarColunas|regularizarApontamento)/.test(hook) &&
    !/\.(insert|update|delete|upsert)\(|useMutation/.test(painel),
  true,
);
verificar(
  "C5. a tela não mostra valor financeiro nem formata dinheiro",
  !/\bbrl\b|daily_rate|daily_cost|agreed_amount|billed_amount/.test(painel),
  true,
);
verificar(
  "C6. erro de consulta não vira lista vazia: a tela mostra alerta e diz que a ausência de resposta não é ausência de pendência",
  /consulta\.isError/.test(painel) && /não significa que não haja/.test(painel),
  true,
);
verificar(
  "C7. resposta inválida lança erro (nunca lista vazia) e o erro da RPC é propagado",
  /if \(pend\.error\) throw pend\.error;/.test(hook) &&
    /if \(div\.error\) throw div\.error;/.test(hook) &&
    /pendencias === null \|\| divergencias === null/.test(hook),
  true,
);
verificar(
  "C8. a consulta não registra nem sincroniza; as únicas ações são ligar o motor e, quando o servidor autorizar, desligá-lo, ambas com confirmação (C05-B8.6 e RB-01)",
  /não registra nem sincroniza nada; as únicas ações desta tela são ligar o motor e, quando o servidor autorizar, desligá-lo \(reversão\), ambas com administrador com segundo fator, motivo e confirmação/.test(
    painel,
  ) &&
    /<AtivarMotor/.test(painel) &&
    !/sincronizar|desligar/i.test(painel.replace(/não registra nem sincroniza/g, "")),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
