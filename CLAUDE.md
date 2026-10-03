# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

se-vezmou.cz: a Czech/English wedding-website SaaS (Next.js 16 App Router, React 19, Tailwind 4, TypeScript), deployed on Vercel, data in a shared Supabase Postgres project. Node >= 24 (`.nvmrc`). README, docs, ADRs, code comments and commit/PR titles in this repo are in **Czech**; follow that in comments and commits.

Design docs: `docs/technical-design.md`, `docs/data-model.md`, `docs/security-privacy.md`, `docs/test-plan.md`, decisions in `docs/adr/` (read the relevant ADR before changing auth, routing, DB access, i18n, email, storage).

## Commands

```bash
npm run dev              # http://localhost:3000 (cp .env.example .env.local, ROOT_DOMAIN=localhost)
npm run format:check     # Prettier (husky + lint-staged run eslint --fix / prettier on commit)
npm run lint
npm run typecheck        # next typegen && tsc --noEmit
npm run i18n:check       # cs/en key parity, placeholders, Czech typography
npm test                 # Vitest (src/**/*.test.{ts,tsx}, scripts/**/*.test.ts)
npx vitest run src/auth/session.test.ts      # single test file (add -t "name" for one case)
npm run build
npm run db:test          # SQL tests on a throwaway PostgreSQL (needs psql + initdb; PG_BIN if not in /usr/lib/postgresql/*/bin)
npm run db:migrate:test
npm run test:e2e         # Playwright e2e (builds app, spins up temp DB via scripts/e2e-db.sh, port 3100)
npm run test:a11y        # Playwright + axe
bash scripts/e2e-db.sh run -- npx playwright test e2e/auth.e2e.ts --project=e2e   # single e2e file
```

CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, i18n:check, test, build; then db:test + db:migrate:test; then e2e in 4 shards. Vitest default env is `node`; component tests opt into jsdom with a `// @vitest-environment jsdom` comment. `server-only` is aliased to a stub in tests.

Locally, e2e can use an existing Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. E2E runs against a production build (`next start`) with `ALLOW_TEST_HATCHES=1`.

## Architecture

### Host-based routing (ADR 0002)

One app serves four host kinds. `src/proxy.ts` (Next 16 "proxy", formerly middleware) rewrites by `Host` header into internal segments under `src/app/h/`:

- `marketing` — root domain, landing page, `[locale]` with translated paths (`src/i18n/pathnames.ts`); the only indexable host.
- `app` — `app.<root>`: couple's admin (login, wizard `vytvorit`, management under `(sprava)`).
- `admin` — `admin.<root>`: operator back-office (Czech only, TOTP 2FA, ADR 0012); code in `src/ops`.
- `tenant` — `<slug>.<root>`: a couple's public wedding site (`h/tenant/[slug]/[locale]`).

Direct requests to `/h/...` return 404. Locally use `app.localhost:3000`, `admin.localhost:3000`, `klara-a-matej.localhost:3000`. On `*.vercel.app` previews pick the host with `HOST_PRESET` / `PREVIEW_TENANT_SLUG`. Host resolution: `src/host/`.

**The proxy is not a security boundary and never queries the DB.** Every Server Action and route handler verifies origin + session itself (`src/auth/request.ts`, `src/auth/session.ts`, `src/admin/guard.ts`, `src/ops/session.ts`).

### Database access (ADR 0011)

- No supabase-js, no PostgREST, the browser never talks to the DB. Server uses `pg` Pool (`src/lib/db/pool.ts`) as role `se_vezmou_app` through the transaction-mode pooler.
- Each call is one transaction: `set local role service_role` (pre-auth, cron, operator) or `authenticated` + `request.jwt.claims` (`sub`, `wedding_id`, `wedding_role`) for tenant-scoped calls. Isolation between weddings is RLS by `wedding_id`.
- App code never reads tables directly; it calls `security definer` SQL functions via typed wrappers in `src/lib/db/` (`rpc.ts` → `serviceRpc`/`tenantRpc`, plus `rpc-wizard.ts`, `rpc-ops.ts`, `admin-site.ts`, `admin-guests.ts`, `media.ts`). Argument names match the SQL. Tests swap the transport with `setTransport`.
- Everything lives in schema `se_vezmou`; migrations must not touch anything outside it (enforced by the isolation test in `db:test`).
- Migrations: `supabase/migrations/<timestamp>_<name>.sql`, applied by `npm run db:migrate` (owner credentials, checksum-tracked in `se_vezmou.schema_migrations`). **Never edit an existing migration** — its checksum would be rejected; add a new one. SQL tests in `supabase/tests/*.test.sql` (`as_app/` runs logged in as the app role). See `supabase/README.md`.

### i18n (ADR 0003, 0013)

Messages in `src/i18n/messages/{cs,en}/<namespace>.json`, used via `createTranslator(locale)` → `t("namespace.key")`, `t.rich` for `<a>/<b>/<i>`. Czech typography is applied by `typo()`; source quotes must already be correct (`„…“`). Both locales must have every key (`i18n:check`). Locale is decided by the URL; the proxy passes it in `x-ui-locale` and negotiates (cookie `NEXT_LOCALE`, `Accept-Language`) only on marketing/app/admin hosts.

### Test hatches

Env switches that shortcut external services in tests (`EMAIL_TRANSPORT=outbox`, `STORAGE_DRIVER=memory`, `CRON_TEST_CLOCK`, `MAP_STUB`, `ENABLE_UI_CATALOG`, `HOST_PRESET`, …) are centralized in `src/lib/test-hatches.ts`. They work only outside production builds or with `ALLOW_TEST_HATCHES=1`, never on `VERCEL_ENV=production`; `instrumentation.ts` fails startup if set where not allowed. Add new test shortcuts there.

### Other places worth knowing

- Auth limits, lifetimes, cookie names: `src/auth/config.ts`, `src/auth/cookie.ts` (`__Host-` prefix dropped on localhost).
- Env parsing/validation: `src/env.ts`. Secrets are server-only, min 32 chars.
- Pricing/operator info: `src/config/`. Cron jobs: `src/app/api/cron/*` (require `CRON_SECRET`) + `src/lib/cron`, `src/lib/lifecycle`.
- Email via AWS SES (`src/lib/email`), photos on Cloudflare R2 (`src/lib/storage`, `src/lib/media`).
- Wizard (site creation): `src/wizard`; public site rendering/content: `src/site`, `src/components/site`.

## Branching & deploy

Vercel builds **only `main`** (production; `ignoreCommand` in `vercel.json`). Feature branches are cut from `main` and PRs target `main`.
