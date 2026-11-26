---
name: using-dualcraft
description: DualCraft workflow - project context from the brain, work mode before working, capture out-of-scope work, route to the right dualcraft skill. Use at the start of any conversation in a project with a .dualcraft/ folder or when DualCraft is mentioned.
---

# Using DualCraft

DualCraft is a web + mobile workflow (web: Next.js, React + Vite, Astro, Vue/Nuxt · mobile: Flutter, React Native, Kotlin Multiplatform, Android, iOS) built around a **project brain**: every task, bug, decision, note and idea lives as a small file in `.dualcraft/brain/`, so context survives between conversations.

## Language rule
- Talk to the user in the project's `lang` (from `.dualcraft/config.json`, Spanish by default) — or in whatever language the user writes in.
- Commands, skill names, file names, note ids, frontmatter keys and branch names are always **English**.
- Commit messages use `commitLang` from the config.

## Tools
- **Brain CLI** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" <command>`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, use the exact "Brain CLI" path printed in the session context, or `<this skill's base directory>/../../scripts/brain.mjs`. Other skills call it **`$BRAIN`**. Run `$BRAIN help` for its commands.
- **Help** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/help.mjs"` lists every DualCraft command.

## The rules
1. **Context first.** Before any work, have the project context: the session start hook prints it (with every decision in force); if it's missing, run `$BRAIN summary`.
2. **Decisions are binding.** A hook adds the decisions related to each request ("decisions and notes related to this request"). Follow them; if a request contradicts one, say so before acting and let the user choose: adapt the request or supersede the decision (`dualcraft:decisions`). When a new choice is made, record it as a decision.
3. **Mode before work.** If the context says the work mode is NOT CHOSEN, invoke `dualcraft:start` before touching code. The mode drives the flow, the commit type and the version bump.
4. **Capture, don't drift.** Anything that comes up but is out of the current scope (a new idea, a bug spotted elsewhere, a "we should also…", a decision taken) goes into the brain with `dualcraft:brain` — never silently done, never forgotten. Tell the user in one line what you noted (e.g. "Apuntado como T-012 para 1.4.0").
5. **Keep the brain true.** When a task starts → `status=doing`; when it's finished and verified → `status=done`. Link work with `depends_on`.
6. **Finish through commit.** When the work is done, use `dualcraft:commit` (it asks before committing).

