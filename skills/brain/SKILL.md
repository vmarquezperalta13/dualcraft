---
name: brain
description: The DualCraft project brain - capture and query tasks, bugs, decisions, notes and ideas with their dependencies and target versions. Use when the user says "apunta", "anota", "déjalo para luego", "para la próxima versión", "¿qué tenemos pendiente?", "¿qué decidimos sobre…?", "backlog", "roadmap", when an out-of-scope task or idea comes up during work, when a decision is taken, or before proposing non-trivial architecture changes (check past decisions first).
---

# DualCraft brain

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Run commands from inside the project.

## Note types
| Type | Id | Use it for | Default status |
|---|---|---|---|
| `task` | T-001 | work to do | todo |
| `bug` | B-001 | a defect, with how to reproduce | todo |
| `decision` | D-001 | a choice made and **why** (architecture, library, convention, product rule) | done |
| `note` | N-001 | knowledge worth keeping: a workaround, a gotcha, how an integration works | done |
| `idea` | I-001 | something maybe worth doing, not committed yet | todo |

Statuses: `todo` · `doing` · `done` · `parked` (finished but held for a later version — use `dualcraft:park`) · `dropped`.

## Capturing
```
$BRAIN new task "Login con Google" --target 1.3.0 --depends D-002 --priority high --tags auth,mobile
$BRAIN new decision "Usar Riverpod para el estado" --body "## Context\n...\n## Decision\n...\n## Why\n..."
```
Then open the created file and fill the body briefly:
- **task / bug**: Context (why it exists, where it came from), Details (what "done" means; for bugs: steps to reproduce, expected vs actual), and which platform (`web`, `mobile`, `both` tag).
- **decision**: Context, Decision, Why, Consequences. Decisions are what future sessions must respect — write the *why*.
- **note**: the fact and how to use it.

Rules:
- One note = one thing. Titles short, in the user's language. Ids/keys in English.
- Link it: `--depends` when it can't be done before another note; `--related` for a loose link. Dependencies are what the visual map draws.
- `--target` = the version it's meant for (`1.3.0`). Ask only if unclear; ideas may have none.
- Capture **during** work, without derailing it: create the note, tell the user in one line ("Apuntado: T-012 · Exportar a PDF → 1.4.0"), and continue.
- Never store secrets, tokens or personal data in the brain — it's committed to git.
- Before creating, check for a duplicate (`$BRAIN list --open` or search `.dualcraft/brain/`); update the existing note instead.

## Updating
```
$BRAIN set T-004 status=doing
$BRAIN set T-004 status=done --log "implemented in web and mobile"
$BRAIN set T-004 target=1.4.0 depends_on=T-001,D-002
```
Every `set` appends to the note's Log.

## Querying
- Pending work: `$BRAIN list --open` · by version: `$BRAIN list --target 1.3.0` · by type: `--type bug`.
- Roadmap by version: `$BRAIN roadmap`.
- One note: `$BRAIN show D-002`.
- "¿Qué decidimos sobre X?" → search the brain files for X (Grep over `.dualcraft/brain/`), read the matching decisions/notes, answer with their ids.
- Health: `$BRAIN check` (missing dependencies, cycles, parked without target). Fix what it reports.

Present results to the user grouped and short, in their language — not raw CLI output unless they ask.
