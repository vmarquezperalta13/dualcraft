#!/usr/bin/env node
// DualCraft tracking plan: .dualcraft/analytics/events.json is the single source of analytics events for web and mobile.
//   check      validate names, params and types against GA4 / Firebase Analytics limits
//   gen        typed helpers: Dart (lib/generated/analytics_events.dart) + TypeScript (…/lib/analytics-events.ts) + docs/ANALYTICS.md
//   coverage   which declared events are actually used in each platform's code
// Options: --force · --out-dart path · --out-ts path · --out-doc path
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, outputFor } from './lib/targets.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['check', 'gen', 'coverage'].includes(cmd)) {
  console.log(`node analytics.mjs check | gen [--force] | coverage
events.json: {"events":[{"name":"sign_up","description":"…","platforms":["web","mobile"],
  "params":{"method":{"type":"string","values":["google","email"],"required":true}},"since":"1.3.0","origin":"T-004"}],
  "userProperties":[{"name":"plan","type":"string","values":["free","pro"],"description":"…"}]}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'analytics', 'events.json')
if (!fs.existsSync(file)) die('no .dualcraft/analytics/events.json yet — create the tracking plan with /dualcraft:analytics')
let plan
try { plan = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`events.json is not valid JSON: ${e.message}`) }
const events = plan.events || []; const props = plan.userProperties || []
const errors = []; const warnings = []

const RESERVED_EVENTS = new Set(['ad_activeview', 'ad_click', 'ad_exposure', 'ad_query', 'ad_reward', 'adunit_exposure', 'app_background', 'app_clear_data', 'app_exception', 'app_remove', 'app_store_refund', 'app_store_subscription_cancel', 'app_store_subscription_convert', 'app_store_subscription_renew', 'app_update', 'app_upgrade', 'dynamic_link_app_open', 'dynamic_link_app_update', 'dynamic_link_first_open', 'error', 'first_open', 'first_visit', 'in_app_purchase', 'notification_dismiss', 'notification_foreground', 'notification_open', 'notification_receive', 'os_update', 'session_start', 'session_start_with_rollout', 'user_engagement'])
const RESERVED_PREFIX = /^(firebase_|google_|ga_)/
const NAME = /^[a-z][a-z0-9_]{0,39}$/
const TYPES = ['string', 'int', 'double', 'bool']
const PLATFORMS = ['web', 'mobile']

const seen = new Set()
for (const e of events) {
  const where = `event "${e.name}"`
  if (!NAME.test(e.name || '')) errors.push(`${where}: name must be snake_case, start with a letter, ≤ 40 chars`)
  if (RESERVED_EVENTS.has(e.name)) errors.push(`${where}: reserved by Firebase/GA4`)
  if (RESERVED_PREFIX.test(e.name || '')) errors.push(`${where}: prefixes firebase_, google_, ga_ are reserved`)
  if (seen.has(e.name)) errors.push(`${where}: duplicated`)
  seen.add(e.name)
  if (!e.description) warnings.push(`${where}: no description (marketing needs to know what it means)`)
  const pl = e.platforms || PLATFORMS
  if (pl.some((p) => !PLATFORMS.includes(p))) errors.push(`${where}: platforms must be "web" and/or "mobile"`)
  const params = Object.entries(e.params || {})
  if (params.length > 25) errors.push(`${where}: more than 25 params`)
  for (const [n, p] of params) {
    if (!NAME.test(n)) errors.push(`${where}: param "${n}" must be snake_case ≤ 40 chars`)
    if (RESERVED_PREFIX.test(n)) errors.push(`${where}: param "${n}" uses a reserved prefix`)
    if (!TYPES.includes(p.type)) errors.push(`${where}: param "${n}" type must be ${TYPES.join('|')}`)
    if (p.values && (p.type !== 'string' || !Array.isArray(p.values) || !p.values.length)) errors.push(`${where}: param "${n}" values[] only for string params`)
    if (p.type === 'bool') warnings.push(`${where}: param "${n}" is bool — sent as 1/0 (Firebase Analytics has no booleans)`)
  }
}
const seenP = new Set()
for (const p of props) {
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(p.name || '')) errors.push(`user property "${p.name}": snake_case ≤ 24 chars`)
  if (RESERVED_PREFIX.test(p.name || '')) errors.push(`user property "${p.name}": reserved prefix`)
  if (seenP.has(p.name)) errors.push(`user property "${p.name}": duplicated`)
  seenP.add(p.name)
}
if (props.length > 25) errors.push('more than 25 user properties')

const camel = (s) => s.split('_').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
const pascal = (s) => { const c = camel(s); return c[0].toUpperCase() + c.slice(1) }
const forPlatform = (p) => events.filter((e) => (e.platforms || PLATFORMS).includes(p))
const stackDir = (k) => path.join(root, config.paths?.[k] || '')

function report() {
  errors.forEach((e) => console.log('✗ ' + e)); warnings.forEach((w) => console.log('⚠ ' + w))
  console.log(`${events.length} events (web ${forPlatform('web').length}, mobile ${forPlatform('mobile').length}) · ${props.length} user properties`)
}
if (cmd === 'check') { report(); process.exit(errors.length ? 1 : 0) }
if (errors.length) { report(); die('fix the tracking plan errors first.') }

// ---------- coverage ----------
if (cmd === 'coverage') {
  const grepDir = (d, ext, re) => {
    let hit = false
    const walk = (x) => { if (hit || !fs.existsSync(x)) return; for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.|build|generated)/.test(e.name)) walk(p) } else if (ext.test(e.name) && !/analytics[_-]?events/i.test(e.name) && re.test(fs.readFileSync(p, 'utf8'))) { hit = true; return } } }
    walk(d); return hit
  }
  const rows = []
  for (const e of events) {
    const pl = e.platforms || PLATFORMS; const r = { name: e.name }
    const EXT = { nextjs: /\.(tsx?|jsx?)$/, 'react-vite': /\.(tsx?|jsx?)$/, astro: /\.(tsx?|jsx?|astro)$/, nuxt: /\.(tsx?|jsx?|vue)$/, 'react-native': /\.(tsx?|jsx?)$/, flutter: /\.dart$/, kmp: /\.kt$/, android: /\.kt$/, ios: /\.swift$/ }
    const re = new RegExp(`[Aa]nalyticsEvents\\.${camel(e.name)}\\(|['"]${e.name}['"]`)
    for (const s of projectStacks(root, config)) {
      if (!pl.includes(s.kind)) continue
      const used = grepDir(s.id === 'flutter' ? path.join(s.dir, 'lib') : s.dir, EXT[s.id], re)
      r[s.kind] = (r[s.kind] || false) || used
    }
    rows.push(r)
  }
  const mark = (v) => (v === undefined ? '  –  ' : v ? '  ✓  ' : '  ✗  ')
  console.log('event'.padEnd(32) + ' web   mobile')
  for (const r of rows) console.log(r.name.padEnd(32) + mark(r.web) + ' ' + mark(r.mobile))
  const missing = rows.filter((r) => r.web === false || r.mobile === false)
  console.log(missing.length ? `\n${missing.length} event(s) declared but not tracked on some platform.` : '\nEvery declared event is tracked where it should be.')
  process.exit(0)
}

// ---------- gen ----------
const src = posix(path.relative(root, file))
const dartType = { string: 'String', int: 'int', double: 'double', bool: 'bool' }
const tsType = { string: 'string', int: 'number', double: 'number', bool: 'boolean' }
const doc = (s) => (s ? String(s).replace(/\*\//g, '* /').replace(/\n/g, ' ') : '')
const written = []

const HEAD = (send) => [`// GENERATED by DualCraft from ${src} — do not edit by hand. Change the tracking plan and run /dualcraft:analytics.`, `// Send with your analytics adapter, e.g. ${send}.`]
const enumsOf = (evs) => evs.flatMap((e) => Object.entries(e.params || {}).filter(([, p]) => p.values).map(([n, p]) => ({ name: pascal(e.name) + pascal(n), values: p.values })))

function genDartA(evs) {
  const L = [...HEAD('FirebaseAnalytics.instance.logEvent(name: e.name, parameters: e.parameters)'), '// ignore_for_file: type=lint', '',
    'class AnalyticsEvent {', '  const AnalyticsEvent(this.name, this.parameters);', '  final String name;', '  final Map<String, Object> parameters;', '}', '']
  for (const en of enumsOf(evs)) {
    L.push(`enum ${en.name} {`, en.values.map((v) => `  ${camel(v.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'v$1').toLowerCase())}('${v.replace(/'/g, "\\'")}')`).join(',\n') + ';', `  const ${en.name}(this.value);`, '  final String value;', '}', '')
  }
  L.push('abstract final class AnalyticsEvents {')
  for (const e of evs) {
    const params = Object.entries(e.params || {})
    const typeOf = (n, p) => (p.values ? pascal(e.name) + pascal(n) : dartType[p.type])
    if (e.description) L.push(`  /// ${doc(e.description)}${e.origin ? ` (${e.origin})` : ''}`)
    const sig = params.length ? `{${params.map(([n, p]) => `${p.required ? 'required ' : ''}${typeOf(n, p)}${p.required ? '' : '?'} ${camel(n)}`).join(', ')}}` : ''
    // optional params are promoted to non-null inside `if (x != null)` collection entries
    const val = (n, p) => (p.values ? `${camel(n)}.value` : p.type === 'bool' ? `(${camel(n)} ? 1 : 0)` : camel(n))
    const entries = params.map(([n, p]) => (p.required ? `'${n}': ${val(n, p)}` : `if (${camel(n)} != null) '${n}': ${val(n, p)}`))
    L.push(`  static AnalyticsEvent ${camel(e.name)}(${sig}) => AnalyticsEvent('${e.name}', {${entries.join(', ')}});`)
  }
  L.push('}', '')
  if (props.length) {
    L.push('/// User properties: FirebaseAnalytics.instance.setUserProperty(name: AnalyticsUserProperties.x, value: …)', 'abstract final class AnalyticsUserProperties {')
    for (const p of props) L.push(`  /// ${doc(p.description)}${p.values ? ` Values: ${p.values.join(', ')}.` : ''}`, `  static const String ${camel(p.name)} = '${p.name}';`)
    L.push('}', '')
  }
  return L.join('\n')
}

function genTsA(evs) {
  const L = [...HEAD('gtag("event", e.name, e.params), posthog.capture(e.name, e.params) or analytics().logEvent(e.name, e.params)'), '',
    'export type AnalyticsEvent = { name: string; params: Record<string, string | number | boolean> }', '']
  L.push('export const analyticsEvents = {')
  for (const e of evs) {
    const params = Object.entries(e.params || {})
    const t = (p) => (p.values ? p.values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(' | ') : tsType[p.type])
    if (e.description) L.push(`  /** ${doc(e.description)}${e.origin ? ` (${e.origin})` : ''} */`)
    if (params.length) {
      L.push(`  ${camel(e.name)}: (p: { ${params.map(([n, p]) => `${n}${p.required ? '' : '?'}: ${t(p)}`).join('; ')} }): AnalyticsEvent => ({`)
      L.push(`    name: '${e.name}',`, '    params: Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as AnalyticsEvent[\'params\'],', '  }),')
    } else L.push(`  ${camel(e.name)}: (): AnalyticsEvent => ({ name: '${e.name}', params: {} }),`)
  }
  L.push('} as const', '')
  if (props.length) {
    L.push('export const analyticsUserProperties = {')
    for (const p of props) L.push(`  /** ${doc(p.description)} */`, `  ${camel(p.name)}: '${p.name}',`)
    L.push('} as const', '')
  }
  return L.join('\n')
}

const ktType = { string: 'String', int: 'Long', double: 'Double', bool: 'Boolean' }
const enumEntry = (v) => { let e = String(v).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE'; if (/^\d/.test(e)) e = 'V_' + e; return e }
function genKotlinA(evs, pkg) {
  const L = [...HEAD('Firebase.analytics.logEvent(e.name) { e.params.forEach { (k, v) -> param(k, …) } } or your adapter'), `package ${pkg}`, '',
    '/** An analytics event ready to send: values are String, Long or Double (booleans are sent as 1/0). */', 'data class AnalyticsEvent(val name: String, val params: Map<String, Any>)', '']
  for (const en of enumsOf(evs)) L.push(`enum class ${en.name}(val value: String) {`, en.values.map((v) => `    ${enumEntry(v)}("${v.replace(/"/g, '\\"')}")`).join(',\n') + ',', '}', '')
  L.push('object AnalyticsEvents {')
  for (const e of evs) {
    const params = Object.entries(e.params || {})
    const typeOf = (n, p) => (p.values ? pascal(e.name) + pascal(n) : ktType[p.type])
    if (e.description) L.push(`    /** ${doc(e.description)}${e.origin ? ` (${e.origin})` : ''} */`)
    const sig = params.map(([n, p]) => `${camel(n)}: ${typeOf(n, p)}${p.required ? '' : '? = null'}`).join(', ')
    const val = (n, p, v) => (p.values ? `${v}.value` : p.type === 'bool' ? `(if (${v}) 1L else 0L)` : v)
    const puts = params.map(([n, p]) => (p.required ? `put("${n}", ${val(n, p, camel(n))})` : `${camel(n)}?.let { put("${n}", ${val(n, p, 'it')}) }`))
    L.push(`    fun ${camel(e.name)}(${sig}) = AnalyticsEvent("${e.name}", ${puts.length ? `buildMap { ${puts.join('; ')} }` : 'emptyMap()'})`)
  }
  L.push('}', '')
  if (props.length) {
    L.push('object AnalyticsUserProperties {')
    for (const p of props) L.push(`    /** ${doc(p.description)}${p.values ? ` Values: ${p.values.join(', ')}.` : ''} */`, `    const val ${p.name.toUpperCase()} = "${p.name}"`)
    L.push('}', '')
  }
  return L.join('\n')
}

const swType = { string: 'String', int: 'Int', double: 'Double', bool: 'Bool' }
const SWIFT_RESERVED = new Set('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self Self throw throws true try'.split(' '))
const swId = (s) => { const c = camel(String(s).replace(/[^A-Za-z0-9_]+/g, '_')); return SWIFT_RESERVED.has(c) ? c + 'Value' : /^\d/.test(c) ? 'v' + c : c }
function genSwiftA(evs) {
  const L = [...HEAD('Analytics.logEvent(e.name, parameters: e.parameters) (Firebase) or your adapter'), 'import Foundation', '',
    '/// An analytics event ready to send (booleans are sent as 1/0).', 'struct AnalyticsEvent {', '    let name: String', '    let parameters: [String: Any]', '}', '']
  for (const en of enumsOf(evs)) { L.push(`enum ${en.name}: String {`); for (const v of en.values) L.push(`    case ${swId(v)} = "${v.replace(/"/g, '\\"')}"`); L.push('}', '') }
  L.push('enum AnalyticsEvents {')
  for (const e of evs) {
    const params = Object.entries(e.params || {})
    const typeOf = (n, p) => (p.values ? pascal(e.name) + pascal(n) : swType[p.type])
    if (e.description) L.push(`    /// ${doc(e.description)}${e.origin ? ` (${e.origin})` : ''}`)
    const sig = params.map(([n, p]) => `${swId(n)}: ${typeOf(n, p)}${p.required ? '' : '? = nil'}`).join(', ')
    const val = (n, p, v) => (p.values ? `${v}.rawValue` : p.type === 'bool' ? `(${v} ? 1 : 0)` : v)
    L.push(`    static func ${swId(e.name)}(${sig}) -> AnalyticsEvent {`)
    L.push(`        var p: [String: Any] = [:]`)
    for (const [n, pp] of params) L.push(pp.required ? `        p["${n}"] = ${val(n, pp, swId(n))}` : `        if let v = ${swId(n)} { p["${n}"] = ${val(n, pp, 'v')} }`)
    L.push(`        return AnalyticsEvent(name: "${e.name}", parameters: p)`, '    }')
  }
  L.push('}', '')
  if (props.length) {
    L.push('enum AnalyticsUserProperties {')
    for (const p of props) L.push(`    /// ${doc(p.description)}${p.values ? ` Values: ${p.values.join(', ')}.` : ''}`, `    static let ${swId(p.name)} = "${p.name}"`)
    L.push('}', '')
  }
  return L.join('\n')
}

const GEN_FOR = { nextjs: 'ts', 'react-vite': 'ts', astro: 'ts', nuxt: 'ts', 'react-native': 'ts', flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }
for (const stack of projectStacks(root, config)) {
  const gen = GEN_FOR[stack.id]
  const evs = forPlatform(stack.kind)
  const t = outputFor('analytics', stack, root, config)
  const code = gen === 'dart' ? genDartA(evs) : gen === 'ts' ? genTsA(evs) : gen === 'kotlin' ? genKotlinA(evs, String(opt.package || t.pkg || 'app.analytics')) : genSwiftA(evs)
  const legacyOut = gen === 'dart' ? opt['out-dart'] : gen === 'ts' && stack.kind === 'web' ? opt['out-ts'] : null
  if (opt.stdout) { console.log(code); continue }
  written.push(writeGuarded(legacyOut ? path.resolve(String(legacyOut)) : t.file, stamp(code), { root, force: !!opt.force }))
}

// tracking plan document (for product & marketing)
{
  const L = [`# Plan de analítica — ${config.name}`, '', `> Generado por DualCraft desde \`${src}\`. Para cambiarlo: \`/dualcraft:analytics\`.`, '',
    '| Evento | Qué significa | Parámetros | Web | Móvil | Desde | Origen |', '|---|---|---|---|---|---|---|']
  for (const e of events) {
    const pl = e.platforms || PLATFORMS
    const params = Object.entries(e.params || {}).map(([n, p]) => `\`${n}\` (${p.type}${p.values ? ': ' + p.values.join('/') : ''}${p.required ? '' : ', opcional'})`).join('<br>') || '—'
    L.push(`| \`${e.name}\` | ${e.description || ''} | ${params} | ${pl.includes('web') ? '✓' : ''} | ${pl.includes('mobile') ? '✓' : ''} | ${e.since || ''} | ${e.origin || ''} |`)
  }
  if (props.length) {
    L.push('', '## Propiedades de usuario', '', '| Propiedad | Qué significa | Valores |', '|---|---|---|')
    for (const p of props) L.push(`| \`${p.name}\` | ${p.description || ''} | ${p.values ? p.values.join(', ') : p.type || 'string'} |`)
  }
  const out = opt['out-doc'] ? path.resolve(String(opt['out-doc'])) : path.join(root, 'docs', 'ANALYTICS.md')
  written.push(writeGuarded(out, stamp(L.join('\n') + '\n', 'html'), { root, force: !!opt.force }))
}
written.forEach((f) => console.log('→ ' + f))
if (warnings.length) console.log(`⚠ ${warnings.length} warning(s) — run "check" for details.`)
