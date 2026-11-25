#!/usr/bin/env node
// DualCraft auth: .dualcraft/auth/auth.json describes sign-in methods, roles, route access, guest/linking, MFA and
// account deletion. From it DualCraft generates a typed auth catalog per stack (roles, decideAccess, password policy,
// normalized errors, the AuthService interface), the server pieces (deleteAccount, setUserRole) and the error texts.
//   init [--methods email,google,apple,passkey,phone] [--roles admin,user] [--mfa totp,sms|none] [--no-guest] [--no-linking]
//   gen [--force]        catalogs per stack + server catalog + contract functions (backend gen)
//   check [--json]       config, catalogs in sync, server pieces, i18n texts, store rules (Sign in with Apple), provider limits
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, outputFor } from './lib/targets.mjs'
import { METHODS, ACCESS, MFA_FACTORS, ERROR_CODES, snake, genTs, genDart, genKotlin, genSwift, genServer } from './lib/auth-gen.mjs'
import * as T from './lib/auth-templates.mjs'
import { flutterFirebase, flutterSupabase } from './lib/auth-clients.mjs'
import { tsFirebase, tsSupabase, rnFirebase } from './lib/auth-clients-ts.mjs'
import { kotlinFirebase, kotlinSupabase } from './lib/auth-clients-kt.mjs'
import { swiftFirebase, swiftSupabase } from './lib/auth-clients-swift.mjs'
import { serviceMembers } from './lib/auth-gen.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check'].includes(cmd)) {
  console.log(`node auth.mjs init [--methods email,google,apple,passkey,phone] [--rp-id acme.app] [--roles admin,user] [--mfa totp,sms|none] [--no-guest] [--no-linking] | gen [--force] | check [--json]
auth.json: {"provider":"firebase","methods":["email","google","apple"],"guest":true,"linking":true,
  "email":{"verification":"required"},"password":{"minLength":8,"upper":false,"digit":true,"symbol":false},
  "mfa":{"factors":["totp"],"enforce":"optional|admins|all"},"roles":["admin","user"],"defaultRole":"user","adminRole":"admin",
  "routes":{"signIn":"/login","afterSignIn":"/","verifyEmail":"/verify-email","rules":[{"path":"/admin/**","roles":["admin"]},{"path":"/account/**","access":"signedIn"},{"path":"/**","access":"guest"}]},
  "deletion":{"webUrl":"https://acme.app/delete-account","cleanup":[{"collection":"users"},{"collection":"posts","field":"authorId"}],"storage":["users/{uid}/"]},
  "passkey":{"rpId":"acme.app","rpName":"Acme"}}
access: public | guest (any session, also anonymous) | signedIn (a real account) | verified (email verified) | roles:[…]`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'auth', 'auth.json')
const apiFile = path.join(dir, 'backend', 'api.json')
const rel = (p) => posix(path.relative(root, p))
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const backend = (...a) => spawnSync(process.execPath, [path.join(HERE, 'backend.mjs'), ...a], { cwd: root, encoding: 'utf8' })
const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean)
const stacks = projectStacks(root, config)
const provider = () => readJson(apiFile)?.provider || ({ firebase: 'firebase', supabase: 'supabase', 'postgres-prisma': 'http' })[config.backend?.provider] || null
const functionsDir = () => {
  if (config.paths?.functions) return path.join(root, config.paths.functions)
  const s = [].concat(readJson(path.join(root, 'firebase.json'))?.functions || [])[0]?.source
  return path.join(root, s || 'functions')
}
const serverCatalogFile = (prov) => (prov === 'firebase' ? path.join(functionsDir(), 'src', 'generated', 'auth.ts') : prov === 'supabase' ? path.join(root, 'supabase', 'functions', '_shared', 'auth.ts') : null)
const LANG = { flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }
const IOS_CAPABLE = ['flutter', 'ios', 'react-native', 'kmp']

