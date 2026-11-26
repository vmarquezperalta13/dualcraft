---
name: design-to-code
description: Implements a designed screen with tokens only, existing components, accessibility and i18n, compared with the artboard. Use for "pasa este diseño a código", "implementa la pantalla de…", "maqueta esto".
---

# DualCraft design to code

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

## 1. Gather
- The design: the task's `design` link or `$BRAIN config get design.screens` → Artifact `read` it; find the artboards `<Screen> · Móvil` / `<Screen> · Web` (+ state artboards). Platform(s) to build: the work mode's scope.
- The tokens are generated and current: `.dualcraft/design/tokens.json` exists and `ds-tokens.css` / `design_tokens.dart` are in the code. If not, or the Design System changed → `dualcraft:tokens` first.
- The project's structure and existing components (buttons, cards, inputs, app bars, layouts) — reuse before creating. Follow the folder/feature structure and state management already used.

## 2. Plan the component tree
List the pieces top-down, mark which exist and which are new, and where each new one goes. Shared pieces (used on several screens) go to the shared components folder. For bigger screens this is a `dualcraft:plan`.

## 3. Build — tokens only
| | Flutter | Next.js (Tailwind v4) |
|---|---|---|
| Colors | `context.ds.primary`, `Theme.of(context).colorScheme` | `bg-primary text-on-primary`, `var(--color-…)` |
| Text | `DsText.titleLarge` / `Theme.of(context).textTheme.titleLarge` | `type-titleLarge` or `text-titleLarge` |
| Spacing | `DsSpacing.s4` | `p-4`, `gap-2` (token scale) |
| Radius | `DsRadius.md` | `rounded-md` |

- **No raw values**: no hex colors, no magic font sizes or paddings in the code — if the design needs a value that isn't a token, it's a Design System change (ask), not a literal.
- Layout from the right artboard: mobile from `· Móvil`, web from `· Web`; responsive web: the mobile artboard is the small breakpoint.
- Behaviour from the spec; data from the generated models/types (`dualcraft:schema`); strings through the project's i18n if it has one.
- States: loading, empty, error as designed.
- Accessibility: Flutter `Semantics`/`tooltip` on icon buttons, 48dp targets, text scaling not clipped; web semantic elements, labels, alt text, focus visible, keyboard reachable.
- Logic (formatting, validation, state) test-first with `dualcraft:tdd`; UI checked visually (step 4) and with a widget/component test for the main interaction.

## 4. Compare with the design
- **Web**: run the dev server, screenshot the page at 1440 and 390 widths (headless Chrome/Edge: `--headless=new --screenshot=<file> --window-size=1440,900 <url>`), read the images and compare with the artboards.
- **Flutter**: screenshot on an emulator (`adb exec-out screencap -p > shot.png`) or a golden/widget test; compare with the mobile artboard.
List the differences (spacing, alignment, colors, typography, missing states) and fix them; report what remains different and why (e.g. platform convention).

## 5. Close
`dualcraft:verify` → `dualcraft:docs` (screen in the functional document) → `dualcraft:commit`. Components that should exist in the Design System but don't → propose adding them there (brain task).
