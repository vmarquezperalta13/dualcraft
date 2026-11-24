---
name: help
description: Lists all DualCraft commands grouped by pack, showing which are available and which are coming. Use when the user runs /dualcraft:help or asks which DualCraft commands exist ("¿qué comandos hay?", "comandos de dualcraft", "qué puedo hacer con dualcraft").
---

# DualCraft help

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/help.mjs" [filter]` (if the variable isn't expanded, use `<this skill's base directory>/../../scripts/help.mjs`). Pass the user's argument as `filter` if they gave one — a pack name (`brain`, `security`…) or part of a command name.
2. Show the output to the user as is, inside a code block — it's already in Spanish and formatted. ✓ = available, · = coming in the phase shown.
3. Add at most one line suggesting where to start: `/dualcraft:start` if no work mode is chosen in this project, otherwise nothing.