// ---------------------------------------------------------------- config
function defaults(prov) {
  const roles = opt.roles ? list(opt.roles) : ['admin', 'user']
  const adminRole = opt['admin-role'] ? String(opt['admin-role']) : roles.includes('admin') ? 'admin' : roles[0]
  const guest = !opt['no-guest']
  return {
    provider: prov,
    methods: opt.methods ? list(opt.methods) : ['email', 'google', 'apple'],
    guest,
    linking: !opt['no-linking'],
    email: { verification: 'required' },
    password: { minLength: 8, upper: false, digit: true, symbol: false },
    mfa: { factors: opt.mfa === 'none' ? [] : opt.mfa ? list(opt.mfa) : ['totp'], enforce: 'optional' },
    roles, defaultRole: roles.includes('user') ? 'user' : roles[roles.length - 1], adminRole,
    routes: { signIn: '/login', afterSignIn: '/', verifyEmail: '/verify-email', rules: [
      { path: '/login', access: 'public' }, { path: '/signup', access: 'public' }, { path: '/forgot-password', access: 'public' },
      { path: '/admin/**', roles: [adminRole] }, { path: '/account/**', access: 'signedIn' }, { path: '/**', access: guest ? 'guest' : 'signedIn' },
    ] },
    deletion: { webUrl: readJson(path.join(dir, 'legal', 'data-map.json'))?.accountDeletionUrl || null, recentLoginSeconds: 300, cleanup: prov === 'supabase' ? [] : [{ collection: 'users' }], storage: prov === 'supabase' ? [] : ['users/{uid}/'] },
    passkey: { rpId: opt['rp-id'] ? String(opt['rp-id']) : null, rpName: config.name || 'App' },
  }
}
const load = () => readJson(file) || die(`no ${rel(file)} — run: auth.mjs init`)
function validate(c) {
  const errors = []; const warnings = []
  for (const m of c.methods || []) if (!METHODS.includes(m)) errors.push(`methods: unknown "${m}" (${METHODS.join(', ')})`)
  if (!c.methods?.length && !c.guest) errors.push('methods: at least one sign-in method')
  if (!c.roles?.length) errors.push('roles: at least one role')
  for (const r of c.roles || []) if (!/^[a-z][a-zA-Z0-9]*$/.test(r)) errors.push(`roles: "${r}" must be lowerCamelCase`)
  if (!c.roles?.includes(c.defaultRole)) errors.push(`defaultRole "${c.defaultRole}" is not in roles`)
  if (!c.roles?.includes(c.adminRole)) errors.push(`adminRole "${c.adminRole}" is not in roles`)
  for (const f of c.mfa?.factors || []) if (!MFA_FACTORS.includes(f)) errors.push(`mfa.factors: unknown "${f}" (${MFA_FACTORS.join(', ')})`)
  if (!['optional', 'admins', 'all'].includes(c.mfa?.enforce || 'optional')) errors.push('mfa.enforce: optional | admins | all')
  if (!(c.password?.minLength >= 6)) errors.push('password.minLength must be ≥ 6 (Firebase and Supabase minimum)')
  for (const k of ['signIn', 'afterSignIn', 'verifyEmail']) if (!String(c.routes?.[k] || '').startsWith('/')) errors.push(`routes.${k} must be a path`)
  for (const r of c.routes?.rules || []) {
    if (!String(r.path || '').startsWith('/')) errors.push(`routes.rules: "${r.path}" must start with /`)
    if (r.roles) { for (const x of r.roles) if (!c.roles?.includes(x)) errors.push(`routes.rules ${r.path}: role "${x}" is not in roles`) } else if (!ACCESS.includes(r.access)) errors.push(`routes.rules ${r.path}: access must be ${ACCESS.join(' | ')} or roles:[…]`)
  }
  if (c.routes?.rules?.some((r) => r.path === c.routes.signIn && r.access !== 'public') || (c.routes && !c.routes.rules?.some((r) => r.path === c.routes.signIn))) warnings.push(`routes: the sign-in page ${c.routes?.signIn} should have a "public" rule`)
  if (c.methods?.includes('passkey') && !c.passkey?.rpId) errors.push('passkey.rpId: your domain (e.g. acme.app) — passkeys are bound to it (assetlinks.json / apple-app-site-association)')
  return { errors, warnings }
}

