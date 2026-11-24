---
name: security-web
description: Web security review - auth, every endpoint and server action, XSS, CSRF, SSRF, headers and CSP, secrets. Use for "seguridad de la web", "¿es segura esta API?", or within a global audit.
---

# DualCraft security — web

> **Stack:** examples here are Next.js. If the project's web stack (`config.stacks.web`) is React + Vite, Astro or Vue/Nuxt, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense (e.g. a SPA has no server routes; Astro is mostly static).

`$SEC` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs" --scope web` (+ `--deps`). Confirm each finding in the code; never print secret values.

## Checklist
**Authentication & sessions**
- Session cookies `httpOnly`, `secure`, `sameSite=lax|strict`; sensible expiry; logout invalidates server-side where possible.
- Firebase Auth on the web: ID tokens verified on the server (`firebase-admin` `verifyIdToken` / session cookies) — never trust a `uid` sent in the body.

**Authorization — every server entry point**
- Route handlers (`route.ts`) and **server actions** are public HTTP endpoints: each one checks the user *and* their right to the specific resource (ownership/role), not just "logged in".
- `middleware.ts` is a convenience gate, not the authorization layer (it can be bypassed for some paths/matchers) — re-check in the handler.
- Server components that read private data check the session before fetching.

**Input & output**
- Validate every input on the server (zod or similar): body, params, search params, headers, uploaded files (type, size, name).
- XSS: no `dangerouslySetInnerHTML` with untrusted content (sanitize with DOMPurify if needed); markdown rendered with a safe renderer; user URLs in `href` restricted to `http(s):`.
- SSRF: no server `fetch` to user-supplied URLs without an allow-list. Open redirects: only relative or allow-listed destinations.
- SQL/NoSQL injection: parameterized queries; no building Firestore paths from raw user input without validation.

**CSRF** — server actions check origin by default (keep `serverActions.allowedOrigins` tight); custom route handlers that rely on cookies need same-site cookies + origin/CSRF token checks for mutations.

**Headers** (next.config `headers()` or middleware): `Content-Security-Policy` (start report-only, then enforce; nonces for inline scripts), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Permissions-Policy`; `poweredByHeader: false`.

**Secrets** — only `NEXT_PUBLIC_*` reaches the browser: no secrets there; server-only modules marked `import 'server-only'`; no secrets in client bundles (search the `.next` output if in doubt), logs or error messages.

**Abuse** — rate limiting on auth, forms, search and any costly endpoint (middleware + KV/Upstash or the platform's firewall); bot protection on public forms; error messages don't leak whether an email exists.

**Dependencies** — `npm audit --omit=dev`; upgrade vulnerable packages; remove unused ones.

## Output
Findings ranked 🔴/🟠/🟡/⚪ with file:line, attack scenario and fix. Critical/high → brain bugs tagged `security,web`. Fix with the user's OK through `dualcraft:tdd` (a test that proves the endpoint now rejects the attack) and `dualcraft:verify`. When run inside a global audit, return findings to `dualcraft:security-global` for the report.
