# Security playbook — Flutter + Firebase (severity, rules, checklist, report)

Field-tested audit method from production apps. Used by `dualcraft:security-global` and `dualcraft:security-mobile`; most of it applies to any client + BaaS stack.

## Severity and release gate
| Severity | Meaning | Release |
|---|---|---|
| CRÍTICO | exploitable now (open data, forged writes, leaked secret) | 🚫 **blocks the release** until fixed |
| ALTO | serious risk | ship only with a dated plan (≤ 7 days) |
| MEDIO | moderate | ship; in the backlog |
| BAJO / INFO | hardening / observation | when possible |
An open CRÍTICO ships only with a documented exception (reason + who authorizes it) — record it as a decision.

## Firestore rules — the first line of defense
- **Default deny** at the end: `match /{document=**} { allow read, write: if false; }`.
- Explicit rules per collection for read **and** write; helpers: `isAuth()`, `isOwner(uid)`, `isOwnerOf(collection, id)` (via `get()`), role checks from custom claims (never a client-writable field).
- **Immutable / server-only fields** on update: `!request.resource.data.diff(resource.data).affectedKeys().hasAny(['ownerId', 'type', 'createdAt', 'rating', 'subscriptionStatus', 'secret…'])`.
- **Shape validation** on create/update: `keys().hasOnly([...])`, `hasAll`, types (`is int`, `is string`), ranges (`>= 0`, `<= max`), sizes (`.size() <= 500`).
- **Server-only collections** (`reports`, `scheduled_tasks`, `promo_codes`, `used_purchase_tokens`, entitlements): `allow write: if false` (Admin SDK in Functions bypasses rules); entitlements readable only by their owner.
- A user can never change their own role/type after registration; content of others (reviews) only by its author.
- Rules in the console must equal the repo's `firestore.rules` — deploy rules with every change (`firebase deploy --only firestore:rules`) and check in the console that the published version is the latest.

## Secrets in the client
Never in app code: webhook secrets, SendGrid (`SG.`), Stripe secret (`sk_live_`) or webhook (`whsec_`) keys, FCM server keys (`AAAA…:`), service accounts, privileged UIDs. Model classes must not even map server-only fields (don't add `webhookSecret` to `fromJson`, even if a rule mistake ever sends it).
- Google API keys (`AIzaSy…`) and `google-services.json` / `GoogleService-Info.plist` are not secrets by themselves — protection comes from rules and App Check — but **restrict** API keys (app/package + SHA, HTTP referrers) and keep config files out of public repos.
- Local config: `.env` / `local.properties` git-ignored; CI secrets for builds.

## Cloud Functions
Auth + input validation in every callable; webhooks verify HMAC with constant-time comparison; rate limits on public endpoints; errors don't expose stack traces; logs without personal data or secrets; one region; `npm audit --audit-level=high` clean. Details: `firebase-functions.md`.

## Flutter client
- Release builds: `--obfuscate --split-debug-info=…` (keep symbols for crash reports); no `print`/`debugPrint` of sensitive data (guard with `kDebugMode`).
- `flutter_secure_storage` for anything sensitive (never `SharedPreferences`); `android:allowBackup="false"` or backup rules excluding it.
- `FLAG_SECURE` on sensitive screens (payments, contracts, personal documents).
- Validate URLs before `launchUrl` (only `https`), sanitize storage paths, `.limit()` on every query (no unbounded reads).
- Never disable TLS verification; pinning only with a rotation plan.
- Emulators only under `kDebugMode`.

## Privacy (GDPR / LOPDGDD for EU users)
Privacy notice at registration · **delete account in the app** (re-authenticate first; delete personal data, anonymize content that affects others such as reviews, delete storage files and subcollections, then the Auth user) · data export on request · location only in foreground with a clear rationale · retention limits (e.g. logs 90 days) · the policy names the processors (Firebase/Google).

## Checklist blocks (mark ✅ / ❌ / ⚠ / N/A with evidence)
A — Rules (CRÍTICO) · B — Secrets & config (CRÍTICO) · C — Auth & session (ALTO: logout clears local data, expired token → login, role-based routes unreachable by other roles incl. deep links, password policy server-side) · D — Cloud Functions (ALTO) · E — Input validation (MEDIO) · F — Privacy (MEDIO) · G — Client hardening (BAJO).

## When to audit
| Event | Blocks |
|---|---|
| Before a production release | A, B, C, D, E |
| New auth feature | B, C |
| Cloud Functions change | D |
| Rules change / new model field | A (+ B, E) |
| Monthly in production | B (scanner), D (`npm audit`) |
| Quarterly | all |

## Finding format
```
## [SEVERIDAD] Título
Componente: path/file:line
Descripción: qué está mal y por qué es un riesgo
Evidencia: código o regla
Impacto: qué puede hacer un atacante
Solución: código o regla corregida
Estado: ABIERTO / RESUELTO en <commit>
```
