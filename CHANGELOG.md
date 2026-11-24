# Changelog

## [0.21.0] - 2026-11-24
### Added
- CI/CD and deploy pack: `/dualcraft:deploy` and `scripts/deploy.mjs` (init, gen, secrets, check)
  - GitHub Actions generated from the project's stacks (hash-protected): CI per stack (Next.js, React+Vite, Astro, Nuxt, React Native, Flutter, Android, KMP, iOS) plus Cloud Functions / Supabase Edge Functions
  - web deploys to Firebase Hosting, Vercel, Cloudflare Pages or Netlify: preview per pull request, dev on main, production on `v*` tags behind the `production` environment; no deploys from forks
  - backend deploys per environment (Firebase functions/rules/indexes, Supabase migrations and Edge Functions)
  - mobile releases on tags: signed builds to Google Play internal testing and TestFlight (iOS automatic signing with an App Store Connect API key, `ExportOptions.plist`), EAS build + submit for React Native
  - `secrets`: every secret and variable per GitHub environment, checked against the repo (missing ones, production without reviewers)
  - `check`: stale workflows, Android release signing, application ids, ExportOptions, eas.json, keys ignored and never committed, SSR on static hosts
- Reference `release-signing.md` (environments, Android upload key and Gradle snippets, iOS API-key signing, hosts, promotion and rollback)
- Generated-file guard supports `#` headers (YAML)
- CI: actionlint + shellcheck over every generated workflow
### Changed
- release skill ships through the pipeline when `dualcraft:deploy` is set up

