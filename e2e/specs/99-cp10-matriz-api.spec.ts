import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ambiente, clienteApi, emailDe, sessaoApi } from "../apoio/contas";
import { consultar, expect, test, valor } from "../apoio/fixtures";

/**
 * CP-10 (QA-BS-01) — matriz de autorização pela API local, sem a interface.
 *
 * Para TODA tabela de `public` e para TODA função `SECURITY DEFINER` que `authenticated` pode
 * executar, cada persona sem papel de administrador chama o PostgREST direto (chave publicável e
 * o JWT da própria conta) e tenta ler, inserir, alterar e excluir. O esperado é: zero linha lida,
 * nada gravado, nada alterado, nada excluído, e toda RPC recusada — exceto a lista explícita de
 * funções que só respondem sobre o próprio chamador.
 *
 * As listas vêm do catálogo do banco no momento do teste: tabela ou função nova entra sozinha na
 * matriz. Roda por último (prefixo 99), quando as specs anteriores já deixaram dados em quase todas
 * as tabelas; a tabela vazia é anotada, porque nela UPDATE/DELETE não provam nada.
 *
 * O admin é o controle: ele LÊ as tabelas de negócio (senão o "zero linha" das outras personas
 * não provaria nada) e a escrita direta em fatura continua recusada também para ele.
 */

test.describe.configure({ mode: "serial" });

type Persona = "OPER" | "SEMPAPEL" | "ANON";
type Tabela = { nome: string; pk: string[] };
type Funcao = { nome: string; args: string[] };

/** Funções que respondem SÓ sobre o chamador (booleanos de sessão) e a lista do próprio operador. */
const SOBRE_O_PROPRIO_CHAMADOR = new Set([
  "identidade_atual_utilizavel",
  "mfa_bloqueia_excecao_aal1",
  "mfa_cotidiano_ok",
]);
const DO_OPERADOR = new Set(["listar_operacoes_do_operador"]);

/** Tabelas que precisam ter linhas para a matriz não ser vazia. */
const NUCLEO = [
  "clients",
  "contracts",
  "contract_terms",
  "employees",
  "employee_cost_terms",
  "operations",
  "shifts",
  "operation_team",
  "timesheets",
  "timesheet_entries",
  "invoices",
  "invoice_items",
  "billing_additionals",
  "profiles",
  "user_roles",
];

function tabelas(): Tabela[] {
  return consultar<Tabela>(`
    select c.relname as nome,
      (select json_agg(a.attname order by array_position(i.indkey, a.attnum))
         from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = c.oid and i.indisprimary) as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`);
}

function funcoesDefiner(): Funcao[] {
  return consultar<Funcao>(`
    select p.proname as nome,
      case when p.pronargs = 0 then '[]'::json
           else coalesce((select json_agg(a.n order by a.o)
                            from unnest(p.proargnames,
                                        coalesce(p.proargmodes,
                                                 array_fill('i'::"char", array[cardinality(p.proargnames)])))
                                 with ordinality as a(n, m, o)
                           where a.m in ('i', 'b')), '[]'::json) end as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1`);
}

/**
 * Uma linha real (só a chave primária). Em `profiles` e `user_roles` é a linha do ADMIN: cada
 * persona pode mexer na própria linha, e a matriz mede o acesso à linha de OUTRA conta.
 */
function amostra(t: Tabela): Record<string, unknown> | null {
  const colunas = t.pk.map((c) => `"${c}"`).join(", ");
  const doAdmin = `(select id from auth.users where email = '${emailDe("ADMIN")}')`;
  const filtro =
    t.nome === "profiles"
      ? `where id = ${doAdmin}`
      : t.nome === "user_roles"
        ? `where user_id = ${doAdmin}`
        : "";
  return (
    consultar<Record<string, unknown>>(
      `select ${colunas} from public."${t.nome}" ${filtro} limit 1`,
    )[0] ?? null
  );
}

const contar = (t: string) => Number(valor(`select count(*) from public."${t}"`));

let clientes: Record<Persona, SupabaseClient>;
let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = await sessaoApi("ADMIN");
  clientes = {
    OPER: await sessaoApi("OPER"),
    SEMPAPEL: await sessaoApi("SEMPAPEL"),
    ANON: clienteApi(),
  };
});

test.afterAll(async () => {
  for (const c of [admin, clientes.OPER, clientes.SEMPAPEL])
    await c.auth.signOut({ scope: "local" });
});

test("M0 controle: o admin lê as tabelas do núcleo e a matriz não é vazia", async () => {
  const todas = tabelas();
  expect(todas.length, "tabelas de public").toBeGreaterThanOrEqual(31);
  const vazias = todas.filter((t) => contar(t.nome) === 0).map((t) => t.nome);
  test
    .info()
    .annotations.push({ type: "tabelas vazias", description: vazias.join(", ") || "nenhuma" });
  for (const t of NUCLEO) {
    expect(contar(t), `${t} tem linhas para a matriz`).toBeGreaterThan(0);
    const { data, error } = await admin.from(t).select("*").limit(1);
    expect(error, `admin lê ${t}`).toBeNull();
    expect((data ?? []).length, `admin lê ${t}`).toBeGreaterThan(0);
  }
});

