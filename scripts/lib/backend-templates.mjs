// Server-side scaffolds for `backend.mjs add`: one file per function, owned by the developer after creation
// (never regenerated). Generated code avoids template literals so these JS templates stay readable.
// f = { name, pascal, slug, secret, description, origin, kind, auth, on, cron, tz }, imp = import path of the generated contract

const doc = (f) => `/** ${(f.description || f.name).replace(/\*\//g, '* /')}${f.origin ? ` (${f.origin})` : ''} — declared in .dualcraft/backend/api.json */`
const hasTypes = (f) => f.kind === 'callable' || f.kind === 'http'

// ---------------------------------------------------------------- Firebase (Cloud Functions v2, TypeScript)
const fbAuthCallable = (f) => f.auth === 'public'
  ? `  const uid = request.auth?.uid ?? null // public: no sign-in required (App Check still applies)`
  : `  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'login_required')${f.auth === 'admin' ? `
  if (request.auth?.token.admin !== true) throw new HttpsError('permission-denied', 'admins_only') // custom claim set with the Admin SDK` : ''}`

const fbAuthHttp = (f) => f.auth === 'public' ? '  // public endpoint: rate-limit it and never trust the body' : `  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const user = token ? await getAuth().verifyIdToken(token).catch(() => null) : null
  if (!user) { res.status(401).json({ code: 'unauthenticated', error: 'login_required' }); return }${f.auth === 'admin' ? `
  if (user.admin !== true) { res.status(403).json({ code: 'permission-denied', error: 'admins_only' }); return }` : ''}`

const FB_TRIGGERS = {
  'firestore.created': ['onDocumentCreated', 'firebase-functions/v2/firestore'],
  'firestore.updated': ['onDocumentUpdated', 'firebase-functions/v2/firestore'],
  'firestore.deleted': ['onDocumentDeleted', 'firebase-functions/v2/firestore'],
  'firestore.written': ['onDocumentWritten', 'firebase-functions/v2/firestore'],
  pubsub: ['onMessagePublished', 'firebase-functions/v2/pubsub'],
  'storage.finalized': ['onObjectFinalized', 'firebase-functions/v2/storage'],
  'auth.beforeCreate': ['beforeUserCreated', 'firebase-functions/v2/identity'],
  'auth.beforeSignIn': ['beforeUserSignedIn', 'firebase-functions/v2/identity'],
}
export const firebaseTriggerKinds = Object.keys(FB_TRIGGERS)

