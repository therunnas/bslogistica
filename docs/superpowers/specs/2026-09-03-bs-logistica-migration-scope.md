# BS Logística Migration Scope

## Confirmed business model

- BS Logística is the only company operating the application.
- Records called `clients` are customers that contract outsourced labor services from BS Logística.
- The application does not need multi-tenant company isolation in this migration.
- Internal users have operational or administrative access according to the existing role model.

## Migration objective

Move the exported Lovable project to infrastructure controlled by BS Logística:

1. Local source code and a private Git repository.
2. A Supabase project owned by BS Logística for database and authentication.
3. A Vercel project owned by BS Logística for the TanStack Start application.
4. A production domain connected only after Preview validation.

## Current baseline

- TanStack Start, React 19, TypeScript, Tailwind CSS, Nitro and Supabase JS.
- Existing Supabase schema consists of three imperative SQL migrations.
- Existing app modules cover authentication, dashboard, clients, contracts, employees, operations, shifts, timesheets, invoices and reports.
- Existing environment variables point to a populated Supabase configuration whose ownership cannot be proven from local files.
- Production build and TypeScript checks pass.
- ESLint currently fails, mostly because of formatting.
- There is no automated test script.
- The exported folder has no `.git` directory.

## Non-goals for this migration

- No multi-company tenancy.
- No redesign of every business screen before the first Vercel Preview.
- No migration of production data unless a separate inventory proves data must be retained.
- No production database changes before an isolated DEV target is verified.
- No Lovable publication, Vercel production deployment or domain cutover during the preparation phases.

## Acceptance criteria

- The repository contains no committed secrets or populated local environment file.
- A clean local Supabase reset can recreate the complete schema.
- RLS allows authenticated staff to perform only the actions assigned to their role.
- New internal users receive a profile but no privileged role automatically.
- The application runs locally against the BS Logística DEV Supabase project.
- A Vercel Preview deployment passes the agreed smoke test.
- Production Supabase and the custom domain are configured only after explicit approval.
