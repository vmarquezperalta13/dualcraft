---
name: database
description: Creates the database and environments (Firebase, Supabase, Postgres+Prisma; local, dev, prod) with each CLI, migrations with RLS and safe promotion to prod. Use for "crea la base de datos", "configura Supabase", "aplica la migración".
---

# DualCraft database

`$DB` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/database.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`, `$GEN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/gen.mjs"`. Talk in the user's language.

**Safety:** creating cloud projects, logging in, deploying, pushing migrations or anything touching **prod** needs the user's explicit OK each time. Interactive logins (`firebase login`, `supabase login`) are run by the user — suggest typing them with `!` in Claude Code. Never print, commit or paste secrets (service keys, DB passwords); they live in git-ignored `.env*` files or the platform's secret store.

## 1. Provider
From `config.backend.provider`, the project brief or ask (AskUserQuestion), recommending:
| Provider | Best when |
|---|---|
| **Firebase** (Firestore) | mobile-first, realtime, offline, simple documents, fast start; Flutter/Android/iOS SDKs are first-class |
| **Supabase** (Postgres) | relational data, SQL, reporting, row-level security, open source/self-host option; good JS/Flutter/Kotlin/Swift SDKs |
| **PostgreSQL + Prisma** | the web has its own server (Next.js/Nuxt) and you want full control of the DB host (Neon, Railway, RDS, Supabase-as-Postgres) |
`$BRAIN config set backend.provider=<firebase|supabase|postgres-prisma>` and record a decision (area data). Changing provider later is a migration project — say so.

## 2. Tooling
`$DB doctor` → what's installed. Missing CLI → give the install command from the output; ask before installing anything globally (prefer `npx` when it works: `npx supabase …`, `npx prisma …`). Docker is needed for local Supabase/Postgres; Java 11+ for the Firestore emulator.

## 3. Environments — local + dev + prod (default)
Record them as you create them: `$BRAIN config set backend.environments.dev.project=<id> backend.environments.prod.project=<id> backend.environments.local.mode=<emulator|docker>`.

**Firebase**
- Projects: `firebase projects:create <name>-dev --display-name "<Name> Dev"` and `<name>-prod` (ids are global — propose, confirm). Billing/plan and Auth providers are enabled in the console (tell the user which).
- Firestore database: `firebase firestore:databases:create "(default)" --location <eur3|nam5|…> --project <id>` (location is permanent — ask, recommend the closest multi-region).
- Repo: `firebase.json` (firestore rules/indexes paths, emulators: auth, firestore, functions, storage, ui) and `.firebaserc` with aliases `{"projects": {"default": "<name>-dev", "dev": "<name>-dev", "prod": "<name>-prod"}}`.
- Local: `firebase emulators:start` (apps point to the emulator in debug builds).
- Apps: Flutter → `flutterfire configure --project <id> --out lib/firebase_options_<env>.dart` per environment (flavors); web/RN → `.env.development` / `.env.production` with the public web config of each project.

**Supabase**
- Local: `npx supabase init` (creates `supabase/`), `npx supabase start` (Docker; prints local URL, anon key, Studio URL).
- Cloud: `npx supabase orgs list`, then `npx supabase projects create <name>-dev --org-id <org> --region <eu-west-1|…> --db-password <generated>` and `<name>-prod` (store the passwords in the user's password manager, not in the repo).
- Link per environment when pushing: `npx supabase link --project-ref <ref>` (dev by default).
- Apps: URL + **anon** key per environment in `.env.*` (`NEXT_PUBLIC_SUPABASE_URL`, `…_ANON_KEY`, `EXPO_PUBLIC_…`, Flutter `--dart-define`); the **service_role** key only in server code / Edge Functions secrets.

**PostgreSQL + Prisma**
- Local: `docker run --name <name>-pg -e POSTGRES_PASSWORD=<generated> -p 5432:5432 -d postgres:16` (or a `docker-compose.yml`); `DATABASE_URL` in `.env` (git-ignored) + `.env.example` without values.
- dev/prod: a managed Postgres per environment (Neon branches, Railway, RDS, or a Supabase project used as plain Postgres); their `DATABASE_URL` in the hosting platform's secrets.
- `npm i -D prisma && npm i @prisma/client` in the server project.

## 4. Schema → provider (after every schema change)
The DBML (`.dualcraft/db/schema.dbml`, `dualcraft:schema`) stays the source of truth. For SQL providers recommend `snake_case` table/column names in the DBML. `er.mjs check` must pass (it also warns about foreign keys whose types don't match).
| Provider | Generate | Apply |
|---|---|---|
| Firebase | `$GEN rules` → `firestore.rules.generated` (merge by hand into `firestore.rules`, with access rules) · composite indexes in `firestore.indexes.json` for the queries the app runs | local: emulator reloads · dev/prod: `firebase deploy --only firestore:rules,firestore:indexes --project <dev|prod>` |
| Supabase | `$DB migration <name>` → `supabase/migrations/<ts>_<name>.sql`: first time the full schema, later **only the difference** since the last migration (snapshot in `.dualcraft/db/snapshot.json`), RLS enabled on every table with owner policies when there's a `user_id`/`owner_id` uuid column | local: `npx supabase db reset` (rebuild) or `npx supabase migration up` · dev/prod: `npx supabase db push` on the linked project · types: `npx supabase gen types typescript --local > <web>/src/types/supabase.ts` |
| Postgres + Prisma | `$DB prisma` → `prisma/schema.prisma` (relations named, 1:1 unique) | local/dev: `npx prisma migrate dev --name <name>` · prod: `npx prisma migrate deploy` · client: `npx prisma generate` |
Review every generated migration with the user before applying it: the ⚠ lines (removed columns/tables, NOT NULL without default, enum values removed) are never applied automatically — decide rename vs drop vs backfill together and write that SQL by hand in the same migration.

## 5. Promote dev → prod
1. Migrations/rules applied and verified on **dev** (app tested against dev, `dualcraft:verify`).
2. Backup prod first when data could be affected (Supabase: PITR/backups in the dashboard or `pg_dump`; Firestore: `gcloud firestore export gs://…`).
3. Apply to prod with explicit OK: `firebase deploy … --project prod` / `npx supabase link --project-ref <prod>` + `db push` / `npx prisma migrate deploy` with the prod URL.
4. Backend changes go **before** the app release and must stay compatible with the app version users still have (`dualcraft:release`).

## 6. Security & follow-up
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs" --scope backend` (tables without RLS, open write policies, service_role exposed, open Firestore rules) — fix before prod.
- Generated policies/rules are a starting point: review ownership and roles with `dualcraft:security-global`.
- Server logic (callables, webhooks, triggers, cron) and how the apps call it: `dualcraft:backend`.
- Brain: tasks for anything pending (enable Auth providers, set up backups, monitoring); decisions for provider, regions and environment layout.
- `$DB status` shows provider, environments and the last migration at any time.
