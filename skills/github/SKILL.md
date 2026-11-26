---
name: github
description: Syncs the brain with GitHub Issues - tasks and bugs as issues, versions as milestones, assignees, closing and importing. Use for "sube las tareas a GitHub", "sincroniza con GitHub", "asigna esta tarea a…".
---

# DualCraft ⇄ GitHub Issues

`$GH` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/github.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. The repo is the git `origin` (or `--repo owner/name`).

The brain stays the source of truth for what the work is (body, dependencies, decisions); GitHub is where the team sees, assigns and discusses it. Every issue body starts with `<!-- dualcraft:<ID> -->` and the note stores `issue=#N`.

## Team fields on notes
- `assignee=<github login>` — who does it (`$BRAIN set T-004 assignee=ana`; `$BRAIN list --assignee ana`, `--assignee none`).
- `estimate=<3h|2d|1w|5pt>` — hours/days (8h)/weeks (40h) or story points; `$BRAIN roadmap` sums them per version (total and left) and counts unestimated items and open items per person.

## Sync
1. `$GH status` — what's linked, what isn't, and differences (state, assignee).
2. `$GH push --dry` — show the user what would be created/closed/updated; then, **with their OK** (it writes to GitHub, visible to everyone with access to the repo), `$GH push`:
   - creates issues for open tasks/bugs without one (`[T-004] title`, body without the Log, labels `dualcraft`, `type:*`, `priority:*`, tags; milestone `v<target>`; assignee),
   - closes the issue of notes that are done/dropped (with a comment),
   - syncs assignee and milestone. Specific notes: `$GH push T-004 B-002`; ideas too: `--ideas`.
3. `$GH pull` — issues closed on GitHub mark their note done; assignee changes come back. `--import` turns open issues that aren't linked into brain tasks/bugs (bugs by label). Use `--dry` first when unsure.

## Auth
Token from `GH_TOKEN`/`GITHUB_TOKEN`, else `gh auth token`, else the git credential helper for github.com (the same credentials used to push). Never print the token. Private notes: anything in a note body goes into the issue — check there's nothing sensitive before the first push of a note.
