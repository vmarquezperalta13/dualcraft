# Changelog

## [0.35.0] - 2026-11-26
### Added
- Store upload with fastlane: `/dualcraft:store` and `scripts/store.mjs` (init, export, check) — the store listing, the latest release notes and the framed screenshots per language exported to fastlane's layout in `fastlane/` (Google Play `metadata/android/<locale>` with phone screenshots and `changelogs/default.txt`; App Store `metadata/<locale>` with support / privacy / marketing URLs and `screenshots/<locale>`), using each store's locale codes; files removed from the sources leave `fastlane/` too
  - `.dualcraft/store/store.json`: app ids (from the Gradle and Xcode projects, skipping test and extension targets), URLs, locale overrides, what to upload
  - `check`: export current, texts each store requires per language, support and privacy URLs, 2–8 Play phone screenshots, 6.9" iPhone screenshots, notes for the current version, release workflow using fastlane
- deploy: with the store set up, the tag release uploads the Android bundle with `fastlane supply` (listing, notes and screenshots included) and, after TestFlight, sets the App Store version's listing with `fastlane deliver`; neither submits for review
- the release readiness check includes the store upload; the release and marketing agents know it; CI lints the workflows with the fastlane steps
- eval trigger case

## [0.34.0] - 2026-11-26
### Added
- Deep links: `/dualcraft:links` and `scripts/links.mjs` (init, add, remove, gen, check, snippets) — `.dualcraft/links/links.json` (domain, scheme, routes with `{params}` and optional query values) → per stack (TypeScript, Dart, Kotlin common code, Swift):
  - typed builders (path, https link, scheme link) and a parser from any link to the typed route, or null for other hosts, bad parameters or unknown paths; the most specific route wins (`/matches/new` before `/matches/{id}`)
  - `.well-known/assetlinks.json` and `apple-app-site-association` in the web's `public/`, merged with what auth passkeys need (whichever runs first)
  - `snippets`: Android intent filters with `autoVerify`, iOS Associated Domains and URL scheme, Flutter and Expo settings, hosting headers
  - `init` imports the routes of push notifications and store screenshots, the domain and app ids from auth passkeys, the Android application id
  - `check`: generated code and `.well-known` current, domain / fingerprint / app id set, manifest and entitlements declare the domain, push routes that are not app routes (error), screenshot links that open no route
- push and screenshots skills point at links; the architect agent knows links; CI compiles and runs the builders and parsers in every language
- new installer pack `links`; eval trigger case

## [0.33.0] - 2026-11-26
### Added
- Error monitoring: `/dualcraft:monitoring` and `scripts/monitoring.mjs` (init, gen, check) — `.dualcraft/monitoring/monitoring.json` → the same settings in every app (TypeScript, Dart, Kotlin, Swift): release name `<app>@<version>`, environment, trace sample rate, personal data off, errors to ignore, consent flag, and `scrubReport()` that redacts sensitive keys at any depth
  - providers: Sentry on the web; Crashlytics on mobile with a Firebase backend, else Sentry; `none` per platform
  - `references/monitoring.md`: wiring per stack and provider (Sentry for Next.js, Vite, Astro, Nuxt, React Native, Flutter, Android, iOS, KMP; Crashlytics for Flutter, Android, iOS, React Native), consent gate and symbol upload
  - `check`: SDK installed per app, symbol upload configured (Sentry Gradle plugin, Crashlytics plugin and dSYM phase, sentry_dart_plugin), DSN documented in `.env.example`, Sentry token in the deploy workflows, privacy policy names the provider, consent reminder
- deploy: with Sentry, the web and mobile release jobs get `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` and the release name, and Flutter runs `sentry_dart_plugin`; `deploy secrets` lists them
- release: `bump` regenerates the monitoring settings (the release name carries the version); the readiness check includes monitoring
- the release and debugger agents and `mobile-crash` point at monitoring; CI compiles and runs the settings in every language and lints the workflows with Sentry
- new installer pack `monitoring`; eval trigger case

