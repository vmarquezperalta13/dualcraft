---
name: map
description: Visual map of the brain - notes as nodes, dependencies as arrows, filters and detail panel (also roadmap view). Use for "enséñame el mapa", "qué depende de qué", "ver el brain".
---

# DualCraft map

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" check` from the project. If it reports problems (missing dependency, cycle), fix them first with `dualcraft:brain` or tell the user what's wrong — the map draws whatever is there.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs" --open` (if the variable isn't expanded: `<this skill's base directory>/../../scripts/map.mjs`). It writes `.dualcraft/out/map.html` (gitignored) and opens it in the browser. The page is self-contained and works offline.
3. Tell the user in 2–4 lines, in their language:
   - where the file is, in case it didn't open;
   - how to read it: arrow **A → B** = B depends on A · thick border = in progress · dashed border = parked · red dot = blocked by an unfinished dependency · colours by type;
   - what they can do: drag nodes (positions are remembered), zoom with the wheel, filter by type, status or version, search, click a node for its details, **Roadmap** tab.
4. If the numbers are interesting, add one line of insight from the CLI output: e.g. how many open notes are blocked, or what the most-depended-on open task is (`brain.mjs graph` has the data).

The map is regenerated each time — run it again after brain changes.
