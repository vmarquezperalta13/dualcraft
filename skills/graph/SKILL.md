---
name: graph
description: Code graph of every stack - find where a symbol is, who uses it, what a change affects, which files matter for a task, and where shared contracts are used on web and mobile, without reading the whole codebase. Use for "¿dónde se usa…?", "¿qué afecta cambiar…?", "¿dónde está…?", or before exploring code for a task.
---

# DualCraft graph

`$GRAPH` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/graph.mjs"`. Talk in the user's language.

## The rule
Ask the graph before grepping or opening files one by one: it is an index of every stack (TypeScript, Vue, Astro, Dart, Kotlin, Swift — symbols with kind, line and container, and file dependencies) in `.dualcraft/graph/` (not committed; queries refresh it when files changed). First use in a project: `$GRAPH init`. Add `--json` for structured output.

| Question | Command |
|---|---|
| Where is X? | `$GRAPH search <name> [--kind class\|function\|component\|method…] [--stack id]` |
| Who uses X? | `$GRAPH callers <name\|Type.member> [--precise]` |
| What does changing X affect? | `$GRAPH impact <file\|symbol> [--depth 3]` |
| Which files matter for this task? | `$GRAPH context "<task in the user's words>"` |
| Where is this endpoint / event / flag / link / text used on web and mobile? | `$GRAPH contracts [api\|events\|flags\|links\|i18n] [name]` |

## How exact it is — say it when it matters
- **Dependencies** come from imports (TypeScript, Vue, Astro, Dart, Kotlin): reliable. Swift (and Kotlin files of the same package) have no imports between files: there they come from type names used — approximate.
- **callers** is a name search, tagged `linked` (the file depends on the definition) or `textual` (same name elsewhere). Two methods with the same name in different types can't be told apart this way: open the file to confirm. **`--precise`** uses the TypeScript compiler the web app already has in node_modules (nothing downloaded) and returns exact references per declaration (`UserRepo.save` ≠ `MatchRepo.save`); other languages stay approximate.
- **contracts** are exact: DualCraft generates those names.
- **context** is a ranking, not a verdict: the task's words matched against paths and symbols, with the user's language bridged to code names through texts (DualCraft i18n, the app's own .arb / message files, hand-made text maps with an English version). Open the top files to confirm; then `impact` before changing a shared one.

## Use it
- Starting a task (`dualcraft:start`, `dualcraft:plan`): `context`, then read only what it points to.
- Before changing a shared file, function or model: `impact` and `callers` — and tell the user which other screens or the other platform are affected.
- Cross-platform work (`dualcraft:refactor-global`, `dualcraft:convert`): `contracts` shows what is only on one platform (`⚠ only on web/mobile`) or unused.
- Review (`dualcraft:review`): `impact` of the changed files to find what the diff can break outside itself.
