// Scaffolds for `push.mjs init` (Firebase Cloud Messaging): created once, owned by the developer afterwards.
// FCM targets Firebase Installation IDs (FIDs); legacy registration tokens are still accepted for SDKs that only give tokens.
// Generated code avoids template literals so these JS templates stay readable.

export const firebaseSend = `// Sending push notifications with FCM (DualCraft push). Yours: adapt freely.
//
// Devices: users/{uid}/devices/{id} { pushId, pushIdType: 'fid' | 'token', platform, locale, appVersion, updatedAt }
// — written only by registerDevice. FIDs (Firebase Installation IDs) are the current FCM target; tokens are legacy.
// Topics are per language: <topic>_<locale> (clients subscribe to the one of their locale).
import { getMessaging, type BaseMessage, type BatchResponse } from 'firebase-admin/messaging'
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore'
import { DEFAULT_LOCALE, LOCALES, render, type PushPayload } from '../generated/push'

const DEAD = ['messaging/installation-id-not-registered', 'messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']

function message(p: PushPayload, locale: string): BaseMessage {
  const { title, body, data } = render(p, locale)
  return {
    notification: { title, body },
    data, // every value is a string; the apps parse it with the generated PushMessage
    android: {
      priority: p.priority === 'high' ? 'high' : 'normal',
      ...(p.ttlSeconds ? { ttl: p.ttlSeconds * 1000 } : {}),
      ...(p.collapseKey ? { collapseKey: p.collapseKey } : {}),
      notification: { channelId: p.channel, ...(p.collapseKey ? { tag: p.collapseKey } : {}) },
    },
    apns: {
      headers: {
        'apns-priority': p.priority === 'high' ? '10' : '5',
        ...(p.collapseKey ? { 'apns-collapse-id': p.collapseKey } : {}),
        ...(p.ttlSeconds ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + p.ttlSeconds) } : {}),
      },
      payload: { aps: { sound: 'default', threadId: p.channel } },
    },
  }
}

interface Device { id: string; type: 'fid' | 'token'; ref: DocumentReference }

/** Sends to every device of a user, each in its language; removes ids FCM reports as dead. */
export async function sendToUser(uid: string, p: PushPayload): Promise<{ sent: number; failed: number; removed: number }> {
  const devices = await getFirestore().collection('users').doc(uid).collection('devices').get()
  const groups = new Map<string, Device[]>()
  for (const d of devices.docs) {
    const id = d.get('pushId') as string | undefined
    if (!id) continue
    const type = d.get('pushIdType') === 'token' ? 'token' : 'fid'
    const loc = LOCALES.includes(String(d.get('locale'))) ? String(d.get('locale')) : DEFAULT_LOCALE
    const key = loc + '|' + type
    groups.set(key, [...(groups.get(key) ?? []), { id, type, ref: d.ref }])
  }
  let sent = 0; let failed = 0; let removed = 0
  for (const [key, list] of groups) {
    const [loc, type] = key.split('|')
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      const ids = chunk.map((x) => x.id)
      const res: BatchResponse = type === 'token'
        ? await getMessaging().sendEachForMulticast({ ...message(p, loc), tokens: ids })
        : await getMessaging().sendEachForMulticast({ ...message(p, loc), fids: ids })
      sent += res.successCount; failed += res.failureCount
      await Promise.all(res.responses.map(async (r, j) => {
        if (!r.success && r.error && DEAD.includes(r.error.code)) { removed++; await chunk[j].ref.delete() }
      }))
    }
  }
  return { sent, failed, removed }
}

/** Sends to a topic in every language (devices subscribe to <topic>_<their locale>). */
export async function sendToTopic(topic: string, p: PushPayload): Promise<void> {
  await Promise.all(LOCALES.map((loc) => getMessaging().send({ ...message(p, loc), topic: topic + '_' + loc })))
}
`

export const firebaseRegister = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { REGION, ApiInputError, parseRegisterDeviceInput, type RegisterDeviceInput, type RegisterDeviceOutput } from './generated/api'

