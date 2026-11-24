---
name: er
description: ER diagram of the schema - tables, crow's-foot relations, drag, PNG/SVG export. Use for "enséñame el modelo de datos", "diagrama de la base de datos", "esquema ER".
---

# DualCraft ER diagram

`$ER` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/er.mjs"` (if the variable isn't expanded: `<this skill's base directory>/../../scripts/er.mjs`).

1. The diagram is drawn from `.dualcraft/db/schema.dbml`. If it doesn't exist, say so and offer to create it with `dualcraft:schema` (it can be inferred from the code). Don't draw from guesses.
2. `$ER check` — if there are errors, fix the schema (they come with line numbers) or report them. Warnings (e.g. table without primary key) are shown to the user but don't block.
3. `$ER html --open` → `.dualcraft/out/er.html` (gitignored), opened in the browser, works offline.
4. Tell the user in a few lines:
   - where it is;
   - notation: `||` exactly one · `o|` zero or one · `o<` zero or many; `?` after a type = nullable; PK/FK marks;
   - they can drag tables, click one to highlight its relations and see field notes, zoom, toggle types, and export **PNG** or **SVG**;
   - to keep a manual arrangement for everyone: **Copiar layout**, then save it as `.dualcraft/db/layout.json` (offer to do it if they paste it). Positions are also remembered in their browser.
5. If the user wants a picture in the chat or a file, they export PNG/SVG from the page — don't try to screenshot.

For a schema in a different file (e.g. an example), pass `--file <path.dbml>`.
