---
name: docs
description: Functional document (docs/FUNCTIONAL.md) kept current per feature and platform, traceable to brain ids. Use for "documento funcional", "documenta esto", "¿qué hace la app?", or after a verified feature.
---

# DualCraft functional document

`$DOCS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs.mjs"`. Location: `docs/FUNCTIONAL.md` (or `config.docs.functional`).

The functional document explains **what** the app does and **under which rules** — for the user, a client, a new developer or a tester. Not how the code works.

## Create it (first time)
`$DOCS init`. Then fill sections 1–3 and 5 from what exists: the code (routes/screens), the brain (done tasks, decisions), the schema, the store/web texts. Ask the user only what can't be derived (vision, roles). Mark unknowns as `_Pendiente_` rather than inventing.

## Update it — after each finished development or user-visible fix
1. Find the affected feature section under "4. Módulos y funcionalidades" (create it with the format in the template's comment if it's new).
2. Update: goal, platforms, main flow, screens, business rules, data, errors/edge cases. Keep the **current truth** — rewrite what changed, don't append contradictions.
3. Add the brain ids to **Origen** (that's how traceability works) and, for new features, **Desde la versión** = the task's target version.
4. Add a row to "9. Historial funcional": version · change in one line · ids.
5. Global rules, integrations or glossary changed? Update those sections too.

Language: the project's `lang`. Style: short sentences, numbered flows, tables for rules. No code, no class names (screen names and routes are fine).

Skip the document for changes with no functional impact (pure refactor, tooling, internal chores) — tag their tasks `internal` so the status check ignores them.

## Catch up
`$DOCS status` lists done tasks/bugs not yet referenced in the document. For each: read the task (and its spec/commits), update the document, or tag it `internal` if it has no functional effect. Report what was added.

## In the flow
`dualcraft:verify` green → **docs** → `dualcraft:commit` (the document change goes in the same commit as the feature).
