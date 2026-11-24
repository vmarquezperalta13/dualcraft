---
name: brainstorm
description: Explores an idea before building it (goal, flows per platform, data, edge cases, options) into an agreed design; leftovers go to the brain. Use in new-development mode before code, or for "tengo una idea", "quiero añadir…", "¿cómo hacemos…?".
---

# DualCraft brainstorm

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.

No code until the design is agreed. Even a "small" feature gets a short version of this — five minutes of questions saves hours of rework.

## 1. Ground yourself first
Read before asking: the brain context (decisions `D-xxx` that constrain the idea, related tasks/ideas), the schema (`.dualcraft/db/schema.dbml`), the functional document, and the code areas involved. Don't ask what you can find out.

## 2. Understand — one question at a time
Ask **one** question per message, multiple-choice when possible (AskUserQuestion). Cover, as needed:
- **Goal**: what problem, for whom, how will we know it works.
- **Platforms**: web, mobile or both? Same behaviour on both, or adapted? (navigation, gestures, offline, notifications differ)
- **Flows**: the main path step by step; entry points (menu, deep link, notification).
- **Data**: what is stored or read; new tables/fields? (→ schema change first)
- **Rules & edge cases**: permissions, limits, empty states, errors, offline, concurrency.
- **Scope for this version**: what's essential now vs later.

## 3. Propose
Offer **2–3 approaches** with trade-offs (effort, risk, UX, impact on the other platform) and recommend one with the reason. YAGNI: cut what isn't needed for the goal.

## 4. Present the design in short sections
Validate section by section (a few sentences each, not a wall): flows · screens per platform · data/schema changes · business rules · errors and edge cases · analytics/i18n if relevant · how it will be tested. Adjust as the user reacts.

## 5. Save
1. Brain: make sure there is a task for it (`$BRAIN new task "<title>" --target <version>`), or use the existing one.
2. Write the agreed design to `.dualcraft/specs/<ID>-<slug>.md` (title, goal, platforms, flows, screens, data, rules, edge cases, out of scope, open questions) and link it: `$BRAIN set <ID> spec=.dualcraft/specs/<ID>-<slug>.md`.
3. **Everything left out** goes to the brain: future parts → tasks with a later `--target` and `--depends <ID>`; maybe-someday → ideas; choices made (and why) → decisions via `dualcraft:decisions` (with area and tags). Tell the user the ids in one line.

## 6. Next
- Data changes → `dualcraft:schema` first.
- More than a couple of steps or both platforms → `dualcraft:plan`.
- Small and clear → implement with `dualcraft:tdd`.
