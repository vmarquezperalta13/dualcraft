---
name: refactor-web
description: Safe web refactoring without behaviour change - components, server/client split, data fetching, duplication, dead code, adoption of shared sources - small green steps. Use for "refactoriza la web", "limpia este componente".
---

# DualCraft refactor — web

> **Stack:** examples here are Next.js. If the project's web stack (`config.stacks.web`) is React + Vite, Astro or Vue/Nuxt, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense (e.g. a SPA has no server routes; Astro is mostly static).

Architecture map: `.dualcraft/architecture/web.md` (`dualcraft:web-architecture` if missing). Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`.

## Safety first
1. Define the target: which files/feature and what "better" means (smaller components, one data-fetching style, no duplicated validation…). Agree it with the user.
2. Behaviour lock: tests covering what you'll touch must exist and pass. Missing → write characterization tests first (component tests by role/text, route handler tests, a Playwright smoke for the page).
3. Small steps; after each: type-check + lint + tests green. Commit at green points (`refactor(web): …`). Never mix a behaviour change in — if you find a bug, note it (brain) and fix it separately.

## Typical targets
| Smell | Refactor |
|---|---|
| Huge page/component | extract feature components colocated with the route; shared ones to `components/ui` |
| `'use client'` high in the tree | push it down to the interactive leaves; keep data fetching on the server |
| Fetching in `useEffect` for data available on the server | move to a server component / cached fetcher; client gets props |
| Same validation in form and route handler written twice | one zod schema shared by both |
| Prop drilling 3+ levels | composition (children/slots) first; context only if truly global |
| Hand-written types for stored data | generated types from `dualcraft:schema` |
| Hex colors / arbitrary values | design tokens (`dualcraft:tokens`) |
| Hard-coded texts | `dualcraft:i18n` |
| Dead code, unused exports/deps | remove (search usages first; `npx knip` if available, ask before installing) |
| Heavy client bundle | `next/dynamic` for heavy widgets, smaller libraries, server-only modules out of client graph |

## Close
`dualcraft:verify` (build included) → `dualcraft:review` → commit. Update `.dualcraft/architecture/web.md` if the structure changed; record significant choices as brain decisions.
