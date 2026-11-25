---
name: web-test
description: Web tests - unit, components, route handlers, e2e - right level, proper mocks, setup if missing. Use for "tests de la web", "añade tests a este componente", "e2e", or when TDD needs a web test.
---

# DualCraft web tests

> **Stack:** examples here are Next.js. If the project's web stack (`config.stacks.web`) is React + Vite, Astro or Vue/Nuxt, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense (e.g. a SPA has no server routes; Astro is mostly static).

Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`. Process: `dualcraft:tdd`. Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`.

## Pick the level
| What | Tool | Notes |
|---|---|---|
| Pure logic: validation, formatting, mappers, business rules | Vitest/Jest | fastest; most tests here |
| Component behaviour | Testing Library + `user-event` | query by role/label/text (`getByRole('button', { name: /guardar/i })`) — also checks accessibility |
| Route handlers (`route.ts`) | call the exported `GET/POST` with a `Request` | assert status, body, auth checks |
| Server actions | call the function directly with mocked data layer | |
| Full user flows (login, checkout) | Playwright via `dualcraft:e2e` (flows.json → specs shared with the apps' Maestro flows) | few, critical paths only; against `next build && next start` or a preview |

Async server components are awkward to unit-test: test their data functions and cover the page with Playwright.

## Mocking
- Network: MSW (preferred) or mock the fetcher module.
- Firebase: mock the data-access module, not the SDK internals; for rules/functions use the emulator (`firebase emulators:exec`).
- Time: fake timers / fixed dates. No real network, no order dependence.
- `next/navigation`: mock `useRouter`, `usePathname` where needed.

## No test setup yet?
Propose (ask first) Vitest + Testing Library: `pm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom`, a `vitest.config.ts` with `environment: 'jsdom'` and the React plugin, a setup file importing `@testing-library/jest-dom/vitest`, and a `"test": "vitest run"` script. Playwright: `dualcraft:e2e` (`e2e.mjs init` writes the config and the derived flows). Record the choice as a brain decision.

## Same rule, both platforms
If the rule also exists in Flutter, use the same test cases (see `dualcraft:tdd`).

## Run & report
Single file while iterating; whole suite before `dualcraft:verify`. Report counts and any flaky test (fix flakiness, don't retry it away).
