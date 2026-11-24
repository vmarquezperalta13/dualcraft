---
name: design-system
description: Creates the project's claude.ai Design System (brand interview or from code), links it and pulls its tokens. Use for "crea el design system", "define la marca, colores o tipografía".
---

# DualCraft design system

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.

One design system per project, shared by its web and its mobile app. Its link lives in `.dualcraft/config.json` → `design.system` (`$BRAIN config get design.system`).

## 0. Already linked?
If `design.system` is set: `read` it with the Artifact tool (its `project/README.md`) and tell the user what it has. Changes to it → see "Changing it" below; pulling into code → `dualcraft:tokens`.

## 1. Choose the source
- **From the existing code** (the project already has a theme: Flutter `ThemeData`/colors file, Tailwind config, CSS variables): the real values win — enumerate every color, text style, spacing and radius in the code first. If a `DesignSync` tool or `/design-sync` is available in this session, use it (it syncs a design system from code); otherwise build the system from the code following the Design System type's `from-code` reference. Then link it (step 4).
- **From scratch**: step 2.

## 2. Brand interview (from scratch) — one question per message, multiple choice when possible
1. What the product is and for whom (1–2 sentences — reuse the functional document / brain if they exist).
2. Personality: 3 adjectives (e.g. cercana, enérgica, profesional) and what it must NOT feel like.
3. References they like (apps, webs) and existing assets: logo, brand colors they must keep.
4. Color direction: a main hue or mood; light + dark themes (recommend both — web and mobile users expect dark mode).
5. Typography feel: geometric / humanist / serif headings / mono accents. Fonts must exist for both platforms: Google Fonts work on web (hosted) and on Flutter (bundle the .ttf or use `google_fonts`).
6. Density: airy or compact (affects spacing scale).
Summarise the brief in 5 lines and confirm.

## 3. Create it in claude.ai
1. Find the "Design System" type: Artifact `list` with `scope: "types"`. Create ONE system: `publish` with its `type_url`, `title` = "<Project> Design System", `auto_open: "after_first_write"`, no files. The result carries the type's instructions — **follow them exactly** for files, shapes, order and the index.
2. Content — a small, complete first system (grow it later):
   - **Colors**, themes `light` then `dark`, each token with a `usage`. Use these names so DualCraft can map and check them:
     `primary`, `on-primary`, `primary-container`, `on-primary-container`, `secondary`, `on-secondary`, `surface`, `on-surface`, `on-surface-variant`, `surface-container`, `outline`, `error`, `on-error` (+ brand extras like `accent`, `success`, `warning` with their `on-*`). `on-X` = text/icons on `X` → it gets a WCAG contrast check; for other text colors write "Text on <token>" in `usage`.
   - **Text styles** named with Material roles so Flutter maps them to its `TextTheme`: `displayLarge`, `headlineMedium`, `titleLarge`, `titleMedium`, `bodyLarge`, `bodyMedium`, `bodySmall`, `labelLarge`, `labelMedium` (5–9 of them), in px with line heights.
   - **Spacing** `space-1 … space-8` (4px base), **radius** `radius-sm/md/lg/full`, optional **shadow**.
   - README as a short brand book: personality, do/don't, color roles, type scale, how web and mobile use it.
   - Contrast: text 4.5:1 (3:1 for large titles) in **every** theme — fix before saving, not after.
3. Show the user the link and the palette in a few lines; adjust with them.

## 4. Link and pull
- `$BRAIN config set design.system=<url>`
- Record a decision: `$BRAIN new decision "Design System del proyecto" --body "## Decision\nFuente de verdad del diseño: <url>\n## Why\n…"`.
- Continue with `dualcraft:tokens` to pull the tokens and generate the code for web and Flutter.

## Changing it later
The Design System is the source of truth: never edit generated code or `.dualcraft/design/tokens.json` to change the look. Edit the system (Artifact `read` its index and `project/tokens.json`, change, publish per the type's "Revising" rules), then `dualcraft:tokens` to pull. Say which tokens changed and which screens they affect.
