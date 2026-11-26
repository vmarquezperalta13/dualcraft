---
name: e2e
description: End-to-end tests from one spec - Playwright (web) with axe accessibility checks and Maestro (apps), flows derived from auth, routes, payments and screenshots, web in CI. Use for "tests e2e", "Playwright", "Maestro", "prueba el login entero", "accesibilidad".
---

# DualCraft e2e

`$E2E` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/e2e.mjs"`, `$DEPLOY` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/e2e/flows.json` holds every end-to-end flow once, in neutral steps; Playwright specs (`<web>/e2e/dualcraft/*.spec.ts`) and Maestro flows (`<app>/.maestro/dualcraft/*.yaml`) are generated from it, so web and apps test the same journeys with the same texts. Never edit the generated files: change the flow and run `$E2E gen`. Your own Playwright/Maestro tests live outside `dualcraft/` folders.

## Steps
`open "/path"` (mobile: `<scheme>://path`, or a full URL) · `tap TEXT|{"id"}` · `fill TEXT|{"id"}` + `"with": VALUE` · `see` / `notSee TEXT|{"id"}` · `url "/path"` (web) · `noErrors: true` (web: no console errors) · `back: true` · `screenshot "name"` · `a11y: true|"name"` (web: axe accessibility check of the current screen).
TEXT = literal words, `"t:<i18n key>"` (default locale — preferred: a copy change doesn't break tests) or `{"t":"key","param":…}`. `{"id":"x"}` = `data-testid` on the web, testID / resource id / accessibilityIdentifier in the apps. VALUE = literal, `"env:NAME"` (secrets) or `"unique-email"`. A flow: `id` (kebab-case), `title`, `platforms` (`web`, `mobile`), `tags`, `requires` (env vars; skipped when missing), `steps`, `locked` (keep a derived flow as you edited it).

## 1. Set up (`$E2E init`)
Needs the stacks in config; reads the app id (Gradle / app.json / products.json) and the deep-link scheme (`--scheme`, `--app-id`, `--base-url` to override; `mobile.appIds.<stack>` when native apps differ). It derives:
- **auth** (from `dualcraft:auth`): protected page → sign in, wrong password → error text, sign-up password policy, sign in with the test account (`E2E_EMAIL` / `E2E_PASSWORD`), guest, and sign up + delete account (`destructive`, only with `E2E_ALLOW_SIGNUP`).
- **smoke**: every static web route opens with no console errors (protected ones land on the sign-in page) and every app route opens by deep link.
- **payments** (from `dualcraft:payments`): the paywall shows each product (`testID="product-<id>"`) — the store sheet itself needs a license tester / sandbox account and is not automated.
- **screenshots** (from `dualcraft:screenshots`): each screen captured to `.dualcraft/store/screenshots/raw/<locale>/<platform>/` for framing; on the web `E2E_VISUAL=1` adds visual regression (baselines made with `--update-snapshots` on the CI's OS).
It also writes `playwright.config.ts` (desktop + mobile Chromium, `webServer` builds and starts the app unless `E2E_BASE_URL` points at a preview) and `.maestro/config.yaml` once, and adds `@playwright/test`.

## 2. Add the user's journeys
Brainstorm the critical paths with the user (the ones that lose money or users when broken), write them as flows without `origin`, prefer `t:` texts and `{"id"}` for icons, then `$E2E gen`. Add the testIDs the flows need in the app code in the same change.

## Accessibility (web, axe)
`"a11y"` in flows.json (on for new specs; `$E2E init --a11y` / `--no-a11y`): `level` (fail from minor|moderate|serious|critical, default serious), `tags` (WCAG 2.0 / 2.1 / 2.2 A and AA by default), `disable` (rule ids), `exclude` (selectors, e.g. third-party widgets). Every public smoke route gets an `a11y` step; add one after the steps that open a dialog, a form error or a menu, since axe checks what is on screen. A failure names the rule, the elements and a fix link (`@axe-core/playwright`, added to package.json). Fix the cause in the component with tokens (`dualcraft:design-to-code`) — never disable a rule to get green without the user agreeing. Automatic checks catch part of the problems: also try the flow with the keyboard and a screen reader.
Apps (Maestro ignores `a11y`): Flutter widget tests `expect(tester, meetsGuideline(textContrastGuideline))` (also `androidTapTargetGuideline`, `iOSTapTargetGuideline`, `labeledTapTargetGuideline`); Android `AccessibilityChecks.enable()` in Espresso tests; iOS `try app.performAccessibilityAudit()` in XCUITest (Xcode 15+) — `dualcraft:mobile-test`.

## 3. Run
- Web: `$E2E run --platform web [--tag auth]` (first time: `npm install && npx playwright install`).
- Apps: install Maestro, start an emulator/simulator with a debug build installed, then `$E2E run --platform android|ios` (env vars are passed with `-e`; flows whose env is missing are skipped).
- CI: `$DEPLOY gen` adds an `e2e-<stack>` Playwright job per web stack (secrets `E2E_EMAIL`, `E2E_PASSWORD`; report uploaded on failure). Mobile E2E stays local (or Maestro Cloud) — emulators in CI are slow and costly.

## 4. Check (`$E2E check`) before calling it done
Spec valid, derived flows in sync with auth.json / routes / products / screenshots, texts exist in the default locale, generated files current, Playwright installed, a CI job present, test account and paywall testIDs reminders.
