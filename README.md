# DualCraft

Web + mobile development workflow for Claude Code — **Next.js ⇄ Flutter** — built around a **project brain**.

You talk to it in your language (Spanish by default); commands are in English.

## What it does (v0.1)

- **Project brain** (`.dualcraft/brain/`): tasks, bugs, decisions, notes and ideas as small markdown files with ids (`T-001`, `D-002`…), status, target version and dependencies. Loaded automatically at the start of every session.
- **Work modes**: before working, DualCraft asks whether it's a *bug / short task*, a *new development* or a *refactor*. The mode drives the flow, the commit type and the version impact.
- **Parked work**: finished development that must wait for a later version is kept on a `parked/*` branch or behind a feature flag, with its target version recorded.
- **Commits**: Conventional Commits derived from the mode, linked to brain ids, with `CHANGELOG.md`.

Run `/dualcraft:help` to see every command, available and upcoming.

## Install

Requires Node.js 18+ and git.

```
/plugin marketplace add vmarquezperalta13/dualcraft
/plugin install dualcraft@dualcraft
```

Or from the terminal: `claude plugin marketplace add vmarquezperalta13/dualcraft` and `claude plugin install dualcraft@dualcraft`.

Local development: `claude plugin marketplace add <path-to-this-folder>`.

## Commands

| Command | |
|---|---|
| `/dualcraft:help` | List all commands |
| `/dualcraft:start` | Set up the project, load context, choose the work mode |
| `/dualcraft:brain` | Capture and query tasks, bugs, decisions, notes, ideas |
| `/dualcraft:park` | Park finished work for a later version |
| `/dualcraft:commit` | Mode-aware Conventional Commit + CHANGELOG |

## Roadmap

1. ✅ Core: brain, work modes, parked work, commits, help
2. Visual brain map (nodes + dependencies), roadmap view, ER diagram and schema as source of truth
3. Process: brainstorm, plan, TDD, debug, verify, review, functional document
4. Design: claude.ai Design → shared tokens → React / Flutter
5. Web and mobile packs, refactoring, i18n, analytics
6. Security: global, web, mobile
7. Marketing and release (versioning, store notes, launch checklist)
8. Web ⇄ mobile converter
9. Standalone installer with packs for several agents

## Project files

```
.dualcraft/
  config.json     name, version, stacks, languages
  brain/          one note per file
  state.json      current work mode (local, gitignored)
```

The brain CLI can also be used directly: `node scripts/brain.mjs help`.
