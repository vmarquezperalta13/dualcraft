# Stack: Next.js (web)

The web skills (`web-architecture`, `web-build`, `web-test`, `web-browser`, `web-seo`, `security-web`, `refactor-web`) are written for Next.js first — follow them as they are.

- **Scaffold**: `npx create-next-app@latest <dir> --ts --tailwind --app --src-dir --eslint --use-npm`
- **Commands**: see `references/stack-commands.md` → Next.js.
- **DualCraft outputs**: tokens → `ds-tokens.css` (Tailwind v4 `@theme` or CSS variables) · i18n → `messages/<locale>.json` (next-intl) · schema → `src/types/db.ts` · analytics → `src/lib/analytics-events.ts`.
- **Backend touchpoints**: route handlers, server actions, middleware (they are server code — security and conversion decisions apply).
