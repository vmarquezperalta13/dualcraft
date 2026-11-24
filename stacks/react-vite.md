# Stack: React + Vite (web SPA)

A client-only single-page app: **no server** — everything the app trusts must be enforced by the backend (Firebase rules, Supabase RLS, an API). Treat it like a mobile client for security decisions.

## Scaffold
`npm create vite@latest <dir> -- --template react-ts` → add: `react-router` (routing), `@tanstack/react-query` (server state) if the project fetches a lot, Tailwind v4 (`@tailwindcss/vite`) for tokens.

## Architecture (default when the project has none)
```
src/
  app/            router, providers (query client, i18n, auth), layout
  features/<x>/   components/, hooks/, api/ (data access), routes.tsx
  components/ui/  shared UI
  lib/            clients (firebase/supabase), utils
  types/          generated db.ts (dualcraft:schema)
```
Routes lazy-loaded per feature; data access only through `features/<x>/api`.

## Commands
| | |
|---|---|
| Dev | `npm run dev` (port 5173) |
| Types | `npx tsc -b` |
| Lint | `npm run lint` |
| Tests | Vitest + Testing Library (`npx vitest run`); e2e Playwright |
| Build | `npm run build` → `dist/` (static; host on Vercel/Netlify/Firebase Hosting with SPA fallback to `index.html`) |
| Preview | `npm run preview` |

## Env & security
Only `VITE_*` variables reach the code — **all of them are public**. No secrets in the client, ever. SEO is weak for SPAs: if pages must rank, that part belongs in Next.js or Astro.

## DualCraft outputs
tokens → `src/styles/ds-tokens.css` (Tailwind v4 or CSS variables) · i18n → `src/locales/<locale>.json` (react-i18next with ICU plugin `i18next-icu`, or `react-intl`) · schema → `src/types/db.ts` · analytics → `src/lib/analytics-events.ts`.

## Browser & tests
Same tooling as Next.js (`web-browser`, `web-test`); no server components or route handlers.
