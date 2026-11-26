---
name: push
description: Push notifications with FCM (Android, iOS, web) from one catalog - channels, topics, typed notifications with deep links, texts per device language, registration, typed senders and parsers per stack. Use for "notificaciones push", "avisar al usuario", "FCM".
---

# DualCraft push

`$PUSH` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/push.mjs"`, `$BE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/backend.mjs"`, `$I18N` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs"`. Talk in the user's language.
Playbook — follow it: `${CLAUDE_PLUGIN_ROOT}/references/push-notifications.md` (FID vs tokens, permission timing, channels, iOS setup, delivery, testing).

## The rule
Every notification is declared in `.dualcraft/push/notifications.json` and its texts live in `.dualcraft/i18n/<locale>.json` under `push.<id>.title` / `push.<id>.body`. The server sends only through the generated `push.<name>(params)`; the apps read pushes only through the generated `PushMessage.parse(data)`. Names, params, routes and texts can't drift between server, Android, iOS and web.

## 1. Setup (once)
Prerequisite: backend contract (`dualcraft:backend`). `$PUSH init` →
- catalog with a first channel; `registerDevice` / `unregisterDevice` callables in the contract (one owner per app instance; FID or legacy token);
- Firebase: `functions/src/push/send.ts` (`sendToUser` per language, dead-id cleanup, `sendToTopic`), the two callables, the collection-group index on `devices.pushId`;
- Flutter: `lib/services/push_service.dart` — add `firebase_messaging` (≥ 17) and `flutter_local_notifications` to pubspec;
- prints the Firestore rule (devices closed to clients).
Supabase / own server: device callables get a generic scaffold; send with the FCM HTTP v1 API (reference).
Console tasks for the brain (the user does them): APNs key in Firebase, Push Notifications + Background Modes capabilities in Xcode, notification icon, test devices.

## 2. Design a notification (with the user)
Ask: what event, who receives it (one user / a topic), is it urgent, what screen opens, can a newer one replace it, when is it useless.
```json
{"id": "match_started", "channel": "matches", "description": "Empieza un partido que sigues",
 "params": {"matchId": {"type": "string", "required": true}, "home": {"type": "string"}},
 "route": "/matches/{matchId}", "priority": "high", "collapse": "match_{matchId}", "ttl": 3600}
```
- Channels (`id`, `name` shown in Android settings, `importance` min|low|normal|high|max) group by what the user may want to silence — matches vs offers. Marketing never shares a channel with transactional pushes.
- Texts with `dualcraft:i18n` in every locale: `"push": {"match_started": {"title": "¡Empieza!", "body": "{home} ya está jugando"}}` — ICU params and plurals work.
- Topics (`news` → `news_<locale>`) for broadcasts the user opts into.
- No personal data in texts or params (lock screen). Respect the user's in-app preferences when sending.
Then `$PUSH gen` (or `$PUSH check` to see what's missing).

## 3. Send (server)
```ts
import { push } from './generated/push'
import { sendToUser, sendToTopic } from './push/send'
await sendToUser(uid, push.matchStarted({ matchId, home }))   // each device in its language
await sendToTopic('news', push.weeklyOffer())
```
Usually from a trigger or a scheduled function (`dualcraft:backend add … --kind trigger`), idempotent (a trigger can run twice: use `collapse` or record what was sent).

## 4. Receive (apps)
- **Flutter**: `PushService(api, onOpen: (m) => router.go(m.route ?? '/'), onForeground: showBanner)`; `init()` after sign-in; `requestPermission()` at the right moment; `signOut()` before signing out. `switch (m) { MatchStartedPush(:final matchId) => … }`.
- **Android (Kotlin/KMP)**: `FirebaseMessagingService.onNewToken` → `registerDevice(pushIdType = token)` (or the FID API when your SDK has it); create `PushChannel.entries` at start; `PushMessage.parse(remoteMessage.data)` in the activity intent / service. `POST_NOTIFICATIONS` in the manifest and at runtime.
- **iOS (SwiftUI)**: `Messaging.messaging()` delegate → `registerDevice`; `UNUserNotificationCenter` delegate → `PushMessage.parse(response.notification.request.content.userInfo)`.
- **React Native**: `@react-native-firebase/messaging` + `parsePush(remoteMessage.data)`; Notifee for Android channels.

## 5. Verify
- `$PUSH check` → catalog + texts in every locale, server pieces, client: permission request, id changes handled (`onRegistered`), cold-start opening, registration through `registerDevice`, iOS entitlements, Android icon/permission. Plus `$BE check`.
- Test matrix from the reference (closed/background/foreground × platform, sign-out + other account, two languages).
- Brain: decision for channels and the permission moment; tasks for the console setup; marketing gets a note for push campaigns (topics) — `dualcraft:marketing`.

Routes: every notification `route` must be an app route of `dualcraft:links` (its check fails otherwise); open them with the generated parser.