// ---------------------------------------------------------------- i18n texts
const TEXTS = {
  es: { errors: { invalid_credentials: 'Email o contraseña incorrectos', invalid_email: 'El email no es válido', email_in_use: 'Ya existe una cuenta con este email', weak_password: 'La contraseña es demasiado débil', email_not_verified: 'Verifica tu email para continuar', requires_recent_login: 'Por seguridad, vuelve a iniciar sesión', mfa_required: 'Introduce el código de tu segundo factor', invalid_code: 'El código no es correcto', code_expired: 'El código ha caducado, pide otro', account_exists_with_different_method: 'Ya tienes una cuenta con otro método de acceso', credential_in_use: 'Ese método ya está vinculado a otra cuenta', already_linked: 'Ese método ya está vinculado a tu cuenta', user_disabled: 'Esta cuenta está desactivada', too_many_requests: 'Demasiados intentos, espera un momento', network: 'Sin conexión, inténtalo de nuevo', cancelled: 'Inicio de sesión cancelado', method_disabled: 'Este método de acceso no está disponible', unknown: 'Algo ha fallado, inténtalo de nuevo' }, password: { too_short: 'Al menos {min} caracteres', no_upper: 'Al menos una mayúscula', no_digit: 'Al menos un número', no_symbol: 'Al menos un símbolo' } },
  en: { errors: { invalid_credentials: 'Wrong email or password', invalid_email: 'This email is not valid', email_in_use: 'An account with this email already exists', weak_password: 'The password is too weak', email_not_verified: 'Verify your email to continue', requires_recent_login: 'For your security, sign in again', mfa_required: 'Enter the code from your second factor', invalid_code: 'The code is not correct', code_expired: 'The code has expired, request a new one', account_exists_with_different_method: 'You already have an account with another sign-in method', credential_in_use: 'That method is already linked to another account', already_linked: 'That method is already linked to your account', user_disabled: 'This account is disabled', too_many_requests: 'Too many attempts, wait a moment', network: 'No connection, try again', cancelled: 'Sign-in cancelled', method_disabled: 'This sign-in method is not available', unknown: 'Something went wrong, try again' }, password: { too_short: 'At least {min} characters', no_upper: 'At least one uppercase letter', no_digit: 'At least one number', no_symbol: 'At least one symbol' } },
}
const PASSWORD_KEYS = ['too_short', 'no_upper', 'no_digit', 'no_symbol']
function locales() {
  const d = path.join(dir, 'i18n')
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.replace('.json', '')) : []
}
/** Adds missing auth texts to every locale (never overwrites). */
function seedTexts() {
  const added = []
  for (const l of locales()) {
    const f = path.join(dir, 'i18n', l + '.json'); const j = readJson(f) || {}
    const src = TEXTS[l.slice(0, 2)] || TEXTS.en
    let n = 0
    j.auth ||= {}
    for (const grp of ['errors', 'password']) { j.auth[grp] ||= {}; for (const [k, v] of Object.entries(src[grp])) if (j.auth[grp][k] === undefined) { j.auth[grp][k] = v; n++ } }
    if (n) { fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); added.push(`${rel(f)}: +${n} auth texts${TEXTS[l.slice(0, 2)] ? '' : ' (English placeholders: translate them)'}`) }
  }
  return added
}