export function firebase(f, imp) {
  if (f.kind === 'callable') return `import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { REGION, ApiInputError, parse${f.pascal}Input, type ${f.pascal}Input, type ${f.pascal}Output } from '${imp}'

${doc(f)}
export const ${f.name} = onCall({ region: REGION, enforceAppCheck: true }, async (request): Promise<${f.pascal}Output> => {
${fbAuthCallable(f)}
  let input: ${f.pascal}Input
  try { input = parse${f.pascal}Input(request.data) } catch (e) { throw new HttpsError('invalid-argument', e instanceof ApiInputError ? e.message : 'bad_input') }
  try {
    // TODO(dualcraft): implement. Read-check-write inside getFirestore().runTransaction(); never trust ids, prices or amounts sent by the client.
    void uid; void input
    throw new HttpsError('unimplemented', 'not_implemented')
  } catch (e) {
    if (e instanceof HttpsError) throw e // typed errors reach the client as ApiError(code)
    console.error('${f.name} failed', e) // no personal data or secrets in logs
    throw new HttpsError('internal', 'internal_error')
  }
})
`
  if (f.kind === 'http') return `import { onRequest } from 'firebase-functions/v2/https'
${f.auth === 'public' ? '' : "import { getAuth } from 'firebase-admin/auth'\n"}import { REGION, ApiInputError, parse${f.pascal}Input } from '${imp}'

${doc(f)}
export const ${f.name} = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ code: 'invalid-argument', error: 'method_not_allowed' }); return }
${fbAuthHttp(f)}
  try {
    const input = parse${f.pascal}Input(req.body)
    // TODO(dualcraft): implement and answer with the declared output
    void input
    res.status(501).json({ code: 'unimplemented', error: 'not_implemented' })
  } catch (e) {
    if (e instanceof ApiInputError) { res.status(400).json({ code: 'invalid-argument', error: e.message }); return }
    console.error('${f.name} failed', e)
    res.status(500).json({ code: 'internal', error: 'internal_error' })
  }
})
`
  if (f.kind === 'webhook') return `import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { REGION } from '${imp}'

// firebase functions:secrets:set ${f.secret}
const SECRET = defineSecret('${f.secret}')

${doc(f)}
// Verifies the signature on the RAW body before touching data; processes each event once (webhook_events/{id}).
// Stripe: use stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], secret) instead of the HMAC below.
export const ${f.name} = onRequest({ region: REGION, secrets: [SECRET] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('method_not_allowed'); return }
  const signature = String(req.headers['x-signature'] ?? '') // TODO(dualcraft): the provider's signature header and format
  const expected = createHmac('sha256', SECRET.value()).update(req.rawBody).digest('hex')
  const a = Buffer.from(signature); const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).send('bad_signature'); return }
  const event = JSON.parse(req.rawBody.toString('utf8')) as { id?: string; type?: string }
  const db = getFirestore()
  const seen = db.collection('webhook_events').doc('${f.slug}_' + (event.id ?? expected))
  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(seen)).exists) return // duplicate delivery: already processed
      tx.set(seen, { type: event.type ?? null, at: FieldValue.serverTimestamp() })
      // TODO(dualcraft): handle event.type inside this transaction
    })
    res.status(200).send('ok')
  } catch (e) {
    console.error('${f.name} failed', e)
    res.status(500).send('error') // the provider retries
  }
})
`
  if (f.kind === 'schedule') return `import { onSchedule } from 'firebase-functions/v2/scheduler'
import { REGION } from '${imp}'

${doc(f)}
export const ${f.name} = onSchedule({ schedule: '${f.cron}', timeZone: '${f.tz || 'Europe/Madrid'}', region: REGION }, async () => {
  // TODO(dualcraft): implement. Work in batches (≤ 500 writes) and make it safe to run twice.
})
`
  // trigger
  const [type, arg] = splitOn(f.on)
  const [fn, mod] = FB_TRIGGERS[type]
  if (type.startsWith('firestore.')) return `import { ${fn} } from 'firebase-functions/v2/firestore'
import { REGION } from '${imp}'

${doc(f)}
// The region must be the Firestore database location's region. Triggers can be delivered more than once: make it idempotent (event.id).
export const ${f.name} = ${fn}({ document: '${arg}', region: REGION }, async (event) => {
  const params = event.params
  // TODO(dualcraft): implement
  void params
})
`
  if (type === 'pubsub') return `import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { REGION } from '${imp}'

${doc(f)}
export const ${f.name} = onMessagePublished({ topic: '${arg}', region: REGION }, async (event) => {
  const data = event.data.message.json as unknown
  // TODO(dualcraft): implement (idempotent: event.id)
  void data
})
`
  if (type === 'storage.finalized') return `import { onObjectFinalized } from 'firebase-functions/v2/storage'
import { REGION } from '${imp}'

${doc(f)}
// The region must match the bucket location.
export const ${f.name} = onObjectFinalized({ region: REGION${arg ? `, bucket: '${arg}'` : ''} }, async (event) => {
  const file = event.data.name
  // TODO(dualcraft): implement (validate content type and size before processing)
  void file
})
`
  return `import { ${fn}, HttpsError } from '${mod}'
import { REGION } from '${imp}'

${doc(f)}
// Blocking function: runs before the user is ${type === 'auth.beforeCreate' ? 'created' : 'signed in'}; throw to reject. Requires Identity Platform.
export const ${f.name} = ${fn}({ region: REGION }, (event) => {
  const user = event.data
  // TODO(dualcraft): implement, e.g. allow-list email domains
  if (!user) throw new HttpsError('invalid-argument', 'no_user')
})
`
}

export const splitOn = (on) => { const i = String(on).indexOf(':'); return i < 0 ? [on, ''] : [on.slice(0, i), on.slice(i + 1)] }

export const firebaseFunctionsPackage = (name) => JSON.stringify({
  name: `${name}-functions`, private: true, main: 'lib/index.js',
  engines: { node: '22' },
  scripts: { build: 'tsc', 'build:watch': 'tsc --watch', serve: 'npm run build && firebase emulators:start --only functions', deploy: 'firebase deploy --only functions', logs: 'firebase functions:log' },
  dependencies: { 'firebase-admin': '^13.0.0', 'firebase-functions': '^6.1.0' },
  devDependencies: { typescript: '^5.6.0' },
}, null, 2) + '\n'

export const firebaseTsconfig = JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'es2022', lib: ['es2022'], outDir: 'lib', rootDir: 'src', strict: true, esModuleInterop: true, skipLibCheck: true, sourceMap: true, noImplicitReturns: true }, include: ['src'] }, null, 2) + '\n'

export const firebaseIndex = `// Cloud Functions entry point. Every function lives in its own file and is re-exported here
// (DualCraft adds the export when you run /dualcraft:backend add).
import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
import { REGION } from './generated/api'

initializeApp()
setGlobalOptions({ region: REGION, maxInstances: 10 }) // cap instances: a bug or an attack can't scale your bill
`

