---
name: web-architecture
description: Understands and documents the structure of the project's Next.js app - router (App/Pages), folders, layers, data fetching, server vs client components, state, auth, styling - writes .dualcraft/architecture/web.md and tells where each kind of change goes, following the patterns already in use. Use when the user runs /dualcraft:web-architecture, asks "¿dónde va esto en la web?", "cómo está organizada la web", before creating a new page/feature/route in Next.js, or when refactoring web structure.
---

# DualCraft web architecture

`$DETECT` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.

## Map it (first time, or when it's stale)
1. `$DETECT` → Next.js version, router, package manager, styling, data, state, auth, tests, i18n.
2. Read the real structure: `app/` (or `pages/`) tree — layouts, route groups `(group)`, dynamic segments, `loading/error/not-found`, route handlers `route.ts`, `middleware.ts`, server actions; `components/` (ui vs feature), `lib/`/`utils/`, `hooks/`, data layer (fetchers, Firebase client/admin, ORM), `types/`, env usage (`process.env.*`, `NEXT_PUBLIC_*`).
3. Find the conventions by example: open 2–3 representative pages and components. How do they fetch data (server component, server action, route handler, client hook)? Where does validation live (zod?)? How are components named and split?
4. Write `.dualcraft/architecture/web.md` (≤ 1 page):
   - stack line (from detect) · folder map with one line per folder
   - data flow: request → page (server) → data layer → backend; mutations path
   - server/client rule used in the project; where secrets live
   - **"Where does X go?"** table: new page, new API endpoint, new shared component, new feature component, data access, validation schema, types (generated ones from `dualcraft:schema`), tokens/styles (`dualcraft:tokens`), texts (`dualcraft:i18n`), analytics (`dualcraft:analytics`)
   - known debts (link brain tasks)
5. Record architecture choices as brain decisions if they aren't already (`$BRAIN new decision …`).

## Use it
Before any web change, read `.dualcraft/architecture/web.md` and follow it. If a change doesn't fit the existing patterns, say so and propose — don't introduce a second pattern silently (two data-fetching styles, two state libraries…).

## Next.js rules of thumb (when the project has no rule of its own)
- App Router: server components by default; `'use client'` only on leaves that need state/effects/browser APIs.
- Data reads in server components or cached fetchers; mutations via server actions or route handlers that validate input and check auth.
- Secrets only on the server; only `NEXT_PUBLIC_*` reaches the browser.
- Colocate feature components with their route; shared UI in `components/ui`.
- Metadata via the Metadata API; images via `next/image`; fonts via `next/font`.
