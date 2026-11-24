// Scaffolds for `payments.mjs init`: created once, owned by the developer afterwards.
// Native mode (Firebase): server verification with the Google Play Developer API and the App Store Server Library,
// Play RTDN and App Store Server Notifications V2. RevenueCat mode: a webhook that mirrors entitlements.
// Generated code avoids template literals so these JS templates stay readable.

export const firebaseStores = `// Store access and entitlement bookkeeping for purchases (DualCraft payments). Yours: adapt freely.
//
// Firestore layout (rules: entitlements read-only for their owner, purchase_tokens closed to clients):
//   users/{uid}/entitlements/{entitlement}  { active, expiresAt, sources: { <purchaseKey>: { productId, platform, active, expiresAt } } }
//   users/{uid}.wallet.<currency>            consumable balances (only the server increments them)
//   purchase_tokens/{purchaseKey}            { uid, productId, platform } — one purchase can only ever belong to one user
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GoogleAuth } from 'google-auth-library'
import { Environment, SignedDataVerifier, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { APP_APPLE_ID, BUNDLE_ID, PACKAGE_NAME, PRODUCTS, type CatalogProduct } from '../generated/payments'

export type StorePlatform = 'android' | 'ios'
export const purchaseKey = (platform: StorePlatform, id: string) => platform + '_' + createHash('sha256').update(id).digest('hex').slice(0, 40)

// ---------------------------------------------------------------- Google Play Developer API
// Invite the Cloud Functions service account in Play Console → Users and permissions
// ("View financial data" + "Manage orders and subscriptions"). No key file needed.
const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] })
const PLAY = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE_NAME + '/purchases/'
async function play<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const res = await google.request<T>({ url: PLAY + path, method })
  return res.data
}
export interface PlayProductPurchase { purchaseState?: number; consumptionState?: number; acknowledgementState?: number; orderId?: string }
export interface PlaySubscription { subscriptionState?: string; acknowledgementState?: string; linkedPurchaseToken?: string; lineItems?: { productId?: string; expiryTime?: string }[] }
const enc = encodeURIComponent
export const playProduct = (productId: string, token: string) => play<PlayProductPurchase>('products/' + enc(productId) + '/tokens/' + enc(token))
export const playSubscription = (token: string) => play<PlaySubscription>('subscriptionsv2/tokens/' + enc(token))
export const playAcknowledgeProduct = (productId: string, token: string) => play<unknown>('products/' + enc(productId) + '/tokens/' + enc(token) + ':acknowledge', 'POST')
export const playAcknowledgeSubscription = (subscriptionId: string, token: string) => play<unknown>('subscriptions/' + enc(subscriptionId) + '/tokens/' + enc(token) + ':acknowledge', 'POST')
export const playConsume = (productId: string, token: string) => play<unknown>('products/' + enc(productId) + '/tokens/' + enc(token) + ':consume', 'POST')
export const PLAY_ACTIVE = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']
/** The store said the token is invalid / not found (not a transient failure). */
export const isRejectedByStore = (e: unknown) => [400, 404, 410].includes(Number((e as { response?: { status?: number } }).response?.status))

// ---------------------------------------------------------------- App Store (StoreKit 2 signed transactions)
// Put Apple's root certificates (AppleRootCA-G3.cer, AppleComputerRootCertificate.cer, AppleIncRootCertificate.cer from
// https://www.apple.com/certificateauthority/) in functions/certs/. APP_APPLE_ID (App Store Connect → App Information) is
// required to verify production transactions.
let verifiers: SignedDataVerifier[] | null = null
function appleVerifiers(): SignedDataVerifier[] {
  if (verifiers) return verifiers
  const dir = join(__dirname, '..', '..', 'certs')
  const roots = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cer')).map((f) => readFileSync(join(dir, f))) : []
  if (!roots.length) throw new HttpsError('failed-precondition', 'apple_root_certificates_missing')
  verifiers = []
  if (APP_APPLE_ID !== undefined) verifiers.push(new SignedDataVerifier(roots, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID))
  verifiers.push(new SignedDataVerifier(roots, true, Environment.SANDBOX, BUNDLE_ID))
  return verifiers
}
export async function appleTransaction(jws: string): Promise<JWSTransactionDecodedPayload> {
  if (!jws.includes('.')) throw new HttpsError('failed-precondition', 'storekit2_required') // a StoreKit 1 receipt, not a signed transaction
  let last: unknown
  for (const v of appleVerifiers()) { try { return await v.verifyAndDecodeTransaction(jws) } catch (e) { last = e } }
  console.warn('apple transaction rejected', last)
  throw new HttpsError('invalid-argument', 'invalid_apple_transaction')
}
export async function appleNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  let last: unknown
  for (const v of appleVerifiers()) { try { return await v.verifyAndDecodeNotification(signedPayload) } catch (e) { last = e } }
  console.warn('apple notification rejected', last)
  throw new HttpsError('invalid-argument', 'invalid_apple_notification')
}

// ---------------------------------------------------------------- entitlements & wallet
interface Source { productId: string; platform: string; active: boolean; expiresAt: Timestamp | null }
function summarize(sources: Record<string, Source>) {
  const now = Date.now()
  const live = Object.values(sources).filter((s) => s.active && (!s.expiresAt || s.expiresAt.toMillis() > now))
  const forever = live.some((s) => !s.expiresAt)
  const until = live.reduce<Timestamp | null>((m, s) => (s.expiresAt && (!m || s.expiresAt.toMillis() > m.toMillis()) ? s.expiresAt : m), null)
  return { active: live.length > 0, expiresAt: forever ? null : until }
}

export interface Grant { product: CatalogProduct; platform: StorePlatform; key: string; active: boolean; expiresAt: Date | null }
export interface GrantResult { entitlements: string[]; expiresAt?: string; granted: Record<string, number> }

/** Records a verified purchase for uid, atomically and idempotently (consumables are credited once per purchase). */
export async function applyGrant(uid: string, g: Grant): Promise<GrantResult> {
  const db = getFirestore()
  const keyRef = db.collection('purchase_tokens').doc(g.key)
  const userRef = db.collection('users').doc(uid)
  const entRef = g.product.entitlement ? userRef.collection('entitlements').doc(g.product.entitlement) : null
  return db.runTransaction(async (tx) => {
    const seen = await tx.get(keyRef)
    const ent = entRef ? await tx.get(entRef) : null
    if (seen.exists && seen.get('uid') !== uid) throw new HttpsError('permission-denied', 'purchase_belongs_to_another_user')
    const granted: Record<string, number> = {}
    if (g.product.type === 'consumable' && !seen.exists) {
      for (const [currency, n] of Object.entries(g.product.grants)) granted[currency] = n
      if (Object.keys(granted).length) tx.set(userRef, { wallet: Object.fromEntries(Object.entries(granted).map(([c, n]) => [c, FieldValue.increment(n)])) }, { merge: true })
    }
    let result: GrantResult = { entitlements: [], granted }
    if (entRef && g.product.entitlement) {
      const sources = { ...((ent?.get('sources') as Record<string, Source> | undefined) ?? {}) }
      sources[g.key] = { productId: g.product.id, platform: g.platform, active: g.active, expiresAt: g.expiresAt ? Timestamp.fromDate(g.expiresAt) : null }
      const s = summarize(sources)
      tx.set(entRef, { active: s.active, expiresAt: s.expiresAt, sources, updatedAt: FieldValue.serverTimestamp() })
      result = { entitlements: s.active ? [g.product.entitlement] : [], granted, ...(s.expiresAt ? { expiresAt: s.expiresAt.toDate().toISOString() } : {}) }
    }
    tx.set(keyRef, { uid, productId: g.product.id, platform: g.platform, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return result
  })
}

/** Store notifications (renewal, expiry, refund): update the purchase behind key, if a user verified it before. */
export async function updatePurchase(key: string, active: boolean, expiresAt: Date | null): Promise<void> {
  const db = getFirestore()
  const owner = await db.collection('purchase_tokens').doc(key).get()
  if (!owner.exists) { console.warn('notification for an unknown purchase', key); return }
  const product = PRODUCTS[owner.get('productId') as string]
  if (!product) return
  await applyGrant(owner.get('uid') as string, { product, platform: owner.get('platform') as StorePlatform, key, active, expiresAt })
}
`