// ---------------------------------------------------------------- Supabase (Edge Functions, Deno)
export const supabaseCors = `// CORS for Edge Functions called from browsers. Set ALLOWED_ORIGIN (supabase secrets set ALLOWED_ORIGIN=https://your.app).
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'http://localhost:3000',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
`

const sbSecretCheck = (f) => `const SECRET = Deno.env.get('${f.secret}') ?? '' // supabase secrets set ${f.secret}=…
const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }`

export function supabase(f) {
  if (hasTypes(f)) return `import { createClient } from 'npm:@supabase/supabase-js@2'
import { ApiInputError, parse${f.pascal}Input, type ${f.pascal}Input, type ${f.pascal}Output } from '../_shared/api.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

${doc(f)}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ code: 'invalid-argument', error: 'method_not_allowed' }, 405)
  // Client with the caller's JWT: queries run under RLS as that user. Use the service_role client only for what RLS can't express.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
${f.auth === 'public' ? '  const user = null // public function: deploy with --no-verify-jwt only if it must work without a session' : `  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ code: 'unauthenticated', error: 'login_required' }, 401)${f.auth === 'admin' ? `
  if (user.app_metadata?.role !== 'admin') return json({ code: 'permission-denied', error: 'admins_only' }, 403)` : ''}`}
  let input: ${f.pascal}Input
  try { input = parse${f.pascal}Input(await req.json()) } catch (e) { return json({ code: 'invalid-argument', error: e instanceof ApiInputError ? e.message : 'bad_input' }, 400) }
  try {
    // TODO(dualcraft): implement and return json(output satisfies ${f.pascal}Output)
    void user; void input
    return json({ code: 'unimplemented', error: 'not_implemented' }, 501)
  } catch (e) {
    console.error('${f.slug} failed', e)
    return json({ code: 'internal', error: 'internal_error' }, 500)
  }
})
`
  if (f.kind === 'webhook') return `import { createClient } from 'npm:@supabase/supabase-js@2'

${doc(f)}
// Deployed with verify_jwt = false (supabase/config.toml): the signature is the authentication.
${sbSecretCheck(f)}
async function hmacHex(body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  const raw = await req.text()
  const signature = req.headers.get('x-signature') ?? '' // TODO(dualcraft): the provider's signature header and format (Stripe: stripe.webhooks.constructEventAsync)
  if (!SECRET || !safeEqual(signature, await hmacHex(raw))) return new Response('bad_signature', { status: 401 })
  const event = JSON.parse(raw) as { id?: string; type?: string }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // idempotency: table webhook_events (id text primary key, type text, created_at timestamptz default now()) — declare it in the DBML
  const { error } = await admin.from('webhook_events').insert({ id: '${f.slug}_' + (event.id ?? crypto.randomUUID()), type: event.type ?? null })
  if (error?.code === '23505') return new Response('duplicate', { status: 200 })
  if (error) { console.error('${f.slug} failed', error); return new Response('error', { status: 500 }) }
  // TODO(dualcraft): handle event.type
  return new Response('ok', { status: 200 })
})
`
  // schedule (pg_cron + pg_net) and trigger (Database Webhook): called by the database with a shared secret
  return `import { createClient } from 'npm:@supabase/supabase-js@2'

${doc(f)}
// Called by ${f.kind === 'schedule' ? `pg_cron (${f.cron})` : `a Database Webhook (${f.on})`} with "Authorization: Bearer <${f.secret}>"; deployed with verify_jwt = false.
${sbSecretCheck(f)}

Deno.serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!SECRET || !safeEqual(token, SECRET)) return new Response('unauthorized', { status: 401 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
${f.kind === 'trigger' ? "  const payload = await req.json() as { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; record: unknown; old_record: unknown }\n  // TODO(dualcraft): implement (idempotent: a webhook can be retried)\n  void admin; void payload" : '  // TODO(dualcraft): implement (safe to run twice)\n  void admin'}
  return new Response('ok', { status: 200 })
})
`
}

export const supabaseScheduleSql = (f, ref = '<project-ref>') => `-- Schedule ${f.slug} (${f.cron}) — run once per environment in the SQL editor (needs pg_cron + pg_net; store the secret in Vault):
select vault.create_secret('<${f.secret}>', '${f.secret}');
select cron.schedule('${f.slug}', '${f.cron}', $$
  select net.http_post(
    url := 'https://${ref}.supabase.co/functions/v1/${f.slug}',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${f.secret}'))
  );
$$);`

// ---------------------------------------------------------------- Next.js / Nuxt (own server: provider "http")
const nextAuth = (f) => f.auth === 'public' ? '  // public endpoint: rate-limit it and never trust the body' : `  // TODO(dualcraft): read the session with the project's auth library (Auth.js auth(), Supabase createServerClient, Clerk auth()…).
  const user = null as null | { id: string${f.auth === 'admin' ? '; admin?: boolean' : ''} } // fails closed until wired
  if (!user) return Response.json({ code: 'unauthenticated', error: 'login_required' }, { status: 401 })${f.auth === 'admin' ? `
  if (!user.admin) return Response.json({ code: 'permission-denied', error: 'admins_only' }, { status: 403 })` : ''}`

