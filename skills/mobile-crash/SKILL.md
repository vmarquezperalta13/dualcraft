---
name: mobile-crash
description: Crash analysis from stack traces, logcat, iOS logs, Crashlytics or Sentry to the root cause in code. Use when a trace or crash report is shared, or for "la app se cierra", "crash", "ANR", "pantalla roja".
---

# DualCraft mobile crash

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Then the fix goes through `dualcraft:debug` → `dualcraft:tdd` → `dualcraft:verify`.

## 1. Collect
- The full trace (not a screenshot crop): ask for it, or get it from the device (`dualcraft:mobile-device` logs). Crashlytics/Sentry: the issue's stack, affected versions, devices/OS, breadcrumbs/logs, % of users, first seen version.
- App version + build number, platform, OS version, whether release (obfuscated?) or debug.
- Obfuscated Dart stack (`--obfuscate`): symbolize with `flutter symbolize -i <trace.txt> -d build/symbols/app.android-arm64.symbols` (needs the symbols of that exact build). Android R8: the mapping file of that build.

## 2. Read the trace
- **Dart**: the exception type + message, then the **first frame in our package** (`package:<app>/…`) — that's where to look; framework frames above it show how we got there.
  - `Null check operator used on a null value` → a `!` on data that can be null (often Firestore fields, `currentUser`, route args).
  - `setState() called after dispose()` / `Looking up a deactivated widget's ancestor` → async work finishing after the screen closed (missing `mounted` check / subscription not cancelled).
  - `RenderFlex overflowed` / `unbounded height` → layout constraints (grey screen in release).
  - `type 'X' is not a subtype of type 'Y'` → JSON/Firestore shape differs from the model (check `.dualcraft/db/schema.dbml` and the generated models).
  - In-app purchases locked after restart / "already own this item" → `${CLAUDE_PLUGIN_ROOT}/references/play-billing.md` (causes A/B/C).
  - `PlatformException` / `MissingPluginException` → plugin setup, permissions, or calling a plugin before `WidgetsFlutterBinding.ensureInitialized()`.
- **Android**: `FATAL EXCEPTION` + `Caused by:` (deepest cause wins); ANR → `main` thread blocked (heavy sync work, platform channel waiting); `SIGSEGV` in a `.so` → native library/plugin.
- **iOS**: the crashed thread, exception type (`EXC_BAD_ACCESS`, `SIGABRT` with reason), our frames.

## 3. Locate & explain
Open the code at the frame; reconstruct the scenario that produces it (which user action, which data). Check git history of that code and the version where it started. State the root cause in one or two sentences with evidence — if it's still a hypothesis, say so and use `dualcraft:debug` to confirm.

## 4. Record & hand over
- Brain: `$BRAIN new bug "<crash summary>" --priority high` (if not there), with trace summary, affected versions, frequency, root cause.
- Fix via `dualcraft:debug` (reproduce with a test) — and search for the same pattern elsewhere (other `!` on Firestore data, other missing `mounted` checks).
- No reports coming in, or stack traces unreadable (missing symbols)? Set up or fix collection with `dualcraft:monitoring`.
- After release: watch the issue's trend in Crashlytics for the fixed version; record it in the bug's log.
