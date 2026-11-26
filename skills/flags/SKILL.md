---
name: flags
description: Feature flags and remote config from one catalog - typed accessors per stack with safe defaults and test overrides, Firebase Remote Config template or Supabase table, expired and unused flag checks. Use for "feature flag", "remote config", "activar sin publicar", "kill switch", "test A/B".
---

# DualCraft flags

`$FLAGS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/flags.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/flags/flags.json` declares every flag once: key (snake_case), `type` bool|string|int|double, `default`, optional `values` (string enums), `kind`, `expires` (version to remove it), `task` (brain id), `platforms`, `description`. DualCraft generates a typed accessor per stack — `flags.newCheckout` (TS), `FeatureFlags.newCheckout` (Dart, Kotlin, Swift) — never edit it. **The default is what ships**: a missing, late or ill-typed remote value falls back to it, so a broken console value can't crash the app.

| kind | for | rule |
|---|---|---|
| `release` | unfinished or parked work shipped switched off | default off, `expires` required — then the flag goes |
| `experiment` | A/B tests, gradual rollouts | `expires` required |
| `ops` | kill switches, emergency limits | permanent, documented |
| `config` | remote values (limits, texts, URLs) | permanent |

## 1. Set up
`$FLAGS init [--provider firebase|supabase|local]` (provider from the backend by default; flags of parked brain notes are imported). Then wire the provider in each app **once**, following `${CLAUDE_PLUGIN_ROOT}/references/feature-flags.md` (adapter per stack and provider) — read it before writing the adapter. Firebase: publish with `firebase deploy --only remoteconfig` (it replaces the live template; ask first). Supabase: add the generated SQL as a migration with `dualcraft:database`.

## 2. Add and use a flag
`$FLAGS add <key> --type bool --default false --kind release --expires 1.4.0 --task T-012 --description "…"`. Read it where the feature starts (route, button, menu entry), on every platform the feature touches, with both branches tested: override the flag in tests (`setFlagOverrides`, `FeatureFlags.overrides`). Parking work behind a flag (`dualcraft:park`) = add the flag here and `flag=<key>` on the brain note.

## 3. Remove a flag
When `check` says it expired (or the experiment ended): make the winning branch the only code on every platform, delete the other, then `$FLAGS remove <key>` and clean the console/table value.

## 4. Check (`$FLAGS check`)
Catalog valid, generated code current, temporary flags without `expires`, **expired flags (error)**, flags no code reads, parked notes whose flag is missing. Run it before a release (`dualcraft:release`).
