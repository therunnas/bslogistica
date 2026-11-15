import {
  consultar,
  estadoDe,
  expect,
  psqlSomenteLeitura,
  semErroDeAplicacao,
  test,
} from "../apoio/fixtures";

/**
 * Fumaça: o ambiente local é o esperado, o admin sintético entra e todas as telas abrem; o
 * operacional entra e fica restrito. Não grava nada além do que o próprio login cria.
 */

test.describe("ambiente local", () => {
  test("banco local com as migrations do repositório (58: as 56 da Production + a 052 e a 053 só locais; motor ON, resolução OFF, dobro ON)", () => {
    const estado = consultar<{
      migrations: number;
      head: string;
      motor: boolean;
      resolucao: boolean;
      dobro: boolean;
      sem_rls: number;
    }>(`select
          (select count(*)::int from supabase_migrations.schema_migrations) as migrations,
          (select max(version) from supabase_migrations.schema_migrations) as head,
          (select vigencia_ativa from public.financial_engine_settings) as motor,
          (select tarifas_por_funcao from public.pricing_settings) as resolucao,
          (select dias_especiais_em_dobro from public.pricing_settings) as dobro,
          (select count(*)::int from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
               and not c.relrowsecurity) as sem_rls`)[0];
    expect(estado).toEqual({
      migrations: 58,
      head: "20261120120000",
      motor: true,
      resolucao: false,
      dobro: true,
      sem_rls: 0,
    });
  });

  test("a leitura do banco local é somente leitura", () => {
    expect(() => consultar("select 1 from public.clients limit 0")).not.toThrow();
    expect(() => psqlSomenteLeitura("insert into public.clients (name) values ('x')")).toThrow(
      /read-only transaction/,
    );
  });
});

test.describe("administrador", () => {
  test.use({ storageState: estadoDe("admin") });

  const telas: Array<[string, RegExp]> = [
    ["/dashboard", /^Dashboard$/],
    ["/apontamentos", /^Apontamento diário$/],
    ["/operacoes", /^Operações$/],
    ["/clientes", /^Clientes e contratos$/],
    ["/colaboradores", /^Colaboradores$/],
    ["/faturamento", /^Faturamento$/],
    ["/fechamento", /^Fechamento$/],
    ["/relatorios", /^Relatórios$/],
    ["/usuarios", /^Usuários$/],
    ["/configuracoes", /^Segurança$/],
  ];

  for (const [caminho, titulo] of telas) {
    test(`abre ${caminho}`, async ({ page }) => {
      await page.goto(caminho);
      await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
      await semErroDeAplicacao(page);
    });
  }
});

test.describe("operacional", () => {
  test.use({ storageState: estadoDe("operacional") });

  test("é levado à tela do operador (ainda sem operação atribuída)", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/operacional/);
    // Sem linha em user_operation_access a própria RPC devolve lista vazia e a tela avisa.
    await expect(
      page.getByText("Nenhuma operação atribuída a você. Procure o administrador."),
    ).toBeVisible();
    await semErroDeAplicacao(page);
  });

  for (const caminho of ["/clientes", "/faturamento", "/fechamento", "/colaboradores"]) {
    test(`não abre ${caminho}`, async ({ page }) => {
      await page.goto(caminho);
      await expect(page.getByText("Área administrativa restrita")).toBeVisible();
    });
  }
});
