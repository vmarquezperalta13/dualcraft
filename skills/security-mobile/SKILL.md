---
name: security-mobile
description: Mobile security review (MASVS) - secure storage, network, deep links, manifest and ATS, release config, IAP verification, App Check. Use for "seguridad de la app", before a store release, or within a global audit.
---

# DualCraft security — mobile

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

`$SEC` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs" --scope mobile`. Confirm each finding in the code; never print secret values. If the project has its own mobile/Firebase security skill, apply it as well.

Playbook for Flutter + Firebase (rules patterns, client hardening, GDPR account deletion, checklist): `${CLAUDE_PLUGIN_ROOT}/references/security-firebase.md`; purchases: `${CLAUDE_PLUGIN_ROOT}/references/play-billing.md`; Functions and release-only failures: `${CLAUDE_PLUGIN_ROOT}/references/firebase-functions.md`.

Mindset: **the app binary is public and can be modified.** Anything in it (API keys, logic, flags) can be read and changed; protection lives on the server (rules, functions). The app's job is to protect the user's data on the device and talk to the server safely.

## Checklist
**Storage** — tokens, credentials, personal data in `flutter_secure_storage` (Keychain/Keystore), not `SharedPreferences`, files or SQLite in plain text; sensitive caches cleared on logout; `android:allowBackup="false"` or backup rules excluding sensitive files.

**Network** — HTTPS only (no `usesCleartextTraffic`, no ATS `NSAllowsArbitraryLoads`); never `badCertificateCallback => true`; certificate pinning only if the threat model needs it (and with a rotation plan).

**Auth** — Firebase Auth state handled via its SDK (no custom token storage); re-authentication for sensitive actions (delete account, change email); sign-out clears local data; account deletion available in-app (store requirement).

**Platform surface**
- Android: exported activities/services/receivers only when needed and with permissions; validate intent extras; deep links (`intent-filter`) validated — never perform actions straight from a link without checks; App Links verified (`assetlinks.json`).
- iOS: Universal Links (`apple-app-site-association`), URL schemes validated.
- WebViews: only trusted origins, navigation restricted, JavaScript channels don't expose sensitive actions, no file access.
- Permissions: minimum set, requested in context, rationale strings (iOS `Info.plist` usage descriptions) accurate.
- Sensitive screens: hide content in app switcher / block screenshots where it matters (payments, documents).

**Release build** — not debuggable; release signing with a key kept out of the repo; `--obfuscate --split-debug-info` (keep symbols for Crashlytics); no debug menus/flags/test endpoints reachable in release (`kReleaseMode` guards); logs don't contain tokens or personal data.

**Integrity & abuse** — Firebase App Check (Play Integrity / App Attest) enforced on Firestore, Storage and Functions used by the app; root/jailbreak detection only if the business needs it (it's bypassable — don't rely on it).

**Payments** — in-app purchases verified **server-side** before granting content; entitlement stored server-side and re-checked; restore purchases works; no "premium" flag the client can set itself (check the rules!).

**Firebase from the client** — every collection the app touches is protected by rules for the exact access the app needs (coordinate with `dualcraft:security-global`); queries don't rely on the client filtering out other users' data.

**Dependencies** — `flutter pub outdated`; check advisories for plugins with native code; remove unused plugins (each adds attack surface and permissions).

## Output
Findings ranked 🔴/🟠/🟡/⚪ with file:line, scenario and fix. Critical/high → brain bugs tagged `security,mobile`. Fix with the user's OK (`dualcraft:tdd` where testable, `dualcraft:verify`, a release build check via `dualcraft:mobile-build`). Inside a global audit, return findings to `dualcraft:security-global`.
