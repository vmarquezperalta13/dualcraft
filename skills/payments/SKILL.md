---
name: payments
description: In-app purchases on Google Play and the App Store from one catalog - subscriptions, unlocks, consumables; server verification and store notifications, or RevenueCat; typed catalogs per stack. Use for "compras in-app", "suscripción", "premium", "RevenueCat".
---

# DualCraft payments

`$PAY` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/payments.mjs"`, `$BE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/backend.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.
Playbooks — follow them: Google Play `${CLAUDE_PLUGIN_ROOT}/references/play-billing.md` · App Store `${CLAUDE_PLUGIN_ROOT}/references/app-store-iap.md` · RevenueCat `${CLAUDE_PLUGIN_ROOT}/references/revenuecat.md`.

## Rules that are never skipped
1. **The server grants, the client asks.** Entitlements and balances are written only by the server (verification or store/RevenueCat webhooks); clients can read them, never write them. `check` fails on client code that writes `entitlements`.
2. **Every purchase is completed** (purchased *and* restored) once the server granted it; a transient server failure leaves it pending so the store redelivers it.
3. **Listener at app start, restore at app start and behind a visible "Restaurar compras" button.**
4. **One purchase belongs to one user** (`purchase_tokens/{key}`): a token reused from another account is rejected.
5. Store product ids are permanent — agree them before creating anything in the consoles.
6. Digital content in the apps is sold only through store billing (Play policy, App Store 3.1.1); physical goods/services may use other payments.

## 1. Mode (once per project — record a decision, area payments)
Ask (AskUserQuestion) with a recommendation:
- **native**: Play Developer API + App Store Server Library verified in your Cloud Functions, Play RTDN and App Store Server Notifications. No fees beyond the stores, more code you own. Scaffolded for **Firebase**; on Supabase/own server prefer RevenueCat or write `verifyPurchase` by hand from the references.
- **revenuecat**: their SDK on the clients, a webhook mirrors entitlements to your DB. Fastest for subscriptions on both stores, paywalls and analytics; a revenue share above their free tier.
Prerequisite: a backend contract (`dualcraft:backend` → `$BE init`).

## 2. Catalog (`.dualcraft/payments/products.json`)
Design it with the user from the business model (what is free, what is premium, which plans, trial, coin packs):
```json
{"mode": "native", "android": {"packageName": "com.acme.app"}, "apple": {"bundleId": "com.acme.app", "appAppleId": 1234567890},
 "entitlements": [{"id": "premium", "description": "Todo desbloqueado"}],
 "currencies": [{"id": "coins", "description": "Monedas"}],
 "products": [
  {"id": "premium_monthly", "type": "subscription", "entitlement": "premium", "period": "P1M", "trial": "P7D",
   "android": "premium", "basePlan": "monthly", "ios": "com.acme.app.premium.monthly", "description": "Premium mensual"},
  {"id": "premium_lifetime", "type": "nonConsumable", "entitlement": "premium"},
  {"id": "coins_100", "type": "consumable", "grants": {"coins": 100}}]}
```
- `id` is the canonical id used in code; `android` / `ios` are the store ids when they differ (Play subscriptions: one subscription id with several `basePlan`s).
- Subscriptions and non-consumables unlock an **entitlement** (the code asks "has premium?", never "bought product X?"); consumables **grant** currency.
- `$PAY init --mode native|revenuecat` → detects package name / bundle id from the projects, scaffolds the server and (Flutter, native) `lib/services/purchase_service.dart`, adds the server functions to the backend contract, prints the Firestore rules to merge.
- After every catalog change: `$PAY gen` → typed catalog per stack (`PaymentsCatalog` / `products`), server catalog, `verifyPurchase` product list, backend clients.

## 3. Server (native, Firebase)
Scaffolded once, yours afterwards:
| File | Does |
|---|---|
| `functions/src/payments/stores.ts` | Play Developer API (service account of Functions invited in Play Console), App Store `SignedDataVerifier` (root certs in `functions/certs/`), `applyGrant` (transaction: one owner per purchase, entitlement sources, wallet increments once) |
| `verifyPurchase.ts` | callable: verifies with the store, grants, then acknowledges (Play) or consumes (Play consumables) |
| `playRtdn.ts` | Pub/Sub topic `play-rtdn`: renewals, cancellations, refunds (voided) |
| `appStoreNotifications.ts` | App Store Server Notifications V2 (signature verified with Apple's chain) |
RevenueCat mode: `revenuecatWebhook` (Firebase) or `supabase/functions/revenuecat-webhook` (shared secret, idempotent by event id).
Setup tasks to put in the brain (they need the consoles, the user does them): invite the service account in Play Console · create the `play-rtdn` topic and set it in Play Console → Monetization setup (grant `google-play-developer-notifications@system.gserviceaccount.com` Publisher) · download Apple root certificates · set the App Store notifications URL · `appAppleId` · Paid Apps Agreement / payments profile.

## 4. Clients
- **Flutter (native)**: create `PurchaseService(api, cache)` once at start, after sign-in; `init()` before any store screen; `buy(PaymentsCatalog.premiumMonthly)`, `has(Entitlement.premium)`, `restore()`. Implement `EntitlementCache` (local storage, or listen to `users/{uid}/entitlements`). iOS needs StoreKit 2 (signed transactions).
- **Native iOS / Android / KMP / React Native**: same flow with StoreKit 2 / Play Billing Library / `react-native-iap` — send the Play purchase token or `transaction.jwsRepresentation` to `api.verifyPurchase`, then finish/acknowledge. Details in the references.
- **RevenueCat**: SDK per platform, `Purchases.logIn(uid)` after sign-in, entitlement ids identical to the catalog.
- Paywall copy (prices from the store's localized `ProductDetails`, never hard-coded), subscription terms and links to Terms/Privacy before purchase — `dualcraft:i18n` for texts.

## 5. Verify before release
- `$PAY check` (catalog, server pieces, client: listener, restore, server verification, no client-side grants, consumables) and `$BE check`.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs"` (IAP rules: `completePurchase`, `restorePurchases`).
- Test matrix from the references on real devices: buy → kill → reopen · reinstall → restore · pending · declined · refund → revoked · subscription expiry · same purchase on a second account → rejected.
- Deploy order: rules + functions to dev → test with license testers / sandbox → prod, **before** the app version that sells.
- Brain: decision (mode, entitlements model), tasks for console setup and store review (screenshots of products, paywall), marketing ideas for launch offers (`dualcraft:marketing`).