// ---------------------------------------------------------------- server functions in the contract
const CONTRACT = (c) => [
  { name: 'deleteAccount', kind: 'callable', auth: 'user', description: 'Borra la cuenta del usuario y sus datos (requiere un inicio de sesión reciente)', platforms: ['web', 'mobile'], input: {}, output: { deleted: { type: 'bool', required: true } }, errors: ['failed-precondition'], origin: 'auth' },
  { name: 'setUserRole', kind: 'callable', auth: 'admin', description: 'Asigna un rol a un usuario (solo administradores)', platforms: ['web', 'mobile'], input: { uid: { type: 'string', required: true, minLength: 1, maxLength: 128 }, role: { type: 'string', required: true, values: c.roles } }, output: {}, errors: ['not-found', 'failed-precondition'], origin: 'auth' },
]
function syncContract(c) {
  const api = readJson(apiFile); if (!api) return false
  let changed = false
  for (const f of CONTRACT(c)) {
    const i = (api.functions || []).findIndex((x) => x.name === f.name)
    if (i < 0) { (api.functions ||= []).push(f); changed = true } else if (JSON.stringify(api.functions[i].input) !== JSON.stringify(f.input) || api.functions[i].origin !== 'auth') { api.functions[i] = { ...api.functions[i], ...f }; changed = true }
  }
  if (changed) fs.writeFileSync(apiFile, JSON.stringify(api, null, 2) + '\n')
  return changed
}
function scaffoldServer(prov) {
  const made = []
  if (prov === 'firebase') {
    const fd = functionsDir()
    made.push(writeNew(path.join(fd, 'src', 'deleteAccount.ts'), T.firebaseDeleteAccount), writeNew(path.join(fd, 'src', 'setUserRole.ts'), T.firebaseSetUserRole), writeNew(path.join(fd, 'scripts', 'grant-role.mjs'), T.firebaseGrantRole))
  } else if (prov === 'supabase') {
    const sf = path.join(root, 'supabase', 'functions')
    made.push(writeNew(path.join(sf, 'delete-account', 'index.ts'), T.supabaseDeleteAccount), writeNew(path.join(sf, 'set-user-role', 'index.ts'), T.supabaseSetUserRole))
  }
  return made.filter(Boolean)
}

// ---------------------------------------------------------------- AuthService implementations (written once)
const WEB = ['nextjs', 'react-vite', 'astro', 'nuxt']
/** { file, text } of the implementation for a stack, or null when DualCraft has none for that stack/provider yet. */
function implFor(c, s, prov) {
  const dirOf = path.dirname(outputFor('auth', s, root, config).file)
  if (s.id === 'flutter' && (prov === 'firebase' || prov === 'supabase')) return { file: path.join(s.dir, 'lib', 'services', 'auth_service.dart'), text: prov === 'firebase' ? flutterFirebase(c) : flutterSupabase(c) }
  if (WEB.includes(s.id) && (prov === 'firebase' || prov === 'supabase')) return { file: path.join(dirOf, 'auth-service.ts'), text: prov === 'firebase' ? tsFirebase(c) : tsSupabase(c) }
  if (s.id === 'react-native' && (prov === 'firebase' || prov === 'supabase')) return { file: path.join(dirOf, 'auth-service.ts'), text: prov === 'firebase' ? rnFirebase(c) : tsSupabase(c, { native: true }) }
  if ((s.id === 'android' && (prov === 'firebase' || prov === 'supabase')) || (s.id === 'kmp' && prov === 'supabase')) {
    const pkgs = { pkg: outputFor('auth', s, root, config).pkg, apiPkg: outputFor('api', s, root, config).pkg }
    return prov === 'firebase' ? { file: path.join(dirOf, 'FirebaseAuthService.kt'), text: kotlinFirebase(c, pkgs) } : { file: path.join(dirOf, 'SupabaseAuthService.kt'), text: kotlinSupabase(c, pkgs) }
  }
  if (s.id === 'ios' && (prov === 'firebase' || prov === 'supabase')) return prov === 'firebase' ? { file: path.join(dirOf, 'FirebaseAuthService.swift'), text: swiftFirebase(c) } : { file: path.join(dirOf, 'SupabaseAuthService.swift'), text: swiftSupabase(c) }
  return null
}
const writeImpls = (c, prov) => stacks.map((s) => implFor(c, s, prov)).filter(Boolean).map((i) => writeNew(i.file, i.text)).filter(Boolean).map((f) => f + ' (AuthService implementation — yours)')

