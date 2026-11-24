---
name: web-build
description: Builds the Next.js app and fixes build problems - dependency installs and upgrades, type and lint errors, server/client boundary errors, environment variables, Next.js and React version upgrades, deploy builds (Vercel or other). Use when the user runs /dualcraft:web-build, "no compila la web", "falla el build", "next build da error", "actualiza Next/React", "instala X en la web", or before a web release.
---

# DualCraft web build

Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md` (package manager from the lockfile — never mix managers). Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`.

## Build
`pm run build` from the web folder. Read the whole error, find the **first** real one (later errors are often consequences).

## Common failures → cause
| Symptom | Usual cause | Fix |
|---|---|---|
| `You're importing a component that needs useState…` | client hook in a server component | move the stateful part to a `'use client'` leaf |
| `Module not found: Can't resolve 'fs'` (or `firebase-admin`) | server-only code imported by a client component | split the module; `import 'server-only'` in server files |
| Type errors only in `build` | `dev` doesn't type-check everything | `npx tsc --noEmit`, fix types (generated types from `dualcraft:schema` win over hand-written ones) |
| `process.env.X` undefined in the browser | not prefixed `NEXT_PUBLIC_` (and needs a rebuild) | prefix only if it's public; otherwise read it on the server |
| `Dynamic server usage` / static generation errors | `cookies()`, `headers()`, uncached fetch in a static route | mark dynamic or cache explicitly |
| Hydration mismatch at runtime | dates, random, `window` during render | render on client or stabilise the value |
| ESLint fails the build | lint errors | fix them; don't disable rules to pass |

## Dependencies
- Add: `pm add <pkg>` (dev: `-D`). Check it's maintained and its license; prefer what the project already uses.
- Upgrades: one major at a time; read the official migration guide/codemods (`npx @next/codemod`); upgrade `next`, `react`, `react-dom`, `eslint-config-next`, `@types/react` together; run build + tests after.
- Security: `npm audit` / `pnpm audit` — triage, don't blindly `--force`.
- Lockfile always committed with the change.

## Environment
List required env vars in `.env.example` (no values). Never commit `.env*` with secrets. Deploy platform env (Vercel project settings) must match.

## Done
Build green + `dualcraft:verify` for the web. Upgrades and new deps → brain decision if they change how the project works.