export const firebaseVerify = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { REGION, ApiInputError, parseVerifyPurchaseInput, type VerifyPurchaseInput, type VerifyPurchaseOutput } from './generated/api'
import { PRODUCTS } from './generated/payments'
import { applyGrant, appleTransaction, isRejectedByStore, PLAY_ACTIVE, playAcknowledgeProduct, playAcknowledgeSubscription, playConsume, playProduct, playSubscription, purchaseKey } from './payments/stores'

/** Verifies a store purchase with Google Play / the App Store and grants it server-side (DualCraft payments). */
export const verifyPurchase = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<VerifyPurchaseOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  let input: VerifyPurchaseInput
  try { input = parseVerifyPurchaseInput(request.data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
  const product = PRODUCTS[input.productId]
  if (!product) throw new HttpsError('not-found', 'unknown_product')
  try {
    if (input.platform === 'android') {
      const key = purchaseKey('android', input.token)
      if (product.type === 'subscription') {
        const s = await playSubscription(input.token)
        const item = (s.lineItems ?? []).find((l) => l.productId === product.android)
        if (!item) throw new HttpsError('invalid-argument', 'token_does_not_match_product')
        if (s.subscriptionState === 'SUBSCRIPTION_STATE_PENDING') throw new HttpsError('failed-precondition', 'purchase_pending')
        const out = await applyGrant(uid, { product, platform: 'android', key, active: PLAY_ACTIVE.includes(s.subscriptionState ?? ''), expiresAt: item.expiryTime ? new Date(item.expiryTime) : null })
        if (s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') await playAcknowledgeSubscription(product.android, input.token)
        return out as VerifyPurchaseOutput
      }
      const p = await playProduct(product.android, input.token)
      if (p.purchaseState === 2) throw new HttpsError('failed-precondition', 'purchase_pending')
      if (p.purchaseState !== 0) throw new HttpsError('invalid-argument', 'purchase_cancelled')
      const out = await applyGrant(uid, { product, platform: 'android', key, active: true, expiresAt: null })
      // after granting: consumables are consumed server-side (buy them with autoConsume: false), the rest acknowledged
      if (product.type === 'consumable') { if (p.consumptionState !== 1) await playConsume(product.android, input.token) }
      else if (p.acknowledgementState !== 1) await playAcknowledgeProduct(product.android, input.token)
      return out as VerifyPurchaseOutput
    }
    const t = await appleTransaction(input.token)
    if (t.productId !== product.ios) throw new HttpsError('invalid-argument', 'token_does_not_match_product')
    const expiresAt = t.expiresDate ? new Date(t.expiresDate) : null
    const id = product.type === 'consumable' ? String(t.transactionId) : String(t.originalTransactionId)
    const out = await applyGrant(uid, { product, platform: 'ios', key: purchaseKey('ios', id), active: !t.revocationDate && (!expiresAt || expiresAt.getTime() > Date.now()), expiresAt })
    return out as VerifyPurchaseOutput
  } catch (e) {
    if (e instanceof HttpsError) throw e
    if (isRejectedByStore(e)) throw new HttpsError('invalid-argument', 'purchase_not_found_in_store')
    console.error('verifyPurchase failed', e)
    throw new HttpsError('unavailable', 'store_unreachable') // transient: the app keeps the purchase pending and retries
  }
})
`

export const firebaseRtdn = `import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { REGION } from './generated/api'
import { PACKAGE_NAME } from './generated/payments'
import { PLAY_ACTIVE, playSubscription, purchaseKey, updatePurchase } from './payments/stores'

interface Rtdn {
  packageName?: string
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string }
  voidedPurchaseNotification?: { purchaseToken?: string; orderId?: string }
  testNotification?: unknown
}

