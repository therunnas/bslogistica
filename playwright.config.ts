import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra o app em loopback e o Supabase LOCAL descartável (scripts/e2e-local.sh).
 * Nunca aponta para Preview, HML ou Production: a baseURL é fixa em 127.0.0.1 e a fixture
 * `test` (e2e/apoio/fixtures.ts) aborta qualquer requisição do navegador fora do loopback.
 */
const SHA = (process.env["E2E_SHA"] ?? "local").slice(0, 12);

export default defineConfig({
  testDir: "./e2e/specs",
  // Um worker e em ordem: os cenários gravam no mesmo banco local; cada arquivo usa nomes
  // próprios, mas a ordem fixa deixa as evidências reproduzíveis.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/apoio/login-global.ts",
  outputDir: `e2e-results/artefatos-${SHA}`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `e2e-results/relatorio-${SHA}`, open: "never" }],
    ["json", { outputFile: "e2e-results/resultado.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