for (const persona of ["OPER", "SEMPAPEL", "ANON"] as const) {
  test(`M1 ${persona}: nenhuma tabela de public é lida, gravada, alterada ou excluída pela API`, async () => {
    const c = clientes[persona];
    const achados: string[] = [];
    for (const t of tabelas()) {
      const antes = contar(t.nome);
      const linha = amostra(t);

      const leitura = await c.from(t.nome).select("*").limit(5);
      const lidas = (leitura.data ?? []).length;
      // profiles e user_roles: cada conta lê só a PRÓPRIA linha (anônimo nenhuma).
      const proprias = t.nome === "profiles" || t.nome === "user_roles";
      if (proprias ? lidas > 1 : lidas > 0) achados.push(`${t.nome}: SELECT leu ${lidas}`);

      const insercao = await c.from(t.nome).insert({}).select();
      if (!insercao.error) achados.push(`${t.nome}: INSERT aceito`);

      if (linha) {
        let alterar = c.from(t.nome).update(linha);
        for (const [k, v] of Object.entries(linha)) alterar = alterar.eq(k, v as string);
        const alteracao = await alterar.select();
        if (!alteracao.error && (alteracao.data ?? []).length > 0)
          achados.push(`${t.nome}: UPDATE alterou ${(alteracao.data ?? []).length}`);

        let excluir = c.from(t.nome).delete();
        for (const [k, v] of Object.entries(linha)) excluir = excluir.eq(k, v as string);
        const exclusao = await excluir.select();
        if (!exclusao.error && (exclusao.data ?? []).length > 0)
          achados.push(`${t.nome}: DELETE excluiu ${(exclusao.data ?? []).length}`);
      }
      if (contar(t.nome) !== antes)
        achados.push(`${t.nome}: contagem mudou ${antes} → ${contar(t.nome)}`);
    }
    expect(achados, achados.join("\n")).toEqual([]);
  });
}

for (const persona of ["OPER", "SEMPAPEL", "ANON"] as const) {
  test(`M2 ${persona}: toda RPC SECURITY DEFINER é recusada, salvo as que respondem sobre o próprio chamador`, async () => {
    const c = clientes[persona];
    const funcoes = funcoesDefiner();
    expect(funcoes.length, "funções DEFINER executáveis por authenticated").toBeGreaterThan(50);
    const aceitas: string[] = [];
    const naoEncontradas: string[] = [];
    for (const f of funcoes) {
      const corpo = Object.fromEntries(f.args.map((a) => [a, null]));
      const { error } = await c.rpc(f.nome, corpo);
      if (!error) aceitas.push(f.nome);
      // "função não encontrada" seria recusa falsa: a chamada nem chegou ao banco.
      else if (error.code === "PGRST202") naoEncontradas.push(f.nome);
    }
    expect(naoEncontradas, "toda RPC foi de fato chamada").toEqual([]);
    const permitidas = new Set<string>(
      persona === "ANON"
        ? []
        : [...SOBRE_O_PROPRIO_CHAMADOR, ...(persona === "OPER" ? [...DO_OPERADOR] : [])],
    );
    const indevidas = aceitas.filter((n) => !permitidas.has(n));
    expect(indevidas, `RPCs aceitas para ${persona}: ${indevidas.join(", ")}`).toEqual([]);
  });
}

test("M3 controle: o admin passa da guarda das RPCs (a recusa acima é do papel, não do payload)", async () => {
  const recusadasPorPapel: string[] = [];
  for (const f of funcoesDefiner()) {
    const corpo = Object.fromEntries(f.args.map((a) => [a, null]));
    const { error } = await admin.rpc(f.nome, corpo);
    if (error?.code === "42501") recusadasPorPapel.push(f.nome);
    expect(error?.code, `${f.nome}: a chamada chegou ao banco`).not.toBe("PGRST202");
  }
  // Só as RPCs do operador recusam o admin pelo papel; as demais param no payload nulo (22023…).
  expect(recusadasPorPapel.sort()).toEqual(
    [
      "listar_apontamentos_do_operador",
      "listar_equipe_do_operador",
      "listar_operacoes_do_operador",
      "listar_turnos_do_operador",
      "salvar_apontamento_operacional",
    ].sort(),
  );
});

test("M4 fatura: nem o admin escreve direto em invoices e invoice_items pela API", async () => {
  for (const t of ["invoices", "invoice_items"]) {
    const antes = contar(t);
    const linha = amostra({ nome: t, pk: ["id"] });
    expect(linha, `${t} tem linha`).not.toBeNull();
    const id = String(linha!["id"]);
    expect((await admin.from(t).insert({}).select()).error, `${t}: INSERT`).not.toBeNull();
    const alt = await admin.from(t).update({ id }).eq("id", id).select();
    expect(!alt.error && (alt.data ?? []).length > 0, `${t}: UPDATE`).toBe(false);
    const exc = await admin.from(t).delete().eq("id", id).select();
    expect(!exc.error && (exc.data ?? []).length > 0, `${t}: DELETE`).toBe(false);
    expect(contar(t), `${t}: contagem`).toBe(antes);
  }
});

