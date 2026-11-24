# Push notifications — FCM, permissions, channels, delivery

Used by `dualcraft:push`. Server functions: `firebase-functions.md`.

## Targets: FID first
- FCM now targets the **Firebase Installation ID (FID)** of each app instance. Flutter `firebase_messaging` ≥ 17: `register()` → `onRegistered` (the FID) / `unregister()` → `onUnregistered`; `getToken`/`onTokenRefresh`/`deleteToken` are deprecated. Admin SDK ≥ 14: `send({ fid })`, `sendEachForMulticast({ fids })`.
- Registration tokens still work for SDKs that only expose tokens (older native SDKs, some React Native libraries): DualCraft stores `pushIdType: 'token'` and sends them with `tokens`.
- One app instance belongs to one user: `registerDevice` removes the id from any previous owner; call `unregisterDevice` + `unregister()` on sign-out.
- Dead ids (`installation-id-not-registered`, `registration-token-not-registered`) are deleted when a send reports them.

## Permission (the moment matters)
- iOS always asks; Android 13+ needs `POST_NOTIFICATIONS` at runtime. You get **one** system prompt — ask after the user sees the value ("¿Te avisamos cuando empiece tu partido?"), with a pre-prompt screen; never at first launch.
- iOS **provisional** authorization delivers quietly to the notification center without a prompt — good for low-urgency apps.
- If denied, offer a path to Settings from the app's notification preferences; don't nag.
- In-app preferences per channel/topic (store them server-side and respect them when sending).

## Android
- **Channels** (Android 8+): created by the app at start (`PushChannel` from the catalog); the user controls each in system settings. Importance can't be raised after creation — pick it carefully, change the channel id to change it.
- Default icon: a white silhouette `ic_notification` + `com.google.firebase.messaging.default_notification_icon` (and `default_notification_color`) meta-data in the manifest, or Android shows a grey square.
- Foreground: FCM doesn't display notification messages while the app is open — show an in-app banner (`onForeground`).
- `priority: high` only for user-visible, time-sensitive messages; abusing it gets the app deprioritized.

## iOS
- Xcode → Signing & Capabilities: **Push Notifications** (adds `aps-environment` to the entitlements) and **Background Modes → Remote notifications**.
- Upload an **APNs authentication key** (.p8) in Firebase → Project settings → Cloud Messaging (one key works for all apps of the team, no yearly renewal).
- Simulator receives pushes on Apple silicon with iOS 16+; test on a device before release anyway.
- `apns-collapse-id` replaces a previous notification; `thread-id` groups them (DualCraft uses the channel).

## Messages
- Notification messages (title/body shown by the system) + `data` (strings only) with `type`, `route` and the params: the app parses `data` with the generated `PushMessage` and navigates to `route`.
- Texts come from the shared i18n (`push.<id>.title/body`) rendered on the server in the device's locale (stored at registration). Titles ≤ ~65 chars, bodies ≤ ~178 before truncation.
- `collapse` key for updates of the same thing (live score), `ttl` for things that are useless later (a match that already started).
- Payload limit 4 KB. No personal or sensitive data in pushes — they show on the lock screen.
- Topics for broadcast (`news_<locale>`); per-user sends through `sendToUser`. Large campaigns: use topics or batches, not a loop of single sends.

## Deep links & opening
- Three entry points: app closed (`getInitialMessage`), background (`onMessageOpenedApp`), foreground tap on your banner. All go through `PushService.onOpen` → router.
- Validate the route like any deep link (the user may not be allowed to see it any more).

## Testing
- Firebase console → Messaging → "Send test message" to a token/FID; or a small callable/admin script calling `sendToUser`.
- Matrix: app closed / background / foreground × Android / iOS · permission denied then granted · sign-out then another account signs in (the first one must stop receiving) · reinstall (new FID registered) · two languages.

## Supabase / own server
No Admin SDK there: send with the **FCM HTTP v1 API** (`POST https://fcm.googleapis.com/v1/projects/<id>/messages:send`, OAuth token of a service account with the `firebase.messaging` scope), same payload shape as `push/send.ts`.
