---
name: monitoring
description: Error and crash monitoring set up the same way on every app - Sentry or Crashlytics with shared release name, sample rate, consent and data scrubbing, symbol upload in CI and checks. Use for "monitorización de errores", "Sentry", "Crashlytics", "quiero enterarme de los crashes".
---

# DualCraft monitoring

`$MON` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/monitoring.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/monitoring/monitoring.json` decides how every app reports errors: `providers` (web: sentry|none · mobile: crashlytics|sentry|none), `app` (release `<app>@<version>`), `sampleRate`, `sendPii` (false), `consent` (true: collect after the user agrees), `scrub` (keys redacted at any depth), `ignore` (noise). DualCraft generates the settings per stack (`monitoring.ts`, `monitoring.dart`, `Monitoring.kt`, `Monitoring.swift`) — never edit them; the release name follows the version (`release.mjs bump` regenerates them).

Default providers: Sentry on the web (Crashlytics has no web SDK); on mobile Crashlytics when the backend is Firebase, else Sentry. Ask the user before changing that, and mention that Sentry's free plan has quotas and Crashlytics is free.

## 1. Set up
1. `$MON init [--web sentry|none] [--mobile crashlytics|sentry|none]`.
2. Read `${CLAUDE_PLUGIN_ROOT}/references/monitoring.md` and wire each app: install the SDK (Sentry wizard / Firebase), init it **with the generated settings** and the consent gate, and set up symbol upload (source maps, mappings, dSYMs, Dart symbols).
3. `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs" gen` (Sentry token in the deploy workflows) and `deploy.mjs secrets`; `dualcraft:legal` (`legal.mjs gen`) so the privacy policy and the store privacy forms name the provider.
4. Prove it: a test error from a debug build arrives with a readable stack trace and without personal data. Then remove the test.

## 2. Check (`$MON check`)
Spec valid, settings current (also after a version bump), SDK installed per app, symbol upload configured, DSN documented in `.env.example`, Sentry token in the deploy workflows, privacy policy names the provider, consent reminder. It runs in the release readiness check.

## 3. When errors arrive
A crash or error from the provider → `dualcraft:mobile-crash` (mobile) or `dualcraft:debug`: root cause from the stack trace, a brain bug, the fix with a regression test; after the release, watch the issue's trend for the fixed version.
