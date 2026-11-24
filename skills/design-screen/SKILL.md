---
name: design-screen
description: Designs a screen in the claude.ai Design canvas as mobile and web artboards with its states, using the design system. Use for "diseña la pantalla de…", "haz un mockup", "cómo se vería…".
---

# DualCraft design screen

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.

## 1. Inputs
- What screen and why: the brain task, its spec (`.dualcraft/specs/…`) and the functional document. No spec for a non-trivial screen → a short `dualcraft:brainstorm` first.
- The design system: `$BRAIN config get design.system` → Artifact `read` its `project/README.md` (and tokens). No system → `dualcraft:design-system` first; never design with improvised colors.
- Existing screens on the canvas, to keep consistency.

## 2. The canvas
- One Design artifact per project holds all screens: `$BRAIN config get design.screens`.
- None yet → Artifact `quickstart` with `intent: "design"`, create it from the "Design" type with `title` = "<Project> — Pantallas", choose the project's design system when the type lists design systems, and save `$BRAIN config set design.screens=<url>`. Follow the type's own instructions for its files and artboards.

## 3. Design the pair
For each screen create two artboards next to each other, same row:
| Artboard | Size | Layout rules |
|---|---|---|
| `<Screen> · Móvil` | 390 × 844 (taller if it scrolls) | single column, thumb-reachable primary action, bottom navigation if the app has it, safe areas, 48dp tap targets |
| `<Screen> · Web` | 1440 × 900 (taller if it scrolls) | top/side navigation, content max-width, multi-column where it helps, hover states, keyboard focus visible |

- Same content and behaviour on both; adapt layout and navigation, not meaning. Differences in behaviour must come from the spec (note them under the artboards).
- Only design-system tokens: colors, text styles, spacing, radius. Real copy in the user's language — no lorem ipsum.
- States: add artboards for empty / loading / error / success when the screen has them (`<Screen> · Móvil · Vacío`…).
- Accessibility from the start: contrast via the system's pairs, readable sizes, labels on icons.

## 4. Review with the user
Share the link; walk them through both artboards in 3–5 lines; iterate. When approved:
- `$BRAIN set <ID> design=<canvas url> --log "screen <Screen> designed (mobile + web)"`.
- New components or tokens the design needed → propose adding them to the Design System (don't let the canvas drift from it).
- Next: `dualcraft:design-to-code`.
