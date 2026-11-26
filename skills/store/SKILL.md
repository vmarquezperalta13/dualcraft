---
name: store
description: Store upload with fastlane - the store listing, release notes and framed screenshots per language exported to fastlane and uploaded to Google Play and App Store Connect by the release workflow, never submitting for review. Use for "fastlane", "sube la ficha a la tienda", "actualizar la ficha de Play / App Store".
---

# DualCraft store

`$STORE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/store.mjs"`. Talk in the user's language.

## The rule
The repo is the source of truth for what the stores show. DualCraft already writes it: `.dualcraft/store/listing.json` (title, descriptions, keywords per language — `dualcraft:marketing`), `.dualcraft/release/<version>.json` (what's new — `dualcraft:release`) and the framed screenshots (`dualcraft:screenshots`). `$STORE export` turns them into fastlane's layout in `fastlane/` (Play: `metadata/android/<es-ES>/…`; App Store: `metadata/<es-ES>/…`, `screenshots/<es-ES>/…`, each store's locale codes) — never edit `fastlane/` by hand. `.dualcraft/store/store.json` holds the app ids, the URLs (support and privacy are required by the App Store), optional `locales` overrides and what to upload.

**What gets uploaded replaces what the console shows** — say so before enabling it, and make sure the listing in the repo is the complete, current one.

## 1. Set up
1. `$STORE init --support-url <url> --privacy-url <url>` (privacy policy: `dualcraft:legal`); app ids come from the projects.
2. `$STORE check` until it is clean: texts each store requires per language, URLs, 2–8 Play phone screenshots, 6.9" iPhone screenshots, notes for the current version.
3. Commit `fastlane/`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs" gen`: on a version tag, the Android job uploads the bundle with `fastlane supply` (listing, notes and screenshots included) and the iOS job, after TestFlight, sets the version's listing with `fastlane deliver`. Same secrets as the release (Play service account, App Store Connect API key).

## 2. Each release
After `dualcraft:release` writes the notes and the screenshots are framed: `$STORE export`, `$STORE check`, commit, tag. **Submitting for review and promoting to production stay manual** (Play Console / App Store Connect) — never automate them without the user asking.

Expo (React Native) apps upload through EAS: use `eas metadata` there instead.