// ---------------------------------------------------------------- generate
const expected = (c, s) => {
  const t = outputFor('auth', s, root, config); const lang = LANG[s.id] || 'ts'
  return { file: t.file, lang, text: stamp(lang === 'dart' ? genDart(c) : lang === 'kotlin' ? genKotlin(c, t.pkg) : lang === 'swift' ? genSwift(c) : genTs(c)) }
}
function generate(c, force) {
  const { errors } = validate(c)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix auth.json first.') }
  const written = []
  for (const s of stacks) { const e = expected(c, s); written.push(writeGuarded(e.file, e.text, { root, force })) }
  const prov = c.provider || provider()
  const sf = serverCatalogFile(prov)
  if (sf) written.push(writeGuarded(sf, stamp(genServer(c, prov)), { root, force }))
  // backend add declares the function, exports it from the entry point and scaffolds what scaffoldServer didn't write
  if (fs.existsSync(apiFile)) for (const f of CONTRACT(c)) if (!(readJson(apiFile).functions || []).some((x) => x.name === f.name)) { const r = backend('add', f.name, '--kind', 'callable', '--auth', f.auth, '--platforms', 'web,mobile'); if (r.status !== 0) die('backend add failed:\n' + r.stdout + r.stderr) }
  if (syncContract(c)) written.push(rel(apiFile) + ' (deleteAccount, setUserRole)')
  if (fs.existsSync(apiFile)) {
    const r = backend('gen', ...(force ? ['--force'] : [])); if (r.status !== 0) die('backend gen failed:\n' + r.stdout + r.stderr)
    r.stdout.split('\n').filter(Boolean).forEach((l) => written.push(l.replace(/^→ /, '') + ' (backend)'))
  }
  written.push(...seedTexts(), ...writeImpls(c, prov))
  return written
}

if (cmd === 'init') {
  const prov = provider()
  if (!prov) die('no backend yet — run /dualcraft:backend init first (deletion and roles live on the server)')
  const exists = fs.existsSync(file)
  if (!exists) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(defaults(prov), null, 2) + '\n') }
  console.log(`${exists ? 'kept' : 'created'} ${rel(file)}`)
  const c = load()
  for (const m of scaffoldServer(prov)) console.log('+ ' + m)
  if (prov === 'http') console.log('⚠ provider "http": auth runs on your own server — the catalogs and texts are generated; implement deleteAccount/setUserRole in your API routes.')
  const v = validate(c)
  if (v.errors.length) { v.errors.forEach((e) => console.log('✗ ' + e)); console.log(`Complete ${rel(file)}, then run: auth.mjs gen`); seedTexts().forEach((w) => console.log('→ ' + w)) }
  else generate(c, !!opt.force).forEach((w) => console.log('→ ' + w))
  console.log('\n' + (prov === 'supabase' ? T.supabaseRlsHelpers(c.adminRole) + '\n\nFirst admin:\n' + T.supabaseGrantRoleSql(c.adminRole) : T.firestoreRulesHelpers(c.adminRole) + `\n\nFirst admin: cd ${rel(functionsDir())} && node scripts/grant-role.mjs you@example.com ${c.adminRole}`))
  process.exit(0)
}

if (cmd === 'gen') { generate(load(), !!opt.force).forEach((w) => console.log('→ ' + w)); process.exit(0) }

