---
name: backend
description: Serverless backend from one contract (.dualcraft/backend/api.json) - Firebase Cloud Functions, Supabase Edge Functions or Next.js/Nuxt API routes; scaffolds callables, webhooks, triggers and cron jobs, server validators and typed clients for every stack. Use for "crea una función", "endpoint", "Cloud Function", "webhook", "cron", "backend".
---

# DualCraft backend

`$BE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/backend.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.
Field-tested patterns (transactions, error codes, debugging by error, release-only failures, deploy): `${CLAUDE_PLUGIN_ROOT}/references/firebase-functions.md` — follow it for Firebase.

## The rule
Every function the apps call is declared in `.dualcraft/backend/api.json` first. The server validates requests with the generated parser (unknown fields rejected) and every client calls it through the generated typed `Api` — names, fields and errors can't drift between web, mobile and server. Business logic, prices, entitlements and anything another user can see are decided **on the server**, never trusted from the client.

## 1. Provider and setup (once)
Provider follows `config.backend.provider` (`dualcraft:database`): Firebase → **Cloud Functions v2**, Supabase → **Edge Functions**, Postgres + Prisma → **API routes of the Next.js/Nuxt app** (`http`). If the project has none, recommend one and record a decision (area backend).
- Firebase needs **one region** for every function and every client (ask; recommend the one next to the Firestore location, e.g. `europe-west1`). Changing it later breaks installed apps.
- `$BE init --provider firebase --region europe-west1` (or `supabase` / `http`) → contract, `functions/` (TypeScript, Node 22, `setGlobalOptions` with `maxInstances`) or `supabase/functions/_shared/cors.ts`, and `firebase.json` functions entry. Then `npm install` in `functions/` (ask first).

## 2. Design a function (with the user)
Kinds: **callable** (the apps call it; typed client) · **http** (REST for third parties) · **webhook** (a provider calls it, signed) · **trigger** (Firestore/Storage/Pub/Sub/Auth blocking on Firebase; `db:<table>.<insert|update|delete>` Database Webhook on Supabase) · **schedule** (cron).
```json
{"name": "redeemCode", "kind": "callable", "auth": "user", "description": "Canjea un código promocional",
 "platforms": ["web", "mobile"], "origin": "T-012",
 "input":  {"code": {"type": "string", "required": true, "pattern": "^[A-Z0-9_-]{3,32}$"}},
 "output": {"coins": {"type": "int", "required": true}},
 "errors": ["not-found", "already-exists"]}
```
- `auth`: `user` (default, signed-in) · `admin` (custom claim `admin` / `app_metadata.role`) · `public` (only when it must work signed-out — then rate-limit it).
- Fields: `string|int|double|bool|json`, `required`, `array`, `values` (enum), `min/max`, `minLength/maxLength/pattern`, `maxItems`. Strings without `maxLength`/`pattern` are capped at 5000 chars, lists at 1000 items. Never accept ids, prices or amounts the server can compute itself.
- `errors`: the standard codes the client must handle (`unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, `already-exists`, `failed-precondition`, `resource-exhausted`…) — map each to a message in the UI (table in the reference).

`$BE add <name> --kind callable [--auth admin] [--desc "…"] [--origin T-12] [--platforms web,mobile]` declares it and scaffolds the server file once (yours afterwards, never regenerated): auth check, input parsing, typed output, error handling that never leaks internals. Then fill `input`/`output`/`errors` in api.json and `$BE gen`.
- Webhook: `--kind webhook` → signature check on the raw body (`timingSafeEqual`) + idempotency (`webhook_events`). Set the provider's real header/SDK (Stripe `constructEvent`). Secret: `firebase functions:secrets:set …` / `supabase secrets set …` / hosting env.
- Trigger: `--kind trigger --on firestore.created:users/{uid}` (also `firestore.updated|deleted|written`, `pubsub:<topic>`, `storage.finalized`, `auth.beforeCreate`, `auth.beforeSignIn`) · Supabase `--on db:orders.insert`. Must be idempotent (delivered more than once).
- Schedule: `--kind schedule --cron "0 3 * * *" [--tz Europe/Madrid]` — Firebase `onSchedule`; Supabase prints the `pg_cron` + `pg_net` SQL; Next/Nuxt uses the platform cron with `CRON_SECRET`.
Implement the `TODO(dualcraft)` with `dualcraft:tdd` when there's logic: read-check-write in a **transaction**, batch writes ≤ 500, no personal data in logs.