/** Google Play Real-time Developer Notifications (Play Console → Monetization setup → topic projects/<id>/topics/play-rtdn). */
export const playRtdn = onMessagePublished({ topic: 'play-rtdn', region: REGION }, async (event) => {
  const msg = event.data.message.json as Rtdn
  if (msg.packageName !== PACKAGE_NAME || msg.testNotification) return
  const voided = msg.voidedPurchaseNotification?.purchaseToken
  if (voided) { await updatePurchase(purchaseKey('android', voided), false, null); return } // refund / chargeback → revoke
  const token = msg.subscriptionNotification?.purchaseToken
  if (!token) return
  const s = await playSubscription(token) // always re-read the state: notifications can arrive out of order
  const expiry = s.lineItems?.[0]?.expiryTime
  await updatePurchase(purchaseKey('android', token), PLAY_ACTIVE.includes(s.subscriptionState ?? ''), expiry ? new Date(expiry) : null)
  if (s.linkedPurchaseToken) await updatePurchase(purchaseKey('android', s.linkedPurchaseToken), false, null) // upgrade/downgrade replaced it
})
`

export const firebaseAppleNotifications = `import { onRequest } from 'firebase-functions/v2/https'
import { REGION } from './generated/api'
import { PRODUCTS_BY_STORE_ID } from './generated/payments'
import { appleNotification, appleTransaction, purchaseKey, updatePurchase } from './payments/stores'

