# DualCraft

[![CI](https://github.com/vmarquezperalta13/dualcraft/actions/workflows/ci.yml/badge.svg)](https://github.com/vmarquezperalta13/dualcraft/actions/workflows/ci.yml)

Web + mobile development workflow for **Claude Code, Gemini CLI and Codex CLI**, built around a **project brain**.

**Stacks** — web: Next.js · React + Vite · Astro · Vue/Nuxt — mobile: Flutter · React Native (Expo) · Kotlin Multiplatform · Android (Compose) · iOS (SwiftUI) — backends: Firebase · Supabase · PostgreSQL + Prisma.

You talk to it in your language (Spanish by default); commands are in English.

## What it does (v0.16)

- **Project brain** (`.dualcraft/brain/`): tasks, bugs, decisions, notes and ideas as small markdown files with ids (`T-001`, `D-002`…), status, target version and dependencies. Loaded automatically at the start of every session.
- **New projects**: a full intake form (idea, type, platforms, stacks, backend, design, MVP features) creates the brief, decisions, MVP tasks and functional document, and scaffolds each stack with its CLI.
- **Decisions that stick**: ADR-style decisions by area; all decisions in force are loaded at session start and the ones related to each request are injected automatically; conflicts are raised before acting; superseding keeps the history.
- **Work modes**: before working, DualCraft asks whether it's a *bug / short task*, a *new development* or a *refactor*. The mode drives the flow, the commit type and the version impact.
- **Parked work**: finished development that must wait for a later version is kept on a `parked/*` branch or behind a feature flag, with its target version recorded.
- **Commits**: Conventional Commits derived from the mode, linked to brain ids, with `CHANGELOG.md`.
- **Team & sharing**: assignee and estimate per task, estimates per version, two-way sync with GitHub Issues, and the roadmap/map as a shareable page (full, or without internal details for clients).
- **Visual brain**: an offline HTML map of notes as nodes linked by their dependencies, plus a roadmap board by version.
- **Process**: brainstorm before building, written plans, TDD, root-cause debugging, verification with evidence, code review (incl. accessibility) — for both platforms.
- **Functional document** (`docs/FUNCTIONAL.md`) kept up to date as work is finished, traceable to brain ids.
- **Design**: the project's claude.ai Design System is the source of truth for the look; its tokens become Tailwind v4 / CSS variables for Next.js and a Material theme for Flutter (light + dark, contrast-checked). Screens are designed as mobile + web artboard pairs and implemented with tokens only.
- **Web and mobile packs**: architecture maps, builds, tests, browser and device tooling, SEO, crash analysis, and safe refactoring per platform or across both.
- **Shared texts and analytics**: one i18n source → Flutter ARB + next-intl; one tracking plan → typed event helpers for Dart and TypeScript.
- **Security**: global, web and mobile audits with a static scanner (secrets, Firebase rules, Cloud Functions, Next.js endpoints and headers, Android/iOS config, payments) and a dated report; findings become brain bugs.
- **Release & marketing**: a readiness checklist across brain, security, texts, analytics and docs; one command bumps every version and closes the CHANGELOG; store notes validated against Play/App Store limits; launch copy, campaign plan and growth ideas for each update.
- **Converter between any stacks** (web ⇄ mobile, or web → web / mobile → mobile migrations): feature-by-feature conversion through a platform-neutral spec; every backend or native dependency is analysed and decided with you (share, expose as API, move to Cloud Functions, alternative, or skip); the target is native, built on the shared sources, and verified against the source.
- **Databases**: Firebase, Supabase or PostgreSQL + Prisma with local + dev + prod environments set up through each CLI; the schema becomes SQL migrations (incremental, with RLS), a Prisma schema or Firestore rules — applied per environment and promoted to prod safely.
- **Database schema as source of truth**: `.dualcraft/db/schema.dbml` ([DBML](https://dbml.dbdiagram.io/docs)) → ER diagram with crow's-foot notation (PNG/SVG export) and generated Dart models, TypeScript types and a Firestore rules skeleton.

Run `/dualcraft:help` to see every command (installed and not installed).

## Install

Requires Node.js 18+ and git.

```
npx github:vmarquezperalta13/dualcraft install
```

The installer asks which **agents** (Claude Code, Gemini CLI, Codex CLI), which **stacks** and which **optional packs** you want, and installs only that — fewer skills means less fixed context in every session (skill descriptions: ≈ 1.3k tokens for core + one stack, ≈ 2.6k with everything).

| Pack | Contents |
|---|---|
| core (always) | brain, decisions, work modes, process skills, functional document, commits |
| one per stack | nextjs · react-vite · astro · nuxt · flutter · react-native · kmp · android · ios (adds the web or mobile platform skills) |
| design | Design System, tokens, screens, design → code |
| data | schema, ER diagram, databases and environments |
| payments | in-app purchases on Google Play and the App Store (native server verification or RevenueCat) |
| push | push notifications with FCM: channels, topics, typed notifications with deep links, texts per language |
| deploy | CI/CD with GitHub Actions: CI per stack, web deploys with previews, backend per environment, mobile builds to Play internal testing and TestFlight |
| auth | sign-in on Firebase or Supabase: email, Google, Apple, phone, passkeys, guest + linking, 2FA, roles and route rules, account deletion; typed service and screens per stack |
| e2e | end-to-end tests from one spec: Playwright for the web, Maestro for the apps; flows derived from auth, routes, payments and store screenshots |
| perf | performance budgets in CI: Lighthouse and bundle size for the web, app size of store builds, cold start with history |
| legal | privacy and legal (EU/Spain + stores): data map, draft policies, App Privacy / Data safety answers, iOS privacy manifest, checks |
| backend | serverless functions from one contract (Cloud Functions, Supabase Edge Functions, API routes), typed clients for every stack |
| shared | i18n, analytics, cross-platform refactor |
| security | global / web / mobile audits |
| release | release and marketing |
| convert | converter between stacks + deep language port (Dart ⇄ Kotlin ⇄ Swift ⇄ TS) |

Other commands: `add <stack|pack>…`, `remove <stack|pack>…`, `list`, `update`, `doctor`, `uninstall`. Non-interactive: `install --agents claude,gemini --stacks nextjs,flutter --packs design,data --yes` (`--all-packs`, `--packs none`).

Where it installs (global, for your user): shared scripts in `~/.dualcraft/current`; **Claude Code** gets a local plugin `dualcraft@dualcraft-local` (commands `/dualcraft:*`, hooks); **Gemini CLI** and **Codex CLI** get the skills as `dualcraft-*` in `~/.gemini/skills` / `~/.codex/skills` plus a DualCraft block in `GEMINI.md` / `AGENTS.md` that loads the brain and the related decisions.

Everything, Claude Code only (no installer): `/plugin marketplace add vmarquezperalta13/dualcraft` then `/plugin install dualcraft@dualcraft`.

Local development: `claude plugin marketplace add <path-to-this-folder>`.

## Commands

| Command | |
|---|---|
| `/dualcraft:help` | List all commands |
| `/dualcraft:new-project` | Intake form + setup for a brand-new project |
| `/dualcraft:stacks` | Supported stacks; add one to the project |
| `/dualcraft:start` | Set up the project, load context, choose the work mode |
| `/dualcraft:brain` | Capture and query tasks, bugs, decisions, notes, ideas |
| `/dualcraft:decisions` | Record, consult, check and supersede decisions |
| `/dualcraft:park` | Park finished work for a later version |
| `/dualcraft:github` | Sync the brain with GitHub Issues |
| `/dualcraft:share` | Publish the roadmap or map as a page |
| `/dualcraft:commit` | Mode-aware Conventional Commit + CHANGELOG |
| `/dualcraft:map` | Visual map of the brain (nodes + dependencies) |
| `/dualcraft:roadmap` | Work grouped by target version |
| `/dualcraft:er` | ER diagram of the database schema |
| `/dualcraft:database` | Create the database and environments; migrations, rules, deploys |
| `/dualcraft:payments` | In-app purchases: catalog, server verification or RevenueCat, purchase service |
| `/dualcraft:push` | Push notifications: catalog, typed senders and parsers, device registration |
| `/dualcraft:deploy` | CI/CD workflows, environments, secrets check, release signing |
| `/dualcraft:auth` | Auth config, catalogs, AuthService, sign-in/account screens, deletion and roles on the server, passkeys |
| `/dualcraft:e2e` | End-to-end flows → Playwright specs and Maestro flows; run locally and in CI |
| `/dualcraft:perf` | Performance budgets: Lighthouse, bundle, app size, cold start; CI jobs and a local runner |
| `/dualcraft:video` | Marketing videos with Remotion: App Store previews, Play promo, Reels/TikTok, per language |
| `/dualcraft:photos` | Product photos from your real photos, free and local: background removal, white packshots, ads per language |
| `/dualcraft:legal` | Data map, draft privacy policy / terms / cookies, store privacy forms, privacy manifest |
| `/dualcraft:backend` | Server functions from a contract: callables, webhooks, triggers, cron; validators + typed clients |
| `/dualcraft:schema` | Edit the schema; generate Dart / TS / Firestore rules |
| `/dualcraft:brainstorm` | Explore an idea and agree the design |
| `/dualcraft:plan` | Step-by-step implementation plan |
| `/dualcraft:tdd` | Test first, then implement |
| `/dualcraft:debug` | Root cause before any fix |
| `/dualcraft:verify` | Evidence before saying it's done |
| `/dualcraft:review` | Code review, incl. accessibility |
| `/dualcraft:docs` | Update the functional document |
| `/dualcraft:design-system` | Create/link the claude.ai Design System |
| `/dualcraft:tokens` | Pull tokens and generate web + Flutter theme code |
| `/dualcraft:design-screen` | Design a screen: mobile + web artboards |
| `/dualcraft:design-to-code` | Implement a designed screen with tokens only |
| `/dualcraft:web-architecture` · `web-build` · `web-test` · `web-browser` · `web-seo` | Next.js pack |
| `/dualcraft:mobile-architecture` · `mobile-build` · `mobile-test` · `mobile-device` · `mobile-crash` | Flutter pack |
| `/dualcraft:i18n` · `analytics` | Shared texts and tracking plan |
| `/dualcraft:refactor-web` · `refactor-mobile` · `refactor-global` | Safe refactoring |
| `/dualcraft:security-global` · `security-web` · `security-mobile` | Security audits |
| `/dualcraft:release` | Close and ship a version |
| `/dualcraft:marketing` | Launch copy, ASO, campaigns, growth ideas |
| `/dualcraft:screenshots` | Store screenshots framed per language and size |
| `/dualcraft:convert` | Convert web ⇄ mobile, feature by feature |
| `/dualcraft:port` | Deep language port (Flutter → Kotlin/KMP/SwiftUI and back, TS ⇄ Dart/Kotlin): idioms, deps, file plan, parity |

## Specialist agents
Specialists with their own context, for jobs that would flood the conversation. Claude Code: `dualcraft:<agent>` (ask "usa el agente de seguridad" or @-mention it); Gemini CLI: `~/.gemini/agents/dualcraft-<agent>.md`; Codex CLI: `~/.codex/agents/dualcraft-<agent>.toml`. Each one is installed with the skill it relies on. None of them commits, pushes, publishes or deploys.

| Agent | Does | Changes code |
|---|---|---|
| `security` | Threat model and full audit (web, mobile, backend, payments, privacy) with the scanner; findings as brain bugs | No — reports only |
| `reviewer` | Code review of a branch, diff or PR: correctness, lifecycle, web ⇄ mobile, decisions, tokens, accessibility | No — reports only |
| `qa` | Finds untested behaviour, writes unit to e2e tests, runs suites and performance budgets | Tests only |
| `architect` | Options with trade-offs, where each change goes, implementation plan, decisions | Plans only |
| `debugger` | Root cause with evidence, minimal fix and regression test, other platform checked | Yes |
| `designer` | Design system, tokens and contrast, screens with their states, design to code | Yes |
| `marketing` | What to say per version, ASO, copy per channel and language, campaign, screenshots, videos, photos | Drafts and material |
| `release` | Readiness checklist, versions, CHANGELOG, store notes, CI/CD, legal; leaves tag, publish and deploy to you | Release files |

## Development

```
npm test                  # unit + integration tests (Node 22+)
npm run compile-fixtures  # writes compile-out/ with the generated code per language
```

CI compiles the generated code for real on every push: TypeScript, Flutter, Kotlin, Swift (macOS) and Postgres/Prisma. Skill descriptions live in `scripts/dev/descriptions.json` (apply with `node scripts/dev/apply-descriptions.mjs`).

Skill evals (`claude plugin eval`, Claude Code ≥ 2.1.269) live in `evals/`, generated by `node scripts/dev/gen-evals.mjs` from `scripts/dev/eval-triggers.json`: one case per skill checks that a natural request loads it, plus behaviour cases on a scaffolded project. They call the model, so they never run on push: locally with your own Claude login, or on demand in GitHub Actions (`.github/workflows/evals.yml`, manual only, no paid API: your Claude subscription through the `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`):

```
claude plugin eval . --ablation none --runs 1 --tag trigger --max-cost-usd 5
claude plugin eval . --ablation none --runs 1 --tag behavior --scaffold
```

## Roadmap

1. ✅ Core: brain, work modes, parked work, commits, help
2. ✅ Visual brain map (nodes + dependencies), roadmap view, ER diagram and schema as source of truth
3. ✅ Process: brainstorm, plan, TDD, debug, verify, review, functional document
4. ✅ Design: claude.ai Design → shared tokens → React / Flutter
5. ✅ Web and mobile packs, refactoring, i18n, analytics
6. ✅ Security: global, web, mobile
7. ✅ Marketing and release (versioning, store notes, launch checklist)
8. ✅ Web ⇄ mobile converter
9. ✅ Installer with packs for Claude Code, Gemini CLI and Codex CLI

## Project files

```
.dualcraft/
  config.json     name, version, stacks, languages
  brain/          one note per file
  db/schema.dbml  database schema (source of truth)
  backend/api.json  server functions contract (source)
  push/notifications.json  channels, topics and notifications (texts in i18n under "push")
  deploy/pipeline.json  web host, Android track, branch (workflows are generated from it)
  auth/auth.json  sign-in methods, roles, route rules, MFA, deletion and passkeys (source of the auth catalogs)
  e2e/flows.json  end-to-end flows in neutral steps (source of the Playwright specs and Maestro flows)
  perf/budgets.json  performance budgets (web vitals, bundle, app size, startup) + perf-check.mjs runner and history
  marketing/videos.json  marketing videos in neutral scenes (source of the Remotion project in marketing/video/)
  marketing/photos.json  product photo presets and texts (studio in marketing/photos/, photos in input/)
  legal/data-map.json  personal data processed: purposes, legal basis, retention, providers (source of the legal drafts)
  payments/products.json  products, entitlements and currencies sold in the apps (source)
  design/tokens.json  copy of the Design System tokens (pulled, never edited here)
  i18n/<locale>.json  UI texts for web + mobile (source)
  analytics/events.json  tracking plan (source)
  architecture/   web.md / mobile.md structure maps
  store/listing.json  store listing texts per language
  release/<version>.json  store release notes per language
  convert/        inventory, status (features + backend decisions), neutral spec,
                  port plans (files/<feature>.json), deps.json, port-<a>-<b>.md cheat sheets
  db/layout.json  saved ER diagram positions (optional)
  db/snapshot.json  schema as of the last generated SQL migration
  specs/          agreed designs (from brainstorm)
  plans/          implementation plans
  out/            generated views: map.html, roadmap.html, er.html (gitignored)
  state.json      current work mode (local, gitignored)
```

Scripts can be used directly: `node scripts/brain.mjs help`, `node scripts/er.mjs help`, `node scripts/gen.mjs help`, `node scripts/map.mjs --open`.
