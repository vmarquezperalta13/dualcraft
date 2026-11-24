# Google Play in-app purchases — Play Console, Flutter `in_app_purchase`, server verification

Field-tested in production. Used by `security-mobile` (and the payments pack). Other stacks: the same flow applies with their library (React Native: `react-native-iap` / RevenueCat; Android: Play Billing Library; KMP: platform actuals or RevenueCat).

## Play Console
- Prerequisites: app uploaded at least to **Internal testing** with a build signed by the **production upload key**; active payments profile (an individual account can't be converted to a company later).
- Products: Monetize → Products → In-app products (one-time) or Subscriptions.
  - **Product IDs are permanent** (can't be renamed or reused after deletion): `snake_case`, e.g. `premium_unlock`, `pack_party`.
  - **Status must be Active** — a draft product is never returned to the app.
  - Price in the base currency (VAT included for consumers); Play converts per country. Propagation: ~1 h for testing, up to 24 h in production.
- Types: **non-consumable** (unlock forever), **consumable** (coins, lives — consume after delivering), **subscription** (base plan + offers).

## Flutter architecture (`in_app_purchase`)
```
IapService (single instance, created at app start)
  ├─ listen to purchaseStream        ← in the ROOT widget/app init, before anything else
  ├─ load owned products from local storage (fast, offline)
  ├─ restorePurchases()              ← at launch AND from a "Restaurar compras" button
  ├─ queryProductDetails(ids)
  ├─ buy…(PurchaseParam)
  └─ _onPurchases(list)              ← the only place that changes entitlements
```
```dart
Future<void> _onPurchases(List<PurchaseDetails> purchases) async {
  for (final p in purchases) {
    switch (p.status) {
      case PurchaseStatus.pending: _showPending(); break;
      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        final ok = await _verifyOnServer(p);          // Cloud Function: verify with Google, store entitlement
        if (ok) await _grant(p.productID);            // persist locally BEFORE completing
        break;
      case PurchaseStatus.error: _showError(p.error); break;
      case PurchaseStatus.canceled: break;
    }
    if (p.pendingCompletePurchase) {                  // ALWAYS — purchased AND restored
      await InAppPurchase.instance.completePurchase(p);
    }
  }
}
```
Launch order: `listen` → load local entitlements → `restorePurchases()`.

## The classic bug: "bought, locked after restart" / "you already own this item"
| Cause | Symptom | Fix |
|---|---|---|
| A. `completePurchase()` not called (or only on `purchased`, not `restored`) | Play keeps the transaction pending; re-buy says "already owned"; refunds after 3 days | complete every purchase with `pendingCompletePurchase == true`, after granting |
| B. entitlement only in memory | unlocked until the app restarts | persist (local DB / secure prefs) before completing; load it at launch |
| C. no `restorePurchases()` at launch | locked after reinstall or clearing data | call it at launch, after the listener is active |
| listener started late (in the store screen) | events lost | start it at app init |
| `queryProductDetails` returns `notFoundIDs` | debug build, product in draft, tester not added | production-signed build from the testing track, product Active, license tester |

Diagnostic log while fixing: `productID`, `status`, `pendingCompletePurchase`, `purchaseID` per event.

## Server verification (don't skip it)
The client can be modified: never grant premium content, coins or subscription status based only on the device.
1. Client sends `{productId, purchaseToken}` to a callable (e.g. `verifyPurchase`) — authenticated.
2. The function calls the **Google Play Developer API** (`purchases.products.get` / `purchases.subscriptionsv2.get`) with a service account (secret, least privilege: "View financial data" + "Manage orders" in Play Console).
3. Checks `purchaseState`/`acknowledgementState`, product id, that the token wasn't used by another user (`used_purchase_tokens/{token}` collection, written in a transaction).
4. Writes the entitlement server-side (`users/{uid}/entitlements/{productId}`) — rules make it **read-only for the client**.
5. Acknowledges server-side if the client didn't (unacknowledged purchases are refunded after 3 days); consumes consumables after granting.
6. Subscriptions: listen to **Real-time Developer Notifications** (Pub/Sub → `onMessagePublished`) for renewals, cancellations, refunds, grace periods; revoke on refund (`voidedpurchases`).

## Testing
- Play Console → Settings → **License testing**: tester accounts buy for free, repeatably; test cards for slow approval (pending) and decline (error).
- Install from the **internal testing link** (not from the IDE) with the tester account on the device.
- Scenarios: buy → kill app → reopen (still unlocked) · uninstall → reinstall → restore · pending purchase · declined card · refund from Play Console → access revoked.

## Release checklist
Products Active · prices reviewed per country · listener at app init · `completePurchase` on purchased + restored · local persistence + load at launch · `restorePurchases` at launch and in settings · server verification + server-side entitlements · error and pending states shown · refund/revocation handled · restore button visible (store requirement) · iOS: StoreKit equivalent and "Restore Purchases".
