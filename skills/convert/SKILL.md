---
name: convert
description: Converts an app between any of the supported stacks - web (Next.js, React + Vite, Astro, Vue/Nuxt) ⇄ mobile (Flutter, React Native, Kotlin Multiplatform, Android, iOS), and also web → web or mobile → mobile migrations - feature by feature - inventories the source, analyses every backend/platform touchpoint and asks the user whether it can be shared or how to handle it, writes a platform-neutral spec, adapts it to the target platform's patterns, generates code on the shared schema/tokens/i18n/analytics, and verifies behaviour and visuals. Creates the target project if it doesn't exist. Use when the user runs /dualcraft:convert, "pasa la web a app", "haz la versión web de la app", "convierte esta funcionalidad a móvil/web", or asks how far a conversion is.
---

# DualCraft convert (any stack ⇄ any stack)

`$CONV` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/convert.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.
References: spec format `${CLAUDE_PLUGIN_ROOT}/references/convert-spec.md` · platform mapping (web ⇄ mobile patterns + per-stack building blocks) `${CLAUDE_PLUGIN_ROOT}/references/platform-mapping.md` · source and target stack sheets `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` · commands `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

Stacks: `nextjs` `react-vite` `astro` `nuxt` · `flutter` `react-native` `kmp` `android` `ios`. `--from`/`--to` take a stack id, or `web`/`mobile` for the project's stack of that kind. Same-kind conversions (e.g. `react-native → flutter`, `nextjs → astro`) keep layout and interaction and change framework idioms; platform capabilities map to the target's native library.

**This is not a line-by-line translation.** Source code tells you *what the product does*; the target is written the way a good native developer of that platform would write it, on the project's shared sources. Behaviour (rules, data, flows) is preserved; layout and interaction are adapted.

## 0. Foundations (once per project)
The shared sources are what make the conversion cheap and safe. Before converting features, make sure they exist — or build them for the features you'll convert:
| Source | Why | How |
|---|---|---|
| Schema `.dualcraft/db/schema.dbml` | same data model both sides | `dualcraft:schema` (infer from the source code) → generate models/types for both |
| Design System + tokens | same look | `dualcraft:design-system` / `dualcraft:tokens` |
| Texts `.dualcraft/i18n` | same copy | `dualcraft:i18n` (scan + extract the source's hard-coded texts first) |
| Tracking plan | same events | `dualcraft:analytics` |
| Architecture map of the source | know where things are | `dualcraft:web-architecture` / `dualcraft:mobile-architecture` |
Do this incrementally: the first feature pulls in what it needs.

## 1. Inventory & target
1. `$CONV inventory --from <stack|web|mobile> [--to <stack>]` → screens grouped by feature (routes when the stack has them), what each uses (entities, i18n keys, events), and every backend/platform touchpoint — data access found anywhere in the source (Firestore, Supabase, callables, external APIs), server code (route handlers, server actions, Nitro/Astro endpoints) and native capabilities (payments, push, camera, location, biometrics, ads…).
2. **Target project**:
   - Which stack? If the user didn't say, recommend from the brief and the source (React web → React Native shares the most; content site → Astro; Kotlin team → KMP; best native feel on both → Flutter or native) and ask.
   - Exists in the project → read/create its architecture map and follow it.
   - Doesn't exist → create it with `dualcraft:stacks` ("Add a stack": `node "${CLAUDE_PLUGIN_ROOT}/scripts/stacks.mjs" scaffold <id> --dir <dir>`, ask before running), register it, wire the shared sources (tokens, i18n, analytics, schema — the generators produce them for the new stack), write its architecture map following `stacks/<id>.md`.
3. `$CONV init --from <source> --to <target-stack> [--target <dir>]` → `.dualcraft/convert/status.json`.

## 2. Backend & platform decisions — analyse, then ASK
For **every** item in `$CONV status` → "Backend decisions" (route handlers, server actions, Firestore collections, Cloud Functions, native plugins, payments):
1. Read the code: what it does, who calls it, whether it uses secrets/admin SDK, whether it enforces a business rule, what the target platform can and can't do (the app has no server; the web has no native APIs; store rules on payments).
2. Present it to the user with the options, your recommendation and the reason, e.g.:
   - *"`/api/reserve` usa firebase-admin y valida el aforo. La app no tiene servidor. Opciones: moverlo a una Cloud Function que usen web y app (recomendado: una sola regla para ambos), exponerlo como API autenticada para la app, o no ofrecer la reserva en la app."*
   - *"`in_app_purchase`: en web no existe. Opciones: checkout web con Stripe (solo si el contenido lo permite), mantener la compra solo en la app, o no vender en web."*
   Use AskUserQuestion (up to 4 items per round, one question each). Never decide sharing on your own.
3. Record: `$CONV backend <id> <decision> --why "<reason>"` and a brain decision for the important ones. Work that a decision creates (new Cloud Function, API auth, Stripe setup, rules for web access) → brain tasks that the affected features `--depends` on. Security-relevant changes go through `dualcraft:security-global` thinking (rules must cover the new client).

## 3. Plan the features
Order by dependency (auth/onboarding → core features → secondary) and value. Per feature: `$BRAIN new task "Convertir <feature> a <web|móvil>" --target <version> --depends <backend tasks>`, `$CONV set <feature> pending --task <ID>`. Features that make no sense on the target → `$CONV set <feature> skipped` with the user's OK (e.g. QR scanning on desktop web). Show the plan; big conversions → `dualcraft:plan`.

## 4. Convert one feature (repeat)
Mode **feature** (`dualcraft:start`), scope = target platform.
1. **Spec** — read every source file of the feature's screens and write `.dualcraft/convert/spec/screens/<id>.json` (+ update `spec/app.json`) per the spec reference: purpose, route, auth, data (schema entities), states, neutral layout, actions, events, and **business rules in plain language** (they become tests). Missing texts/events/entities → add them to the shared sources first. `$CONV spec-check` must pass. `$CONV set <feature> spec`.
2. **Adapt** — apply the platform mapping: navigation, layout, inputs, feedback, capabilities; write the choices in `platformNotes`. If the layout changes a lot, design the target screens first (`dualcraft:design-screen`) and get the user's OK. `$CONV set <feature> adapted`.
3. **Generate** — in the target project, following its architecture map and `stacks/<target>.md` (use the per-stack building blocks table for routing, lists, sheets, forms, state): routes/screens, state, data access through the generated models/types, tokens only (`dualcraft:design-to-code` rules), texts from i18n, events through the generated helpers, backend calls as decided in step 2. Rules test-first with the **same cases** as the source (`dualcraft:tdd`); add the missing tests to the source too if it had none. `$CONV set <feature> generated`.
4. **Verify** — target analyzer/types/tests/build (`dualcraft:verify`); run both apps and compare screenshots of each screen and state (`dualcraft:web-browser`, `dualcraft:mobile-device`); walk the main flow end to end against the same backend; `analytics.mjs coverage` shows the feature's events on both platforms. `$CONV set <feature> verified`.
5. **Close** — `dualcraft:review`, functional document updated (the feature's Platforms line now says both — `dualcraft:docs`), commit `feat(<web|mobile>): <feature> converted from <source-stack>` (`dualcraft:commit`), `$CONV set <feature> done`, brain task done.

## 5. Progress & finish
- `$CONV status` anytime — show it to the user as a short table; the brain map shows the conversion tasks and their dependencies.
- When all features are done/skipped: summary of what was converted, what was adapted, backend changes made, what's not offered on the target and why. A new app or website also needs its launch work: store listing/ASO or SEO (`dualcraft:marketing`, `dualcraft:web-seo`) and the release checklist (`dualcraft:release`).
