---
name: tokens
description: Pulls Design System tokens, checks WCAG contrast and generates theme code for every stack. Use for "actualiza los colores", "sincroniza el diseño", or when generated tokens are missing or stale.
---

# DualCraft tokens

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`, `$TOKENS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/tokens.mjs"`.

Flow: **Design System (claude.ai) → `.dualcraft/design/tokens.json` (local copy, committed) → generated code**. Local files are never the place to change the design.

## 1. Pull
1. `$BRAIN config get design.system` → the system's url. Not set → `dualcraft:design-system`.
2. Artifact `read` with that `url` and `path: "project/tokens.json"`; copy the saved file to `.dualcraft/design/tokens.json`.
3. If there was a previous copy, summarise what changed (tokens added/removed/changed values per theme) — that's what the user cares about.

## 2. Check
`$TOKENS check`
- Errors (unsupported color values, map-shaped families, duplicates) → the fix belongs in the Design System; propose it, change it there with the user's OK (`dualcraft:design-system` → "Changing it"), pull again.
- Contrast failures → show the pairs and ratios; propose accessible values; don't silently ship text that fails AA.

## 3. Generate
`$TOKENS all` writes one file per stack of the project (or a single target: `web` · `dart` · `ts` · `compose` · `swift`).
### Outputs per stack (`all` generates one per stack in `config.stacks`)
| Stack | Tokens | Texts (i18n) | Models (schema) | Analytics |
|---|---|---|---|---|
| Next.js | `ds-tokens.css` (Tailwind v4 / CSS vars) | `messages/<l>.json` (next-intl) | `src/types/db.ts` | `src/lib/analytics-events.ts` |
| React + Vite | `src/styles/ds-tokens.css` | `src/locales/<l>.json` (i18next + ICU) | `src/types/db.ts` | `src/lib/analytics-events.ts` |
| Astro | `src/styles/ds-tokens.css` | `src/i18n/<l>.json` | `src/types/db.ts` | `src/lib/analytics-events.ts` |
| Vue / Nuxt | `assets/css/ds-tokens.css` | `i18n/locales/<l>.json` (vue-i18n plurals) | `types/db.ts` | `utils/analytics-events.ts` |
| Flutter | `lib/generated/design_tokens.dart` | `lib/l10n/app_<l>.arb` | `lib/generated/db_models.dart` | `lib/generated/analytics_events.dart` |
| React Native | `src/theme/ds-tokens.ts` (`useDsTheme()`) | `src/locales/<l>.json` (i18next + ICU) | `src/types/db.ts` | `src/lib/analytics-events.ts` |
| KMP | `commonMain/…/theme/DsTokens.kt` (`DsTheme {}`) | `composeResources/values[-l]/ds_strings.xml` | `commonMain/…/model/DbModels.kt` | `commonMain/…/analytics/AnalyticsEvents.kt` |
| Android | `…/ui/theme/DsTokens.kt` | `res/values[-l]/ds_strings.xml` | `…/data/model/DbModels.kt` | `…/analytics/AnalyticsEvents.kt` |
| iOS | `<App>/DesignSystem/DsTokens.swift` | `<App>/Resources/DualCraft.xcstrings` | `<App>/Core/Models/DbModels.swift` | `<App>/Core/Analytics/AnalyticsEvents.swift` |
Kotlin package: the Gradle `namespace` (override `config.design.kotlinPackage`). Paths per stack can be overridden in config (`design.out.<stack>`, `db.out.<stack>`, `analytics.out.<stack>`). Every generated file is protected against hand edits.

Details for Next.js and Flutter:
| Platform | File | Contents |
|---|---|---|
| Next.js | `<web>/src/app/ds-tokens.css` (or `app/`, `styles/`) | `--ds-*` variables, light/dark (OS preference, `data-theme="dark"` or `.dark`), Tailwind v4 `@theme` (→ `bg-primary`, `text-on-surface`, `p-4`, `rounded-md`, `font-sans`, `text-bodyMedium`), `type-<style>` utilities. Without Tailwind v4: plain `--color-*` variables + `.type-*` classes. |
| Flutter | `<mobile>/lib/generated/design_tokens.dart` | `DsTheme.light()/dark()` (ColorScheme from the tokens), `context.ds.<color>`, `DsSpacing`, `DsRadius`, `DsText`. |

Overrides in config: `design.web` (`tailwind4`/`css`), `design.out.web`, `design.out.dart`, `design.dartPrefix` (default `Ds`; change it if the project already has `Ds*` classes).

**Hand-edit guard**: generated files carry a hash. If the script refuses because a file was edited by hand, show the user the diff (`git diff <file>`), move whatever is valuable into the Design System, and only then rerun with `--force` (with their OK).

## 4. Wire up (first time only — check before adding)
- **Next.js**: in the global stylesheet (`app/globals.css`), right after `@import "tailwindcss";` add `@import "./ds-tokens.css";` (adjust the path). Dark mode toggle, if the app has one: set `data-theme="dark"`/`"light"` (or class `dark`) on `<html>` — e.g. `next-themes` with `attribute="data-theme"`. Fonts: `next/font` with the system's families.
- **Flutter**: `MaterialApp(theme: DsTheme.light(), darkTheme: DsTheme.dark(), …)`; fonts declared in `pubspec.yaml` (`.ttf`/`.otf` — the generated file lists them and warns about `.woff2`), or `google_fonts`.
- **React + Vite / Astro / Nuxt**: import `ds-tokens.css` in the global stylesheet (after Tailwind if used).
- **React Native**: `const t = useDsTheme()` → `t.colors.primary`, `t.spacing.s4`, `t.text.titleLarge` (style objects); fonts via `expo-font`.
- **KMP / Android**: wrap the app in `DsTheme { … }`; colors `Ds.colors.primary` (or `MaterialTheme.colorScheme`), `DsSpacing.s4`, `DsText.titleLarge`; fonts as `FontFamily` resources (comment in the file).
- **iOS**: `DsColor.primary` (adapts to dark mode), `DsSpacing.s4`, `.font(DsText.bodyMedium.font)` + `.lineSpacing(DsText.bodyMedium.lineSpacing)`; custom fonts in Info.plist (`UIAppFonts`).

## 5. Verify and commit
Run the analyzers/type-check (`flutter analyze`, `npx tsc --noEmit`/build) — `dualcraft:verify`. Commit `tokens.json` + generated files together: `style(shared): update design tokens from Design System` (or `feat` if it's the first wiring). Mention visible changes in the CHANGELOG.
