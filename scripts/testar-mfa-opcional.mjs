/**
 * MFA opcional com AAL2 nas operações críticas (AUTH-01B).
 *
 * COMO RODAR:  npm run test:mfa-opcional
 *
 * Sem rede nem banco. O comportamento no banco (RLS, RPCs, AAL1 x AAL2, fator removido) é de
 * `supabase/tests/032_mfa_opcional.sql`; aqui ficam a decisão de acesso, os guards, a gestão do
 * fator, a forma da migration 032 e a documentação.
 *
 *   A  decisão de acesso: sem fator = AAL1 liberado (dois papéis); com fator = TOTP; falha fecha
 *   B  "liberado" não é AAL2: o `nivel` e os guards críticos
 *   C  Configurações > Segurança: ativar/desativar o próprio fator, rótulo, sessão
 *   D  migration 032: classificação, o que NÃO foi tocado, permissões, rollback
 *   E  mensagem das operações críticas recusadas
 *   F  documentação
 */
import { existsSync, readFileSync } from "node:fs";

import { decidirAcesso } from "../src/lib/mfa.ts";
import { MENSAGEM_EXIGE_SEGUNDO_FATOR, mensagemDoErro } from "../src/lib/erros-banco.ts";
import { NOME_DO_FATOR, textoSemFator } from "../src/app/(painel)/configuracoes/_dominio.ts";

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
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const semSql = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

console.log("\nA. Decisão de acesso\n");
verificar(
  "A1. admin sem fator em AAL1: liberado",
  decidirAcesso("admin", "aal1", "sem-fator"),
  "liberado",
);
verificar(
  "A2. operacional sem fator em AAL1: liberado",
  decidirAcesso("operacional", "aal1", "sem-fator"),
  "liberado",
);
verificar(
  "A3. admin COM fator em AAL1: TOTP pendente",
  decidirAcesso("admin", "aal1", "exige-fator"),
  "mfa-pendente",
);
verificar(
  "A4. operacional COM fator em AAL1: TOTP pendente",
  decidirAcesso("operacional", "aal1", "exige-fator"),
  "mfa-pendente",
);
verificar(
  "A5. com fator e AAL2: liberado (os dois papéis)",
  [
    decidirAcesso("admin", "aal2", "exige-fator"),
    decidirAcesso("operacional", "aal2", "exige-fator"),
  ],
  ["liberado", "liberado"],
);
verificar(
  "A6. não saber se há fator NÃO libera (os dois papéis)",
  [
    decidirAcesso("admin", "aal1", "indeterminado"),
    decidirAcesso("operacional", "aal1", "indeterminado"),
  ],
  ["mfa-indisponivel", "mfa-indisponivel"],
);
verificar(
  "A7. claim aal ausente, vazia ou desconhecida fecha",
  [null, undefined, "", "aal3"].map((n) => decidirAcesso("admin", n, "sem-fator")),
  ["mfa-indisponivel", "mfa-indisponivel", "mfa-indisponivel", "mfa-indisponivel"],
);
verificar(
  "A8. sem papel nunca é liberado",
  ["aal1", "aal2"].map((n) => decidirAcesso("sem-papel", n, "sem-fator")),
  ["sem-papel", "sem-papel"],
);
{
  let indevidas = 0;
  for (const papel of ["admin", "operacional", "sem-papel"])
    for (const nivel of ["aal1", "aal2", "aal3", "", null, undefined])
      for (const fator of ["sem-fator", "exige-fator", "indeterminado"]) {
        if (decidirAcesso(papel, nivel, fator) !== "liberado") continue;
        if (!(
          papel !== "sem-papel" &&
          (nivel === "aal2" || (nivel === "aal1" && fator === "sem-fator"))
        ))
          indevidas++;
      }
  verificar("A9. varredura de 54 combinações: nenhuma liberação fora da regra", indevidas, 0);
}
verificar(
  "A10. o painel nunca produz 'mfa-ausente' (o fator é opcional)",
  ["admin", "operacional"]
    .flatMap((p) =>
      ["aal1", "aal2"].flatMap((n) =>
        ["sem-fator", "exige-fator", "indeterminado"].map((f) => decidirAcesso(p, n, f)),
      ),
    )
    .includes("mfa-ausente"),
  false,
);

