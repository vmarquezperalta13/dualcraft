---
name: commit
description: Conventional Commits from the work mode, linked to brain ids, with CHANGELOG; asks first, never pushes unasked. Use for "haz commit", "commitea", "sube los cambios", or when verified work is done.
---

# DualCraft commit

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.

## 0. Preconditions
- The work was verified in this session (`dualcraft:verify`). If not, run it first — don't commit unverified work; if the user insists, say in the commit body what wasn't verified.
- For `feat` and user-visible `fix`: the functional document is updated (`dualcraft:docs`) and goes in this commit. Skip for internal changes.

## 1. Gather
- `$BRAIN mode` → the work mode, tasks and scope. If no mode is recorded, ask the user which one applies (same three options as `dualcraft:start`).
- `git status` and `git diff` (staged + unstaged). If changes belong to **different** pieces of work, propose splitting them into several commits.
- Never include secrets, `.env` files, build outputs or `.dualcraft/state.json`.

## 2. Write the message
Language: `commitLang` from `.dualcraft/config.json`.

```
<type>(<scope>): <summary in imperative, ≤ 72 chars>

<body: what changed and WHY, wrapped at 72; bullets fine>

Refs: T-004, B-002
```

- **type** from the mode and the actual change:
  - bugfix → `fix` (or `chore` / `docs` / `style` / `test` / `build` / `ci` when the short task isn't a bug fix)
  - feature → `feat`
  - refactor → `refactor` (or `perf` for performance)
  - Breaking change → `!` after the scope and a `BREAKING CHANGE:` footer.
- **scope**: `web`, `mobile`, `shared` (both platforms or backend/Firebase), or a narrower module name if the project uses them (`auth`, `payments`…). Use the mode's scope by default.
- **Refs**: the brain ids being worked on. Use `Closes: <ID>` instead when this commit completes the note.
- Add the attribution lines required by the environment, if any.

## 3. CHANGELOG
Only for user-visible changes (`feat`, `fix`, `perf`, breaking): add a line under `## [Unreleased]` in `CHANGELOG.md` at the project root (create it with the Keep a Changelog layout if missing), in the user's language:
- feat → `### Added` · fix → `### Fixed` · perf/visible refactor → `### Changed` · removals → `### Removed`
- Format: `- <what the user notices> (web|mobile|ambos) — T-004`

Include the CHANGELOG edit in the same commit. Version numbers are bumped at release time (the `release` command), not per commit.

## 4. Confirm and commit
Show the user: the files, the message and the CHANGELOG line. Ask to confirm (they may edit). Then stage exactly those files and commit. Report the hash in one line.

## 5. Keep the brain in sync
- Notes closed by this commit: `$BRAIN set <ID> status=done --log "commit <short-hash>"` (if not done already).
- If the mode's tasks are all done, `$BRAIN mode clear`.
- Pushing: only if the user asks. If the current branch is the default branch and it's a feature, suggest a branch first.
