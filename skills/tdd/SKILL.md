---
name: tdd
description: Test first, watch it fail, minimum code to pass, refactor green; same cases on every platform. Use before writing implementation code, or for "con tests", "hazlo con TDD".
---

# DualCraft TDD

Commands per stack: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

## The cycle
1. **Red** — write one test for the next small piece of behaviour. Run it. It must **fail, and for the expected reason** (assertion about the missing behaviour — not a typo, import error or wrong setup). A test you never saw fail proves nothing.
2. **Green** — write the minimum code that makes it pass. Run it, and the related tests.
3. **Refactor** — clean names, duplication, structure. Tests stay green after each change.
4. Repeat for the next behaviour. Commit at green points if the user commits often.

For a **bug**: the first test reproduces the bug (fails now, passes after the fix) — it's the regression guard.

## What to test where
| Layer | Flutter | Next.js |
|---|---|---|
| Pure logic (validation, calculations, mappers, business rules) | `test/` unit tests | Vitest/Jest unit tests |
| State (Riverpod/Bloc/Provider, hooks, stores) | unit tests with fakes | hook/store tests |
| Data access (repositories, Firestore, API) | fake/mocked client or emulator | mock fetch / MSW, route handler tests |
| UI component | widget test (`testWidgets`, `find`, `tester.tap`, `pumpAndSettle`) | Testing Library (render, `screen.getByRole`, `userEvent`) |
| Full flow | `integration_test/` on a device | Playwright/Cypress |

Prefer the lowest layer that proves the behaviour; add a UI test for user-visible flows. Query UI by role/label/text the user sees, not by implementation details — that also checks accessibility.

## Same rule, both platforms
When a business rule exists on web and mobile (or should), write the **same test cases** on both (same inputs, same expected outputs — keep them in a table in the plan). Better still: if the rule can live in one place (backend, Cloud Function, shared rules), suggest moving it there.

## When there's no test setup
- Flutter always has `flutter_test` — no excuse.
- Web without a runner: propose adding Vitest + Testing Library (one small task, ask first). For an urgent bugfix, don't block: fix with a manual verification documented, and leave a brain task "set up web tests".

## Rules
- Don't write production code without a failing test that requires it — except pure UI layout, generated code (`dualcraft:schema`) and config; verify those another way (screenshot, build, analyzer).
- Don't change a test to make it pass unless the test was wrong — say so explicitly when you do.
- Tests are deterministic: no real network, fixed clocks/dates, no order dependence.
- Show the user the red and green runs (one line each), not just "tests pass".