## 3. Generated files (`$BE gen`)
| Where | File |
|---|---|
| Firebase server | `functions/src/generated/api.ts` (`REGION`, types, `parse<Name>Input`) |
| Supabase server | `supabase/functions/_shared/api.ts` |
| Next.js / Nuxt server | `src/server/api-contract.ts` / `server/utils/api-contract.ts` |
| Web / RN client | `…/lib/api-client.ts` (`createApi(transport)`) · Nuxt `utils/api-client.ts` |
| Flutter | `lib/generated/api_client.dart` (`Api(transport)`) |
| KMP / Android | `…/api/ApiClient.kt` / `…/data/api/ApiClient.kt` |
| iOS | `Core/Api/ApiClient.swift` |
Hash-protected: change the contract, not the files. Only `callable` functions get client methods (filtered by `platforms`).

## 4. Transports (write once per app, in its services layer)
The generated `Api` needs one `ApiTransport` that sends `(endpoint, data)` and turns failures into `ApiError(code)`:
- **Flutter + Firebase**: `FirebaseFunctions.instanceFor(region: REGION).httpsCallable(endpoint).call(data)` → `result.data`; `on FirebaseFunctionsException catch (e) { throw ApiError(e.code, e.message); }`.
- **Flutter + Supabase**: `Supabase.instance.client.functions.invoke(endpoint, body: data)` → `res.data`; `on FunctionException catch (e)` → `ApiError(e.details?['code'] ?? 'internal')`.
- **Web/RN + Firebase**: `httpsCallable(getFunctions(app, REGION), endpoint)(data)` → `r.data`; catch → `new ApiError(String(e.code).replace('functions/', ''), e.message)`.
- **Web/RN + Supabase**: `supabase.functions.invoke(endpoint, { body: data })`; on `error` read `await error.context.json()` → `ApiError(body.code)`.
- **Own API (http)**: `fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'include' })`; `!res.ok` → `ApiError(body.code)`.
- **Android/KMP**: `Firebase.functions(REGION).getHttpsCallable(endpoint).call(data).await().data` (KMP: GitLive Firebase SDK or Ktor for http); map `FirebaseFunctionsException.code` (`NOT_FOUND` → `not-found`).
- **iOS**: `try await Functions.functions(region: REGION).httpsCallable(endpoint).call(data).data`; map `FunctionsErrorCode` to the same strings.
Emulators only in debug builds (`kDebugMode`, `NODE_ENV === 'development'`, `BuildConfig.DEBUG`, `#if DEBUG`). Anonymous auth: sign in before the first call.

## 5. Check, deploy, operate
- `$BE check` → contract valid, every function implemented and exported, no Cloud Functions v1, regions consistent (functions **and** client code), generated files up to date. `$BE list` → inventory. Both before every commit that touches the backend.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs" --scope backend` → callables without auth/App Check, webhooks without signature, CORS `*`, secrets.
- Deploy with explicit OK, dev first: `firebase deploy --only functions --project dev` (one: `functions:redeemCode`) · `npx supabase functions deploy <slug> --project-ref <dev>` · the web's normal deploy. Then prod. The backend ships **before** the app version that needs it and stays compatible with the versions users still have (add fields, don't rename or remove; deprecate first).
- Logs: `firebase functions:log --only <name>` · Supabase dashboard → Edge Functions → Logs. Debugging by error code: the reference's table.
- Brain: a decision for provider/region/auth model; tasks for secrets to set per environment, monitoring and anything left as `TODO(dualcraft)`.
