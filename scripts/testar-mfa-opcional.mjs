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
import { execSync } from "node:child_process";
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

console.log("\nB. MFA só protege o login: nenhum guard pede AAL2 (AUTH-01D.R1)\n");
const aut = semComentarios(ler("src/app/(painel)/_autorizacao.ts"));
verificar(
  "B1. lerAcesso devolve 'liberado' sem expor nível (nenhuma funcionalidade depende de AAL)",
  !/nivel: /.test(aut) &&
    !/NivelAcesso/.test(aut) &&
    /situacao: "liberado"; email: string; papeis: Papel\[\] \}/.test(aut),
  true,
);
verificar(
  "B2. o tipo Acesso não tem mais 'mfa-ausente'",
  /situacao: "mfa-ausente"/.test(aut),
  false,
);
const aa = semComentarios(ler("src/lib/admin-usuarios/autorizacao.ts"));
verificar(
  "B3. exigirAdminAtor exige só 'liberado' e papel admin (sem nível aal2)",
  /acesso\.situacao !== "liberado" \|\| !ehAdmin\(acesso\.papeis\)/.test(aa) &&
    !/aal2|nivel/.test(aa),
  true,
);
const guard = semComentarios(ler("src/app/(painel)/_exigir-admin.tsx"));
verificar(
  "B4. a tela ExigeSegundoFator e o guard exigirAdminAal2Tela foram removidos",
  [
    existsSync(new URL("../src/app/(painel)/_components/exige-segundo-fator.tsx", import.meta.url)),
    /ExigeSegundoFator|exigirAdminAal2/.test(guard),
  ],
  [false, false],
);
verificar(
  "B5. exigirAdmin confere sessão liberada e papel admin, só isso",
  /export async function exigirAdmin\(\)[\s\S]*?acesso\.situacao !== "liberado" \|\| !ehAdmin\(acesso\.papeis\)[\s\S]*?return null;\s*\}/.test(
    guard,
  ) && !/aal|nivel/i.test(guard),
  true,
);
const pag = (p) => semComentarios(ler(`src/app/(painel)/${p}/page.tsx`));
verificar(
  "B6. Usuários e Implantação usam exigirAdmin como as demais telas",
  /await exigirAdmin\(\)/.test(pag("usuarios")) &&
    /await exigirAdmin\(\)/.test(pag("implantacao-vigencias")),
  true,
);
verificar(
  "B7. todas as telas administrativas seguem com exigirAdmin",
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
  "B8. Server Actions de usuários e motor chamam exigirAdminAtor antes de agir",
  ["usuarios/_acoes.ts", "implantacao-vigencias/_acoes.ts"].every((f) =>
    /exigirAdminAtor\(\)/.test(semComentarios(ler(`src/app/(painel)/${f}`))),
  ),
  true,
);
verificar(
  "B9. a Server Action de reverter o motor segue com admin ANTES da trava de servidor",
  /desligarMotorAction[\s\S]*?exigirAdminAtor\(\)[\s\S]*?reversaoHabilitada\(/.test(
    semComentarios(ler("src/app/(painel)/implantacao-vigencias/_acoes.ts")),
  ),
  true,
);
verificar(
  "B10. o layout só manda para /mfa quem JÁ tem fator (mfa-pendente): o desafio de LOGIN segue obrigatório",
  /acesso\.situacao === "mfa-pendente"\) redirect\("\/mfa"\)/.test(
    semComentarios(ler("src/app/(painel)/layout.tsx")),
  ),
  true,
);
verificar(
  "B11. nenhum arquivo de src/app ou src/lib testa nível aal2 para liberar funcionalidade (só mfa/recuperação)",
  (() => {
    const lista = execSync(
      'grep -rlE "nivel === |nivel !== |currentLevel" src --include=*.ts --include=*.tsx || true',
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    return lista.filter(
      (f) =>
        !/lib\/mfa\.ts|redefinir-senha|recuperacao-senha|confirmar-recuperacao|app\/mfa\/|_autorizacao\.ts|vigencias\.tsx/.test(
          f,
        ),
    );
  })(),
  [],
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
  "C9. o texto do admin sem fator diz que é opcional e que a conta fica só com a senha (nada de 'operações críticas fechadas'); o do operacional segue opcional",
  [
    /opcional/i.test(textoSemFator("admin").corpo),
    /apenas pela senha/i.test(textoSemFator("admin").corpo),
    /críticas|fechadas/i.test(textoSemFator("admin").corpo),
    /opcional/i.test(textoSemFator("operacional").corpo),
  ],
  [true, true, false, true],
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
  .filter(
    (n) =>
      !["mfa_cotidiano_ok", "condicoes_exigir_admin_leitura", "exigir_aal2_taxa_legada"].includes(
        n,
      ),
  )
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

verificar(
  "D14. colunas de taxa legadas exigem AAL2 (INSERT e UPDATE) com motor ligado ou desligado: 3 gatilhos próprios, 42501, exceção só para postgres/service_role",
  ["contracts", "employees", "operations"].every((t) =>
    new RegExp(
      `create trigger trg_${t}_exige_aal2_taxa_legada\\s+before insert or update of [a-z_, ]+ on public\\.${t}`,
    ).test(corpo),
  ) &&
    /coalesce\(auth\.jwt\(\) ->> 'aal', ''\) <> 'aal2'/.test(corpo) &&
    /errcode = '42501'/.test(corpo) &&
    /current_user in \('postgres', 'service_role'\)/.test(corpo),
  true,
);
verificar(
  "D15. esses gatilhos não são os *_bloqueia_taxa_direta (que o motor liga e desliga) e o rollback os remove",
  [
    !/alter table[^;]*(enable|disable) trigger/i.test(corpo),
    /drop trigger trg_contracts_exige_aal2_taxa_legada/.test(
      ler("docs/runbooks/rollback-mfa-opcional.sql"),
    ),
    /drop function public\.exigir_aal2_taxa_legada\(\)/.test(
      ler("docs/runbooks/rollback-mfa-opcional.sql"),
    ),
  ],
  [true, true, true],
);

console.log("\nG. Migration 033 (taxas legadas exigem vigência com o motor ligado)\n");
const m33 = "20261031120000_033_taxa_legada_exige_vigencia.sql";
const sql33 = semSql(ler(`supabase/migrations/${m33}`));
verificar(
  "G1. a 033 é posterior à 032 e a 032 não foi tocada para isso (nenhuma menção à regra nova)",
  [
    m33 > migrations[0],
    /exigir_vigencia_na_taxa_legada/.test(ler(`supabase/migrations/${migrations[0]}`)),
  ],
  [true, false],
);
verificar(
  "G2. três CONSTRAINT TRIGGER AFTER INSERT, deferidos, com WHEN que exclui postgres/service_role",
  ["contracts", "employees", "operations"].every((t) =>
    new RegExp(
      `create constraint trigger trg_${t}_exige_vigencia_na_taxa\\s+after insert on public\\.${t}\\s+deferrable initially deferred\\s+for each row\\s+when \\(current_user not in \\('postgres', 'service_role'\\)`,
    ).test(sql33),
  ),
  true,
);
verificar(
  "G3. a função é SECURITY INVOKER, com search_path fixo e sem EXECUTE para public/anon/authenticated",
  [
    /security invoker/.test(sql33),
    /set search_path = pg_catalog, public, pg_temp/.test(sql33),
    /revoke all on function public\.exigir_vigencia_na_taxa_legada\(\) from public, anon, authenticated/.test(
      sql33,
    ),
    /\bgrant\b/i.test(sql33),
  ],
  [true, true, true, false],
);
verificar(
  "G4. nenhuma exceção controlável pelo cliente: sem flag, parâmetro, GUC (current_setting/set_config) nem leitura do JWT",
  /current_setting|set_config|auth\.jwt|request\.jwt/i.test(sql33),
  false,
);
verificar(
  "G5. a recusa é 55000 e nunca concede nada: sem policy, sem alter policy, sem grant, sem service_role em chave",
  [
    /errcode = '55000'/.test(sql33),
    /(create|alter|drop) policy/i.test(sql33),
    /grant /i.test(sql33),
  ],
  [true, false, false],
);
verificar(
  "G6. 'motor ligado' vem do catálogo (gatilho de bloqueio habilitado), não da tabela da chave sob RLS (evita fail-open)",
  [/from pg_trigger/.test(sql33), /from public\.financial_engine_settings/.test(sql33)],
  [true, false],
);
verificar(
  "G7. compara com a vigência ATIVA de valor igual nas três tabelas de vigência",
  ["contract_terms", "employee_cost_terms", "operation_terms"].every((t) =>
    new RegExp(`from public\\.${t} t[\\s\\S]*?t\\.active`).test(sql33),
  ),
  true,
);
verificar(
  "G8. rollback da 033 existe, fora de supabase/migrations, e dropa os 3 gatilhos e a função",
  (() => {
    const r = ler("docs/runbooks/rollback-taxa-legada-vigencia.sql");
    return (
      ["contracts", "employees", "operations"].every((t) =>
        new RegExp(`drop trigger trg_${t}_exige_vigencia_na_taxa on public\\.${t}`).test(r),
      ) && /drop function public\.exigir_vigencia_na_taxa_legada\(\)/.test(r)
    );
  })(),
  true,
);
verificar(
  "G9. suíte SQL da 033 existe e o CI roda as suítes novas",
  [
    existsSync(new URL("../supabase/tests/033_taxa_legada_exige_vigencia.sql", import.meta.url)),
    /Teste mfa-opcional/.test(ler(".github/workflows/ci.yml")),
  ],
  [true, true],
);
verificar(
  "G10. documentação registra a 033 e a decisão (INSERT direto exige vigência com motor ligado)",
  (() => {
    const d = ler("docs/SEGURANCA.md");
    return [
      /Integridade financeira com o motor ligado \(033\)/.test(d),
      /rollback-taxa-legada-vigencia\.sql/.test(d),
      /na mesma transação/.test(d),
    ];
  })(),
  [true, true, true],
);

console.log("\nH. Migration 034 (MFA protege só o login)\n");
const m34 = "20261101120000_034_mfa_somente_login.sql";
const sql34 = semSql(ler(`supabase/migrations/${m34}`));
verificar(
  "H1. a 034 é posterior à 033 e as migrations 032 e 033 não mencionam a 034",
  [
    m34 > "20261031120000_033_taxa_legada_exige_vigencia.sql",
    /034/.test(semSql(ler("supabase/migrations/20261030120000_032_mfa_opcional.sql"))),
    /034/.test(sql33),
  ],
  [true, false, false],
);
verificar(
  "H2. troca o aal2 literal por mfa_cotidiano_ok() nas 3 funções e nas 14 policies, e não deixa 'aal2' cru",
  [
    (sql34.match(/alter policy/gi) ?? []).length,
    /create or replace function public\.(condicoes_exigir_admin|gerar_fatura|exigir_aal2_taxa_legada)/gi.test(
      sql34,
    ),
    /'aal2'/.test(sql34),
  ],
  [14, true, false],
);
verificar(
  "H3. nenhuma verificação de papel removida: gerar_fatura e condicoes_exigir_admin seguem com has_role; policies seguem com has_role('admin')",
  [
    /has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/.test(sql34),
    (sql34.match(/has_role/g) ?? []).length >= 6,
  ],
  [true, true],
);
verificar(
  "H4. nada concedido a anon/public, sem service_role, sem policy nova, sem drop, transação única",
  [
    /grant /i.test(sql34),
    /grant [^;]*service_role/i.test(sql34),
    /create policy|drop policy|drop function|drop trigger/i.test(sql34),
    /^begin;/m.test(sql34) && /^commit;/m.test(sql34),
  ],
  [false, false, false, true],
);
verificar(
  "H5. a 034 não toca a 033 (nenhuma menção aos gatilhos de vigência)",
  /exigir_vigencia_na_taxa|trg_.*_exige_vigencia/.test(sql34),
  false,
);
verificar(
  "H6. rollback da 034 restaura o AAL2 literal e não toca a 033",
  (() => {
    const r = ler("docs/runbooks/rollback-mfa-somente-login.sql");
    return [
      /'aal2'/.test(r),
      /exigir_vigencia_na_taxa|trg_.*_exige_vigencia/.test(r),
      (r.match(/alter policy/gi) ?? []).length,
    ];
  })(),
  [true, false, 14],
);
verificar(
  "H7. suíte SQL da 034 existe",
  existsSync(new URL("../supabase/tests/034_mfa_somente_login.sql", import.meta.url)),
  true,
);

console.log("\nE. Mensagem das operações críticas recusadas\n");
verificar(
  "E1. recusa de MFA do guard (42501: TOTP pendente) vira a orientação de concluir o login",
  mensagemDoErro({ code: "42501", message: "Autenticação de dois fatores obrigatória." }),
  MENSAGEM_EXIGE_SEGUNDO_FATOR,
);
verificar(
  "E2. recusa direta por policy (exige_aal2, nome histórico) também",
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
  "F2. CLAUDE.md e AGENTS.md registram: MFA protege só o login, nenhuma funcionalidade exige AAL2",
  [
    /protege só o LOGIN/.test(claude),
    /Nenhuma funcionalidade exige AAL2/.test(claude),
    /protege só o LOGIN/.test(ler("AGENTS.md")),
    /continuam exigindo AAL2 DE FATO/.test(claude + ler("AGENTS.md")),
  ],
  [true, true, true, false],
);
verificar(
  "F3. SEGURANCA.md traz política, matriz, gestão do fator, perda do autenticador, rollout/compatibilidade, rollback e o runbook do 55006",
  [
    "MFA só no login: política, matriz e rollout",
    "Matriz de permissões",
    "Gestão individual do fator",
    "Perda do autenticador",
    "Compatibilidade entre versões",
    "rollback-mfa-somente-login.sql",
    "SET CONSTRAINTS ALL IMMEDIATE",
    "55006",
  ].every((t) => new RegExp(t).test(seg)),
  true,
);
verificar(
  "F4. SEGURANCA.md registra o limite do Supabase (unenroll só exige AAL2; código novo é da interface) e o risco de contas sem MFA",
  [
    /apenas sessão AAL2/.test(seg),
    /imposto pela \*\*interface\*\*/.test(seg),
    /protegida \*\*apenas pela senha\*\*/.test(seg),
    /administradores ativam o MFA voluntariamente/.test(seg),
  ],
  [true, true, true, true],
);
verificar(
  "F5. as revisões anteriores ficam como histórico e não aprovam o novo HEAD",
  /Não são aprovação\*\* da política final/.test(seg),
  true,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