## [0.32.0] - 2026-11-26
### Added
- Feature flags and remote config: `/dualcraft:flags` and `scripts/flags.mjs` (init, add, remove, gen, check) — `.dualcraft/flags/flags.json` → a typed accessor per stack (TypeScript, Dart, Kotlin, Swift): defaults built in, overrides for tests and QA, and any missing or ill-typed remote value falls back to the default
  - kinds: release and experiment (must expire), ops (kill switches), config (remote values); string enums; flags per platform
  - Firebase Remote Config template (`firebase deploy --only remoteconfig`) or a Supabase `feature_flags` table (read-only to clients, seeded with the defaults)
  - `references/feature-flags.md`: the adapter per stack and provider (Firebase web, React Native, Flutter, Android, iOS, KMP; Supabase for TS, Dart, Kotlin, Swift; local)
  - `check`: generated code current, temporary flags without expiry, expired flags (error), flags no code reads, parked brain notes whose flag is missing
- `park` parks behind a catalog flag; `flags init` imports the flags of parked notes
- the release readiness check blocks on flag errors (expired flags); the release and architect agents know the flags skill
- CI compiles and runs the generated flags in TypeScript, Kotlin, Swift and Dart, and applies the Supabase table on Postgres
- new installer pack `flags`; eval trigger case

## [0.31.1] - 2026-11-26
### Fixed
- evals: the behaviour scaffolds embedded the day they were generated, so the drift test failed every new day — the brain CLI now honours `DUALCRAFT_TODAY` and the generator pins it
### Changed
- skill descriptions trimmed (~3,450 → ~3,000 tokens per session with everything installed), keeping their Spanish trigger phrases; the installer's cost note updated
- README: overview rewritten for every area and stack (it still described v0.16), roadmap up to date
- CI: every job has a time limit
### Added
- tests for the ER tool, the stacks registry and store screenshots (check; frame when Chrome or Edge is present)

## [0.31.0] - 2026-11-25
### Added
- `/dualcraft:agents`: lists the specialist agents (installed or not, what each does, how to add the missing ones) — `scripts/agents.mjs` (`--json`); `/dualcraft:agents <agent> <task>` writes the agent a self-contained brief, launches it and relays its report (Spanish agent names accepted)
- eval trigger case for the agents command

## [0.30.0] - 2026-11-25
### Added
- Specialist agents in `agents/` (Claude Code `dualcraft:<agent>`), each built on the DualCraft skills of its area and with its own context: `security`, `reviewer`, `qa`, `architect`, `debugger`, `designer`, `marketing`, `release`
  - `security` and `reviewer` only report (no Edit/Write); `architect` writes plans, not code; `qa` writes tests, not production code
  - shared rules: read the brain and the decisions in force first, report in the project's language, return the user's choices as questions, never commit, push, tag, publish or deploy
  - generated from `scripts/dev/agents-src.mjs` (`--check` in the tests)
- Installer: each agent is installed with the skill it relies on (`packs.json` → `specialists`) — into the Claude plugin, `~/.gemini/agents/dualcraft-<agent>.md` and `~/.codex/agents/dualcraft-<agent>.toml`; `list`, `doctor` and `uninstall` include them
- `/dualcraft:help` lists the agents; `using-dualcraft` says when to hand work to one
### Changed
- `photos`: image generation dropped from the plans — the skill edits real photos only (`generate` removed from the spec)