const REVOKING = ['REFUND', 'REVOKE', 'EXPIRED', 'GRACE_PERIOD_EXPIRED']

/** App Store Server Notifications V2 (App Store Connect → App Information → Production and Sandbox Server URL). */
export const appStoreNotifications = onRequest({ region: REGION }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return }
  const signed = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload
  if (typeof signed !== 'string') { res.status(400).send('bad_request'); return }
  let n
  try { n = await appleNotification(signed) } catch { res.status(401).send('bad_signature'); return } // verifies Apple's signature chain
  try {
    const info = n.data?.signedTransactionInfo
    if (info) {
      const t = await appleTransaction(info)
      const product = t.productId ? PRODUCTS_BY_STORE_ID[t.productId] : undefined
      const expiresAt = t.expiresDate ? new Date(t.expiresDate) : null
      const revoked = !!t.revocationDate || REVOKING.includes(String(n.notificationType ?? ''))
      const id = product?.type === 'consumable' ? String(t.transactionId) : String(t.originalTransactionId)
      await updatePurchase(purchaseKey('ios', id), !revoked && (!expiresAt || expiresAt.getTime() > Date.now()), expiresAt)
    }
    res.status(200).send('ok')
  } catch (e) {
    console.error('appStoreNotifications failed', e)
    res.status(500).send('error') // Apple retries
  }
})
`

export const firebaseRevenueCat = `import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { timingSafeEqual } from 'node:crypto'
import { REGION } from './generated/api'
import { PRODUCTS_BY_STORE_ID } from './generated/payments'

// RevenueCat → Project settings → Integrations → Webhooks: URL of this function, Authorization header "Bearer <secret>".
// firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
const SECRET = defineSecret('REVENUECAT_WEBHOOK_SECRET')

interface RcEvent { id?: string; type?: string; app_user_id?: string; entitlement_ids?: string[] | null; product_id?: string; expiration_at_ms?: number | null }

/** Mirrors RevenueCat entitlements into users/{uid}/entitlements and credits consumables (app_user_id = Firebase uid via Purchases.logIn). */
export const revenuecatWebhook = onRequest({ region: REGION, secrets: [SECRET] }, async (req, res) => {
  const got = Buffer.from(String(req.headers.authorization ?? '')); const want = Buffer.from('Bearer ' + SECRET.value())
  if (got.length !== want.length || !timingSafeEqual(got, want)) { res.status(401).send('unauthorized'); return }
  const e = (req.body as { event?: RcEvent } | undefined)?.event
  if (!e?.id || !e.app_user_id) { res.status(400).send('bad_request'); return }
  if (e.app_user_id.startsWith('$RCAnonymousID')) { res.status(200).send('anonymous'); return } // log in to RevenueCat with the uid before purchasing
  const db = getFirestore()
  const seen = db.collection('webhook_events').doc('revenuecat_' + e.id)
  const user = db.collection('users').doc(e.app_user_id)
  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(seen)).exists) return
      tx.set(seen, { type: e.type ?? null, at: FieldValue.serverTimestamp() })
      const expiresAt = e.expiration_at_ms ? new Date(e.expiration_at_ms) : null
      const active = e.type !== 'EXPIRATION' && (!expiresAt || expiresAt.getTime() > Date.now())
      for (const ent of e.entitlement_ids ?? []) tx.set(user.collection('entitlements').doc(ent), { active, productId: e.product_id ?? null, platform: 'revenuecat', expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      const product = e.product_id ? PRODUCTS_BY_STORE_ID[e.product_id] : undefined
      if (e.type === 'NON_RENEWING_PURCHASE' && product?.type === 'consumable') tx.set(user, { wallet: Object.fromEntries(Object.entries(product.grants).map(([c, n]) => [c, FieldValue.increment(n)])) }, { merge: true })
    })
    res.status(200).send('ok')
  } catch (err) {
    console.error('revenuecatWebhook failed', err)
    res.status(500).send('error') // RevenueCat retries
  }
})
`

export const supabaseRevenueCat = `import { createClient } from 'npm:@supabase/supabase-js@2'
import { PRODUCTS_BY_STORE_ID } from '../_shared/payments.ts'