test("M5 lançamento faturado: nem o admin altera nem exclui pela API", async () => {
  const faturado = consultar<{ id: string; billed_amount: string; check_out: string | null }>(
    `select id, billed_amount::text, check_out::text from public.timesheet_entries
      where invoice_id is not null and check_out is not null limit 1`,
  )[0];
  expect(faturado, "existe lançamento faturado").toBeTruthy();
  const alt = await admin
    .from("timesheet_entries")
    .update({ check_out: "23:59:00" })
    .eq("id", faturado!.id)
    .select();
  expect(alt.error, "UPDATE recusado").not.toBeNull();
  const exc = await admin.from("timesheet_entries").delete().eq("id", faturado!.id).select();
  expect(exc.error, "DELETE recusado").not.toBeNull();
  const depois = consultar<{ billed_amount: string; check_out: string | null }>(
    `select billed_amount::text, check_out::text from public.timesheet_entries where id = '${faturado!.id}'`,
  )[0];
  expect(depois).toEqual({
    billed_amount: faturado!.billed_amount,
    check_out: faturado!.check_out,
  });
});

/** Cliente que só carrega um JWT já emitido (sem login, sem renovação). */
function comToken(token: string): SupabaseClient {
  return createClient(
    ambiente("NEXT_PUBLIC_SUPABASE_URL"),
    ambiente("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

test("M6 depois do logout, o JWT emitido antes (ainda no prazo) não lê nada nem chama RPC", async () => {
  const sessao = await sessaoApi("ADMIN");
  const token = (await sessao.auth.getSession()).data.session?.access_token;
  expect(token, "token do admin").toBeTruthy();
  const antes = await comToken(token!).from("clients").select("id").limit(1);
  expect((antes.data ?? []).length, "antes do logout o token lê").toBe(1);

  // O app sai com signOut() (escopo global); aqui basta encerrar ESTA sessão.
  await sessao.auth.signOut({ scope: "local" });

  const depois = await comToken(token!).from("clients").select("id").limit(1);
  expect(depois.data ?? [], "o JWT antigo não lê tabela de negócio").toEqual([]);
  const rpc = await comToken(token!).rpc("resumo_financeiro_periodo", {
    p_inicio: "2027-01-01",
    p_fim: "2027-01-31",
    p_client_id: null,
    p_operation_id: null,
  });
  expect(rpc.error, "nem chama RPC financeira").not.toBeNull();
});

test("M7 cabeçalhos: CSP com nonce, anti-frame e sem anunciar o framework (X-Powered-By)", async ({
  request,
}) => {
  for (const rota of ["/login", "/api/fechamento?cliente=x"]) {
    const r = await request.get(rota, { maxRedirects: 0 });
    const h = r.headers();
    expect(h["x-powered-by"], `${rota}: X-Powered-By`).toBeUndefined();
    expect(h["x-frame-options"], `${rota}: X-Frame-Options`).toBe("DENY");
    expect(h["x-content-type-options"], `${rota}: nosniff`).toBe("nosniff");
    if (rota === "/login") {
      expect(h["content-security-policy"], "CSP").toMatch(/script-src 'self' 'nonce-[^']+'/);
      expect(h["content-security-policy"], "CSP").toContain("frame-ancestors 'none'");
    }
  }
});

test("M8 052: a RPC legada de contêiner não cria nada pela API — nem para o admin (AUT-CP06-01)", async () => {
  const antes = contar("container_services");
  const corpo = {
    p_dados: {},
    p_idempotency_key: "5c10a0d0-0000-4000-8000-0000000000e8",
    p_reason: "E2E 052: tentativa pela API",
  };
  const codigos: Record<string, string | null> = {};
  for (const [nome, c] of [
    ["ADMIN", admin],
    ["OPER", clientes.OPER],
    ["SEMPAPEL", clientes.SEMPAPEL],
    ["ANON", clientes.ANON],
  ] as const) {
    const { error } = await c.rpc("registrar_servico_container", corpo);
    expect(error, `${nome}: recusado`).not.toBeNull();
    expect(error?.code, `${nome}: a chamada chegou ao banco`).not.toBe("PGRST202");
    codigos[nome] = error?.code ?? null;
  }
  // Sem EXECUTE o PostgreSQL recusa antes do corpo da função: 42501 para todos.
  expect(codigos).toEqual({ ADMIN: "42501", OPER: "42501", SEMPAPEL: "42501", ANON: "42501" });
  expect(contar("container_services"), "nada foi gravado").toBe(antes);
  expect(
    funcoesDefiner().some((f) => f.nome === "registrar_servico_container"),
    "fora da lista de RPCs executáveis por authenticated",
  ).toBe(false);
});