## [0.29.0] - 2026-11-25
### Added
- Product photos, free and local: `/dualcraft:photos` and `scripts/photos.mjs` (init, gen, check, render) — `.dualcraft/marketing/photos.json` + a studio in `marketing/photos/` (sharp 0.35.5, transformers.js 4.3.2) that edits the user's real product photos; no paid API, CPU only, offline after the first model download
  - background removal with BiRefNet lite (MIT, ONNX); cutouts cached in `cutouts/` and editable by hand; photos already transparent are used as they are
  - presets: `store-white` (2000×2000, pure white, contact shadow, product fills 85 %), `cutout` (transparent), `brand-square` (brand spotlight), `ad-feed` 4:5, `ad-story` 9:16 (text outside the top and bottom safe zones), `ad-square`; editable sizes, formats, backgrounds (white, transparent, brand, surface, colour, image), shadows (contact, drop) and fill
  - ads with headline and call-to-action button per language (literal, per locale, `t:` i18n keys, `listing:`), wrapped to 3 lines, colours from the Design System tokens (oklch converted) and its .ttf/.otf fonts
  - one product per photo in `input/`, kept in sync; each image carries a `.json` recipe (source hash, settings, coverage)
  - `check`: new or missing photos, stale renders, marketplace fill rule, headline overflow; reminder to use only photos of your own products
  - `render --dry-run` plans the images without processing them
  - image generation (local ComfyUI on your GPU, or a paid provider with caps) is planned as option 2; `generate` stays `null` until then
- eval trigger case for the photos skill

## [0.28.0] - 2026-11-25
### Added
- Marketing videos with Remotion: `/dualcraft:video` and `scripts/video.mjs` (init, gen, check, studio, render) — `.dualcraft/marketing/videos.json` → a Remotion project (`marketing/video/`, Remotion 4.0.547) with one composition per video × format × language
  - scenes: title, screen (store screenshot in a phone or browser frame), bullets, call to action with store badges; texts literal, per language, from the i18n (`t:`) or the store listing (`listing:`)
  - formats: App Store app preview (886×1920, 15–30 s), Google Play promo (1920×1080), vertical 9:16, square, feed 4:5 — 30 fps, H.264
  - derived videos kept in sync: app intro (listing name and subtitle, up to 6 store screens with captions, fitted to the App Store window) and release news (latest `.dualcraft/release/<version>.json` notes per language)
  - theme from the Design System tokens (colors, font files); scenes in `src/components.tsx` are yours to restyle
  - `check`: platform duration windows, texts and screenshots per language, generated files current; Remotion license and official store badges reminders
  - local render into `marketing/video/out/<locale>/<format>/<video>.mp4`
- CI type-checks the generated Remotion project and renders a video and a still with it
- eval trigger case for the video skill

## [0.27.0] - 2026-11-25
### Added
- Skill evals for `claude plugin eval` (Claude Code ≥ 2.1.269) in `evals/`, generated by `scripts/dev/gen-evals.mjs`:
  - `triggers/<skill>`: one natural Spanish request per skill (57) that must load that skill
  - `behavior/<case>`: on a project scaffolded with the real brain CLI — `start` asks the work mode before any code, a request against a decision in force names the decision, "what is pending?" is answered from the brain
  - deterministic graders only (no LLM judge); `scripts/dev/eval-summary.mjs` turns the JSON result into a job summary
