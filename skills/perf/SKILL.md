---
name: perf
description: Performance budgets checked in CI - Lighthouse Core Web Vitals and bundle size per route, store build size, app cold start with history. Use for "rendimiento", "la web va lenta", "Lighthouse", "la app pesa mucho", "arranque".
---

# DualCraft perf

`$PERF` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/perf.mjs"`, `$DEPLOY` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/perf/budgets.json` states how fast and how small the product must be; `.dualcraft/perf/perf-check.mjs` (a self-contained runner DualCraft copies into the repo, no dependencies) measures it the same way in CI and on your machine. A budget is raised on purpose (edit the file, say why in the PR), never silently. Default mode `warn`: annotations and a table in the job summary, the PR is not blocked; `"mode": "fail"` blocks. `tolerance` (default 5 %) absorbs noise.

## 1. Set up (`$PERF init [--routes /,/precios] [--mode warn|fail]`)
Budgets with defaults: web routes (the e2e smoke routes that stay on their page, else `/` and the sign-in page), Lighthouse mobile lab thresholds (score ≥ 90, LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms), bundle (JS total 350 KB gzip, largest chunk 150 KB, per Next.js route 200 KB, CSS 60 KB), app size (APK/AAB 40 MB, IPA 80 MB), cold start (Android 1500 ms, iOS 1000 ms, Flutter first frame 1500 ms). Adjust them with the user to the product (a content site can aim lower; a game higher). Then `$DEPLOY gen`: a `perf-<stack>` job per web stack (build → bundle → start the app → Lighthouse) and an app-size step in the mobile release workflow (signed AAB / IPA).

## 2. Measure
- Web bundle: `$PERF run bundle <stack> <web dir>` after a build — totals, largest chunks, JS per route (Next.js App Router).
- Lighthouse: start the production build, then `$PERF run lighthouse http://localhost:3000 [--runs 3]` (median; Chrome needed).
- App size: `$PERF run app-size path/to/app-release.aab` (CI does it on release tags).
- Cold start (local, release/profile builds on a real device when possible):
  - Android: `$PERF run startup android <applicationId> [--activity .MainActivity] [--runs 5]` (adb `am start -W`).
  - Flutter: `flutter run --profile --trace-startup` then `$PERF run startup flutter build/start_up_info.json`.
  - iOS: XCTest `XCTApplicationLaunchMetric` → `$PERF run startup ios --value <ms>`.
  Each run is appended to `.dualcraft/perf/history.json` (commit it) and compared with the previous one.

## 3. When something is over budget
Find the cause before touching the budget: largest chunks and new dependencies (dynamic import, lighter alternative, tree-shaking), images and fonts (LCP), layout shifts from late content (CLS), long main-thread tasks (TBT), app assets/ABIs/unused resources (size; App Bundles split per device), work done before the first frame (startup). Record the finding in the brain; if the budget must change, record a decision.

## 4. Check (`$PERF check`)
Budgets valid, runner current, CI jobs present, startup measured at least once, and the last results over budget.