## [0.20.0] - 2026-11-24
### Added
- Push notifications pack: `/dualcraft:push` and `scripts/push.mjs` (init, gen, check)
  - one catalog: `.dualcraft/push/notifications.json` — Android channels, topics (per language), notifications with typed params, deep-link route, priority, collapse key and TTL
  - texts from the shared i18n (`push.<id>.title/body`, ICU params and plurals) rendered on the server in each device's language
  - Firebase Installation IDs (FCM's current target) with legacy-token fallback: `registerDevice` / `unregisterDevice` (one owner per app instance), `sendToUser` (dead-id cleanup), `sendToTopic`
  - typed senders on the server and `PushMessage` parsers for TypeScript, Dart (sealed classes), Kotlin and Swift; Flutter `PushService` (firebase_messaging 17: register/onRegistered, channels, cold start, foreground banner, sign-out)
  - check: catalog and texts in every locale, server pieces, permission request, id changes, cold-start opening, iOS entitlements, Android icon and permission, notifications never sent
- Reference `push-notifications.md`
### Changed
- Cloud Functions scaffold: firebase-admin 14 and firebase-functions 7
- CI: Deno check fixed (nodeModulesDir auto), actions/checkout and setup-node v5

## [0.19.0] - 2026-11-24
### Added
- Payments pack: `/dualcraft:payments` and `scripts/payments.mjs` (init, gen, check)
  - one catalog: `.dualcraft/payments/products.json` — subscriptions (period, trial, Play base plans), one-time unlocks and consumables, entitlements and currencies, store ids per platform
  - native mode (Firebase): `verifyPurchase` with the Google Play Developer API and the App Store Server Library (StoreKit 2 signed transactions), acknowledge/consume after granting, one owner per purchase, entitlements with several sources, wallet credited once; Play RTDN and App Store Server Notifications V2
  - RevenueCat mode: webhook for Firebase or Supabase that mirrors entitlements and credits consumables
  - typed catalogs for TypeScript, Dart, Kotlin and Swift; Flutter `PurchaseService` scaffold (listener at start, restore, server verification, completes only when granted)
  - check: catalog rules, server pieces, client-side grants, missing restore, purchases not verified, `autoConsume`
- References: `app-store-iap.md` (App Store Connect, StoreKit 2, server verification, notifications, testing) and `revenuecat.md`
- CI compiles the payments server against the real Google and Apple libraries (native and RevenueCat) and the Flutter purchase service

## [0.18.0] - 2026-11-24
### Added
- Backend serverless pack: `/dualcraft:backend` and `scripts/backend.mjs` (init, add, gen, check, list)
  - one contract for every server function: `.dualcraft/backend/api.json` (kind, auth, typed input/output, errors, platforms)
  - providers: Firebase Cloud Functions v2 (one region everywhere), Supabase Edge Functions, Next.js / Nuxt API routes
  - scaffolds per kind: callable, http, webhook (signature on the raw body + idempotency), trigger (Firestore, Storage, Pub/Sub, Auth blocking, Supabase Database Webhooks), schedule (onSchedule, pg_cron, platform cron)
  - generated server validators (unknown fields rejected, size limits by default) and typed clients for TypeScript, Dart, Kotlin and Swift through a small transport interface
  - check: contract valid, functions implemented and exported, no Cloud Functions v1, region drift in functions and client code, generated files up to date
- CI compiles the scaffolds and clients: Cloud Functions with the real firebase-functions types, Next.js/Nuxt routes, Supabase Edge Functions with Deno, Dart, Kotlin (runs encode/decode) and Swift
### Changed
- Security scanner: webhooks that verify a signature no longer count as HTTP functions without authentication

## [0.17.0] - 2026-11-24
### Added
- Field-tested references integrated from the AforApp / La Previa skills, generalized for any project:
  - `references/firebase-functions.md` — Cloud Functions v2 patterns (callable template, transactions, error codes, secrets), client calls per stack, debugging by error (unauthenticated / unavailable / not-found, debug vs release: R8, SHA fingerprints with Play App Signing, App Check), webhooks, deploy
  - `references/play-billing.md` — Play Console products, Flutter `in_app_purchase` architecture, the "bought but locked after restart" causes, server verification with the Play Developer API and RTDN, testing and release checklist
  - `references/security-firebase.md` — severity scale and release gate, Firestore rules patterns, client hardening, GDPR account deletion, A–G checklist, audit frequency, finding format
- Security scanner: Firebase emulator outside `kDebugMode`, Cloud Functions region mismatch between client and server, `purchaseStream` without `completePurchase`, no `restorePurchases`, missing default-deny rule, SendGrid / Stripe webhook / FCM server keys, unrestricted Google API keys
### Changed
- security-global, security-mobile, debug, mobile-build and mobile-crash use these references

## [0.16.0] - 2026-11-24
### Added
- Test suite (`npm test`, node:test, no dependencies): parsers, brain and decisions, every generator and stack, hand-edit guards, database migrations, detector, converter, security scanner, release, docs and shareable map, GitHub sync (mock API), plugin consistency (frontmatter, packs, catalog, references, hooks) and the installer
- CI on GitHub Actions: tests on Ubuntu and Windows (Node 22/24) plus real compilation of the generated code: TypeScript (strict), Flutter (gen-l10n + analyze), Kotlin (Compose + kotlinx.serialization, compiled and run), Swift (macOS and iOS simulator SDK), SQL migrations applied on Postgres (PGlite) and Prisma validate
### Fixed
- Kotlin inventory ignored projects whose package contains "test" (com.test.app)
- Security scanner skipped Cloud Functions and secrets when the project path contained "test"/"spec" (e.g. C:/projects/latest)
- Two SQL migrations generated in the same second got the wrong order / duplicate version

## [0.15.0] - 2026-11-24
### Added
- `github`: brain ⇄ GitHub Issues sync (`github.mjs` status / push / pull, milestones from target versions, assignees, closing finished notes with a comment, importing unlinked issues; token from GH_TOKEN, gh or the git credential helper)
- Team fields on notes: `assignee`, `estimate` (3h, 2d, 1w, 5pt); `list --assignee`; roadmap totals per version (estimated, left, unestimated, open per person); map panel and roadmap cards show them
- `share`: roadmap or map as a page to publish (`map.mjs --share`), full for the team or `--no-details` for clients (no note bodies, decisions, branches or repo links), with snapshot date
- `screenshots`: store screenshots — capture by deep link (adb with demo status bar and per-app locale, iOS simulator, headless browser), framing at Google Play / App Store sizes with captions per language and design-token colors, size and count check
### Changed
- Skill descriptions rewritten: fixed context per session 5.3k → 2.3k tokens (−56%); `scripts/dev/apply-descriptions.mjs` keeps them YAML-safe

## [0.14.0] - 2026-11-24
### Added
- Installer (`npx github:vmarquezperalta13/dualcraft`): `install` (interactive or flags), `add`, `remove`, `list`, `update`, `doctor`, `uninstall`
- Packs (`packs.json`): core + one per stack (pulls the web/mobile platform skills) + optional design, data, shared, security, release, convert
- Agents: Claude Code (local plugin `dualcraft@dualcraft-local` with only the chosen skills, hooks included), Gemini CLI and Codex CLI (skills as `dualcraft-*` with paths resolved to `~/.dualcraft/current`, plus a context block in GEMINI.md / AGENTS.md that loads the brain summary and related decisions)
- `/dualcraft:help` marks skills that aren't installed and the command to add them
### Fixed
- `start` skill frontmatter was invalid YAML (`: ` inside the description), so Claude loaded it without metadata; descriptions with YAML-unsafe text now use a folded block

## [0.13.0] - 2026-11-24
### Added
- Converter for any stack (stage D): `--from`/`--to` take any of the nine stacks (or web/mobile); inventory for Next.js, React + Vite (react-router), Astro (pages + endpoints), Nuxt (pages + Nitro handlers), Flutter, React Native (Expo Router), Kotlin Multiplatform / Android (Compose screens + Navigation routes), iOS (SwiftUI screens)
- Data access detected across the whole source tree (Firestore, Supabase, callables, external APIs); native capabilities mapped to web alternatives (payments, push, camera/scanner, image picker, location, biometrics, ads, store review, secure storage, sensors, crash reporting) and web-only ones to mobile (Stripe, web push, geolocation, camera, cookies)
- Same-kind migrations (web → web, mobile → mobile): capabilities map to the target's native library
- Platform mapping: per-stack building blocks table (routing, tabs, lists, sheets, toasts, forms, server state, images, secure storage)

## [0.12.0] - 2026-11-24
### Added
- Multi-stack generators (stage B) — one output per stack of the project:
  - tokens: React Native TS theme (`useDsTheme`), Compose Material 3 theme for KMP/Android (`DsTheme`, `Ds.colors`, spacing, radius, typography), SwiftUI (dynamic light/dark colors, spacing, radius, text styles); CSS for React + Vite / Astro / Nuxt
  - i18n: i18next JSON (React Native, React + Vite), Astro JSON, vue-i18n (Nuxt, plurals converted), Android/KMP `ds_strings.xml` with `<plurals>`, iOS String Catalog `DualCraft.xcstrings`
  - models: Kotlin `@Serializable` data classes, Swift `Codable` structs (+ `DsJSONValue`), TypeScript for every JS stack
  - analytics: Kotlin and Swift helpers; coverage scans Kotlin, Swift, Vue and Astro code
- `lib/targets.mjs`: per-stack output paths, Kotlin package from Gradle namespace, iOS app folder detection
### Verified
- Generated Kotlin compiled and run (Compose + kotlinx.serialization on JVM); generated TypeScript type-checked with `--strict`; Dart still `flutter analyze` clean

## [0.11.0] - 2026-11-24
### Added
- `database` skill: provider choice (Firebase, Supabase, PostgreSQL + Prisma), local + dev + prod environments with each provider's CLI, schema → provider artifacts, apply per environment, safe dev → prod promotion
- `database.mjs`: `doctor` (CLIs and files), `status`, `migration` (Postgres/Supabase SQL — full schema first, then only the difference since the last snapshot, RLS with owner policies, destructive changes flagged instead of generated), `sql`, `prisma` (schema.prisma with named relations) — validated on Postgres (PGlite) and `prisma validate`
- Security scan: Supabase tables without RLS, open write policies, service_role key in public env vars or client code
- Schema check warns when a foreign key's type differs from the referenced column

## [0.10.0] - 2026-11-24
### Added
- Multi-stack support (stage A): stack registry and reference sheets for Next.js, React + Vite, Astro, Vue/Nuxt, Flutter, React Native (Expo), Kotlin Multiplatform, Android native (Compose) and iOS native (SwiftUI); backends Firebase, Supabase, PostgreSQL + Prisma
- `new-project`: full intake form for a new project (idea, type, platforms, audience, monetization, stacks, backend, auth, design style, MVP features, languages, constraints) → brief, decisions, MVP tasks, functional document, scaffolding with each stack's CLI
- `stacks` skill and `stacks.mjs` (list, show, scaffold command, project stacks)
- `detect.mjs` recognises all nine stacks (several mobile apps per project, e.g. Android + iOS native), Supabase and Prisma; ignores platform folders inside Flutter/React Native projects
### Changed
- `start` sends empty folders to `new-project` and detects every stack; web/mobile/refactor/security skills read the project's stack sheet

## [0.9.0] - 2026-11-24
### Added
- `decisions` skill: ADR-style decisions with area, consult by area or topic, conflict check, supersede with history
- `UserPromptSubmit` hook: every request gets the decisions and notes related to it added to the context automatically
- Brain: `area` field, `superseded` status with `superseded_by`, commands `decisions`, `supersede`, `relevant`; decision body template (Context / Decision / Alternatives / Consequences)
### Changed
- Session context lists **all** decisions in force grouped by area (was: the 6 most recent), hiding superseded ones
- `review` and `verify` include a decision-compliance step; the map shows areas and superseded decisions

## [0.8.0] - 2026-11-24
### Added
- `convert`: web ⇄ mobile conversion feature by feature — inventory, backend/platform touchpoints analysed and decided with the user, platform-neutral spec, native adaptation, generation on the shared schema/tokens/i18n/analytics, verification with shared test cases and screenshots; creates the target project when missing
- `convert.mjs`: `inventory` (Next.js routes/handlers/server actions, Flutter screens/go_router/Firestore/callables/native plugins with web alternatives), `init`, `status`, `set` (blocks generation while backend decisions are pending), `backend`, `spec-check`
- References: neutral spec format and web ⇄ mobile platform mapping

## [0.7.0] - 2026-11-24
### Added
- `release`: readiness checklist, version bump (config, pubspec build number, package.json), CHANGELOG close, release commit and tag, store release notes per language, store/web launch and post-release follow-up
- `marketing`: what to communicate per version and ready-to-use copy for stores/ASO, web, social, in-app, push/email; campaign plan, metrics from the tracking plan, growth ideas saved to the brain
- `release.mjs`: `suggest` (next version from Conventional Commits), `check`, `bump`, `notes`, `store-check` (Google Play / App Store / web text limits)

## [0.6.0] - 2026-11-24
### Added
- Security pack: `security-global` (threat model, scan, manual review of rules/functions/payments/abuse/privacy, dated report, brain bugs), `security-web` (Next.js), `security-mobile` (Flutter, MASVS)
- `security.mjs`: zero-dependency static scan — secrets and key files, open/test-mode/unvalidated Firestore & Storage rules, Cloud Functions without auth/App Check/with open CORS, NEXT_PUBLIC_ secrets, server code in client components, unauthenticated route handlers and server actions, XSS/SSRF/open-redirect patterns, missing security headers, Android/iOS insecure config, tokens in SharedPreferences, TLS bypass, client-only IAP; optional npm audit
### Changed
- `review` runs a quick security scan on the changed area

## [0.5.0] - 2026-11-24
### Added
- Web pack: `web-architecture`, `web-build`, `web-test`, `web-browser`, `web-seo`
- Mobile pack: `mobile-architecture`, `mobile-build`, `mobile-test`, `mobile-device`, `mobile-crash`
- Refactor pack: `refactor-web`, `refactor-mobile`, `refactor-global` (cross-platform drift)
- `i18n`: one source of texts (`.dualcraft/i18n/<locale>.json`, ICU) → Flutter ARB + next-intl messages; checks and hard-coded string scan
- `analytics`: tracking plan (`.dualcraft/analytics/events.json`) → typed Dart/TS helpers, `docs/ANALYTICS.md`, per-platform coverage
- `detect.mjs`: what the Next.js and Flutter projects really use
- Shared generated-file guard (code, Markdown and JSON/ARB)
### Changed
- `start` detects stacks with `detect.mjs`, offers architecture maps, routes refactors and crashes to the new skills

## [0.4.0] - 2026-11-24
### Added
- Design pack: `design-system` (claude.ai Design System from scratch or from code), `tokens`, `design-screen` (mobile + web artboards), `design-to-code`
- `tokens.mjs`: Design System tokens → CSS variables with light/dark + Tailwind v4 `@theme` and `type-*` utilities (Next.js), and `ThemeData` + `DsColors` ThemeExtension + spacing/radius/text styles (Flutter)
- WCAG contrast check of text/background pairs in every theme
- Hand-edit guard on generated token files
- `brain.mjs config` to read and set project settings (e.g. the Design System link)
### Changed
- `review` flags raw colors/sizes where a design token exists; the feature flow includes screen design

## [0.3.0] - 2026-11-24
### Added
- Process pack: `brainstorm`, `plan`, `tdd`, `debug`, `verify`, `review` (with accessibility) and `docs`
- Functional document `docs/FUNCTIONAL.md` (es/en template) with traceability to brain ids (`docs.mjs status`)
- Shared reference of Next.js / Flutter / Firebase commands
- Specs and plans stored in `.dualcraft/specs/` and `.dualcraft/plans/`, linked from brain notes
### Changed
- `start` routes each work mode through the process skills; `commit` requires verification and the functional document update

## [0.2.0] - 2026-11-24
### Added
- `/dualcraft:map`: visual brain map (nodes, dependency arrows, filters, search, detail panel) with a Roadmap view
- `/dualcraft:roadmap`: tasks grouped by version with progress, blocked and parked items
- `/dualcraft:er`: ER diagram from `.dualcraft/db/schema.dbml` with crow's-foot notation, drag, PNG/SVG export, saved layout
- `/dualcraft:schema`: DBML schema as single source of truth; generates Dart models, TypeScript types and a Firestore rules skeleton
- DBML parser (zero dependencies) and example schema `examples/hockey.dbml`

## [0.1.0] - 2026-11-24
### Added
- Brain CLI (notes, roadmap, graph, check, work mode, session summary)
- Skills: using-dualcraft, help, start, brain, park, commit
- SessionStart hook that loads the project context
