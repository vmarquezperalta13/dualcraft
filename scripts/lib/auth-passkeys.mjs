// Passkeys (DualCraft auth): Firebase server functions (WebAuthn with SimpleWebAuthn + custom token), the contract
// entries, the well-known files that bind the domain to the apps, and the Supabase dashboard/CLI settings.

/** Contract functions (Firebase only: Supabase has passkeys built in). JSON travels as strings (native SDKs use JSON text). */
export const PASSKEY_CONTRACT = [
  { name: 'passkeyRegisterOptions', kind: 'callable', auth: 'user', description: 'Opciones WebAuthn para añadir una passkey a la cuenta', platforms: ['web', 'mobile'], input: {}, output: { options: { type: 'string', required: true } }, errors: ['failed-precondition'], origin: 'auth' },
  { name: 'passkeyRegisterVerify', kind: 'callable', auth: 'user', description: 'Verifica y guarda la passkey nueva', platforms: ['web', 'mobile'], input: { response: { type: 'string', required: true, maxLength: 20000 }, name: { type: 'string', maxLength: 120 } }, output: { id: { type: 'string', required: true } }, errors: ['failed-precondition', 'permission-denied', 'already-exists'], origin: 'auth' },
  { name: 'passkeySignInOptions', kind: 'callable', auth: 'public', description: 'Opciones WebAuthn para entrar con passkey', platforms: ['web', 'mobile'], input: {}, output: { challengeId: { type: 'string', required: true }, options: { type: 'string', required: true } }, errors: [], origin: 'auth' },
  { name: 'passkeySignInVerify', kind: 'callable', auth: 'public', description: 'Verifica la passkey y devuelve un token de sesión', platforms: ['web', 'mobile'], input: { challengeId: { type: 'string', required: true, maxLength: 128 }, response: { type: 'string', required: true, maxLength: 20000 } }, output: { token: { type: 'string', required: true } }, errors: ['failed-precondition', 'not-found', 'permission-denied'], origin: 'auth' },
]

export const firebasePasskeys = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import {
  REGION, ApiInputError, parsePasskeyRegisterVerifyInput, parsePasskeySignInVerifyInput,
  type PasskeyRegisterOptionsOutput, type PasskeyRegisterVerifyOutput, type PasskeySignInOptionsOutput, type PasskeySignInVerifyOutput,
} from './generated/api'
import { PASSKEY_ORIGINS, PASSKEY_RP_ID, PASSKEY_RP_NAME } from './generated/auth'

// Passkeys for Firebase Auth (DualCraft auth). Firebase has no native passkeys: these functions run WebAuthn
// (SimpleWebAuthn) and sign the user in with a custom token. Firestore: passkeys/{credentialId} and
// passkeyChallenges/{id} (single use, 5 minutes) — deny all client access in the rules.
// The functions' service account needs the "Service Account Token Creator" role (createCustomToken).
const CHALLENGE_TTL_MS = 5 * 60 * 1000
type StoredPasskey = { uid: string; publicKey: string; counter: number; transports: AuthenticatorTransportFuture[]; name: string | null; createdAt: Timestamp; lastUsedAt: Timestamp | null }

const db = () => getFirestore()
const parse = <T>(fn: (d: unknown) => T, data: unknown): T => {
  try { return fn(data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
}
const json = <T>(s: string): T => {
  try { return JSON.parse(s) as T } catch { throw new HttpsError('invalid-argument', 'bad_json') }
}

async function putChallenge(id: string | null, challenge: string, uid: string | null): Promise<string> {
  const ref = id ? db().collection('passkeyChallenges').doc(id) : db().collection('passkeyChallenges').doc()
  await ref.set({ challenge, uid, expiresAt: Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MS) })
  return ref.id
}
/** Reads and deletes the challenge (single use). */
async function takeChallenge(id: string, uid: string | null): Promise<string> {
  const ref = db().collection('passkeyChallenges').doc(id)
  const data = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) tx.delete(ref)
    return snap.data()
  })
  if (!data || data.uid !== uid || (data.expiresAt as Timestamp).toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'challenge_expired')
  return data.challenge as string
}