export function next(f, imp) {
  if (hasTypes(f)) return `import { ApiInputError, parse${f.pascal}Input } from '${imp}'

${doc(f)}
export async function POST(req: Request) {
${nextAuth(f)}
  let input
  try { input = parse${f.pascal}Input(await req.json()) } catch (e) { return Response.json({ code: 'invalid-argument', error: e instanceof ApiInputError ? e.message : 'bad_input' }, { status: 400 }) }
  try {
    // TODO(dualcraft): implement and return Response.json(output)
    void input
    return Response.json({ code: 'unimplemented', error: 'not_implemented' }, { status: 501 })
  } catch (e) {
    console.error('${f.slug} failed', e)
    return Response.json({ code: 'internal', error: 'internal_error' }, { status: 500 })
  }
}
`
  if (f.kind === 'webhook') return `import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'

${doc(f)}
// Signature on the RAW body; secret ${f.secret} in the hosting platform's env (never NEXT_PUBLIC_).
export async function POST(req: Request) {
  const raw = await req.text()
  const signature = req.headers.get('x-signature') ?? '' // TODO(dualcraft): the provider's signature header (Stripe: stripe.webhooks.constructEvent)
  const expected = createHmac('sha256', process.env.${f.secret} ?? '').update(raw).digest('hex')
  const a = Buffer.from(signature); const b = Buffer.from(expected)
  if (!process.env.${f.secret} || a.length !== b.length || !timingSafeEqual(a, b)) return new Response('bad_signature', { status: 401 })
  const event = JSON.parse(raw) as { id?: string; type?: string }
  // TODO(dualcraft): skip already-processed event.id (unique table), then handle event.type
  void event
  return new Response('ok', { status: 200 })
}
`
  return `export const runtime = 'nodejs'

${doc(f)}
// Vercel Cron (vercel.json: { "crons": [{ "path": "/api/${f.slug}", "schedule": "${f.cron}" }] }) sends "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== 'Bearer ' + process.env.CRON_SECRET) return new Response('unauthorized', { status: 401 })
  // TODO(dualcraft): implement (safe to run twice)
  return new Response('ok', { status: 200 })
}
`
}

export function nuxt(f, imp) {
  if (hasTypes(f)) return `import { ApiInputError, parse${f.pascal}Input } from '${imp}'

${doc(f)}
export default defineEventHandler(async (event) => {
${f.auth === 'public' ? '  // public endpoint: rate-limit it and never trust the body' : `  // TODO(dualcraft): read the session with the project's auth module (nuxt-auth-utils getUserSession, Supabase serverSupabaseUser…).
  const user = null as null | { id: string${f.auth === 'admin' ? '; admin?: boolean' : ''} } // fails closed until wired
  if (!user) throw createError({ statusCode: 401, data: { code: 'unauthenticated', error: 'login_required' } })${f.auth === 'admin' ? `
  if (!user.admin) throw createError({ statusCode: 403, data: { code: 'permission-denied', error: 'admins_only' } })` : ''}`}
  let input
  try { input = parse${f.pascal}Input(await readBody(event)) } catch (e) { throw createError({ statusCode: 400, data: { code: 'invalid-argument', error: e instanceof ApiInputError ? e.message : 'bad_input' } }) }
  // TODO(dualcraft): implement and return the declared output
  void input
  throw createError({ statusCode: 501, data: { code: 'unimplemented', error: 'not_implemented' } })
})
`
  if (f.kind === 'webhook') return `import { createHmac, timingSafeEqual } from 'node:crypto'

${doc(f)}
export default defineEventHandler(async (event) => {
  const raw = (await readRawBody(event)) ?? ''
  const signature = getHeader(event, 'x-signature') ?? '' // TODO(dualcraft): the provider's signature header
  const secret = process.env.${f.secret} ?? ''
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(signature); const b = Buffer.from(expected)
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw createError({ statusCode: 401, statusMessage: 'bad_signature' })
  const payload = JSON.parse(raw) as { id?: string; type?: string }
  // TODO(dualcraft): skip already-processed payload.id, then handle payload.type
  void payload
  return 'ok'
})
`
  return `${doc(f)}
// Scheduled (${f.cron}) by the platform cron, which calls it with "Authorization: Bearer $CRON_SECRET".
export default defineEventHandler(async (event) => {
  if (!process.env.CRON_SECRET || getHeader(event, 'authorization') !== 'Bearer ' + process.env.CRON_SECRET) throw createError({ statusCode: 401 })
  // TODO(dualcraft): implement (safe to run twice)
  return 'ok'
})
`
}
