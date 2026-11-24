# Firebase Cloud Functions (v2) — patterns, client calls, debugging, deploy

Field-tested in production Flutter + Firebase apps. Used by `dualcraft:backend` and the security skills (and the payments and push packs).

## Rules of thumb
- **Always v2** (`firebase-functions/v2/*`); never mix with v1 (`functions.https.onCall`) in the same codebase.
- **One region, declared everywhere**: every function sets `region`, and every client calls that same region. A client using the default region (`us-central1`) against functions in `europe-west1` fails with a misleading `unavailable`.
- `initializeApp()` once at the top; Admin SDK bypasses rules → **validate every input** anyway.
- Secrets with `defineSecret` + `firebase functions:secrets:set NAME`; never in code, never in `functions.config()` (deprecated), never logged.

## Callable template (Node)
```js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
initializeApp();
const REGION = "europe-west1";

exports.redeemCode = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  try {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Login required");
    const code = String(request.data?.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new HttpsError("invalid-argument", "bad_code");
    const db = getFirestore();
    // read-check-write atomically: prevents double redemption under concurrency
    return await db.runTransaction(async (tx) => {
      const ref = db.collection("promo_codes").doc(code);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new HttpsError("not-found", "invalid_code");
      if (doc.data().used) throw new HttpsError("already-exists", "already_used");
      tx.update(ref, { used: true, used_by: uid, used_at: FieldValue.serverTimestamp() });
      tx.set(db.collection("users").doc(uid), { coins: FieldValue.increment(doc.data().coins ?? 0) }, { merge: true });
      return { coins: doc.data().coins ?? 0 };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;             // typed errors pass through
    console.error("redeemCode failed", e);            // no personal data / secrets in logs
    throw new HttpsError("internal", "internal_error"); // never leak stack traces
  }
});
```
`invoker: "public"` is only needed when the app calls with anonymous auth and App Check isn't enforced; prefer `enforceAppCheck: true` for client-only callables.

Other triggers: `onRequest` (webhooks — verify the provider signature), `onDocumentCreated/Updated` (`firebase-functions/v2/firestore`), `onSchedule` (cron), `onMessagePublished` (Pub/Sub, e.g. Play RTDN).

## Error codes → client meaning
| Code | Use it when | Client shows |
|---|---|---|
| `unauthenticated` | no user | "inicia sesión" |
| `permission-denied` | user lacks rights | "no tienes permiso" |
| `invalid-argument` | bad input | field error |
| `not-found` | resource missing | "no existe" |
| `already-exists` | duplicate / already used | "ya usado" |
| `failed-precondition` | wrong state (e.g. purchase not acknowledged) | explain the state |
| `resource-exhausted` | rate limit / quota | "inténtalo más tarde" |
| `deadline-exceeded` | expired / timeout | "ha caducado" |
| `internal` | unexpected | generic error |
| `unavailable` | transient / wrong region / emulator in release | "sin conexión" |

## Calling from the apps
- **Flutter**: `FirebaseFunctions.instanceFor(region: 'europe-west1').httpsCallable('redeemCode').call({...})`; catch `FirebaseFunctionsException` and switch on `e.code`; cast `Map<String, dynamic>.from(result.data as Map)`; `HttpsCallableOptions(timeout: …)` for slow ones.
- **Web (JS SDK)**: `httpsCallable(getFunctions(app, 'europe-west1'), 'redeemCode')`.
- **Kotlin**: `Firebase.functions("europe-west1")` · **Swift**: `Functions.functions(region: "europe-west1")`.
- Auth before calling: if the app uses anonymous auth, `await signInAnonymously()` at startup, before any callable or Firestore access (never fire-and-forget).
- **Emulators only in debug**: wrap `useFunctionsEmulator/useFirestoreEmulator/useAuthEmulator` in `if (kDebugMode)` (web: `if (process.env.NODE_ENV === 'development')`). An emulator call left in a release build breaks every request.

## Debugging by error
| Symptom | Check, in order |
|---|---|
| `unauthenticated` | user really signed in (log uid, `getIdToken(true)`) → App Check enforced but the build doesn't pass (Play Integrity/App Attest; use **Monitoring** while testing or register a debug token) → `invoker` for anonymous auth → release-only: R8 rules, SHA fingerprints |
| `unavailable` | region mismatch client vs function → emulator active in release → function not deployed (`firebase functions:list`) |
| `not-found` | callable name typo / not deployed; for lookups, exact document id (case!) and field types (`false` boolean, not `"false"`) |
| `internal` | uncaught exception → `firebase functions:log --only <name>` |
| works in debug, fails in release / closed testing | **R8/ProGuard** stripping Firebase classes; **SHA-1/SHA-256**: with Play App Signing the installed app is signed by Google — add both the upload key and the Play app-signing certificate fingerprints in Firebase; App Check provider differs (debug vs Play Integrity) |

R8 rules (`android/app/proguard-rules.pro`) when release builds break Firebase:
```
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
-keepattributes Signature,*Annotation*,EnclosingMethod
```

## Webhooks (payment providers, POS, third parties)
- Verify the signature on the **raw body** with HMAC-SHA256 and `crypto.timingSafeEqual` (constant time); reject missing/invalid with 401 before touching data.
- Idempotency: store processed event ids; return 200 for duplicates.
- Rate-limit public endpoints (App Check can't protect server-to-server webhooks).

## Deploy & operate
```bash
firebase deploy --only functions                     # all
firebase deploy --only functions:redeemCode          # one
firebase deploy --only firestore:rules,firestore:indexes
firebase functions:list                              # names + regions
firebase functions:log --only redeemCode             # logs
firebase emulators:start --only functions,firestore,auth
```
Before deploying: region on every function · no emulator calls outside debug in any client · secrets set in the target project · `npm audit --audit-level=high` in `functions/` · rules deployed match the repo.
