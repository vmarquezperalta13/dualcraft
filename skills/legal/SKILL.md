---
name: legal
description: EU/Spain privacy for apps and webs - data map from SDKs and schema, drafts of privacy, terms and cookie policies, App Store privacy, Data safety, iOS privacy manifest; checks deletion, ATT, consent. Use for "privacidad", "RGPD", "cookies", "data safety".
---

# DualCraft legal & privacy

`$LEGAL` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/legal.mjs"`, `$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.

**Always say it:** everything generated is a **draft** to review with a lawyer/DPO before publishing. You help structure and keep things consistent; you don't give legal advice. Frame: GDPR + LOPDGDD (Spain), LSSI-CE, ePrivacy (cookies), consumer law (TRLGDCU), App Store Review Guidelines 5.1, Google Play User Data policy. Other markets (US states, UK, Brazil…) → say what changes and ask before assuming.

## The rule
`.dualcraft/legal/data-map.json` is the record of processing: every personal data category the product handles, its purposes, legal basis, retention and the providers (processors) involved. Legal texts, store forms and the iOS privacy manifest are generated from it, so they can't contradict each other or the code. When a feature adds an SDK, a permission or a personal field → update the map in the same change (`$LEGAL check` fails on undeclared collection).

## 1. Build the map
1. `$LEGAL scan` → what the code collects: SDKs (Firebase Auth/Analytics/Crashlytics/Messaging, Supabase, store billing, RevenueCat, AdMob/Meta, location, camera/photos, contacts, microphone, Sentry, Mixpanel, Stripe, Google Analytics…), personal columns in the DBML schema, permissions, tracking, cookies.
2. `$LEGAL scan --write` → adds suggestions with `needsReview: true`.
3. Review each entry **with the user** (AskUserQuestion when it's a choice):
   - controller: legal name, NIF/CIF, address, contact email (and DPO if any);
   - purposes and legal basis: contract for what the service needs, consent for analytics cookies/advertising/tracking/marketing, legitimate interest for crash logs and security (state it), special categories (health…) only with explicit consent — and ask if they're really needed;
   - retention per data ("hasta que elimines tu cuenta", "26 meses", "6 años por obligación fiscal" for invoices…);
   - minimum age (14 in Spain without parental consent);
   - privacy policy URL and account deletion URL (Google Play requires a web page).
   Remove `needsReview` once confirmed. Minimize: if a data item isn't needed, propose removing it instead of declaring it.

## 2. Generate (`$LEGAL gen`)
- `docs/legal/privacy-policy.<lang>.md` (GDPR art. 13: controller, data/purpose/basis/retention table, processors, international transfers, rights + AEPD, account deletion, children, security, changes) · `terms.<lang>.md` (with purchases/subscriptions and loss of withdrawal right for digital content when `dualcraft:payments` exists) · `cookies.<lang>.md` (web with cookies).
- `docs/legal/app-store-privacy.md` → answers for App Store Connect → App Privacy · `docs/legal/google-data-safety.md` → Play Console → Data safety.
- iOS `PrivacyInfo.xcprivacy` (Flutter `ios/Runner/`, native next to the `@main` app; add it to the target in Xcode once). React Native/Expo: `app.json` → `expo.ios.privacyManifests`.
Publish the policies at stable URLs (the web or a simple hosted page) and link them from the apps (settings, sign-up, paywall) and store listings.

## 3. Check (`$LEGAL check`) — before every release
- map valid; collection found in code but not declared; processors outside the EEA without transfer mechanism; documents/manifest out of date;
- **account deletion inside the app** whenever there are accounts (App Store 5.1.1(v), Google Play) + web deletion URL;
- **ATT** prompt and `NSUserTrackingUsageDescription` when tracking on iOS; `trackingDomains`;
- iOS permission texts present and specific (camera, photos, location, contacts, microphone);
- **cookie consent banner** when the web sets non-essential cookies (nothing non-essential before accepting; Google Consent Mode v2 with Google tags);
- link to the privacy policy in the apps.
Also: `node "${CLAUDE_PLUGIN_ROOT}/scripts/analytics.mjs" check` (no personal data in events) and `dualcraft:security-global` (protection measures the policy promises).

## 4. Implementation notes
- Account deletion = delete the auth user **and** their data (Firestore/Supabase rows, Storage files, push devices, RevenueCat customer) server-side (a callable from `dualcraft:backend`), confirm with re-authentication, explain what's kept by law. Subscriptions aren't cancelled by deleting the account — tell the user to cancel in the store.
- Consent in apps: analytics/ads SDKs start disabled until consent where the basis is consent (`setAnalyticsCollectionEnabled(false)`, Google UMP for AdMob in the EEA); store the choice and offer to change it in settings.
- Brain: decision for each legal basis choice and retention; tasks for console forms (App Privacy, Data safety), publishing URLs, the professional review, and DPAs signed with each processor.