## Routing
| Situation | Skill |
|---|---|
| Brand-new project, "empezamos de cero" | `dualcraft:new-project` |
| Starting work / choosing what to do | `dualcraft:start` |
| Supported stacks, add a stack to the project | `dualcraft:stacks` |
| "apunta", "déjalo para luego", backlog questions | `dualcraft:brain` |
| "hemos decidido…", "a partir de ahora…", "¿qué decidimos sobre…?", changing a decision | `dualcraft:decisions` |
| Finished work that must wait for a later version | `dualcraft:park` |
| Committing, writing commit messages, CHANGELOG | `dualcraft:commit` |
| See the brain as a network of nodes | `dualcraft:map` |
| What goes in which version, progress | `dualcraft:roadmap` |
| See the database model as a diagram | `dualcraft:er` |
| Define/change stored data, generate models/types/rules | `dualcraft:schema` |
| Create the database, environments, migrations, deploy rules | `dualcraft:database` |
| Server functions, endpoints, webhooks, cron, calling the backend from the apps | `dualcraft:backend` |
| In-app purchases, subscriptions, premium, coins, RevenueCat | `dualcraft:payments` |
| Push notifications, notify users, FCM | `dualcraft:push` |
| CI, deploys, pipelines, TestFlight / Play testing uploads, secrets | `dualcraft:deploy` |
| Login, sign-up, roles, protected routes, delete account, passkeys, 2FA | `dualcraft:auth` |
| Feature flag, remote config, kill switch, A/B test, "activar sin publicar" | `dualcraft:flags` |
| End-to-end tests, Playwright, Maestro, smoke tests of every screen | `dualcraft:e2e` |
| Performance budgets, Lighthouse, bundle size, app size, startup time | `dualcraft:perf` |
| Marketing video, Remotion, App Store preview, reel or TikTok of a release | `dualcraft:video` |
| Product photos, remove background, white background packshot, ad with the product photo | `dualcraft:photos` |
| Privacy policy, GDPR, cookies, terms, App Privacy / Data safety, account deletion | `dualcraft:legal` |
| New idea, "quiero añadir…", design before code | `dualcraft:brainstorm` |
| Work with several steps / both platforms | `dualcraft:plan` |
| Writing implementation code | `dualcraft:tdd` |
| Bug, crash, failing test, "no funciona" | `dualcraft:debug` (before any fix) |
| Before saying done / committing | `dualcraft:verify` |
| Reviewing changes, before merge/PR | `dualcraft:review` |
| Functional document, "documenta" | `dualcraft:docs` |
| Brand, colors, typography, "crea el design system" | `dualcraft:design-system` |
| Pull design changes into code, "actualiza los colores" | `dualcraft:tokens` |
| Design a screen (mobile + web mockup) | `dualcraft:design-screen` |
| Implement a designed screen | `dualcraft:design-to-code` |
| Next.js structure, where a web change goes | `dualcraft:web-architecture` |
| Web build errors, dependencies, upgrades | `dualcraft:web-build` |
| Web tests | `dualcraft:web-test` |
| See/try the web in a browser, screenshots | `dualcraft:web-browser` |
| SEO, performance, Lighthouse | `dualcraft:web-seo` |
| Flutter structure, where an app change goes | `dualcraft:mobile-architecture` |
| App build errors, Gradle/pods, store builds | `dualcraft:mobile-build` |
| Flutter tests | `dualcraft:mobile-test` |
| Emulator/device, adb, logs, screenshots | `dualcraft:mobile-device` |
| Crash, stack trace, Crashlytics | `dualcraft:mobile-crash` |
| Texts, translations, languages | `dualcraft:i18n` |
| Analytics events, tracking plan | `dualcraft:analytics` |
| Refactor web / app / both | `dualcraft:refactor-web` / `refactor-mobile` / `refactor-global` |
| Security audit of everything / web / app | `dualcraft:security-global` / `security-web` / `security-mobile` |
| Close/ship a version, store release notes | `dualcraft:release` |
| Store screenshots | `dualcraft:screenshots` |
| GitHub Issues sync, assign or estimate tasks | `dualcraft:github` |
| Share the roadmap or map as a page | `dualcraft:share` |
| Communicate an update, ASO, social, campaigns, growth ideas | `dualcraft:marketing` |
| Turn the web into an app or the app into a web, migrate to another stack, conversion progress | `dualcraft:convert` |
| Port code to another language (Flutter → Kotlin/KMP/Swift, Kotlin/Swift → Flutter, TS ⇄ Dart/Kotlin), library equivalents | `dualcraft:port` |
| "¿qué comandos hay?", help | `dualcraft:help` |

**Data rule:** in a project with `.dualcraft/db/schema.dbml`, any change to stored data starts in the schema (`dualcraft:schema`) and models/types are regenerated — never hand-edit generated files.

**Design rule:** the claude.ai Design System (`design.system` in config) is the source of truth for colors, typography, spacing and radius. Code uses only the generated tokens — never raw hex colors or magic sizes; a missing value is a Design System change.

**Shared-sources rule:** texts come from `.dualcraft/i18n/` and analytics events from `.dualcraft/analytics/events.json` — both platforms use the generated files, never hard-coded strings or ad-hoc event names. Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`; per-platform maps in `.dualcraft/architecture/`.

**Stack rule:** the project's stacks are in `config.stacks`. For any stack other than Next.js/Flutter, read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` before working in it — it replaces the Next.js/Flutter examples of the general skills.

**Specialist agents** (`dualcraft:<agent>`, when installed): hand a self-contained job to one when it is big, needs a fresh look, or would flood this conversation — a security audit (`security`), a branch review (`reviewer`), test coverage and "is it really done" (`qa`), options and a plan for a new feature (`architect`), a hard bug (`debugger`), screens and the design system (`designer`), launch copy and material (`marketing`), closing a version (`release`). Also when the user asks for one ("usa el agente de seguridad"). List them, or delegate with a brief: `dualcraft:agents`. Give the agent the goal, scope and what the user already decided; relay its report to the user. `security` and `reviewer` only report: apply their fixes here, after the user agrees. Small tasks stay here.

**Process rules:** no code before an agreed design for new features; no fix before a root cause; no "done" without fresh verification evidence.

All commands: `dualcraft:help` (it also shows skills not installed and how to add them: `npx github:vmarquezperalta13/dualcraft add <stack|pack>`).