// RevenueCat webhook → entitlements table (deployed with verify_jwt = false; the shared secret authenticates).
// Tables (declare them in the DBML): entitlements(user_id uuid, entitlement text, active bool, product_id text, expires_at timestamptz,
// updated_at timestamptz, primary key (user_id, entitlement)) · wallet_ledger(id text primary key, user_id uuid, currency text, amount int)
// · webhook_events(id text primary key, type text). Balance = sum(amount) per user and currency.
const SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '' // supabase secrets set REVENUECAT_WEBHOOK_SECRET=…
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
interface RcEvent { id?: string; type?: string; app_user_id?: string; entitlement_ids?: string[] | null; product_id?: string; expiration_at_ms?: number | null }

Deno.serve(async (req) => {
  if (!SECRET || !safeEqual(req.headers.get('Authorization') ?? '', 'Bearer ' + SECRET)) return new Response('unauthorized', { status: 401 })
  const e = ((await req.json()) as { event?: RcEvent }).event
  if (!e?.id || !e.app_user_id) return new Response('bad_request', { status: 400 })
  if (e.app_user_id.startsWith('$RCAnonymousID')) return new Response('anonymous', { status: 200 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error: dup } = await admin.from('webhook_events').insert({ id: 'revenuecat_' + e.id, type: e.type ?? null })
  if (dup?.code === '23505') return new Response('duplicate', { status: 200 })
  if (dup) { console.error('revenuecat-webhook', dup); return new Response('error', { status: 500 }) }
  const expiresAt = e.expiration_at_ms ? new Date(e.expiration_at_ms) : null
  const active = e.type !== 'EXPIRATION' && (!expiresAt || expiresAt.getTime() > Date.now())
  for (const ent of e.entitlement_ids ?? []) {
    const { error } = await admin.from('entitlements').upsert({ user_id: e.app_user_id, entitlement: ent, active, product_id: e.product_id ?? null, expires_at: expiresAt?.toISOString() ?? null, updated_at: new Date().toISOString() })
    if (error) { console.error('revenuecat-webhook', error); return new Response('error', { status: 500 }) }
  }
  const product = e.product_id ? PRODUCTS_BY_STORE_ID[e.product_id] : undefined
  if (e.type === 'NON_RENEWING_PURCHASE' && product?.type === 'consumable') {
    const rows = Object.entries(product.grants).map(([currency, amount]) => ({ id: e.id + '_' + currency, user_id: e.app_user_id, currency, amount }))
    const { error } = await admin.from('wallet_ledger').insert(rows)
    if (error && error.code !== '23505') { console.error('revenuecat-webhook', error); return new Response('error', { status: 500 }) }
  }
  return new Response('ok', { status: 200 })
})
`

export const flutterPurchaseService = `// Purchases for Flutter (Google Play + App Store) following the DualCraft payments playbook. Yours after creation.
// Create it once at app start, after sign-in (anonymous is fine), and call init() before any store screen.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../generated/api_client.dart';
import '../generated/payments_catalog.dart';

/// Unlocked entitlements between launches (offline). Implement with shared_preferences / secure storage, or by listening
/// to users/{uid}/entitlements in Firestore — the server is the source of truth (renewals, expiry, refunds).
abstract class EntitlementCache {
  Future<Set<String>> load();
  Future<void> save(Set<String> entitlements);
}

class PurchaseService extends ChangeNotifier {
  PurchaseService(this._api, this._cache, {InAppPurchase? iap}) : _iap = iap ?? InAppPurchase.instance;

  final Api _api;
  final EntitlementCache _cache;
  final InAppPurchase _iap;
  StreamSubscription<List<PurchaseDetails>>? _sub;
  final Set<String> _entitlements = {};
  Map<String, ProductDetails> products = const {};
  bool available = false;
  bool pending = false;
  String? lastError;

  bool has(Entitlement e) => _entitlements.contains(e.id);
  StorePlatform get _platform => defaultTargetPlatform == TargetPlatform.iOS ? StorePlatform.ios : StorePlatform.android;

  /// Order matters: listen first, then local entitlements, then products and restore.
  Future<void> init() async {
    _sub ??= _iap.purchaseStream.listen(_onPurchases, onError: (Object e) {
      lastError = e.toString();
      notifyListeners();
    });
    _entitlements.addAll(await _cache.load());
    available = await _iap.isAvailable();
    if (available) {
      final res = await _iap.queryProductDetails(PaymentsCatalog.storeIds(_platform));
      // Several Play base plans/offers of one subscription share the id: pick the right GooglePlayProductDetails if you sell more than one.
      products = {for (final p in res.productDetails) p.id: p};
      if (res.notFoundIDs.isNotEmpty) debugPrint('IAP products not found: \${res.notFoundIDs} (draft product, debug build or missing license tester)');
      await _iap.restorePurchases();
    }
    notifyListeners();
  }

  Future<void> buy(CatalogProduct product) async {
    final details = products[product.storeId(_platform)];
    if (details == null) {
      lastError = 'product_unavailable';
      notifyListeners();
      return;
    }
    final param = PurchaseParam(productDetails: details);
    if (product.type == ProductType.consumable) {
      await _iap.buyConsumable(purchaseParam: param, autoConsume: false); // the server consumes it after crediting
    } else {
      await _iap.buyNonConsumable(purchaseParam: param);
    }
  }

  /// "Restaurar compras" button — required by the App Store, useful everywhere.
  Future<void> restore() => _iap.restorePurchases();

  Future<void> _onPurchases(List<PurchaseDetails> purchases) async {
    for (final p in purchases) {
      debugPrint('IAP \${p.productID} \${p.status} pendingComplete=\${p.pendingCompletePurchase} id=\${p.purchaseID}');
      var complete = true;
      switch (p.status) {
        case PurchaseStatus.pending:
          pending = true;
          complete = false;
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          pending = false;
          complete = await _verify(p);
        case PurchaseStatus.error:
          pending = false;
          lastError = p.error?.message;
        case PurchaseStatus.canceled:
          pending = false;
      }
      // Complete purchased AND restored ones once granted; a transient server failure leaves it pending so the store redelivers it.
      if (complete && p.pendingCompletePurchase) {
        try {
          await _iap.completePurchase(p);
        } catch (e) {
          debugPrint('completePurchase: \$e');
        }
      }
    }
    notifyListeners();
  }

  /// Server verification (Cloud Function verifyPurchase): grants the entitlement or coins server-side.
  Future<bool> _verify(PurchaseDetails p) async {
    final product = PaymentsCatalog.byStoreId(p.productID);
    if (product == null) {
      lastError = 'unknown_product';
      return true;
    }
    try {
      final r = await _api.verifyPurchase(VerifyPurchaseInput(
        platform: _platform == StorePlatform.ios ? VerifyPurchasePlatform.ios : VerifyPurchasePlatform.android,
        productId: VerifyPurchaseProductId.fromValue(product.id),
        token: p.verificationData.serverVerificationData, // Play purchase token / StoreKit 2 signed transaction
      ));
      _entitlements.addAll(r.entitlements);
      await _cache.save(_entitlements);
      return true;
    } on ApiError catch (e) {
      lastError = e.code;
      return const {'invalid-argument', 'permission-denied', 'not-found'}.contains(e.code); // definitive: don't retry forever
    } catch (e) {
      lastError = e.toString();
      return false; // network: retried on the next launch (restore / redelivery)
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
`
