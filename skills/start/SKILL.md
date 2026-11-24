---
name: start
description: Starts DualCraft work in a project - sets the project up the first time (.dualcraft/), loads the brain context and ASKS THE WORK MODE (bug or short task / new development / refactor) before any code is touched. Use when the user runs /dualcraft:start, says "empezamos", "vamos a trabajar en…", "quiero hacer X" in a DualCraft project whose work mode is not chosen, or when the session context says "Work mode: NOT CHOSEN".
---

# DualCraft start

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"` (see `dualcraft:using-dualcraft` if the variable isn't expanded).

## 1. Set up the project (first time only)
Run `$BRAIN summary`. If it says there is no DualCraft project:
1. Detect the stacks yourself, don't ask what you can read — `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"` reports both:
   - Web: a `package.json` with `next` → `nextjs` (note its folder if not the root).
   - Mobile: a `pubspec.yaml` with `flutter` → `flutter` (note its folder).
   - Version: from `pubspec.yaml` (`version: 1.2.3+4` → `1.2.3`) or `package.json`; else `0.1.0`.
2. Ask the user only what you couldn't detect, plus the commit language (English or Spanish — recommend English).
3. Run from the project root:
   `$BRAIN init --name "<name>" --version <v> [--web nextjs --web-path <dir>] [--mobile flutter --mobile-path <dir>] --lang es --commit-lang <en|es>`
4. Make sure `.dualcraft/` is committed with the project (only `state.json` is ignored — init does that).
5. Offer to map the architecture (`dualcraft:web-architecture` / `dualcraft:mobile-architecture`) so later work follows the project's patterns.
6. Offer, in one line, to seed the brain from existing sources (TODO/FIXME comments, open issues, notes the user pastes). Do it only if they accept, via `dualcraft:brain`.

## 2. Show the context
Summarise `$BRAIN summary` for the user in a few lines: version, what's in progress, open bugs, next tasks, parked work for the coming version. Don't dump the raw output.

## 3. Ask the work mode
Use the AskUserQuestion tool (one question, the user can always pick "Other"):

| Option | Meaning | Commit type | Version impact |
|---|---|---|---|
| **Bug / tarea corta** | fix a bug or a small, contained task | `fix:` / `chore:` / `style:` / `docs:` | patch (1.2.**3**) |
| **Nuevo desarrollo** | a new feature, short or long | `feat:` | minor (1.**3**.0) |
| **Refactor** | change structure without changing behaviour | `refactor:` / `perf:` | none |

If the user already said what they want in a way that makes the mode obvious ("arregla el crash de…"), propose the mode and ask only to confirm.

Then ask (or infer) **what** they'll work on:
- An existing brain item → use its id.
- Something new → create it with `$BRAIN new task|bug "<title>" [--target <version>]`.
- And the **scope** if the project has both stacks: `web`, `mobile` or `both`.

Record it: `$BRAIN mode <bugfix|feature|refactor> --task <IDs> --scope <web|mobile|both>`, and `$BRAIN set <ID> status=doing`.

## 4. Work according to the mode
| Mode | Flow |
|---|---|
| **bugfix** | `dualcraft:debug` (root cause with evidence; crashes: `dualcraft:mobile-crash` first) → `dualcraft:tdd` (failing test reproduces it, then fix) → `dualcraft:verify` |
| **feature** | `dualcraft:brainstorm` (agree the design; leftovers → brain) → `dualcraft:schema` if data changes → `dualcraft:design-screen` if there are new screens (then `dualcraft:design-to-code`) → `dualcraft:plan` if several steps or both platforms → `dualcraft:tdd` while implementing → `dualcraft:verify` → `dualcraft:review` for anything non-trivial → `dualcraft:docs` |
| **refactor** | `dualcraft:refactor-web`, `dualcraft:refactor-mobile` or `dualcraft:refactor-global` by scope (tests lock behaviour first → small steps, green after each → no behaviour change mixed in) → `dualcraft:verify` |

A short task in bugfix mode that isn't a bug (copy change, config, dependency bump) skips debug: do it, then verify.

Throughout: capture out-of-scope things with `dualcraft:brain`; if a finished piece must wait for a later version, use `dualcraft:park`.

## 5. Close
When verified: `$BRAIN set <ID> status=done --log "<one-line outcome>"`, functional document updated if behaviour changed (`dualcraft:docs`), then `dualcraft:commit`. Afterwards `$BRAIN mode clear` unless the user continues in the same mode.
