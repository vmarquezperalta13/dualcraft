---
name: mobile-architecture
description: Maps the mobile app structure (Flutter, React Native, KMP, Android, iOS) and says where each change goes. Use for "¿dónde va esto en la app?", "cómo está organizada la app", or before a new screen.
---

# DualCraft mobile architecture

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

`$DETECT` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.

## Map it (first time, or when it's stale)
1. `$DETECT` → state management, routing, codegen, Firebase packages, tests, i18n, flavors, entrypoints, `lib/` folders.
2. Read the real structure: `lib/` tree (feature-first `features/<x>/{data,domain,presentation}` or layer-first `screens/ widgets/ services/ models/`), `main*.dart` (initialisation order: Firebase, DI, crash reporting), app widget (theme, router, localizations), router config, DI (Riverpod providers, `get_it`, Provider tree).
3. Find conventions by example: open one full feature end to end — screen → state (notifier/bloc/provider) → repository → Firebase/API. Note naming, how errors and loading are modelled, how widgets are split.
4. Write `.dualcraft/architecture/mobile.md` (≤ 1 page):
   - stack line (from detect) · folder map with one line per folder
   - data flow: widget → state → repository → service/Firebase; how streams/listeners are owned and disposed
   - **"Where does X go?"** table: new screen, new reusable widget, new state, repository/service, model (generated from `dualcraft:schema`), route, theme/tokens (`dualcraft:tokens`), texts (`dualcraft:i18n`), analytics events (`dualcraft:analytics`), platform channel/permission
   - known debts (link brain tasks)
5. Record architecture choices as brain decisions if they aren't already.

## Use it
Before any app change, read `.dualcraft/architecture/mobile.md` and follow it. Don't mix a second state-management or routing approach in; if the current one hurts, propose a migration as a brain task.

## Flutter rules of thumb (when the project has no rule of its own)
- Feature-first folders; UI never talks to Firebase directly — through a repository.
- Widgets small and `const` where possible; split a `build()` that grows past ~80 lines into private widgets (not helper methods).
- State objects own their subscriptions and cancel them; no `BuildContext` across async gaps without `mounted`.
- Models immutable (generated); dates as `DateTime` in the app, converted at the edges.
- Navigation through the router, not ad-hoc `Navigator.push` scattered around.
