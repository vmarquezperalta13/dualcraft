---
name: plan
description: Written implementation plan (small steps, exact files, tests first, checks) saved and executed step by step. Use for multi-step or cross-platform work, after a brainstorm, or "sigue con el plan".
---

# DualCraft plan

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Commands per stack: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

## Write the plan
Input: the spec (`.dualcraft/specs/<ID>-*.md`) or the agreed request, plus the real code — read the files you'll touch first. File: `.dualcraft/plans/<ID>-<slug>.md`, linked with `$BRAIN set <ID> plan=<path>`.

```markdown
# Plan — <ID> <title>
Goal: <one sentence> · Spec: <path or "—"> · Mode: feature|bugfix|refactor · Scope: web|mobile|both

## Order
1. Schema/data (if any) → regenerate models/types
2. Shared logic / backend (Firebase rules, functions)
3. Mobile  4. Web   (or the reverse — say why)
5. Docs (functional document) · 6. Verify both platforms

## Steps
### Step 1 — <short name>  [mobile]
Files: `lib/features/x/x_repository.dart` (modify), `test/features/x/x_repository_test.dart` (create)
- [ ] Write failing test: <what it asserts>
- [ ] Run it, see it fail: `flutter test test/features/x/x_repository_test.dart`
- [ ] Implement: <what, precisely — names, signatures, behaviour>
- [ ] Run it, see it pass; `flutter analyze`
Done when: <observable result>
```

Rules for steps:
- Each step is small (minutes, not hours), leaves the project compiling and its tests green, and can be committed on its own.
- Exact file paths, real names from the code, exact commands. No "handle errors appropriately" — say which errors and how.
- Tests first wherever practical (see `dualcraft:tdd`). UI-only steps say how they'll be checked (widget test, screenshot, browser).
- Platform tag on every step. When web and mobile implement the same rule, say so and test it on both with the same cases.
- If the plan uncovers work outside the scope → brain task with a later target, not a new step.

Show the plan to the user and get a yes before executing. Big plans: show the outline first.

## Execute the plan
- Mark the task `doing`. Go step by step; tick checkboxes in the plan file as you go (it's the progress record across sessions).
- After each step: run the step's checks. Red → stop and fix (use `dualcraft:debug` if the cause isn't obvious) before the next step.
- Deviations: if reality differs from the plan, update the plan file (note why) — don't silently improvise. If it changes scope or design, ask the user.
- Commit at sensible points with `dualcraft:commit` (the user may prefer one commit at the end — ask once).
- At the end: `dualcraft:verify`, then `dualcraft:docs`, then close the task.

## Resume
"Sigue con el plan" → open the plan file, find the first unticked step, re-run the previous step's checks to confirm the state, continue.