/** Stores this app instance's push id (FID, or a legacy token) for the signed-in user. Called on registration and after sign-in. */
export const registerDevice = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<RegisterDeviceOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  let input: RegisterDeviceInput
  try { input = parseRegisterDeviceInput(request.data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
  const db = getFirestore()
  const id = createHash('sha256').update(input.pushId).digest('hex').slice(0, 40)
  // one app instance → one user: drop the id from whoever had it before (shared devices, account switch)
  const previous = await db.collectionGroup('devices').where('pushId', '==', input.pushId).get()
  const batch = db.batch()
  for (const d of previous.docs) if (d.ref.parent.parent?.id !== uid) batch.delete(d.ref)
  batch.set(db.collection('users').doc(uid).collection('devices').doc(id), { pushId: input.pushId, pushIdType: input.pushIdType, platform: input.platform, locale: input.locale ?? null, appVersion: input.appVersion ?? null, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()
  return {}
})
`

export const firebaseUnregister = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { REGION, ApiInputError, parseUnregisterDeviceInput, type UnregisterDeviceInput, type UnregisterDeviceOutput } from './generated/api'

/** Forgets this app instance's push id (sign-out, notifications turned off in the app). */
export const unregisterDevice = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<UnregisterDeviceOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  let input: UnregisterDeviceInput
  try { input = parseUnregisterDeviceInput(request.data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
  const id = createHash('sha256').update(input.pushId).digest('hex').slice(0, 40)
  await getFirestore().collection('users').doc(uid).collection('devices').doc(id).delete()
  return {}
})
`

export const flutterPushService = `// Push notifications for Flutter (FCM) following the DualCraft push playbook. Yours after creation.
// Needs firebase_messaging (≥ 17: Firebase Installation ID registration) and flutter_local_notifications (Android channels).
// Create it once after Firebase.initializeApp() and sign-in; call init() at start and requestPermission() at a meaningful moment.
import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../generated/api_client.dart';
import '../generated/push_catalog.dart';

class PushService {
  PushService(this._api, {required this.onOpen, this.onForeground, FirebaseMessaging? messaging})
      : _messaging = messaging ?? FirebaseMessaging.instance;

  final Api _api;
  final FirebaseMessaging _messaging;

  /// The user tapped a notification (cold start, background or foreground): navigate to message.route.
  final void Function(PushMessage message) onOpen;

  /// A notification arrived with the app open: show an in-app banner (the system doesn't show it on Android).
  final void Function(PushMessage message, RemoteNotification? notification)? onForeground;

  final List<StreamSubscription<Object?>> _subs = [];
  String? _fid;

  Future<void> init() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = FlutterLocalNotificationsPlugin().resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      for (final c in PushChannel.values) {
        await android?.createNotificationChannel(AndroidNotificationChannel(c.id, c.label, description: c.description, importance: _importance(c.importance)));
      }
    }
    await _messaging.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true); // iOS
    _subs.add(FirebaseMessaging.onMessage.listen((m) {
      final msg = PushMessage.parse(m.data);
      if (msg != null) onForeground?.call(msg, m.notification);
    }));
    _subs.add(FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(m.data)));
    _subs.add(_messaging.onRegistered.listen(_register)); // first registration and every id change
    _subs.add(_messaging.onUnregistered.listen(_forget));
    final initial = await _messaging.getInitialMessage(); // opened from a terminated state
    if (initial != null) _open(initial.data);
    final settings = await _messaging.getNotificationSettings();
    if (_granted(settings.authorizationStatus)) await _messaging.register();
  }

  /// Ask when the user understands the value ("¿Te avisamos cuando empiece el partido?"), never at first launch.
  Future<bool> requestPermission() async {
    final s = await _messaging.requestPermission();
    final ok = _granted(s.authorizationStatus);
    if (ok) await _messaging.register();
    return ok;
  }

  /// Topics are per language: <topic>_<locale>.
  Future<void> subscribe(PushTopic topic, String locale) => _messaging.subscribeToTopic(topic.forLocale(locale));
  Future<void> unsubscribe(PushTopic topic, String locale) => _messaging.unsubscribeFromTopic(topic.forLocale(locale));

  /// Call before signing out so the next user of this phone doesn't get this user's notifications.
  Future<void> signOut() async {
    final fid = _fid;
    if (fid != null) await _forget(fid);
    await _messaging.unregister();
  }

  Future<void> _register(String fid) async {
    _fid = fid;
    try {
      await _api.registerDevice(RegisterDeviceInput(
        pushId: fid,
        pushIdType: RegisterDevicePushIdType.fid,
        platform: switch (defaultTargetPlatform) {
          TargetPlatform.iOS => RegisterDevicePlatform.ios,
          TargetPlatform.android => RegisterDevicePlatform.android,
          _ => RegisterDevicePlatform.web,
        },
        locale: WidgetsBinding.instance.platformDispatcher.locale.languageCode,
      ));
    } catch (e) {
      debugPrint('registerDevice: \$e'); // retried on the next start (register() emits onRegistered again)
    }
  }

  Future<void> _forget(String fid) async {
    try {
      await _api.unregisterDevice(UnregisterDeviceInput(pushId: fid));
    } catch (e) {
      debugPrint('unregisterDevice: \$e');
    }
  }

  void _open(Map<String, dynamic> data) {
    final msg = PushMessage.parse(data);
    if (msg != null) onOpen(msg);
  }

  bool _granted(AuthorizationStatus s) => s == AuthorizationStatus.authorized || s == AuthorizationStatus.provisional;

  Importance _importance(PushImportance i) => switch (i) {
        PushImportance.min => Importance.min,
        PushImportance.low => Importance.low,
        PushImportance.normal => Importance.defaultImportance,
        PushImportance.high => Importance.high,
        PushImportance.max => Importance.max,
      };

  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
  }
}
`