/** Step 1 of adding a passkey to the signed-in account. */
export const passkeyRegisterOptions = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<PasskeyRegisterOptionsOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  if (request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('failed-precondition', 'guest_cannot_add_passkey')
  const user = await getAuth().getUser(uid)
  const existing = await db().collection('passkeys').where('uid', '==', uid).get()
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME, rpID: PASSKEY_RP_ID,
    userName: user.email ?? user.phoneNumber ?? uid, userDisplayName: user.displayName ?? user.email ?? '', userID: new TextEncoder().encode(uid),
    attestationType: 'none',
    excludeCredentials: existing.docs.map((d) => ({ id: d.id, transports: (d.data() as StoredPasskey).transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  await putChallenge('reg_' + uid, options.challenge, uid)
  return { options: JSON.stringify(options) }
})

/** Step 2: verifies the authenticator's answer and stores the passkey. */
export const passkeyRegisterVerify = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<PasskeyRegisterVerifyOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  const input = parse(parsePasskeyRegisterVerifyInput, request.data)
  const expectedChallenge = await takeChallenge('reg_' + uid, uid)
  const v = await verifyRegistrationResponse({
    response: json<RegistrationResponseJSON>(input.response), expectedChallenge,
    expectedOrigin: [...PASSKEY_ORIGINS], expectedRPID: PASSKEY_RP_ID, requireUserVerification: false,
  }).catch(() => null)
  if (!v?.verified) throw new HttpsError('permission-denied', 'passkey_not_verified')
  const { credential } = v.registrationInfo
  const passkey: StoredPasskey = { uid, publicKey: isoBase64URL.fromBuffer(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], name: input.name ?? null, createdAt: Timestamp.now(), lastUsedAt: null }
  try { await db().collection('passkeys').doc(credential.id).create(passkey) } catch { throw new HttpsError('already-exists', 'passkey_exists') }
  // the "passkey" claim lets the app list it among the sign-in methods
  const user = await getAuth().getUser(uid)
  await getAuth().setCustomUserClaims(uid, { ...(user.customClaims ?? {}), passkey: true })
  return { id: credential.id }
})

/** Step 1 of signing in with a passkey (discoverable credential: no email needed). */
export const passkeySignInOptions = onCall({ region: REGION, enforceAppCheck: true }, async (): Promise<PasskeySignInOptionsOutput> => {
  const options = await generateAuthenticationOptions({ rpID: PASSKEY_RP_ID, userVerification: 'preferred' })
  return { challengeId: await putChallenge(null, options.challenge, null), options: JSON.stringify(options) }
})

/** Step 2: verifies the assertion and returns a custom token for signInWithCustomToken. */
export const passkeySignInVerify = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<PasskeySignInVerifyOutput> => {
  const input = parse(parsePasskeySignInVerifyInput, request.data)
  const response = json<AuthenticationResponseJSON>(input.response)
  const expectedChallenge = await takeChallenge(input.challengeId, null)
  const ref = db().collection('passkeys').doc(response.id)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'passkey_not_found')
  const stored = snap.data() as StoredPasskey
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: [...PASSKEY_ORIGINS], expectedRPID: PASSKEY_RP_ID, requireUserVerification: false,
    credential: { id: snap.id, publicKey: isoBase64URL.toBuffer(stored.publicKey), counter: stored.counter, transports: stored.transports },
  }).catch(() => null)
  if (!v?.verified) throw new HttpsError('permission-denied', 'passkey_not_verified')
  await ref.update({ counter: v.authenticationInfo.newCounter, lastUsedAt: FieldValue.serverTimestamp() })
  const user = await getAuth().getUser(stored.uid).catch(() => null)
  if (!user || user.disabled) throw new HttpsError('permission-denied', 'user_disabled')
  return { token: await getAuth().createCustomToken(stored.uid) }
})
`

export const firestorePasskeyRules = `  // passkeys (DualCraft auth): only the Cloud Functions read and write them
  match /passkeys/{id} { allow read, write: if false; }
  match /passkeyChallenges/{id} { allow read, write: if false; }`

/** .well-known files that bind the domain (rpId) to the apps, so their passkeys work for it. */
export function wellKnown(c, { androidPackage, iosAppId }) {
  const fingerprints = c.passkey?.androidSha256 || []
  return {
    'assetlinks.json': JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: androidPackage || 'com.example.app', sha256_cert_fingerprints: fingerprints.length ? fingerprints : ['<SHA-256 of your signing certificate: keytool -list -v / Play Console → App signing>'] } }], null, 2) + '\n',
    'apple-app-site-association': JSON.stringify({ webcredentials: { apps: [iosAppId || '<TEAMID>.<bundle id>'] } }, null, 2) + '\n',
  }
}

/** Supabase: passkeys are a dashboard / config.toml setting. */
export const supabasePasskeyConfig = (c, origins) => `Supabase passkeys (beta) — supabase/config.toml (or Dashboard → Authentication → Passkeys):
  [auth.passkey]
  enabled = true
  [auth.webauthn]
  rp_display_name = ${JSON.stringify(c.passkey?.rpName || 'App')}
  rp_id = ${JSON.stringify(c.passkey?.rpId || '')}
  rp_origins = ${JSON.stringify(origins)}`
