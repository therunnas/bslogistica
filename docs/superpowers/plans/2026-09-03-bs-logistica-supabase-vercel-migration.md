# BS Logística Supabase and Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing BS Logística application on a BS-owned Supabase backend and a Vercel Preview, then promote it safely to production and attach the custom domain.

**Architecture:** Keep the current single-company data model: BS Logística is the operator and `clients` are service customers. Use the existing imperative migrations as the schema baseline, add append-only hardening migrations, query Supabase from the browser with a publishable key protected by RLS, and deploy the TanStack Start SSR application through Nitro on Vercel.

**Tech Stack:** Node.js 22, npm, TypeScript, React 19, TanStack Start, Vite, Nitro, Tailwind CSS 4, Supabase Auth/Postgres/Data API, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-03-bs-logistica-migration-scope.md`

## Global Constraints

- BS Logística is the only operating company; do not add tenant or organization tables in this migration.
- Use Node.js 22 or later; current Supabase JS releases no longer support Node.js 20.
- Use npm and `package-lock.json` as the only package-management lockfile.
- Never commit `.env`, credentials, database passwords, service-role keys or secret API keys.
- A `VITE_` variable is browser-visible and may contain only the Supabase URL, project ID and publishable key.
- Keep all existing migration files immutable; database changes go into new append-only migrations.
- Develop against local Supabase first and BS Logística DEV second. Production is forbidden until the Preview gate passes and the user explicitly approves production work.
- Before every remote Supabase command, prove the linked project ref is the intended DEV or production project.
- Do not rewrite published Lovable/Git history through force push, rebase, amend or squash.
- Do not commit, push, publish or deploy without explicit authorization at the relevant checkpoint.

## File Map

- `.gitignore`: prevent local environment and Supabase temporary state from entering Git.
- `.env.example`: document public runtime variable names without values.
- `package.json`: standardize npm scripts for checks and Vercel builds.
- `vite.config.ts`: select the Vercel-compatible Nitro target while preserving the custom server entry.
- `vercel.json`: explicitly identify the TanStack Start framework to Vercel.
- `src/routes/auth.tsx`: convert public self-registration to an internal sign-in flow.
- `src/routes/_authenticated/faturamento.tsx`: replace the three-step browser write with one database RPC before production.
- `src/integrations/supabase/client.ts`: retain only public client configuration.
- `src/integrations/supabase/types.ts`: regenerate from the verified BS Logística schema.
- `supabase/config.toml`: local Auth URLs and non-secret project configuration.
- `supabase/migrations/`: immutable baseline plus append-only security, onboarding, index and billing migrations.
- `supabase/tests/`: SQL tests for grants, RLS and the atomic invoice function.
- `docs/runbooks/deployment.md`: exact Preview, production and rollback procedures.

---

## Milestone 1: Safe, reproducible local baseline

### Task 1: Protect configuration and establish source control

**Files:**

- Modify: `.gitignore`
- Create: `.env.example`
- Remove after npm verification: `bun.lock`

**Produces:** A private-repository-ready folder with no populated environment file eligible for staging.

- [ ] Add `.env`, `.env.*`, `!.env.example`, `.supabase/`, `supabase/.temp/` and `.vercel/` to `.gitignore`.
- [ ] Create `.env.example` containing only these empty names:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

- [ ] Confirm the current `.env` remains local and populated values are not copied into documentation or chat.
- [ ] Run `npm ci` and confirm dependency installation succeeds from `package-lock.json`.
- [ ] Remove `bun.lock` only after `npm ci` succeeds.
- [ ] Run `git init` only after `git check-ignore -v .env` proves `.env` is ignored.
- [ ] Create or connect a private GitHub repository owned by BS Logística.
- [ ] Stop for explicit authorization before the first commit or push.

### Task 2: Make the baseline checkable

**Files:**

- Modify: `package.json`
- Modify: files reported by ESLint, without changing business behavior

**Produces:** One repeatable local quality gate.

- [ ] Add scripts `typecheck: tsc --noEmit` and `check: npm run lint && npm run typecheck && npm run build`.
- [ ] Run `npx prettier --check .` and record the current formatting failure.
- [ ] Run `npx prettier --write .` as a dedicated formatting-only change.
- [ ] Change the never-reassigned `timer` in `src/integrations/supabase/previewAuthStorage.ts` from `let` to `const`.
- [ ] Run `npm run lint`; expected result: zero errors. Record any remaining warnings separately.
- [ ] Run `npm run typecheck`; expected result: exit code 0.
- [ ] Run `npm run build`; expected result: exit code 0.
- [ ] Run `npm audit --omit=dev --audit-level=high`; expected result: no high or critical production vulnerability.
- [ ] Stop for review before committing the baseline cleanup.

### Task 3: Prove the local Supabase toolchain

**Files:**

- Inspect: `supabase/config.toml`
- Inspect: `supabase/migrations/*.sql`

**Produces:** A disposable local database recreated exclusively from versioned migrations.

- [ ] Run `node --version`; expected major version: 22 or later.
- [ ] Run `docker version`; expected result: client and server are available.
- [ ] Run `npx supabase --version`; record the installed CLI version.
- [ ] Run `npx supabase --help`, `npx supabase db --help` and `npx supabase migration --help` before choosing flags.
- [ ] Run `npx supabase start`; confirm the command reports local API and Studio endpoints.
- [ ] Run `npx supabase db reset`; expected result: all three existing migrations apply in timestamp order.
- [ ] Run `npx supabase migration list`; expected result: the three local migration files appear in the local column.
- [ ] If Docker or the local stack is unavailable, stop here. Do not substitute an unknown remote database.

---

## Milestone 2: Backend ready for BS Logística DEV

### Task 4: Add secure internal-user onboarding

**Files:**

- Create through `npx supabase migration new add_internal_user_onboarding`: the returned migration file
- Modify: `src/routes/auth.tsx`
- Create: `supabase/tests/internal_user_onboarding.sql`

**Interfaces:**

- Produces: `public.handle_new_user() returns trigger`
- Preserves: `public.user_roles(user_id, role)` as the authorization source

- [ ] Write a SQL test proving that a new Auth user receives one `profiles` row and zero `user_roles` rows.
- [ ] Run `npx supabase test db`; expected result before implementation: the onboarding test fails.
- [ ] Add this trigger function and trigger to the migration returned by `npx supabase migration new add_internal_user_onboarding`:

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

- [ ] Inspect the applied trigger in local Studio and verify it inserts `id`, `email` and the optional `full_name` into `public.profiles`.
- [ ] Do not assign `admin` or `operacional` automatically; roles are granted explicitly by an administrator.
- [ ] Remove the self-signup toggle and `signUp` branch from `src/routes/auth.tsx`; keep password sign-in and clear invalid-login feedback.
- [ ] Configure Supabase DEV Auth so public sign-ups are disabled and internal users are invited from the dashboard for the first release.
- [ ] Run `npx supabase db reset` and `npx supabase test db`; expected result: onboarding test passes.

### Task 5: Harden grants, RLS and indexes

**Files:**

- Create through `npx supabase migration new harden_rls_and_indexes`: the returned migration file
- Create: `supabase/tests/rls_roles.sql`

**Interfaces:**

- Admin: reads and writes commercial/master data.
- Operacional: reads master data and manages operational records.
- Anonymous and authenticated users without a role: no business-table access.

- [ ] Write tests for anonymous, roleless, operacional and admin access to `clients`, `contracts`, `employees`, `operations`, `timesheets`, `timesheet_entries`, `invoices` and `invoice_items`.
- [ ] Run `npx supabase test db`; expected result before hardening: any uncovered authorization or indexing assumption is visible.
- [ ] Preserve RLS on every exposed table and preserve both `USING` and `WITH CHECK` on update-capable policies.
- [ ] Explicitly grant Data API table access only to `authenticated` and `service_role`; grant no business-table access to `anon`.
- [ ] Add B-tree indexes for foreign-key access paths: `contracts.client_id`, `operations.client_id`, `operations.contract_id`, `operation_team.operation_id`, `operation_team.employee_id`, `timesheets.operation_id`, `timesheets.shift_id`, `timesheet_entries.timesheet_id`, `timesheet_entries.employee_id`, `timesheet_entries.replacement_employee_id`, `timesheet_entries.invoice_id`, `invoices.client_id`, `invoice_items.invoice_id` and `invoice_items.operation_id`.
- [ ] Run `npx supabase db reset` and `npx supabase test db`; expected result: all role tests pass.
- [ ] Run the local database linter/advisors supported by the installed CLI and resolve every security finding before remote deployment.

### Task 6: Make invoice creation atomic before production

**Files:**

- Create through `npx supabase migration new create_invoice_transaction`: the returned migration file
- Modify: `src/routes/_authenticated/faturamento.tsx`
- Create: `supabase/tests/create_invoice_transaction.sql`
- Regenerate: `src/integrations/supabase/types.ts`

**Interfaces:**

- Produces: `public.create_invoice(p_client_id uuid, p_period_start date, p_period_end date, p_entry_ids uuid[]) returns uuid`
- Consumes: authenticated admin identity and open, unbilled `timesheet_entries`

- [ ] Write a test that calls the function with two eligible entries and asserts one invoice, its items and both entry links are committed.
- [ ] Write a rollback test that includes an ineligible entry and asserts no invoice, item or link remains.
- [ ] Run `npx supabase test db`; expected result before implementation: both tests fail because the function does not exist.
- [ ] Implement the function in PL/pgSQL with one transaction scope, an explicit `auth.uid()` admin check, row locks on selected entries, validation that every entry is open and unbilled, server-side total calculation, invoice/item inserts and entry updates.
- [ ] Revoke execute from `public` and `anon`; grant execute to `authenticated`.
- [ ] Replace the three browser writes in `faturamento.tsx` with one typed `supabase.rpc("create_invoice", ...)` call.
- [ ] Regenerate local TypeScript database types with `npx supabase gen types --lang typescript --local` and update the generated types file with the command output.
- [ ] Run database tests, lint, typecheck and build; expected result: all pass.

### Task 7: Create and verify the BS Logística DEV project

**Files:**

- Modify locally only: `.env`
- Update non-secret local configuration if required: `supabase/config.toml`

**Produces:** A remote DEV project owned by BS Logística and containing no production data.

- [ ] Create a Supabase organization and a project named `BS Logistica DEV` in the BS Logística account, choosing the region closest to the expected users.
- [ ] Enable 2FA on the owning Supabase account.
- [ ] Run `npx supabase login` and complete browser authentication without sharing the access token.
- [ ] In PowerShell run `$env:BS_SUPABASE_DEV_REF = Read-Host "Cole o Project ref do BS Logistica DEV"`.
- [ ] Run `npx supabase projects list` and visually confirm the entered ref belongs to `BS Logistica DEV`.
- [ ] Run `npx supabase link --project-ref $env:BS_SUPABASE_DEV_REF`.
- [ ] Run `npx supabase migration list --linked`; expected result: remote has no application migrations and local lists the reviewed chain.
- [ ] Run `npx supabase db push --dry-run`; review the complete plan and stop if it targets anything other than DEV.
- [ ] After explicit approval, run `npx supabase db push` against DEV.
- [ ] Run `npx supabase migration list --linked`; expected result: local and remote timestamps match.
- [ ] Run Supabase Security Advisor and Performance Advisor; resolve security errors before continuing.
- [ ] Put the DEV project URL, project ID and publishable key into the local `.env`; do not add a service-role key because the current browser application does not require one.
- [ ] Create the first internal user through Auth, assign `admin` explicitly in `user_roles`, then verify sign-in.

### Task 8: Validate the application locally against remote DEV

**Files:**

- Create: `docs/runbooks/smoke-test.md`

**Produces:** A repeatable end-to-end acceptance checklist with disposable DEV data.

- [ ] Start the app with `npm run dev`.
- [ ] Verify unauthenticated navigation redirects protected routes to `/auth`.
- [ ] Sign in as admin and create one client, one contract, one employee, one operation and one shift.
- [ ] Create a timesheet and entries, then generate an invoice.
- [ ] Verify dashboard and report totals match the inserted data.
- [ ] Sign in as operacional and verify commercial/master writes are blocked while operational work remains allowed.
- [ ] Sign in with a roleless test user and verify no business rows are returned.
- [ ] Record exact expected results in `docs/runbooks/smoke-test.md`.
- [ ] Run `npm run check`; expected result: lint, typecheck and build pass.

---

## Milestone 3: Vercel Preview

### Task 9: Adapt the Lovable build target to Vercel

**Files:**

- Modify: `vite.config.ts`
- Create: `vercel.json`
- Modify: `package.json` only if Vercel detection requires an explicit script

**Produces:** A TanStack Start/Nitro artifact detected by Vercel rather than the current Cloudflare module artifact.

- [ ] Update `vite.config.ts` to preserve the server entry and explicitly select the Vercel Nitro preset:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
  },
});
```

- [ ] Create `vercel.json` with this exact content:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "tanstack-start"
}
```

- [ ] Run `npm run build`; confirm the build no longer reports `preset: cloudflare-module` for the Vercel target.
- [ ] Run `npm run check`; expected result: all checks pass.
- [ ] Keep the Lovable config package for the first Preview if removing it changes application behavior; complete full Lovable-runtime removal as a later isolated refactor.

### Task 10: Deploy and test Vercel Preview

**Files:**

- No source change unless Preview reveals a reproducible deployment defect.

**Produces:** A non-production Vercel URL connected only to BS Logística DEV.

- [ ] Import the private GitHub repository into the BS Logística Vercel account.
- [ ] Confirm Vercel detects `TanStack Start` and Node.js 22.
- [ ] Add Preview environment values for `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PROJECT_ID` from BS Logística DEV.
- [ ] Do not add the database password or service-role key to a `VITE_` variable.
- [ ] Add the exact Vercel Preview URL to Supabase DEV Auth redirect allow-list.
- [ ] Deploy Preview and inspect build/runtime logs.
- [ ] Execute every item in `docs/runbooks/smoke-test.md` against the Preview URL.
- [ ] Verify direct navigation to `/auth`, `/dashboard`, `/clientes`, `/operacoes`, `/apontamentos`, `/faturamento` and `/relatorios` returns the application rather than 404.
- [ ] Stop. Do not promote to production until the Preview smoke test and security review pass.

---

## Milestone 4: Production and domain cutover

### Task 11: Provision production independently

**Files:**

- Create: `docs/runbooks/deployment.md`

**Produces:** Separate production Supabase and Vercel environments with a documented rollback path.

- [ ] Create `BS Logistica PROD` as a separate Supabase project owned by BS Logística.
- [ ] Prove the production project ref using `npx supabase projects list` before linking.
- [ ] Run `npx supabase db push --dry-run` and archive the reviewed output in the deployment record without secrets.
- [ ] Obtain explicit approval, then apply migrations to production.
- [ ] Run Security Advisor, Performance Advisor and migration-list verification.
- [ ] Configure production Auth with public sign-up disabled, the Vercel production URL as Site URL and only approved redirect URLs.
- [ ] Add production Supabase public values to Vercel Production environment settings and redeploy.
- [ ] Run the smoke test with disposable production validation records, then remove only those identified records.
- [ ] Document rollback: restore the prior Vercel deployment; do not automatically reverse database migrations.

### Task 12: Connect the BS Logística domain

**Files:**

- Update: `docs/runbooks/deployment.md`

**Produces:** HTTPS production access on the BS Logística domain.

- [ ] Add the selected domain to the Vercel project and copy the exact DNS records Vercel provides.
- [ ] Add those records at the domain registrar; do not change unrelated DNS records.
- [ ] Wait for Vercel domain verification and TLS issuance.
- [ ] Update Supabase Production Auth Site URL to the final HTTPS domain.
- [ ] Add the final `/dashboard` redirect target and remove obsolete Preview redirects not needed by the release workflow.
- [ ] Execute the full smoke test on the custom domain.
- [ ] Verify authentication emails, password reset links, logout, direct-route navigation and mobile behavior.
- [ ] Record the release date, migration versions, Vercel deployment ID and rollback deployment ID in the runbook.

## Final release gate

The migration is complete only when all conditions below are true:

- [ ] Git contains no populated `.env` or secret.
- [ ] Local reset replays every migration successfully.
- [ ] Supabase database tests pass.
- [ ] Lint, typecheck and production build pass.
- [ ] DEV and production migration histories match the intended release.
- [ ] Supabase security review has no unresolved error.
- [ ] Vercel Preview smoke test passes before production promotion.
- [ ] Production smoke test passes on the custom domain.
- [ ] Rollback instructions are written and verified.
