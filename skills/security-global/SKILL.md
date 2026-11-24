---
name: security-global
description: Full security audit - threat model, scanner, rules vs schema, functions, payments, abuse, privacy - dated report and brain bugs. Use for "auditoría de seguridad", "¿es segura la app?", or before a public launch.
---

# DualCraft security — global audit

`$SEC` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`.
Platform depth: `dualcraft:security-web`, `dualcraft:security-mobile` (run them as part of this audit for each stack the project has). If the project has its own security-audit skill, use it too and merge the findings.

Defensive review of the user's own project. Never exfiltrate, print or commit secrets you find — report location and type only, and tell the user to rotate them.

## 1. Threat model (short)
From the functional document, schema and code, write 6–10 lines: **assets** (user data, payments, scores/rankings, admin powers, API quotas), **actors** (anonymous, signed-in user, other users, admin, attacker with a modified app or direct API/Firestore access), **entry points** (web pages/route handlers/server actions, mobile app, Firestore/Storage directly from clients, Cloud Functions, webhooks). Key assumption to test: *the client can be modified — every rule that matters must hold on the server.*

## 2. Automated scan
`$SEC` (add `--deps` to include `npm audit`). Confirm every finding by reading the code — mark false positives, don't report them as issues.

## 3. Manual review — backend first (it protects everything)
- **Firestore / Storage rules**, collection by collection against `.dualcraft/db/schema.dbml`: who can read, create, update, delete; ownership (`request.auth.uid == resource.data.ownerId`), roles (custom claims, not a client-writable field), field validation (`hasOnly`, types, sizes, immutable fields like `ownerId`, `createdAt`), list queries limited (no reading other users' data through queries). Compare with `firestore.rules.generated`. Propose rules unit tests with the emulator (`@firebase/rules-unit-testing`) for each rule that matters.
- **Cloud Functions**: auth and authorization in every callable/HTTP function; input validation; App Check for client-only endpoints; webhooks verify the provider signature; secrets in Secret Manager / params, not in code; least-privilege service accounts; idempotency for payments.
- **Trusted values**: prices, scores, points, balances, roles, premium flags, timestamps — computed or verified server-side, never accepted from the client.
- **Payments / IAP / subscriptions**: receipts verified server-side (Play Developer API / App Store Server API, or RevenueCat webhooks), entitlement stored server-side, refunds/revocations handled.
- **Abuse**: mass writes, spam, enumeration, fake accounts — rate limits (functions), rules limits (document size, write frequency via timestamps), App Check, quotas/budget alerts.
- **Auth**: providers configured, email enumeration protection, account deletion path, session/token lifetime, admin accounts protected (MFA).
- **Privacy (GDPR if EU users)**: data inventory from the schema (what personal data, where, why), deletion on account delete (including Storage and subcollections), consent for analytics/ads, privacy policy matches reality, no personal data in analytics or logs.
- **Secrets & config**: rotation needed for anything ever committed (check `git log` for removed `.env`/keys if the scan found them); Firebase web config is public by design — protection comes from rules and App Check.

## 4. Report
Write `docs/security/AUDIT-<YYYY-MM-DD>.md`: scope, threat model, method (scan + manual), findings table ranked 🔴 critical / 🟠 high / 🟡 medium / ⚪ low — each with location, impact (what an attacker can do), evidence, fix — then what was **not** reviewed. Keep secrets out of the report.

## 5. Act
- Each critical/high finding → brain bug: `$BRAIN new bug "<finding>" --priority high --tags security,<web|mobile|backend>`; medium → bug or task with a target version.
- Offer to fix in priority order, each through `dualcraft:debug`/`dualcraft:tdd` (a test or rules test that proves the hole is closed) and `dualcraft:verify`.
- Release gate: no open critical/high security bugs for the version (the release checklist will check `--tags security`).
