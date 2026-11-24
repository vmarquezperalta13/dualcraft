# Stack: Vue / Nuxt (web)

Full-stack Vue framework (SSR/SSG + server routes via Nitro). Equivalent role to Next.js.

## Scaffold
`npm create nuxt@latest <dir>` → modules with `npx nuxi module add <name>`: `@nuxtjs/tailwindcss` (or Tailwind v4 via Vite plugin), `@nuxtjs/i18n`, `@pinia/nuxt` (state), `@nuxt/image`, `@nuxtjs/sitemap`, `@nuxt/test-utils`.

## Architecture
```
app/ (Nuxt 4) or root (Nuxt 3)
  pages/          file-based routes ([id].vue)
  layouts/        default.vue …
  components/     auto-imported components (ui/ + feature folders)
  composables/    useX() logic, data access (useFetch/useAsyncData wrappers)
  stores/         Pinia stores
server/
  api/            Nitro endpoints (server code — auth + validation required)
  middleware/     server middleware
```
Rules: data fetching with `useFetch`/`useAsyncData` (SSR-safe); secrets only in `server/` via `runtimeConfig` (public keys under `runtimeConfig.public`); Pinia for cross-page state only.

## Commands
| | |
|---|---|
| Dev | `npm run dev` (port 3000) |
| Types | `npx nuxi typecheck` |
| Lint | `npm run lint` (`@nuxt/eslint`) |
| Tests | Vitest + `@nuxt/test-utils` (`environment: 'nuxt'`), `@vue/test-utils`; Playwright e2e |
| Build | `npm run build` (SSR) · `npx nuxi generate` (static) |

## Security
`server/api` handlers validate input (zod/valibot) and check the session on every mutating route; `v-html` only with sanitized content; headers via `nuxt-security` module or route rules.

## DualCraft outputs
tokens → `assets/css/ds-tokens.css` · i18n → `i18n/locales/<locale>.json` for `@nuxtjs/i18n` (vue-i18n message syntax: `{name}` works; plurals use `|` — the generator converts simple ICU plurals) · schema → `types/db.ts` · analytics → `utils/analytics-events.ts`.
