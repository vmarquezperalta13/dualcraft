---
name: web-seo
description: SEO and performance - metadata, sitemap, canonical, hreflang, structured data, Core Web Vitals, Lighthouse. Use for "SEO", "posicionamiento", "Google no indexa", "la web va lenta", or before public pages.
---

# DualCraft web SEO & performance

> **Stack:** examples here are Next.js. If the project's web stack (`config.stacks.web`) is React + Vite, Astro or Vue/Nuxt, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense (e.g. a SPA has no server routes; Astro is mostly static).

Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"` (shows sitemap/robots presence).

## Audit checklist
**Indexability**
- Public pages are server-rendered with real content (not a client-only shell); private/app pages are `noindex` and disallowed where appropriate.
- `app/robots.ts` and `app/sitemap.ts` exist; sitemap lists public URLs (dynamic ones from the data layer) with `lastModified`.
- One canonical URL per page (`alternates.canonical`); no duplicate content across query params; correct status codes (404 via `notFound()`, redirects 301/308).

**Metadata** (Metadata API: `export const metadata` / `generateMetadata`)
- Unique `title` (≤ 60 chars) and `description` (≤ 155) per page, in the page's language; `metadataBase` set.
- Open Graph + Twitter card with an image (static or `opengraph-image.tsx`).
- Multilingual: `alternates.languages` (hreflang) per locale; `<html lang>` correct.

**Structured data** — JSON-LD where it fits (Organization, WebSite, Product, Event, Article, FAQ, BreadcrumbList, SoftwareApplication/MobileApplication for the app's landing), validated against schema.org.

**Content** — one `h1`, logical heading order, descriptive link text, `alt` on meaningful images, internal links between related pages, app store badges linking to the app.

**Performance (Core Web Vitals)**
- LCP: hero image via `next/image` with `priority` and correct `sizes`; fonts via `next/font` (no layout shift).
- CLS: dimensions on images/embeds; no late-injected banners above content.
- INP: little client JS — keep `'use client'` at leaves, lazy-load heavy widgets (`next/dynamic`), avoid large libraries for small needs.
- Caching: static where possible, `revalidate` for content pages.
- Keep it from regressing: `dualcraft:perf` turns these into budgets checked in CI (Lighthouse + bundle per route).

## Measure
- Lighthouse: `npx lighthouse <url> --only-categories=performance,seo,accessibility,best-practices --output=json --output-path=<scratchpad>/lh.json --chrome-flags="--headless=new"` against a production build (`build` + `start`), mobile and desktop presets. Ask before installing if it isn't available.
- Report scores and the top fixes ordered by impact.

## Output
Findings ranked by impact with file:line and the fix; implement what the user approves; SEO texts (titles, descriptions) go through `dualcraft:i18n` when the site is multilingual. Long-term items → brain tasks; landing/SEO ideas → also useful for the marketing pack.
