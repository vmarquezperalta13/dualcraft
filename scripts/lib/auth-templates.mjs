// Server scaffolds of the DualCraft auth pack (written once, owned by the developer afterwards).

// ---------------------------------------------------------------- Firebase (Cloud Functions v2)
export const firebaseDeleteAccount = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { REGION, type DeleteAccountOutput } from './generated/api'
import { CLEANUP, RECENT_LOGIN_SECONDS, STORAGE_PREFIXES } from './generated/auth'

/** Deletes the caller's account and data (App Store 5.1.1(v), Google Play account deletion policy). DualCraft auth. */
export const deleteAccount = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<DeleteAccountOutput> => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')
  // a stolen session must not be enough: the client reauthenticates first (AuthService.reauthenticate)
  const authTime = Number(request.auth?.token.auth_time ?? 0)
  if (Date.now() / 1000 - authTime > RECENT_LOGIN_SECONDS) throw new HttpsError('failed-precondition', 'requires_recent_login')
  const db = getFirestore()
  for (const c of CLEANUP) {
    if (!c.field) { await db.recursiveDelete(db.collection(c.collection).doc(uid)); continue } // the user's document + subcollections
    for (;;) { // documents that reference the user, in batches
      const snap = await db.collection(c.collection).where(c.field, '==', uid).limit(300).get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
  }
  const bucket = getStorage().bucket()
  for (const p of STORAGE_PREFIXES) await bucket.deleteFiles({ prefix: p.replace('{uid}', uid) })
  await getAuth().deleteUser(uid)
  return { deleted: true }
})
`

export const firebaseSetUserRole = `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { REGION, ApiInputError, parseSetUserRoleInput, type SetUserRoleInput, type SetUserRoleOutput } from './generated/api'
import { ADMIN_ROLE, roleFrom } from './generated/auth'

