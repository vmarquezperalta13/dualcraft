# RevenueCat — when, setup, client SDKs, webhook

Used by `dualcraft:payments` (mode `revenuecat`). Native alternative: `play-billing.md` + `app-store-iap.md`.

## When it pays off
| Choose RevenueCat when | Choose native when |
|---|---|
| subscriptions on both stores and you want one source of truth fast | revenue is high enough that the fee matters |
| you want paywall A/B tests, charts, cohort and churn data | you only sell a few one-time products |
| no server-side purchase code to maintain | you already run Cloud Functions and want no third party with purchase data |
Cost: free up to a monthly revenue threshold, then a percentage of tracked revenue (check current pricing). Record the choice as a decision.

## Setup
1. Project → apps: Google Play (package name + a **service account JSON** with Play Console financial access) and App Store (bundle id + **In-App Purchase key** / App Store Connect API key, shared secret).
2. **Products**: import the store products — the ids must be the ones in `products.json` (`android` / `ios`).
3. **Entitlements**: same ids as `products.json` → `entitlements` (e.g. `premium`), attach the products.
4. **Offerings**: packages (`$rc_monthly`, `$rc_annual`, lifetime) shown by the paywall.
5. **Webhook**: Integrations → Webhooks → URL of `revenuecatWebhook`, Authorization header `Bearer <secret>`; set the same secret on the server (`firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET` / `supabase secrets set …`).

## Client
- SDKs: Flutter `purchases_flutter` (+ `purchases_ui_flutter` for paywalls), React Native `react-native-purchases`, Android `com.revenuecat.purchases:purchases`, iOS `RevenueCat` (SPM), KMP `purchases-kmp`.
- Configure once at launch with the **public** SDK key per platform (never the secret API key).
- **Identify the user**: after sign-in `Purchases.logIn(uid)` (Firebase/Supabase user id) — the webhook writes to that uid; anonymous RevenueCat ids are ignored by the DualCraft webhook. On sign-out `Purchases.logOut()`.
- Unlock from `customerInfo.entitlements.active['premium']` (listen to customer info updates) and/or from `users/{uid}/entitlements` written by the webhook — the server copy is what your backend rules and functions trust.
- Restore: `Purchases.restorePurchases()` behind a visible button.
- Consumables: RevenueCat reports them (`NON_RENEWING_PURCHASE`); the webhook credits `grants` from `products.json` once per event.

## Webhook events
`INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION` (auto-renew off — still active until `expiration_at_ms`), `UNCANCELLATION`, `BILLING_ISSUE`, `SUBSCRIPTION_PAUSED`, `EXPIRATION`, `NON_RENEWING_PURCHASE`, `TRANSFER`. Idempotent by `event.id`; RevenueCat retries non-2xx responses. For a full refresh of one user call the REST API `GET /v1/subscribers/{app_user_id}` with the secret key from the server.

## Testing
Sandbox purchases from both stores show up in RevenueCat with `environment: SANDBOX`; send a test event from the webhook settings page. Same store test setup as native (license testers on Play, sandbox accounts on iOS).
