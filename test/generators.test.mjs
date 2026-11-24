// Generators for every stack: tokens, models, analytics, i18n — outputs, formats and hand-edit guards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { run, makeMultiProject, makeProject, read, write, exists } from './helpers.mjs'

const dir = makeMultiProject('firestore')
const P = (...p) => path.join(dir, ...p)
const KT = (stack, ...p) => (stack === 'kmp' ? P('kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', ...p) : P('droid', 'app', 'src', 'main', 'java', 'com', 'test', 'droid', ...p))

test('tokens: one output per stack with the right idioms', () => {
  const r = run('tokens.mjs', ['all'], dir)
  assert.equal(r.code, 0, r.err)
  const css = read(P('web', 'src', 'styles', 'ds-tokens.css'))
  assert.match(css, /--color-primary/); assert.match(css, /prefers-color-scheme: dark/)
  const ts = read(P('rn', 'src', 'theme', 'ds-tokens.ts'))
  assert.match(ts, /export function useDsTheme\(\)/); assert.match(ts, /dsSpacing = \{\s+s1: 4/)
  const kt = read(KT('kmp', 'theme', 'DsTokens.kt'))
  assert.match(kt, /^\/\/ dualcraft:hash=/); assert.match(kt, /package com\.test\.app\.theme/); assert.match(kt, /fun DsTheme\(/); assert.match(kt, /Color\(0xFF0F74C5\)/)
  assert.match(read(KT('android', 'ui', 'theme', 'DsTokens.kt')), /package com\.test\.droid\.ui\.theme/)
  const sw = read(P('iosapp', 'Demo', 'DesignSystem', 'DsTokens.swift'))
  assert.match(sw, /static let primary = Color\.ds\(0x0F74C5FF, 0x70B3F7FF\)/)
})

test('tokens: contrast failures are reported and warnings never leak into --stdout code', () => {
  const chk = run('tokens.mjs', ['check'], dir)
  assert.match(chk.out, /✗ contrast muted on surface/)
  const ts = run('tokens.mjs', ['ts', '--stdout'], dir)
  assert.doesNotMatch(ts.out, /contrast pair/)
})

test('tokens: rejects unsupported values and map-shaped families', () => {
  const t = makeProject(); const f = path.join(t, 'bad.json')
  write(f, JSON.stringify({ name: 'x', color: { tokens: [{ name: 'a', value: 'red' }] }, spacing: { s: { $value: '4px' } } }))
  const r = run('tokens.mjs', ['check', '--file', f], t)
  assert.equal(r.code, 1); assert.match(r.out, /unsupported or unresolved value "red"/); assert.match(r.out, /a list, not a name→value map/)
})

test('models: TS, Kotlin and Swift per stack + Firestore rules', () => {
  const r = run('gen.mjs', ['all'], dir)
  assert.equal(r.code, 0, r.err)
  assert.match(read(P('web', 'src', 'types', 'db.ts')), /export interface Users \{/)
  const kt = read(KT('kmp', 'model', 'DbModels.kt'))
  assert.match(kt, /@SerialName\("in-progress"\) IN_PROGRESS/); assert.match(kt, /@SerialName\("class"\) val classValue: String\? = null/)
  const sw = read(P('iosapp', 'Demo', 'Core', 'Models', 'DbModels.swift'))
  assert.match(sw, /case inProgress = "in-progress"/); assert.match(sw, /case classValue = "class"/); assert.match(sw, /enum DsJSONValue/)
  const rules = read(P('firestore.rules.generated'))
  assert.match(rules, /match \/users\/\{userId\}\/sessions\/\{sessionsId\}/); assert.match(rules, /d\['class'\]/)
})

test('analytics: helpers per stack, reserved names rejected, coverage finds usage', () => {
  assert.equal(run('analytics.mjs', ['gen'], dir).code, 0)
  assert.match(read(KT('kmp', 'analytics', 'AnalyticsEvents.kt')), /fun signUp\(method: SignUpMethod\) = AnalyticsEvent\("sign_up"/)
  assert.match(read(P('iosapp', 'Demo', 'Core', 'Analytics', 'AnalyticsEvents.swift')), /static func signUp\(method: SignUpSignUpMethod|static func signUp\(method: SignUpMethod\)/)
  assert.match(read(P('docs', 'ANALYTICS.md')), /\| `sign_up` \|/)
  const cov = run('analytics.mjs', ['coverage'], dir).out
  assert.match(cov, /match_viewed\s+–\s+✓/)
  const ev = P('.dualcraft', 'analytics', 'events.json'); const plan = JSON.parse(read(ev)); plan.events.push({ name: 'first_open' }); write(ev, JSON.stringify(plan))
  const chk = run('analytics.mjs', ['check'], dir)
  assert.equal(chk.code, 1); assert.match(chk.out, /reserved by Firebase/)
  plan.events.pop(); write(ev, JSON.stringify(plan))
})

test('i18n: formats per stack (i18next JSON, Android/KMP XML with plurals, xcstrings) and checks', () => {
  assert.equal(run('i18n.mjs', ['check'], dir).code, 0)
  assert.equal(run('i18n.mjs', ['gen'], dir).code, 0)
  const xml = read(KT('android').replace(/java.*$/, path.join('res', 'values', 'ds_strings.xml')))
  assert.match(xml, /<string name="auth_login_welcome">Hola, %1\$s<\/string>/)
  assert.match(xml, /<plurals name="matches_count">[\s\S]*<item quantity="one">%1\$d partido<\/item>/)
  assert.ok(exists(P('kmp', 'composeApp', 'src', 'commonMain', 'composeResources', 'values-en', 'ds_strings.xml')))
  const xc = JSON.parse(read(P('iosapp', 'Demo', 'Resources', 'DualCraft.xcstrings')))
  assert.equal(xc.strings['auth.login.welcome'].localizations.es.stringUnit.value, 'Hola, %@')
  assert.equal(xc.strings['matches.count'].localizations.en.variations.plural.one.stringUnit.value, '%lld match')
  assert.ok(JSON.parse(read(P('rn', 'src', 'locales', 'es.json'))).auth)
  const es = P('.dualcraft', 'i18n', 'en.json'); const before = read(es)
  write(es, before.replace('{name}', '{nombre}'))
  const bad = run('i18n.mjs', ['check'], dir)
  assert.equal(bad.code, 1); assert.match(bad.out, /placeholders \{nombre\} differ/)
  write(es, before)
})

test('guards: generated files edited by hand are not overwritten without --force', () => {
  const css = P('web', 'src', 'styles', 'ds-tokens.css')
  fs.appendFileSync(css, '/* hand edit */')
  const r = run('tokens.mjs', ['all'], dir)
  assert.notEqual(r.code, 0); assert.match(r.err, /edited by hand/)
  assert.equal(run('tokens.mjs', ['all', '--force'], dir).code, 0)
  const xml = KT('android').replace(/java.*$/, path.join('res', 'values', 'ds_strings.xml'))
  fs.appendFileSync(xml, '<!-- x -->')
  assert.match(run('i18n.mjs', ['gen'], dir).err, /edited by hand/)
  run('i18n.mjs', ['gen', '--force'], dir)
  const xc = P('iosapp', 'Demo', 'Resources', 'DualCraft.xcstrings')
  fs.appendFileSync(xc, ' ')
  assert.match(run('i18n.mjs', ['gen'], dir).err, /edited by hand/)
})