/** Gives a user a role (custom claim "role"; "admin" mirrors the admin role for older rules). Admins only. DualCraft auth. */
export const setUserRole = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<SetUserRoleOutput> => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'login_required')
  if (request.auth.token.role !== ADMIN_ROLE && request.auth.token.admin !== true) throw new HttpsError('permission-denied', 'admins_only')
  let input: SetUserRoleInput
  try { input = parseSetUserRoleInput(request.data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
  if (input.uid === request.auth.uid && input.role !== ADMIN_ROLE) throw new HttpsError('failed-precondition', 'cannot_demote_yourself')
  const auth = getAuth()
  const user = await auth.getUser(input.uid).catch(() => null)
  if (!user) throw new HttpsError('not-found', 'user_not_found')
  const role = roleFrom(input.role)
  await auth.setCustomUserClaims(input.uid, { ...(user.customClaims ?? {}), role, admin: role === ADMIN_ROLE })
  // the user sees the new role after their ID token refreshes (AuthService.refreshUser forces it)
  return {}
})
`

export const firebaseGrantRole = `#!/usr/bin/env node
// First admin (and any role) from your machine — DualCraft auth. Needs Application Default Credentials:
//   gcloud auth application-default login   (or GOOGLE_APPLICATION_CREDENTIALS=service-account.json)
// Usage: node scripts/grant-role.mjs <email> [role] [--project <id>]
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const args = process.argv.slice(2)
const pi = args.indexOf('--project')
const projectId = pi >= 0 ? args.splice(pi, 2)[1] : process.env.GCLOUD_PROJECT
const [email, role = 'admin'] = args
if (!email) { console.error('usage: node scripts/grant-role.mjs <email> [role] [--project <id>]'); process.exit(1) }
initializeApp(projectId ? { projectId } : undefined)
const auth = getAuth()
const user = await auth.getUserByEmail(email)
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role, admin: role === 'admin' })
console.log(\`\${email} (\${user.uid}) → role \${role}. They must sign in again or refresh their token.\`)
`

// ---------------------------------------------------------------- Supabase (Edge Functions, Deno)
export const supabaseDeleteAccount = `import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { CLEANUP, RECENT_LOGIN_SECONDS, STORAGE_PREFIXES } from '../_shared/auth.ts'
import type { DeleteAccountOutput } from '../_shared/api.ts'

/** Deletes the caller's account and data (App Store 5.1.1(v), Google Play account deletion policy). DualCraft auth. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ code: 'invalid-argument', error: 'method_not_allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ code: 'unauthenticated', error: 'login_required' }, 401)
  // a stolen session must not be enough: the client reauthenticates first (AuthService.reauthenticate)
  const last = Date.parse(user.last_sign_in_at ?? '')
  if (!last || Date.now() - last > RECENT_LOGIN_SECONDS * 1000) return json({ code: 'failed-precondition', error: 'requires_recent_login' }, 412)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    for (const c of CLEANUP) {
      const { error } = await admin.from(c.collection).delete().eq(c.field ?? 'id', user.id) // tables with ON DELETE CASCADE to auth.users need no entry
      if (error) throw error
    }
    for (const p of STORAGE_PREFIXES) {
      const [bucket, ...rest] = p.replace('{uid}', user.id).split('/')
      const prefix = rest.filter(Boolean).join('/')
      const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
      if (data?.length) await admin.storage.from(bucket).remove(data.map((f) => (prefix ? prefix + '/' : '') + f.name))
    }
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error
    return json({ deleted: true } satisfies DeleteAccountOutput)
  } catch (e) {
    console.error('delete-account failed', e)
    return json({ code: 'internal', error: 'internal_error' }, 500)
  }
})
`

export const supabaseSetUserRole = `import { createClient } from 'npm:@supabase/supabase-js@2'
import { ApiInputError, parseSetUserRoleInput, type SetUserRoleInput, type SetUserRoleOutput } from '../_shared/api.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { ADMIN_ROLE, roleFrom } from '../_shared/auth.ts'

/** Gives a user a role (app_metadata.role: only the service role can write it, and it travels in the JWT). Admins only. DualCraft auth. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ code: 'invalid-argument', error: 'method_not_allowed' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ code: 'unauthenticated', error: 'login_required' }, 401)
  if (user.app_metadata?.role !== ADMIN_ROLE) return json({ code: 'permission-denied', error: 'admins_only' }, 403)
  let input: SetUserRoleInput
  try { input = parseSetUserRoleInput(await req.json()) } catch (e) { return json({ code: 'invalid-argument', error: e instanceof ApiInputError ? e.message : 'bad_input' }, 400) }
  if (input.uid === user.id && input.role !== ADMIN_ROLE) return json({ code: 'failed-precondition', error: 'cannot_demote_yourself' }, 412)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await admin.auth.admin.updateUserById(input.uid, { app_metadata: { role: roleFrom(input.role) } })
  if (error) return json({ code: 'not-found', error: 'user_not_found' }, 404)
  // the user sees the new role when the session refreshes (AuthService.refreshUser forces it)
  return json({} satisfies SetUserRoleOutput)
})
`

export const supabaseGrantRoleSql = (role) => `-- First admin (DualCraft auth): run once in the SQL editor of each environment, with the user's email.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', '${role}')
where email = 'you@example.com';
-- In RLS policies: (auth.jwt() -> 'app_metadata' ->> 'role') = '${role}'
`

export const firestoreRulesHelpers = (adminRole) => `Firestore rules helpers (merge into firestore.rules):
  function signedIn() { return request.auth != null && request.auth.token.firebase.sign_in_provider != 'anonymous'; }
  function hasRole(r) { return request.auth != null && request.auth.token.role == r; }
  function isAdmin() { return hasRole('${adminRole}'); }
  function verified() { return request.auth != null && request.auth.token.email_verified == true; }
  // e.g. match /admin/{doc=**} { allow read, write: if isAdmin(); }`

export const supabaseRlsHelpers = (adminRole) => `RLS helpers (a migration):
  create or replace function public.has_role(r text) returns boolean language sql stable as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = r $$;
  -- e.g. create policy "admins manage" on public.reports for all using (public.has_role('${adminRole}'));
  -- anonymous (guest) sessions: (auth.jwt() ->> 'is_anonymous')::boolean`
