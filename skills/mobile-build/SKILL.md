---
name: mobile-build
description: Builds the mobile app and fixes build problems - dependencies, Gradle, pods, flavors, codegen, signing, store builds. Use for "no compila la app", "falla Gradle", "error de pods", "genera el appbundle".
---

# DualCraft mobile build

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`. Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"` (flavors, entrypoints, platforms).

## Build
Debug check: `flutter build apk --debug` (add `--flavor x -t lib/main_x.dart` if the project uses flavors — copy what CI does). Read the **first** real error; Gradle prints the root cause under "What went wrong".

## Common failures → fix
| Symptom | Fix |
|---|---|
| `version solving failed` | read which constraint conflicts; upgrade the blocking package or pin compatible versions; `flutter pub outdated` to see the landscape |
| `*.g.dart` / `*.freezed.dart` missing or stale | `dart run build_runner build --delete-conflicting-outputs` |
| AGP / Gradle / Kotlin version errors | align `android/settings.gradle(.kts)` plugin versions, `gradle-wrapper.properties` and Kotlin with the Flutter version's requirements; one step at a time |
| `minSdkVersion` / `compileSdk` too low | raise in `android/app/build.gradle` to what the plugin needs |
| NDK / 16 KB page-size warnings | align NDK and AGP; if the `android-16kb-page-size` skill is available, use it |
| Multidex / method count | `minSdk ≥ 21` solves it in practice |
| iOS `pod install` errors (macOS only) | `cd ios && pod repo update && pod install`; raise `platform :ios` in the Podfile if a pod needs it |
| `google-services.json` / `GoogleService-Info.plist` missing | add per flavor (never commit secrets beyond what Firebase config requires) |

## Release-only failures
If the debug build works and the release/testing build fails with Firebase (`unauthenticated`, `unavailable`, sign-in errors): R8 rules, upload-key **and** Play app-signing SHA fingerprints in Firebase, App Check provider, emulator guarded by `kDebugMode` — see `${CLAUDE_PLUGIN_ROOT}/references/firebase-functions.md` ("Debugging by error").

## Versioning & store builds
- `pubspec.yaml` `version: X.Y.Z+N` — `X.Y.Z` follows the DualCraft version (release command), `N` (build number) must increase on every store upload.
- Android release: `flutter build appbundle --release [--obfuscate --split-debug-info=build/symbols]`; keep the symbols for crash symbolication. Signing via `key.properties` + keystore **outside the repo**; never print or commit keystore passwords.
- iOS release: `flutter build ipa` on macOS with the right signing team.

## Upgrades
Flutter SDK: read the release notes' breaking changes; `flutter upgrade`, `dart fix --apply`, `flutter analyze`, tests. Packages: one major at a time, read changelogs, run the app.

## Done
Build green + `dualcraft:verify` for mobile. Toolchain changes (AGP, Kotlin, minSdk) → brain decision with the reason.