- `.github/workflows/evals.yml`: manual run only, no paid API — your Claude subscription through the `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`); refuses to run with `ANTHROPIC_API_KEY` set; pinned model, 1 run at a time, no baseline arm, usage ceilings, results archived
- tests keep `evals/` in sync with the skills
### Fixed
- e2e: `@playwright/test` ^1.65 (GitHub's `ubuntu-latest` is now Ubuntu 26.04, which Playwright 1.57 cannot install Chromium on)

## [0.26.0] - 2026-11-25
### Added
- Performance budgets: `/dualcraft:perf` and `scripts/perf.mjs` (init, gen, check, run) — `.dualcraft/perf/budgets.json` plus a self-contained runner copied into the repo (`.dualcraft/perf/perf-check.mjs`, Node 18+, no dependencies) used by CI and locally
  - web: Lighthouse 12 (mobile, median of runs) on the budget routes — score, LCP, CLS, TBT; bundle JS/CSS gzip totals, largest chunks and JS per Next.js App Router route
  - mobile: APK / AAB / IPA size; cold start from adb (`am start -W`), Flutter `--trace-startup` or an XCTest value, kept in `history.json` and compared with the previous run
  - `mode` warn (annotations + job summary table, default) or fail, with a tolerance for noise
- `deploy`: a `perf-<stack>` job per web stack (build → bundle → start the app → Lighthouse) and an app-size step before each store upload in the mobile release workflow
- CI runs real Lighthouse with the runner against the fixture site

## [0.25.0] - 2026-11-25
### Added
- End-to-end tests: `/dualcraft:e2e` and `scripts/e2e.mjs` (init, gen, check, run) — one neutral spec `.dualcraft/e2e/flows.json` → Playwright specs for the web (`e2e/dualcraft/*.spec.ts`) and Maestro flows for every mobile stack (`.maestro/dualcraft/*.yaml`)
  - steps: open, tap, fill, see / notSee, url, noErrors, back, screenshot; texts by i18n key (default locale), test ids, secrets from env, unique emails
  - derived flows refreshed by `gen`: auth (protected page → sign in, wrong password, password policy, sign in with a test account, guest, sign up + delete), smoke for every static web route (console errors, protected → sign in) and app deep link, payments paywall (product testIDs), store screenshots (raw captures for `dualcraft:screenshots`, opt-in web visual regression)
  - `playwright.config.ts` (desktop + mobile Chromium, webServer or a preview URL) and Maestro workspace config written once; `@playwright/test` added
  - `check`: spec valid, derived flows in sync, texts exist, generated files current, Playwright installed, CI job present
- `deploy`: an `e2e-<stack>` Playwright job per web stack in the generated CI (test-account secrets, report uploaded on failure)
- CI runs the generated Playwright specs against a fixture site (Chromium, desktop + mobile) and validates the generated Maestro flows against the SchemaStore schema (documented commands only)
### Fixed
- Flutter Supabase passkey sign-in awaits inside its `try` (Flutter 3.50 lint `unawaited_return_in_try_block`)

## [0.24.0] - 2026-11-25
### Added
- Auth pack: `/dualcraft:auth` and `scripts/auth.mjs` (init, gen, check) on Firebase Auth or Supabase Auth, from one `.dualcraft/auth/auth.json`
  - methods: email + password, Google, Apple, phone, passkeys; guest sessions and account linking; email verification; password policy; two-step verification (TOTP, SMS)
  - roles with a default and an admin role, route access rules (`public`, `guest`, `signedIn`, `verified`, `roles`) and `decideAccess()`; Firebase custom claims / Supabase `app_metadata`
  - generated catalog per stack (TypeScript, Dart, Kotlin, Swift): roles, methods, route rules, password policy, 18 normalized error codes from Firebase and Supabase, the `AuthService` interface
  - server: `deleteAccount` (recent sign-in, data and storage cleanup, deletion) and `setUserRole` (admins only) in the backend contract with typed clients; first-admin script / SQL; Firestore rules and RLS helpers
  - `AuthService` implementations (written once): Flutter, web (Next.js, Vite, Astro, Nuxt), React Native, Android, KMP (Supabase) and iOS, for Firebase and Supabase
  - screens (written once): `AuthFlow` (sign in, sign up, forgot password, phone, second factor, verify email), `AccountScreen` (linking, second factor, passkey, sign out, delete account with re-authentication) and `authRedirect()` for Flutter, React (next-intl / react-i18next), React Native, Nuxt (Vue), Compose (Android / KMP) and SwiftUI; texts `auth.ui.*`, `auth.errors.*`, `auth.password.*` in the shared i18n
  - passkeys: on Firebase, WebAuthn in your own Cloud Functions (SimpleWebAuthn, single-use challenges, custom token) with clients for the web (@simplewebauthn/browser), React Native (react-native-passkey), Flutter (package:passkeys), Android (Credential Manager) and iOS (AuthenticationServices); on Supabase, the native beta API (supabase-js, supabase_flutter, supabase-swift); `assetlinks.json` and `apple-app-site-association`
  - `check`: catalogs and contract in sync, implementations complete, texts, App Store 4.8 (Apple with Google on iOS), account-deletion URL, Identity Platform for Firebase MFA, provider limits (RN Firebase TOTP, Supabase SMS and passkeys), SMS cost, guest cleanup, Android passkey origin
- CI compiles the auth output against the real SDKs: firebase, supabase-js, React Native libraries, next-intl, react-i18next, Vue (vue-tsc), Flutter, supabase-kt, Android (Firebase, Credential Manager, Compose), iOS (FirebaseAuth, GoogleSignIn, supabase-swift, SwiftUI) and the Cloud Functions with SimpleWebAuthn
### Fixed
- push test fixture: English text with the same placeholders as Spanish

## [0.23.0] - 2026-11-24
### Added
- Deep language port: `/dualcraft:port` and `scripts/port.mjs` (idioms, deps, files, parity) — Dart ⇄ Kotlin ⇄ Swift ⇄ TypeScript and Flutter ⇄ Compose (Android/KMP) ⇄ SwiftUI ⇄ React Native, in every direction
  - `references/port/`: side-by-side idioms as real code with the same `@idiom` ids in every language — basics, types, collections, async, errors; UI layout, lists, state (Riverpod/Bloc → ViewModel + StateFlow / @Observable / zustand + TanStack Query), navigation (go_router → type-safe Navigation Compose / NavigationStack / React Navigation), forms and feedback
  - semantic pitfalls per language pair (equality, Int sizes, division, string length, eager vs lazy async, threads, value vs reference collections, JSON strictness, dates) and per UI framework
  - `deps`: reads pubspec, package.json, Gradle (version catalog + build files), Package.swift / Xcode / Podfile and Swift framework imports; maps ~60 concepts to the target ecosystem with install lines; choices kept in `.dualcraft/convert/deps.json`
  - `files <feature>`: follows imports/references from the feature's screens, classifies each file (model, repository, state, screen, widget, util, test, generated) and plans its target path and renames per stack (`.dualcraft/convert/files/<feature>.json`)
  - `parity <feature>`: every type, member, enum case, top-level function and test of the source exists in the target (renames, sealed → enum cases, widget class → composable function, intentional drops with `ignore`)
- CI compiles every idiom: Dart/Flutter (Riverpod, Bloc, go_router), Kotlin + Compose Multiplatform (lifecycle ViewModel, type-safe navigation, Coil), Swift + SwiftUI (macOS and iOS), TypeScript, React Native against the real library types
### Changed
- convert skill hands language-level work to `dualcraft:port` when the source and target languages differ
### Fixed
- `deploy secrets` no longer calls `process.exit()` after `fetch` (intermittent Node crash on Windows)

## [0.22.0] - 2026-11-24
### Added
- Legal and privacy pack: `/dualcraft:legal` and `scripts/legal.mjs` (scan, gen, check) — EU/Spain (GDPR, LOPDGDD, LSSI-CE, ePrivacy) plus App Store and Google Play rules; everything generated is a draft for professional review
  - `.dualcraft/legal/data-map.json`: controller, data categories with purposes, legal basis, retention and processors, minimum age, policy and account-deletion URLs, tracking, cookies
  - `scan`: infers collection from SDKs (Firebase, Supabase, store billing, RevenueCat, AdMob/Meta, location, photos, contacts, microphone, Sentry, Mixpanel, Amplitude, PostHog, Stripe, Google Analytics…), personal columns in the DB schema, permissions, tracking and cookies
  - `gen`: privacy policy, terms (purchases and subscriptions when the payments pack is used) and cookie policy in every project language; App Store privacy answers; Google Play Data safety answers; iOS `PrivacyInfo.xcprivacy` (collected data, tracking, required-reason APIs from Swift code)
  - `check`: map consistency (consent for ads/tracking/special data, international transfers), undeclared collection, in-app account deletion and web deletion URL, App Tracking Transparency, iOS permission texts, cookie consent banner, link to the policy
- CI: `plutil -lint` on the generated privacy manifests
### Changed
- release skill points to the legal checks for the store privacy forms

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
