---
name: verify
description: Verification before any completion claim - run the real checks (analyzer, types, lint, tests, build) for every affected platform, read the output, and report evidence; nothing is "done", "fixed" or "working" without it. Use before saying work is finished, before committing or pushing, before closing a brain task, when the user runs /dualcraft:verify, or asks "¿funciona?", "¿está listo?", "comprueba que todo va bien".
---

# DualCraft verify

Commands per stack: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

**Evidence before claims.** "Should work", "looks right" and "tests probably pass" are not verification.

## 1. Decide what to check
From the changed files (`git status`, `git diff --stat`) and the work mode's scope:
- web files → web checks · mobile files → mobile checks
- schema, shared logic, Firebase rules/functions, generated models → **both platforms** + Firebase checks
- the specific behaviour that was built or fixed → its test(s), or a manual check

## 2. Run them — fresh, in this session
In this order, stopping to fix at the first failure:
1. Static: analyzer / type-check / lint (+ format check if CI does it)
2. Tests: the new/changed tests first, then the whole suite of the affected platform
3. Build: `flutter build apk --debug` and/or `next build` when the change could affect it (routing, config, dependencies, server/client code, native setup, generated code)
4. Decisions: `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" relevant "<what changed>"` — confirm the change complies with each matching decision in force (report "cumple D-xxx" or the conflict).
5. Behaviour: for UI, run it and look — widget/integration test, screenshot on emulator, or the page in a browser. For a bug: the reproduction from `dualcraft:debug` now passes.

Read the output. Count failures and warnings — exit code 0 with new warnings is still something to report.

## 3. Report
A short block for the user:
```
Verificación
✓ flutter analyze — sin problemas
✓ flutter test — 148 pasan (3 nuevos)
✓ npx tsc --noEmit · npm run lint — sin errores
✓ npm test — 52 pasan
– Build iOS: no se puede en Windows (no ejecutado)
✗ e2e: 1 falla — login.spec.ts:42 (ver abajo)
✓ Decisiones: cumple D-002 (Provider), D-004 (solo tokens)
```
- Everything not run says so and why. Never round "not run" up to "passed".
- Failures: show the relevant lines and either fix them (back to the right skill) or ask the user.

## 4. Then
All green → close the loop: `dualcraft:docs` if behaviour changed, brain task `done`, `dualcraft:commit`. If something can't be verified here (device, store build, payment sandbox), leave a brain task or a checklist item for it and say so.
