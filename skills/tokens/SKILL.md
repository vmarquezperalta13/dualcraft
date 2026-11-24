---
name: tokens
description: Pulls the design tokens from the project's claude.ai Design System into .dualcraft/design/tokens.json, checks them (including WCAG contrast in every theme) and generates the code for both platforms - CSS variables with light/dark + Tailwind v4 @theme for Next.js, ThemeData light/dark + DsColors ThemeExtension + spacing/radius/text styles for Flutter. Use when the user runs /dualcraft:tokens, after the Design System changes, says "actualiza los colores/estilos", "sincroniza el diseño", or before design-to-code if the generated tokens are missing or stale.
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
`$TOKENS all` (or `web` / `dart`) writes, by default:
| Platform | File | Contents |
|---|---|---|
| Next.js | `<web>/src/app/ds-tokens.css` (or `app/`, `styles/`) | `--ds-*` variables, light/dark (OS preference, `data-theme="dark"` or `.dark`), Tailwind v4 `@theme` (→ `bg-primary`, `text-on-surface`, `p-4`, `rounded-md`, `font-sans`, `text-bodyMedium`), `type-<style>` utilities. Without Tailwind v4: plain `--color-*` variables + `.type-*` classes. |
| Flutter | `<mobile>/lib/generated/design_tokens.dart` | `DsTheme.light()/dark()` (ColorScheme from the tokens), `context.ds.<color>`, `DsSpacing`, `DsRadius`, `DsText`. |

Overrides in config: `design.web` (`tailwind4`/`css`), `design.out.web`, `design.out.dart`, `design.dartPrefix` (default `Ds`; change it if the project already has `Ds*` classes).

**Hand-edit guard**: generated files carry a hash. If the script refuses because a file was edited by hand, show the user the diff (`git diff <file>`), move whatever is valuable into the Design System, and only then rerun with `--force` (with their OK).

## 4. Wire up (first time only — check before adding)
- **Next.js**: in the global stylesheet (`app/globals.css`), right after `@import "tailwindcss";` add `@import "./ds-tokens.css";` (adjust the path). Dark mode toggle, if the app has one: set `data-theme="dark"`/`"light"` (or class `dark`) on `<html>` — e.g. `next-themes` with `attribute="data-theme"`. Fonts: `next/font` with the system's families.
- **Flutter**: `MaterialApp(theme: DsTheme.light(), darkTheme: DsTheme.dark(), …)`; fonts declared in `pubspec.yaml` (`.ttf`/`.otf` — the generated file lists them and warns about `.woff2`), or `google_fonts`.

## 5. Verify and commit
Run the analyzers/type-check (`flutter analyze`, `npx tsc --noEmit`/build) — `dualcraft:verify`. Commit `tokens.json` + generated files together: `style(shared): update design tokens from Design System` (or `feat` if it's the first wiring). Mention visible changes in the CHANGELOG.
