---
name: port
description: Deep code conversion between Dart, Kotlin, Swift and TypeScript (Flutter, Compose, KMP, SwiftUI, React Native) - idioms, dependency mapping, file plan, parity checks. Use for "pasa la app de Flutter a Kotlin", "convierte a Swift", "migra a KMP".
---

# DualCraft port (deep language conversion)

`$PORT` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/port.mjs"`, `$CONV` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/convert.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.
Reference code (compiled in CI, same `@idiom` ids in every language): `${CLAUDE_PLUGIN_ROOT}/references/port/lang/<dart|kotlin|swift|ts>/` and `${CLAUDE_PLUGIN_ROOT}/references/port/ui/<flutter|compose|swiftui|react-native>/`. Target conventions: `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md`.

**When**: a whole app (Flutter → Android/KMP/SwiftUI, and back; React Native/TS ⇄ Dart/Kotlin), one feature inside `dualcraft:convert` (its step 4.3 when the languages differ), or a single file/module. Web UI ⇄ mobile UI is a platform adaptation, not a language port: that part stays in `dualcraft:convert` (platform mapping).

**The rule**: port behaviour, not syntax. Keep the public API, rules, error cases and wire formats; write the target the way a good developer of that platform would.

## 0. Target shape — ask before porting
- Flutter → Kotlin: **Android only** (Compose, Hilt or Koin, Room, Retrofit or Ktor) or **KMP** (logic in `commonMain`, Compose Multiplatform, Koin, Ktor, SQLDelight or Room KMP)? Recommend KMP when iOS must stay covered without Flutter, Android when the app is Android-only or relies on many Android APIs.
- Architecture: follow the target's architecture map; for a new project use MVVM — `ui/<feature>` (screens + ViewModels), `data` (repositories, models), `di`.
- Ask with AskUserQuestion (recommendation first) and record it: `$BRAIN new decision "Port a <target>: <choice>" --why "…"`.

## 1. Equivalences (once per session)
- `$PORT idioms --from <src> --to <dst>` → index of topics: language (`basics types collections async errors`) and UI (`layout lists state navigation forms`).
- Read the topics you are about to use: `--topic async`, or write the whole cheat sheet into the project (`--write` → `.dualcraft/convert/port-<a>-<b>.md`) and read it.
- Each topic ends with **pitfalls**: code that compiles and behaves differently (equality, Int sizes, division, string length, eager vs lazy async, threads, value vs reference collections, JSON strictness, dates). Check every one against the code you port.

## 2. Dependencies → libraries
1. `$PORT deps --from <src-stack> --to <dst-stack> --write` → mapped (first option = recommended), unknown (research), tooling (no equivalent needed). Results go to `.dualcraft/convert/deps.json`.
2. Where there are real alternatives (HTTP: Retrofit or Ktor; DI: Hilt or Koin; DB: Room or SQLDelight; images: Coil…), ask the user in one round and write the choice into `deps.json` (`choice`).
3. Unknown packages: find a maintained equivalent, or write it on the platform API; for KMP gaps use `expect`/`actual`.
4. Install current stable versions (check them — never invent). Do not hand-port what DualCraft generates: regenerate tokens, i18n, models, analytics, the API client, payments and push for the target stack (`dualcraft:tokens`, `dualcraft:i18n`, `dualcraft:schema`, `dualcraft:analytics`, `dualcraft:backend`, `dualcraft:payments`, `dualcraft:push`).

## 3. File plan
`$PORT files <feature>` (feature from the conversion status; or `--seed a.dart,b.dart` for loose files) → `.dualcraft/convert/files/<feature>.json`: each source file (followed through its imports/references) with its kind (model, repository, state, screen, widget, util, test, generated), planned target path, renames (`CartNotifier → CartViewModel`), `shared` files used by other features, and tests. Adjust targets and renames to the target's architecture map **before** writing code.

## 4. Port, file by file — models → data → state → UI → tests
- **Names**: keep them, adapted to conventions (Kotlin enum constants in UPPER_CASE with `@SerialName("free")` so the wire value stays the same; Swift lowerCamel cases; TS string unions).
- **State**: Riverpod Notifier / Bloc / Cubit / Provider / GetX → `ViewModel` + `StateFlow` (Compose) · `@MainActor @Observable` model (SwiftUI) · zustand store + TanStack Query (React Native). Public methods keep their names; Bloc events become methods; `AsyncValue` → a `UiState` sealed type.
- **Navigation**: go_router → type-safe routes (Navigation Compose `@Serializable` routes · `NavigationStack` with an enum path · React Navigation param lists / Expo Router files). Keep the same deep-link paths.
- **UI**: one Composable / View / component per widget, state hoisted, design tokens only (`dualcraft:design-to-code`). Adapt to the platform (UI pitfalls: no Material imitation on iOS, insets and edge-to-edge on Android).
- **Platform plugins and channels** → the native API directly (Android/iOS) or `expect`/`actual` (KMP).
- **Tests**: port every test with the same name — parity matches tests by name. Port the test first where possible (`dualcraft:tdd`).
- Anything not portable: a `TODO(port)` comment, and an `ignore` entry with a reason in the plan (see 5).
- After each file: build the target. Do not move on with compile errors.

## 5. Verify
1. `$PORT parity <feature>` → per file: missing types, members, enum cases, top-level functions and tests (exit 1 until every file is ported). Fix the gaps, or record intentional drops in the plan entry: `"ignore": ["CartNotifier.clear", "clear empties the cart"], "note": "why"`.
2. Build and run the tests of the target (`dualcraft:verify`):
   - Android: `./gradlew assembleDebug testDebugUnitTest`
   - KMP: `./gradlew :composeApp:allTests`
   - iOS: `xcodebuild test`
   - Flutter: `flutter analyze && flutter test`
   - React Native: `npx tsc --noEmit && npx jest`
3. Run both apps against the same backend and compare each screen and flow (`dualcraft:mobile-device`, `dualcraft:web-browser`).
4. Inside a conversion: `$CONV set <feature> verified`; then review and commit (`dualcraft:review`, `dualcraft:commit`).

## Whole app (e.g. Flutter → Kotlin)
1. `$CONV init --from flutter --to android|kmp|ios` → inventory, features and backend decisions. The backend is usually *shared*: same Firebase/Supabase project, register the new app.
2. Step 0 (target shape) + step 2 (deps) once; generate the shared foundations for the new stack.
3. App shell: DI graph, navigation host, theme from tokens, Application/App entry point, permissions in the manifest / Info.plist, flavors and environments (`dualcraft:deploy` for signing and pipelines).
4. Features in dependency order (auth → core → secondary): files → port → parity → verify → commit, one feature at a time (`dualcraft:convert` tracks the progress).
5. Finish with store work: privacy answers (`dualcraft:legal`), listing and release (`dualcraft:release`).
