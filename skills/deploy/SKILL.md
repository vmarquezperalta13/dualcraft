---
name: deploy
description: CI/CD with GitHub Actions generated from the project's stacks - CI per stack, web deploys to Firebase Hosting, Vercel, Cloudflare Pages or Netlify with PR previews, backend deploys, mobile releases to Play internal testing and TestFlight on tags; environments, secrets check, release signing. Use for "CI", "despliegue", "deploy", "pipeline", "subir a TestFlight".
---

# DualCraft deploy

`$DEPLOY` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs"`. Talk in the user's language.
Setup details — follow them: `${CLAUDE_PLUGIN_ROOT}/references/release-signing.md` (environments, Android upload key + Gradle snippets, iOS API-key signing, EAS, hosts, promotion and rollback).

## The flow it builds
| Event | What runs |
|---|---|
| pull request | CI for every stack (+ Functions / Edge Functions) · web **preview** (environment `preview`) |
| push to `main` | CI · deploy web + backend to **dev** |
| tag `v*` | deploy web + backend to **production** (environment `production`, required reviewers) · mobile: signed builds → **Play internal testing** + **TestFlight** |
Promotion to the stores' production stays manual in the consoles. One version = one tag, created by `dualcraft:release`.

## 1. Init (once, or when stacks/host change)
- Web host: from `--host`, an existing `vercel.json` / `netlify.toml` / `wrangler.toml` / `firebase.json` hosting, or ask (AskUserQuestion) recommending: Vercel for Next.js SSR, Firebase Hosting when the project is on Firebase and the web is static/SPA (SSR → Firebase App Hosting), Cloudflare Pages for static/Astro at low cost, Netlify as an alternative. Record a decision (area deploy).
- `$DEPLOY init --host <host> [--android-track internal|alpha|beta]` → `.dualcraft/deploy/pipeline.json`, `.github/workflows/dualcraft-{ci,deploy-web,deploy-backend,release-mobile}.yml` (only those that apply), `ExportOptions.plist` per iOS app, `.gitignore` for keys.
- Workflows are generated and hash-protected: change the pipeline (or stacks) and `$DEPLOY gen`, never hand-edit. Need a custom step? Add a separate workflow file of your own.

## 2. Make releases signable (check tells you what's missing)
- Flutter: `android/app/build.gradle(.kts)` reads `key.properties` (snippet in the reference) — without it the "release" is signed with the debug key and Play rejects it.
- Android native / KMP: release signingConfig from `ANDROID_KEYSTORE_PATH` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`, version from `-PversionCode` / `-PversionName`.
- iOS: automatic signing + App Store Connect API key (Admin role); app record exists in App Store Connect.
- React Native: `eas.json` with `build.production` and `submit.production`.
- First Play upload of a new app is manual (the API can't create the app).

## 3. Environments and secrets
- Create environments `preview`, `dev`, `production` (production: required reviewers, tags only). Same names, per-environment values.
- `$DEPLOY secrets` → every secret/variable per environment and whether it exists in the repo (GitHub API, token like `dualcraft:github`); `--offline` just lists. Never paste secret values into the chat — the user sets them with `gh secret set …` (suggest typing it with `!`).

## 4. Check before trusting it
- `$DEPLOY check` → workflows up to date, signing configs, application ids, ExportOptions, eas.json, keys ignored and not committed, host/stack fit (SSR on static hosts).
- First run: push to a branch and open a PR (CI + preview), merge (dev deploy), then a test tag on a pre-release version (`v0.1.0-rc.1` deploys like a release: use it before the first real one).
- If a job fails: read the log (`gh run view --log-failed`), fix the cause in the project (signing, ids, scripts) or the pipeline, `gen`, push again. Don't disable checks to get green.

## 5. Keep it healthy
- New stack or backend → `$DEPLOY gen` (check flags stale workflows).
- Mobile build numbers come from the run number (+ `BUILD_NUMBER_OFFSET` variable if you uploaded builds by hand before).
- Brain: decision (host, environments, approval rule); tasks for each missing secret or console step; `dualcraft:release` links the version tag to the deploy.
