---
name: park
description: Parks finished work for a later version (parked branch or feature flag) and resumes it later. Use for "déjalo para la siguiente versión", "apárcalo", "no lo metas en esta versión", "¿qué hay aparcado?".
---

# DualCraft park

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.

## Park something
1. **Identify the work**: which brain note it belongs to (create a task if there is none) and which changes are part of it (`git status`, `git diff`, or the commits on the current branch). Confirm with the user if the boundary isn't obvious.
2. **Ask the target version** if not given (default: the next minor of `config.version`).
3. **Choose the method** — recommend one, let the user decide:

   | Method | When | How |
   |---|---|---|
   | **Branch** (default) | the code isn't merged yet, or it's self-contained | branch `parked/<ID>-<slug>` with the work committed on it; the main line stays clean |
   | **Feature flag** | the code is already merged / entangled with other changes, or you want it in the codebase but invisible | ship the code switched off behind a `release` flag from the flags catalog (`dualcraft:flags`), default **off** |

4. **Do it** (ask before any git operation that moves or rewrites work):
   - Branch, uncommitted work: `git switch -c parked/<ID>-<slug>`, commit with `feat(<scope>): <title> [parked → <version>]` and `Refs: <ID>`, then `git switch -` back. Verify the original branch no longer has those changes.
   - Branch, already committed on a feature branch: just rename/keep it as `parked/<ID>-<slug>` and make sure it is not merged.
   - Feature flag: `node "${CLAUDE_PLUGIN_ROOT}/scripts/flags.mjs" add <id_snake> --type bool --default false --kind release --expires <version> --task <ID> --description "<title>"` (run `flags.mjs init` first if the project has no catalog), guard the entry points (routes, buttons, menu items) with the generated accessor on every platform the feature touches, and check that with the flag off the app behaves exactly as before (test with the flag overridden both ways).
   - Push the branch only if the user wants it on the remote.
5. **Record it**:
   `$BRAIN set <ID> status=parked target=<version> branch=parked/<ID>-<slug>` (or `flag=<name>`) `--log "parked: <what's done, what's missing>"`
   And write in the note's Details **how to resume**: what's done, what's left, any conflicts to expect.
6. Tell the user in one or two lines where it is and how it'll come back.

## List parked work
`$BRAIN list --status parked` → group by target version, show branch/flag and what's missing.

## Resume parked work
When its version starts (or the user asks):
- Branch: `git switch parked/<ID>-<slug>`, rebase/merge on the current main line, resolve conflicts, run the tests; then work continues as a normal feature.
- Flag: turn it on (remote value or default), and once it's stable make the code unconditional and `flags.mjs remove <key>` — `flags.mjs check` reports it as expired when its version arrives.
- `$BRAIN set <ID> status=doing --log "resumed for <version>"`.
