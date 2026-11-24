# Stack: Astro (web, content-first)

Best for content sites, landings, blogs and SEO/AdSense sites: static HTML by default, JavaScript only in interactive "islands".

## Scaffold
`npm create astro@latest <dir> -- --template minimal --install --no-git` → add integrations with `npx astro add <name>`: `tailwind` (tokens), `sitemap`, `mdx`, a UI framework for islands only if needed (`react`), an adapter (`vercel`, `node`, `netlify`) only if there are server routes.

## Architecture
```
src/
  pages/            file-based routes (.astro, .md/.mdx); [slug].astro for dynamic pages
  layouts/          page shells (SEO head, nav, footer)
  components/       .astro components (static) + islands (client:visible / client:load)
  content/          content collections (Markdown/MDX + schema in src/content.config.ts)
  styles/           global CSS (+ ds-tokens.css)
public/             static files (robots.txt, favicons)
```
Rules: content in collections with a typed schema; islands only where interaction is needed (`client:visible` preferred); images through `astro:assets`.

## Commands
| | |
|---|---|
| Dev | `npm run dev` (port 4321) |
| Check | `npx astro check` (types + .astro diagnostics) |
| Tests | Vitest for logic (`getViteConfig`), Playwright for pages |
| Build | `npm run build` → `dist/` (static) or server output with an adapter |

## SEO & content
Built-in i18n routing (`i18n` in `astro.config`), `@astrojs/sitemap`, canonical/OG tags in the layout, structured data per page. Use `web-seo` — most of it applies directly. Content quality and internal linking matter more than code here.

## Env & security
`PUBLIC_*` variables are exposed; others only in server code (endpoints `src/pages/api/*.ts` with an adapter). Static sites have little attack surface: forms → a trusted backend; no secrets in islands.

## DualCraft outputs
tokens → `src/styles/ds-tokens.css` · i18n → `src/i18n/<locale>.json` (simple `t()` helper or `astro-i18next`) · schema → `src/types/db.ts` · analytics → `src/lib/analytics-events.ts` (send from an island or a small inline script after consent).