// ---------------------------------------------------------------- check
const c = load()
const { errors, warnings } = validate(c)
const issues = [...errors.map((m) => ({ level: 'error', m })), ...warnings.map((m) => ({ level: 'warn', m }))]
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
const prov = c.provider || provider()
if (!errors.length) {
  for (const s of stacks) { const e = expected(c, s); if (read(e.file) !== e.text) err(`${rel(e.file)} out of date — run: auth.mjs gen`) }
  const sf = serverCatalogFile(prov)
  if (sf && read(sf) !== stamp(genServer(c, prov))) err(`${rel(sf)} out of date — run: auth.mjs gen`)
}
const api = readJson(apiFile)
for (const f of CONTRACT(c)) if (api && !(api.functions || []).some((x) => x.name === f.name)) err(`backend contract: ${f.name} missing — run: auth.mjs gen`)
if (prov === 'firebase') for (const f of ['deleteAccount', 'setUserRole']) if (!fs.existsSync(path.join(functionsDir(), 'src', f + '.ts'))) err(`${f}: no implementation in ${rel(path.join(functionsDir(), 'src'))}`)
if (prov === 'supabase') for (const f of ['delete-account', 'set-user-role']) if (!fs.existsSync(path.join(root, 'supabase', 'functions', f, 'index.ts'))) err(`${f}: no Edge Function`)
// implementations: every method of the interface (methods enabled later must be added by hand)
if (!errors.length) for (const s of stacks) {
  const i = implFor(c, s, prov)
  if (!i) { warn(`${s.id}: no DualCraft AuthService implementation for ${prov} yet — implement the interface in ${rel(outputFor('auth', s, root, config).file)}`); continue }
  if (!fs.existsSync(i.file)) { err(`${rel(i.file)} missing — run: auth.mjs gen`); continue }
  const src = read(i.file)
  const miss = serviceMembers(c).map(([n]) => n).filter((n) => !new RegExp(`\\b${n}\\s*\\(`).test(src))
  if (miss.length) err(`${rel(i.file)} lacks ${miss.join(', ')} (enabled after it was created: add them, see the generated interface)`)
}
// texts
for (const l of locales()) {
  const t = readJson(path.join(dir, 'i18n', l + '.json'))?.auth || {}
  const miss = [...ERROR_CODES.map((e) => 'errors.' + snake(e)), ...PASSWORD_KEYS.map((k) => 'password.' + k)].filter((k) => { const [g, x] = k.split('.'); return !t[g]?.[x] })
  if (miss.length) err(`i18n ${l}: missing auth.${miss.slice(0, 4).join(', auth.')}${miss.length > 4 ? ` (+${miss.length - 4})` : ''} — run: auth.mjs gen`)
}
// store rules and provider limits
const ids = stacks.map((s) => s.id)
const mobile = ids.some((x) => IOS_CAPABLE.includes(x))
if (mobile && c.methods.includes('google') && !c.methods.includes('apple')) err('App Store 4.8: an iOS app with Google sign-in must also offer Sign in with Apple (add "apple" to methods)')
if (mobile && !c.deletion?.webUrl) warn('deletion.webUrl: Google Play asks for a web page where users can request account deletion (also legal/data-map.json accountDeletionUrl)')
if ((c.mfa?.factors || []).length && prov === 'firebase') warn('mfa: Firebase multi-factor (TOTP and SMS) needs "Firebase Authentication with Identity Platform" (Console → Authentication → Settings)')
if ((c.mfa?.factors || []).length) warn('mfa: a second factor can only be added to accounts with a verified email — not to guest or phone-only accounts')
if ((c.mfa?.factors || []).includes('totp') && prov === 'firebase' && ids.includes('react-native')) warn('mfa totp: @react-native-firebase has no TOTP second factor (nor unenroll) — on React Native only SMS works; manage TOTP from the web app')
if ((c.mfa?.factors || []).includes('sms') && prov === 'supabase') warn('mfa sms: Supabase phone MFA needs an SMS provider (Twilio, MessageBird, Vonage) configured')
if (c.methods.includes('phone')) warn(`phone: SMS has a cost per message and attracts toll fraud — ${prov === 'firebase' ? 'enable App Check and set an SMS region policy' : 'configure the SMS provider and CAPTCHA protection'}`)
if (c.guest) warn(`guest: enable ${prov === 'supabase' ? 'anonymous sign-ins (Authentication → Providers) with CAPTCHA, and clean up stale anonymous users' : 'the Anonymous provider and plan a cleanup of stale anonymous accounts'}`)
if (c.methods.includes('passkey')) {
  if (prov === 'firebase') warn('passkey: Firebase has no native passkeys — DualCraft verifies them in your own Cloud Functions and signs in with a custom token (needs the Service Account Token Creator role)')
  if (prov === 'supabase' && ids.some((x) => ['android', 'kmp', 'ios'].includes(x))) warn('passkey: Supabase passkeys are beta and only in supabase-js / supabase_flutter — the native Kotlin/Swift SDKs do not have them yet')
}
if (opt.json) { console.log(JSON.stringify({ provider: prov, issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Auth (${prov || 'no backend'}) — methods: ${c.methods.join(', ')}${c.guest ? ', guest' : ''} · roles: ${c.roles.join(', ')} · MFA: ${(c.mfa?.factors || []).join(', ') || 'off'}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `auth OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
