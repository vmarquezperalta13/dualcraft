---
name: mobile-test
description: Mobile tests - unit, widget/component, golden, integration - with fakes for Firebase and plugins. Use for "tests de la app", "test de este widget", "integration test", or when TDD needs a mobile test.
---

# DualCraft mobile tests

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`. Process: `dualcraft:tdd`. Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`.

## Pick the level
| What | How |
|---|---|
| Pure logic, models, mappers, validators | `test()` in `test/` mirroring `lib/` paths |
| State (Riverpod notifier, Bloc, ChangeNotifier) | unit test with fake repositories; Riverpod: `ProviderContainer(overrides: […])`; Bloc: `bloc_test` if present |
| Widgets / screens | `testWidgets` — `pumpWidget` inside the app's `MaterialApp` with theme (`DsTheme.light()`), localizations and provider overrides; `find.text/byType/bySemanticsLabel`, `tester.tap`, `pumpAndSettle` |
| Visual regressions | goldens (`matchesGoldenFile`) for key components in light and dark; regenerate deliberately with `--update-goldens` |
| Real device flows | `integration_test/` (or Patrol) — few, critical paths |

Wrap widgets in a shared test harness (`test/helpers/pump_app.dart`) so every test gets theme, l10n and overrides the same way — create it if missing.

## Fakes
- Firestore: `fake_cloud_firestore`; Auth: `firebase_auth_mocks`; or fake the repository (simplest, preferred for widget tests).
- Mocks: `mocktail` (or `mockito` if the project uses it). Fake platform plugins via their test interfaces or by hiding them behind a service.
- Time: inject a clock; never `DateTime.now()` inside logic under test.
- No real network; no Firebase initialisation in unit/widget tests.

## Accessibility in tests
`expect(tester, meetsGuideline(androidTapTargetGuideline))`, `textContrastGuideline`, `labeledTapTargetGuideline` on key screens.

## Same rule, both platforms
If the rule also exists on the web, use the same test cases (`dualcraft:tdd`).

## Run & report
One file while iterating (`flutter test test/x_test.dart`), whole suite before `dualcraft:verify`. Report counts; fix flaky tests (usually missing `pumpAndSettle` or real timers).