console.log("\nB. 'Liberado' não é AAL2\n");
const aut = semComentarios(ler("src/app/(painel)/_autorizacao.ts"));
verificar(
  "B1. lerAcesso devolve o nível de quem foi liberado (aal1 ou aal2, nunca presumido)",
  /nivel: nivelAtual === "aal2" \? "aal2" : "aal1"/.test(aut) &&
    /situacao: "liberado"; email: string; papeis: Papel\[\]; nivel: NivelAcesso/.test(aut),
  true,
);
verificar(
  "B2. o tipo Acesso não tem mais 'mfa-ausente'",
  /situacao: "mfa-ausente"/.test(aut),
  false,
);
const aa = semComentarios(ler("src/lib/admin-usuarios/autorizacao.ts"));
verificar(
  "B3. exigirAdminAal2 (Server Actions críticas) exige nivel === 'aal2' além de admin liberado",
  /acesso\.situacao !== "liberado" \|\| acesso\.nivel !== "aal2" \|\| !ehAdmin\(acesso\.papeis\)/.test(
    aa,
  ),
  true,
);
const guard = semComentarios(ler("src/app/(painel)/_exigir-admin.tsx"));
verificar(
  "B4. exigirAdminAal2Tela mostra a orientação de ativar o MFA quando o nível não é aal2",
  /export async function exigirAdminAal2Tela/.test(guard) &&
    /acesso\.nivel !== "aal2"\) return <ExigeSegundoFator \/>/.test(guard),
  true,
);
verificar(
  "B5. exigirAdmin (cotidiano) NÃO ganhou exigência de aal2",
  /export async function exigirAdmin\(\)[\s\S]*?return null;\s*\}/.test(guard) &&
    !/export async function exigirAdmin\(\)[\s\S]*?nivel[\s\S]*?return null;\s*\}\s*\n\s*\/\*\*/.test(
      guard,
    ),
  true,
);
const pag = (p) => semComentarios(ler(`src/app/(painel)/${p}/page.tsx`));
verificar(
  "B6. áreas críticas (Usuários e Implantação) usam o guard de AAL2 de fato",
  /await exigirAdminAal2Tela\(\)/.test(pag("usuarios")) &&
    /await exigirAdminAal2Tela\(\)/.test(pag("implantacao-vigencias")),
  true,
);
verificar(
  "B7. telas cotidianas seguem com exigirAdmin",
  [
    "dashboard",
    "clientes",
    "colaboradores",
    "operacoes",
    "apontamentos",
    "faturamento",
    "fechamento",
    "relatorios",
  ].every((r) => /await exigirAdmin\(\)/.test(pag(r))),
  true,
);
verificar(
  "B8. Server Actions críticas (usuários e motor: ativar e reverter) chamam exigirAdminAal2 antes de agir",
  ["usuarios/_acoes.ts", "implantacao-vigencias/_acoes.ts"].every((f) =>
    /exigirAdminAal2\(\)/.test(semComentarios(ler(`src/app/(painel)/${f}`))),
  ),
  true,
);
verificar(
  "B9. a Server Action de reverter o motor segue com admin AAL2 ANTES da trava",
  /desligarMotorAction[\s\S]*?exigirAdminAal2\(\)[\s\S]*?reversaoHabilitada\(/.test(
    semComentarios(ler("src/app/(painel)/implantacao-vigencias/_acoes.ts")),
  ),
  true,
);
verificar(
  "B10. o layout só manda para /mfa quem JÁ tem fator (mfa-pendente)",
  /acesso\.situacao === "mfa-pendente"\) redirect\("\/mfa"\)/.test(
    semComentarios(ler("src/app/(painel)/layout.tsx")),
  ),
  true,
);
const tela = ler("src/app/(painel)/_components/exige-segundo-fator.tsx");
verificar(
  "B11. a tela de orientação aponta para Configurações e não oferece contornar",
  /href="\/configuracoes"/.test(tela) && !/service_role|bypass/i.test(tela),
  true,
);

