---
name: using-dualcraft
description: Use at the start of any conversation in a project that has a .dualcraft/ folder (the session context shows "DualCraft — project context"), or whenever the user mentions DualCraft. Establishes the DualCraft workflow - project context from the brain, ask the work mode before working, capture out-of-scope work in the brain, and route to the right dualcraft:* skill.
---

# Using DualCraft

DualCraft is a web + mobile workflow (Next.js ⇄ Flutter) built around a **project brain**: every task, bug, decision, note and idea lives as a small file in `.dualcraft/brain/`, so context survives between conversations.

## Language rule
- Talk to the user in the project's `lang` (from `.dualcraft/config.json`, Spanish by default) — or in whatever language the user writes in.
- Commands, skill names, file names, note ids, frontmatter keys and branch names are always **English**.
- Commit messages use `commitLang` from the config.

## Tools
- **Brain CLI** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" <command>`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, use the exact "Brain CLI" path printed in the session context, or `<this skill's base directory>/../../scripts/brain.mjs`. Other skills call it **`$BRAIN`**. Run `$BRAIN help` for its commands.
- **Help** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/help.mjs"` lists every DualCraft command.

## The rules
1. **Context first.** Before any work, have the project context: the session start hook prints it; if it's missing, run `$BRAIN summary`. Respect recorded decisions (`D-xxx`); if the user's request contradicts one, point it out before proceeding.
2. **Mode before work.** If the context says the work mode is NOT CHOSEN, invoke `dualcraft:start` before touching code. The mode drives the flow, the commit type and the version bump.
3. **Capture, don't drift.** Anything that comes up but is out of the current scope (a new idea, a bug spotted elsewhere, a "we should also…", a decision taken) goes into the brain with `dualcraft:brain` — never silently done, never forgotten. Tell the user in one line what you noted (e.g. "Apuntado como T-012 para 1.4.0").
4. **Keep the brain true.** When a task starts → `status=doing`; when it's finished and verified → `status=done`. Link work with `depends_on`.
5. **Finish through commit.** When the work is done, use `dualcraft:commit` (it asks before committing).

## Routing
| Situation | Skill |
|---|---|
| Starting work / choosing what to do | `dualcraft:start` |
| "apunta", "déjalo para luego", "¿qué decidimos sobre…?", backlog questions | `dualcraft:brain` |
| Finished work that must wait for a later version | `dualcraft:park` |
| Committing, writing commit messages, CHANGELOG | `dualcraft:commit` |
| See the brain as a network of nodes | `dualcraft:map` |
| What goes in which version, progress | `dualcraft:roadmap` |
| See the database model as a diagram | `dualcraft:er` |
| Define/change stored data, generate models/types/rules | `dualcraft:schema` |
| New idea, "quiero añadir…", design before code | `dualcraft:brainstorm` |
| Work with several steps / both platforms | `dualcraft:plan` |
| Writing implementation code | `dualcraft:tdd` |
| Bug, crash, failing test, "no funciona" | `dualcraft:debug` (before any fix) |
| Before saying done / committing | `dualcraft:verify` |
| Reviewing changes, before merge/PR | `dualcraft:review` |
| Functional document, "documenta" | `dualcraft:docs` |
| "¿qué comandos hay?", help | `dualcraft:help` |

**Data rule:** in a project with `.dualcraft/db/schema.dbml`, any change to stored data starts in the schema (`dualcraft:schema`) and models/types are regenerated — never hand-edit generated files.

**Process rules:** no code before an agreed design for new features; no fix before a root cause; no "done" without fresh verification evidence.

More packs (design, web, mobile, refactor, security, marketing, converter) are listed by `dualcraft:help` and are added phase by phase.
