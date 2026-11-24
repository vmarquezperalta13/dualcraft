---
name: debug
description: Root cause before any fix - reproduce, gather evidence, test hypotheses, fix the cause, check the other platform. Use for any bug, crash or failing test, "no funciona", "falla", or when a previous fix didn't work.
---

# DualCraft debug

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Commands per stack: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

**No fix before a root cause backed by evidence.** Guess-and-patch fixes hide bugs and create new ones.

## 1. Frame it
- Expected vs actual, exact error text, platform (web/mobile/both, OS, browser, device), since when (version, commit), how often.
- Check the brain: is there a `B-xxx` for it, notes about this area, a past fix that didn't hold? Create the bug note if missing (`$BRAIN new bug "…"` with steps to reproduce).

## 2. Reproduce
Find the shortest reliable reproduction: a failing test (best), a script, or exact steps on device/browser. Can't reproduce → gather more evidence instead of guessing; say so to the user.

## 3. Gather evidence
- **Flutter**: full stack trace (first frame in *our* code), `flutter logs` / `adb logcat`, Crashlytics, `flutter analyze` warnings near the code. Typical causes: `setState` after `dispose`/`await` (missing `mounted` check), null from Firestore on a "required" field, async gaps with `BuildContext`, listeners/streams not cancelled, platform-specific plugin setup.
- **Next.js**: browser console + network tab, server logs (route handlers, server components run on the server!), build output. Typical causes: hydration mismatch (dates, `window`, random values in render), server/client boundary (`'use client'` missing, secrets in client code), caching/revalidation of fetch, env vars not exposed (`NEXT_PUBLIC_`), effects without cleanup.
- **Works in debug, fails in release / closed testing** (Firebase): R8 stripping classes, SHA fingerprints (Play App Signing re-signs the app), App Check provider, emulator left on, region mismatch — table in `${CLAUDE_PLUGIN_ROOT}/references/firebase-functions.md`.
- **Firebase**: rules denials (`permission-denied`), missing indexes (the error links to create it), functions logs, emulator.
- Recent changes: `git log -p` on the involved files, `git bisect` for regressions.

## 4. Hypothesis → test
Write the hypothesis in one sentence ("X is null because Y writes the doc before Z"). Test it with the smallest experiment (a log, a test, a breakpoint-style print). Confirmed → step 5. Rejected → next hypothesis; don't stack speculative changes. Remove temporary logs afterwards.

## 5. Fix the cause
- Failing test first (`dualcraft:tdd`), then the smallest correct fix at the root.
- **Other platform**: does the same logic/data path exist on the other platform or in the backend? Check it; if the bug exists there too, fix both (same test cases) or create a linked bug note.
- **Same pattern elsewhere**: search the codebase for the same mistake (e.g. other `setState` after `await`); fix or note them.

## 6. Verify and record
- `dualcraft:verify` on the affected platforms.
- Brain: `$BRAIN set B-xxx status=done --log "root cause: …; fix: …"`. If the root cause teaches something reusable (a gotcha of a library, a Firestore quirk), add a `note`.

## If the fix doesn't work
Stop. Don't layer another patch. Revert it, go back to step 3 with the new evidence, and tell the user what was wrong in the previous reasoning. After 3 failed attempts, question the architecture with the user instead of trying a 4th patch.