console.log("\nC. Configurações > Segurança\n");
const painel = semComentarios(ler("src/app/(painel)/configuracoes/painel-configuracoes.tsx"));
verificar(
  "C1. o rótulo do novo fator é BS Soluções Logísticas (e não há mais 'BS Logística')",
  [NOME_DO_FATOR, /friendlyName: NOME_DO_FATOR/.test(painel), /"BS Logística"/.test(painel)],
  ["BS Soluções Logísticas", true, false],
);
verificar(
  "C2. o rótulo do cadastro em /mfa também é o oficial",
  /const NOME_DO_FATOR = "BS Soluções Logísticas"/.test(ler("src/app/mfa/painel-mfa.tsx")),
  true,
);
verificar(
  "C3. admin e operacional veem a desativação (sem ramo por papel)",
  /Desativar autenticação em duas etapas/.test(painel) &&
    !/papel === "operacional" \? \(/.test(painel) &&
    !/obrigatória para administradores/.test(painel),
  true,
);
verificar(
  "C4. só o titular: o fator vem de listFactors da própria sessão; nenhum id de fator em props, URL ou parâmetro",
  /listFactors\(\)/.test(painel) &&
    /unenroll\(\{ factorId: fator\.id \}\)/.test(painel) &&
    !/searchParams|useParams|factorId:\s*(props|params)/.test(painel),
  true,
);
verificar(
  "C5. depois de remover o fator a sessão é renovada e o estado relido",
  /unenroll[\s\S]*?refreshSession\(\)[\s\S]*?aoRemover\(\)/.test(painel),
  true,
);
verificar(
  "C6. a remoção exige confirmação (AlertDialog) e mostra o erro do Supabase (AAL2 exigido) sem esconder",
  /<AlertDialog open=\{confirmando\}/.test(painel) &&
    /toast\.error\(erroUnenroll\.message\)/.test(painel),
  true,
);
verificar(
  "C7. a ativação só conta depois do código válido (challengeAndVerify) e limpa fatores pendentes",
  /challengeAndVerify/.test(painel) && /status === "unverified"/.test(painel),
  true,
);
verificar("C8. nada de segredo TOTP em log", /console\.(log|info|warn|error)/.test(painel), false);
verificar(
  "C9. o texto do admin sem fator explica o opcional e o que fica fechado; o do operacional segue opcional",
  [
    /opcional/i.test(textoSemFator("admin").corpo),
    /críticas/i.test(textoSemFator("admin").corpo),
    /opcional/i.test(textoSemFator("operacional").corpo),
  ],
  [true, true, true],
);
verificar(
  "C10. a aplicação não tem rota nem Server Action que gerencie fator de OUTRA conta",
  /mfa\.(unenroll|deleteFactor)|auth\.admin\.mfa/.test(
    [
      "src/lib/admin-usuarios/servico.ts",
      "src/lib/admin-usuarios/operacoes.ts",
      "src/app/(painel)/usuarios/_acoes.ts",
    ]
      .map((f) => ler(f))
      .join("\n"),
  ),
  false,
);

console.log("\nD. Migration 032\n");
const migrations = ["20261030120000_032_mfa_opcional.sql"];
const sql = ler(`supabase/migrations/${migrations[0]}`);
const corpo = semSql(sql);
verificar(
  "D1. cria o helper do piso e o guard de leitura",
  /create or replace function public\.mfa_cotidiano_ok\(\)/.test(corpo) &&
    /create or replace function public\.condicoes_exigir_admin_leitura\(\)/.test(corpo),
  true,
);
verificar(
  "D2. o helper é fail-closed: exige sessão, conta existente e (aal2 OU aal1 sem fator verificado)",
  /auth\.uid\(\) is not null/.test(corpo) &&
    /exists \(select 1 from auth\.users/.test(corpo) &&
    /mfa_bloqueia_excecao_aal1\(\) = false/.test(corpo) &&
    /coalesce\(/.test(corpo),
  true,
);
verificar(
  "D3. a condicoes_exigir_admin() ORIGINAL e o AAL2 literal NÃO foram tocados",
  !/create or replace function public\.condicoes_exigir_admin\(\)/.test(corpo),
  true,
);
const tocadas = [
  ...corpo.matchAll(/(?:alter policy|drop policy|create policy)\s+(\w+)\s+on public\.(\w+)/g),
].map((m) => m[2]);
verificar(
  "D4. nenhuma policy de motor, auditoria, acesso por operação ou eventos financeiros foi tocada",
  tocadas.filter((t) =>
    [
      "financial_engine_settings",
      "financial_terms_audit",
      "admin_audit_log",
      "user_operation_access",
      "user_roles",
    ].includes(t),
  ),
  [],
);
verificar(
  "D5. nenhuma função crítica foi reescrita (gerar_fatura, motor, registrar_*, corrigir_*, encerrar_*, aposentar_*, adicionais, feriados, legado)",
  [...corpo.matchAll(/create or replace function public\.(\w+)\(/gi)]
    .map((m) => m[1])
    .filter((n) =>
      /gerar_fatura|alterar_motor|^registrar_|^corrigir_|^encerrar_|^aposentar_|cancelar_adicional|sincronizar|regularizar|pendencias_|divergencias_/.test(
        n,
      ),
    ),
  [],
);
const reescritas = [...corpo.matchAll(/create or replace function public\.(\w+)\(/gi)]
  .map((m) => m[1])
  .filter((n) => !["mfa_cotidiano_ok", "condicoes_exigir_admin_leitura"].includes(n))
  .sort();
verificar(
  "D6. só as 7 RPCs de leitura e o apontamento do admin foram reescritas",
  reescritas,
  [
    "ajustes_de_arredondamento_acumulado",
    "condicao_contrato_na_data",
    "custo_colaborador_na_data",
    "estado_motor_vigencia",
    "resumo_financeiro_periodo",
    "salvar_apontamento_admin",
    "saldo_de_horas_do_periodo",
    "valor_acordado_operacao_na_data",
  ].sort(),
);
verificar(
  "D7. as 7 leituras trocaram SÓ o guard (leitura); salvar_apontamento_admin trocou só o piso de MFA",
  (corpo.match(/perform public\.condicoes_exigir_admin_leitura\(\)/g) ?? []).length === 7 &&
    !/perform public\.condicoes_exigir_admin\(\)/.test(corpo) &&
    /if not public\.mfa_cotidiano_ok\(\) then/.test(corpo),
  true,
);
verificar(
  "D8. escrita em invoices e invoice_items continua estrita (aal2 literal) em insert, update e delete",
  ["invoices", "invoice_items"].every((t) =>
    ["insert", "update", "delete"].every((c) =>
      new RegExp(
        `create policy ${t}_${c}_exige_aal2 on public\\.${t} as restrictive for ${c}`,
      ).test(corpo),
    ),
  ),
  true,
);
verificar(
  "D9. as 9 tabelas cotidianas só trocaram a expressão (ALTER POLICY, nome preservado), USING e WITH CHECK",
  [
    "clients",
    "contracts",
    "employees",
    "operations",
    "shifts",
    "timesheets",
    "timesheet_entries",
    "operation_team",
    "profiles",
  ].every((t) =>
    new RegExp(
      `alter policy ${t}_exige_aal2 on public\\.${t} using \\(\\(select public\\.mfa_cotidiano_ok\\(\\)\\)\\) with check \\(\\(select public\\.mfa_cotidiano_ok\\(\\)\\)\\);`,
    ).test(corpo),
  ),
  true,
);
verificar(
  "D10. nada concedido a anon/public, nenhum service_role, helper só para authenticated e o guard de leitura sem execute",
  !/grant [^;]*\sto\s[^;]*(anon|public|service_role)/i.test(corpo) &&
    /grant execute on function public\.mfa_cotidiano_ok\(\) to authenticated/.test(corpo) &&
    /revoke all on function public\.condicoes_exigir_admin_leitura\(\) from public, anon, authenticated/.test(
      corpo,
    ),
  true,
);
verificar(
  "D11. transação única (begin/commit) e nenhuma operação destrutiva de dados",
  /^begin;/m.test(corpo) &&
    /^commit;/m.test(corpo) &&
    !/\b(delete from|truncate|drop table|drop column|alter table)\b/i.test(corpo),
  true,
);
verificar(
  "D12. o rollback documentado existe, fora de supabase/migrations, e restaura o AAL2 literal",
  existsSync(new URL("../docs/runbooks/rollback-mfa-opcional.sql", import.meta.url)) &&
    /drop function public\.mfa_cotidiano_ok\(\)/.test(
      ler("docs/runbooks/rollback-mfa-opcional.sql"),
    ) &&
    /'aal2'::text\)/.test(ler("docs/runbooks/rollback-mfa-opcional.sql")),
  true,
);
verificar(
  "D13. a 032 não edita nenhuma migration já aplicada (arquivo novo, após a 031)",
  migrations[0] > "20261029120000_031_integridade_folha_e_historico.sql",
  true,
);

console.log("\nE. Mensagem das operações críticas recusadas\n");
verificar(
  "E1. recusa de MFA do guard (42501) vira a orientação de ativar",
  mensagemDoErro({ code: "42501", message: "Autenticação de dois fatores obrigatória." }),
  MENSAGEM_EXIGE_SEGUNDO_FATOR,
);
verificar(
  "E2. recusa direta por policy estrita (exige_aal2) também",
  mensagemDoErro({
    code: "42501",
    message:
      'new row violates row-level security policy "invoices_insert_exige_aal2" for table "invoices"',
  }),
  MENSAGEM_EXIGE_SEGUNDO_FATOR,
);
verificar(
  "E3. outro 42501 NÃO vira essa mensagem (não esconde recusa de papel)",
  mensagemDoErro({ code: "42501", message: "Apenas administradores podem gerar faturas." }) ===
    MENSAGEM_EXIGE_SEGUNDO_FATOR,
  false,
);

console.log("\nF. Documentação\n");
const claude = ler("CLAUDE.md");
const seg = ler("docs/SEGURANCA.md");
verificar(
  "F1. CLAUDE.md e AGENTS.md não dizem mais que o MFA do admin é obrigatório",
  [
    /MFA TOTP é obrigatório para o admin/.test(claude),
    /MFA TOTP é obrigatório para o admin/.test(ler("AGENTS.md")),
  ],
  [false, false],
);
verificar(
  "F2. CLAUDE.md registra MFA opcional e AAL2 nas operações críticas",
  /OPCIONAL para `admin` e para `operacional`/.test(claude) &&
    /continuam exigindo AAL2 DE FATO/.test(claude),
  true,
);
verificar(
  "F3. SEGURANCA.md traz a classificação, a gestão do fator, a perda do autenticador, a implantação e o rollback",
  [
    "MFA opcional e a classificação das operações",
    "Gestão individual do fator",
    "Perda do autenticador",
    "Implantação \\(plano\\) e rollback",
    "rollback-mfa-opcional.sql",
    "Decisões pendentes",
  ].every((t) => new RegExp(t).test(seg)),
  true,
);
verificar(
  "F4. a tabela de decisão do SEGURANCA.md mostra admin sem fator liberado em AAL1",
  /\| `admin`       \| `aal1` \| sem fator       \| liberado \(AAL1\)    \|/.test(seg),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
