# App Store in-app purchases — App Store Connect, StoreKit 2, server verification

Used by `dualcraft:payments`. Google Play side: `play-billing.md`. Managed alternative: `revenuecat.md`.

## App Store Connect
- Prerequisites: **Paid Apps Agreement** active (Business → Agreements, tax and banking) — without it no product loads, even in sandbox.
- Products: app → Monetization → **In-App Purchases** (consumable / non-consumable) or **Subscriptions** (inside a **subscription group**: one active subscription per group; levels decide upgrade/downgrade).
  - **Product IDs are permanent** and can't be reused after deletion: reverse-DNS works well (`com.acme.app.premium.monthly`); DualCraft keeps it in `products.json` → `ios`.
  - Each product needs a reference name, price, localized display name/description and a review screenshot; the first ones are submitted **with an app version**.
- Introductory offers (free trial) live on the subscription; one per user per group.
- **Apple ID** of the app (App Information) → `apple.appAppleId` in products.json (needed to verify production transactions).

## Client (StoreKit 2)
- Native iOS: `Product.products(for:)`, `try await product.purchase(options: [.appAccountToken(uuidOfUser)])`, check `VerificationResult`, send `transaction.jwsRepresentation` to the server, then `await transaction.finish()`.
- Listen to `Transaction.updates` **from app launch** (renewals, Ask to Buy approvals, purchases made on another device) — a missed one is a paid but locked purchase.
- Current entitlements: `Transaction.currentEntitlements`; restore: `try await AppStore.sync()` behind a visible **"Restaurar compras"** button (App Review rejects apps without it, guideline 3.1.1).
- Flutter `in_app_purchase`: on iOS make sure **StoreKit 2** is used so `verificationData.serverVerificationData` is the signed transaction (JWS); the server rejects StoreKit 1 receipts with `storekit2_required`. Call `completePurchase` after the server granted (it finishes the transaction).
- Never unlock from the client's view of the transaction alone: the server verifies the JWS signature and records the entitlement.

## Server verification (`verifyPurchase`, scaffolded by DualCraft)
- `@apple/app-store-server-library` → `SignedDataVerifier(appleRootCAs, enableOnlineChecks, environment, bundleId, appAppleId)`; `verifyAndDecodeTransaction(jws)` checks the certificate chain up to Apple's roots, the bundle id and the environment.
- Root certificates: download `AppleRootCA-G3.cer` (and `AppleIncRootCertificate.cer`, `AppleComputerRootCertificate.cer`) from https://www.apple.com/certificateauthority/ into `functions/certs/`.
- Try **production first, then sandbox** (TestFlight and review builds use sandbox).
- Idempotency key: `originalTransactionId` for subscriptions and non-consumables (same across renewals and restores), `transactionId` for consumables.
- `appAccountToken` (a UUID you set at purchase) lets the server match purchases to users; DualCraft matches through `purchase_tokens` instead, so it works with Flutter too.

## App Store Server Notifications V2
- App Store Connect → App Information → **Production and Sandbox Server URL** → the `appStoreNotifications` function URL (version 2).
- Payload `{ signedPayload }`: verify with `verifyAndDecodeNotification`, then decode `data.signedTransactionInfo`.
- Types that matter: `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS` (auto-renew off: still active until expiry), `DID_FAIL_TO_RENEW` (+ `GRACE_PERIOD` subtype), `GRACE_PERIOD_EXPIRED`, `EXPIRED`, `REFUND`, `REVOKE` (Family Sharing removed), `CONSUMPTION_REQUEST` (Apple asks about a consumable refund).
- Answer 200 quickly; Apple retries failures. Re-derive the state from the transaction (expiresDate, revocationDate), don't trust the order of notifications.

## Testing
- **Sandbox** testers (Users and Access → Sandbox) on a device: Settings → App Store → Sandbox Account. Renewals are accelerated (1 month ≈ 5 minutes, 12 renewals max).
- **StoreKit configuration file** in Xcode for local tests without App Store Connect (transactions are not verifiable by the server — use sandbox for end-to-end).
- **TestFlight** uses sandbox purchases.
- Scenarios: buy → kill → reopen (unlocked) · delete app → reinstall → restore · Ask to Buy (pending) · auto-renew off → expires · refund (sandbox "Request refund") → revoked.

## Release checklist
Paid Apps Agreement · products "Ready to Submit" and attached to the version · restore button · prices per storefront · subscription terms, price and renewal shown before purchase with links to Terms and Privacy (guideline 3.1.2) · `Transaction.updates` listener at launch · server verification + notifications URL · root certificates deployed · `appAppleId` set · no external payment links for digital content (3.1.1; region-specific exceptions need entitlements).
