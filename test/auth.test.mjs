// Auth pack: config, catalogs per stack, server functions in the contract, texts, store rules and provider limits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeProject, makeMultiProject, write, read, exists } from './helpers.mjs'

const auth = (p, ...a) => run('auth.mjs', a, p)
const cfg = (p) => path.join(p, '.dualcraft', 'auth', 'auth.json')

test('init needs a backend; Firebase: catalogs for every stack, server functions exported, texts, rules helpers', () => {
  const p = makeMultiProject('firestore')
  assert.match(auth(p, 'init').err, /run \/dualcraft:backend init first/)
  run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
  const r = auth(p, 'init', '--methods', 'email,google,apple', '--roles', 'admin,editor,user')
  assert.equal(r.code, 0, r.err)
  for (const f of ['web/src/lib/auth-catalog.ts', 'rn/src/lib/auth-catalog.ts', 'kmp/composeApp/src/commonMain/kotlin/com/test/app/auth/AuthCatalog.kt', 'droid/app/src/main/java/com/test/droid/data/auth/AuthCatalog.kt', 'iosapp/Demo/Core/Auth/AuthCatalog.swift', 'functions/src/generated/auth.ts', 'functions/src/deleteAccount.ts', 'functions/src/setUserRole.ts', 'functions/scripts/grant-role.mjs']) assert.ok(exists(path.join(p, f)), f)
  const idx = read(path.join(p, 'functions/src/index.ts'))
  assert.match(idx, /export \{ deleteAccount \} from '\.\/deleteAccount'/); assert.match(idx, /export \{ setUserRole \} from '\.\/setUserRole'/)
  const api = JSON.parse(read(path.join(p, '.dualcraft/backend/api.json')))
  const sr = api.functions.find((f) => f.name === 'setUserRole')
  assert.equal(sr.auth, 'admin'); assert.deepEqual(sr.input.role.values, ['admin', 'editor', 'user']); assert.equal(sr.origin, 'auth')
  assert.match(read(path.join(p, 'web/src/lib/api-client.ts')), /deleteAccount/)
  const ts = read(path.join(p, 'web/src/lib/auth-catalog.ts'))
  assert.match(ts, /export type AuthRole = "admin" \| "editor" \| "user"/)
  assert.match(ts, /signInWithGoogle\(\): Promise<AuthUser>/); assert.match(ts, /signInAsGuest\(\): Promise<AuthUser>/); assert.match(ts, /linkApple\(\): Promise<AuthUser>/)
  assert.match(ts, /enrollTotpStart\(\): Promise<TotpEnrollment>/); assert.doesNotMatch(ts, /enrollSmsStart|signInWithPasskey|startPhoneSignIn/)
  assert.match(ts, /\{ pattern: "\/admin\/\*\*", access: \{ kind: 'roles', roles: \["admin"\] \} \}/)
  assert.match(read(path.join(p, 'iosapp/Demo/Core/Auth/AuthCatalog.swift')), /func signInWithEmail\(_ email: String, password: String\) async throws -> AuthUser/)
  assert.match(read(path.join(p, 'droid/app/src/main/java/com/test/droid/data/auth/AuthCatalog.kt')), /^package com\.test\.droid\.data\.auth$/m)
  const es = JSON.parse(read(path.join(p, '.dualcraft/i18n/es.json')))
  assert.equal(es.auth.errors.email_in_use, 'Ya existe una cuenta con este email'); assert.equal(es.auth.login.title, 'Inicia sesión', 'existing texts are kept')
  assert.match(r.out, /function hasRole\(r\)/); assert.match(r.out, /node scripts\/grant-role\.mjs you@example\.com admin/)
  // screens per UI stack (written once), with the UI texts seeded
  const screens = { 'web/src/components/auth/AuthScreens.tsx': /from 'react-i18next'/, 'rn/src/screens/auth/AuthScreens.tsx': /from 'react-native'/, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/ui/auth/AuthScreens.kt': /import k\.composeapp\.generated\.resources\.Res/, 'droid/app/src/main/java/com/test/droid/ui/auth/AuthScreens.kt': /import com\.test\.droid\.R$/m, 'iosapp/Demo/Features/Auth/AuthScreens.swift': /struct AuthFlowView: View/ }
  for (const [f, re] of Object.entries(screens)) assert.match(read(path.join(p, f)), re, f)
  assert.match(read(path.join(p, 'web/src/components/auth/AuthScreens.tsx')), /from '\.\.\/\.\.\/lib\/auth-catalog'/)
  assert.match(read(path.join(p, 'droid/app/src/main/java/com/test/droid/ui/auth/AuthScreens.kt')), /linkApple\(\)/)
  assert.doesNotMatch(read(path.join(p, 'rn/src/screens/auth/AuthScreens.tsx')), /startPhoneSignIn|enrollSmsStart/, 'only enabled methods')
  assert.equal(es.auth.ui.sign_in_title, 'Inicia sesión'); assert.equal(JSON.parse(read(path.join(p, '.dualcraft/i18n/en.json'))).auth.ui.delete_account, 'Delete account')
  const c = auth(p, 'check')
  assert.equal(c.code, 0, c.out)
  assert.equal(run('backend.mjs', ['check'], p).code, 0)
})

test('check: catalogs out of date, missing texts, Sign in with Apple, provider limits; validation errors', () => {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
  auth(p, 'init', '--methods', 'email,google,phone', '--mfa', 'totp,sms')
  const c = JSON.parse(read(cfg(p))); c.roles.push('moderator'); write(cfg(p), JSON.stringify(c))
  assert.match(read(path.join(p, 'app/lib/features/auth/auth_screens.dart')), /import '\.\.\/\.\.\/l10n\/app_localizations\.dart';/)
  const es = JSON.parse(read(path.join(p, '.dualcraft/i18n/es.json'))); delete es.auth.errors.network; delete es.auth.ui.sign_out; write(path.join(p, '.dualcraft/i18n/es.json'), JSON.stringify(es))
  const r = auth(p, 'check')
  assert.equal(r.code, 1)
  for (const re of [/app\/lib\/generated\/auth_catalog\.dart out of date/, /i18n es: missing auth\.errors\.network, auth\.ui\.sign_out/, /App Store 4\.8: .*Sign in with Apple/, /Identity Platform/, /phone: SMS has a cost/, /deletion\.webUrl/]) assert.match(r.out, re)
  assert.equal(auth(p, 'gen').code, 0)
  assert.match(read(path.join(p, 'app/lib/generated/auth_catalog.dart')), /enum AuthRole \{ admin, user, moderator \}/)
  // the implementation is written once; a method enabled later is reported until it is added by hand
  const impl = read(path.join(p, 'app/lib/services/auth_service.dart'))
  assert.match(impl, /class FirebaseAuthService implements AuthService/); assert.match(impl, /Future<String> startPhoneSignIn/); assert.doesNotMatch(impl, /signInWithApple/)
  write(cfg(p), JSON.stringify({ ...JSON.parse(read(cfg(p))), methods: ['email', 'google', 'phone', 'apple'] }))
  auth(p, 'gen')
  assert.equal(read(path.join(p, 'app/lib/services/auth_service.dart')), impl, 'never overwritten')
  assert.match(auth(p, 'check').out, /auth_service\.dart lacks signInWithApple, linkApple/)
  // validation
  write(cfg(p), JSON.stringify({ ...c, methods: ['email', 'fax', 'passkey'], defaultRole: 'nobody', routes: { ...c.routes, rules: [{ path: '/x', roles: ['ghost'] }, { path: 'y', access: 'everyone' }] } }))
  const v = auth(p, 'gen')
  assert.equal(v.code, 1)
  for (const re of [/unknown "fax"/, /defaultRole "nobody"/, /role "ghost" is not in roles/, /"y" must start with \//, /access must be public/, /passkey\.rpId/]) assert.match(v.out, re)
})

test('screens for Next.js (next-intl, client component) and Nuxt (Vue SFCs + redirect helper)', () => {
  for (const [web, files] of [['nextjs', { 'site/src/components/auth/AuthScreens.tsx': /^'use client'[\s\S]*from 'next-intl'/ }], ['nuxt', { 'site/app/components/auth/AuthFlow.vue': /<script setup lang="ts">[\s\S]*from '\.\.\/\.\.\/utils\/auth-catalog'/, 'site/app/components/auth/AccountScreen.vue': /deleteAccount/, 'site/app/utils/auth-redirect.ts': /export function authRedirect/ }]]) {
    const p = makeProject({ web, paths: { web: 'site' } })
    write(path.join(p, 'site', web === 'nuxt' ? 'app/app.vue' : 'src/app/page.tsx'), '')
    run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
    const r = auth(p, 'init', '--methods', 'email,google', '--no-guest')
    assert.equal(r.code, 0, r.err)
    for (const [f, re] of Object.entries(files)) assert.match(read(path.join(p, f)), re, f)
  }
})

test('Supabase: Edge Functions, app_metadata roles, RLS helpers, passkey limits on native SDKs', () => {
  const p = makeMultiProject('firestore')
  const cf = path.join(p, '.dualcraft', 'config.json'); write(cf, JSON.stringify({ ...JSON.parse(read(cf)), backend: { provider: 'supabase' } }))
  run('backend.mjs', ['init', '--provider', 'supabase'], p)
  const r = auth(p, 'init', '--methods', 'email,google,apple,passkey', '--rp-id', 'acme.app')
  assert.equal(r.code, 0, r.err)
  assert.match(read(path.join(p, 'supabase/functions/set-user-role/index.ts')), /app_metadata: \{ role: roleFrom\(input\.role\) \}/)
  assert.match(read(path.join(p, 'supabase/functions/delete-account/index.ts')), /admin\.auth\.admin\.deleteUser/)
  assert.match(read(path.join(p, 'supabase/functions/_shared/auth.ts')), /export const ADMIN_ROLE: Role = "admin"/)
  assert.match(r.out, /public\.has_role/); assert.match(r.out, /raw_app_meta_data/)
  const c = auth(p, 'check')
  assert.equal(c.code, 0, c.out)
  assert.match(c.out, /Supabase passkeys are beta and only in supabase-js \/ supabase_flutter/)
})
