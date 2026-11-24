---
name: roadmap
description: Shows the DualCraft roadmap - tasks, bugs and ideas grouped by target version with progress, blocked and parked items - as a visual board, or as a short summary in chat. Use when the user runs /dualcraft:roadmap or asks "¿qué entra en la próxima versión?", "roadmap", "qué falta para la 1.3", "cómo vamos con la versión X".
---

# DualCraft roadmap

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.

- **Question about a version** ("qué falta para la 1.3"): answer in chat from `$BRAIN roadmap` / `$BRAIN list --target 1.3.0` — done vs total, what's in progress, what's blocked and by what, what's parked waiting for it. Short, grouped, with ids.
- **Wants to see the roadmap**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs" --view road --open` → `.dualcraft/out/roadmap.html` (columns per version, progress bars, "siguiente" marks the next version after the current one, filters shared with the map). Tell the user where it is in one line.

Then, if useful, point out in one or two lines what's risky: blocked items in the next version, items with no target version, parked work whose version has arrived (`status=parked` and `target` ≤ next version → suggest resuming it with `dualcraft:park`).

Moving items between versions is done with `$BRAIN set <ID> target=<version>` — ask before re-planning several items.
