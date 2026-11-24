---
name: release
description: Closes and ships a version - readiness checklist, version bump everywhere, CHANGELOG, tag, store notes per language, launch and follow-up. Use for "saca la versión", "cerramos la 1.3", "vamos a publicar", "release".
---

# DualCraft release

`$REL` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language. Every irreversible step (commit, tag, push, store upload, deploy) needs the user's explicit OK.

## 1. Which version
`$REL suggest` → proposed version from the commits since the last tag (feat → minor, fix/perf → patch, breaking → major). Confirm with the user (they may want a different number for marketing reasons).

## 2. Readiness
`$REL check --version <v>`:
- ✗ **blockers** must be solved or explicitly moved: unfinished tasks/bugs targeted at this version (`$BRAIN set <ID> target=<later>` with the user's OK), open high-priority security bugs, invalid texts/schema/tracking plan, existing tag.
- ⚠ **warnings**: parked work for this version (resume with `dualcraft:park` or move), events not tracked, contrast failures, undocumented changes (`dualcraft:docs`), empty CHANGELOG, version mismatch, uncommitted changes.
Then run `dualcraft:verify` on both platforms (fresh) — release builds included: `next build`, `flutter build appbundle --release` (+ `ipa` on macOS) per `dualcraft:mobile-build`.

## 3. Release notes
`$REL notes --version <v>` gives the CHANGELOG section and the brain items. Write, in every app language (the project's locales):
- **Store notes** (user language, benefits first, no ticket ids, no jargon): Google Play ≤ 500 chars, App Store "What's New" ≤ 4000 → `.dualcraft/release/<v>.json` as `{"es": {"play": "…", "appstore": "…"}, "en": {…}}`.
- **Web**: changelog/news entry if the site has one.
`$REL store-check` must pass. Tone from the Design System README / brand book if it exists. For campaign material, hand over to `dualcraft:marketing`.

## 4. Bump, commit, tag
1. `$REL bump <v> --dry` → show the user; then `$REL bump <v>`: `.dualcraft/config.json`, `pubspec.yaml` (`X.Y.Z+N`, build number +1), `package.json`, CHANGELOG `[Unreleased]` → `[v] - date`.
2. Commit with `dualcraft:commit` conventions: `chore(release): v<v>` including the bump, CHANGELOG, release notes file.
3. Tag `v<v>` (annotated: `git tag -a v<v> -m "<v>"`). Push commit and tag **only when the user says so**.

## 5. Ship (with the user)
**With `dualcraft:deploy` set up** — pushing the tag does it: production deploys of web and backend wait for the approval in GitHub (environment `production`), mobile builds land in Play internal testing and TestFlight; then promote them in the consoles (below). Watch the runs (`gh run watch`).
**Web** — deploy through the project's pipeline (Vercel: push to the production branch or promote the preview); check production: main pages load, no console errors, sitemap reachable, analytics firing.
**Android** — upload the `.aab` to Play Console (internal → closed → production, or staged rollout %); release notes from step 3; data safety form still accurate (`dualcraft:legal check`, docs/legal/google-data-safety.md); keep the debug symbols / mapping for Crashlytics.
**iOS** — upload via Xcode/Transporter, TestFlight first, then submit with "What's New"; privacy labels and PrivacyInfo.xcprivacy still accurate (`dualcraft:legal`).
**Store listing** — if screenshots or texts should change with this version → `dualcraft:screenshots` and `dualcraft:marketing` (ASO).
**Backend first** — Firestore rules/indexes and Cloud Functions that the new version needs are deployed **before** the apps, and stay compatible with the previous app version still in users' hands.

## 6. After the release
- Brain: tasks of the version stay `done`; create a decision/note with anything learned; parked items now due → surface them for the next version.
- Watch for 24–72 h: Crashlytics (new issues in v<v>), store reviews, analytics events of the new features (`dualcraft:analytics` coverage + dashboards). Problems → bugs with target `<v+patch>`.
- Hand over to `dualcraft:marketing` for the launch communication if not done yet.
