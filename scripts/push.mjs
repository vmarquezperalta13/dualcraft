#!/usr/bin/env node
// DualCraft push: .dualcraft/push/notifications.json is the catalog of every push notification (FCM for Android,
// iOS via APNs, web). Texts live in the shared i18n (push.<id>.title / push.<id>.body), so the server sends each
// device its language.
//   init                 catalog + registerDevice/unregisterDevice on the backend + sender (Firebase) + Flutter PushService
//   gen [--force]        server catalog with typed senders, typed PushMessage parsers per stack
//   check [--json]       catalog + texts, server pieces, client setup (permission, token refresh, cold start, iOS/Android config)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, outputFor } from './lib/targets.mjs'
import * as T from './lib/push-templates.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check'].includes(cmd)) {
  console.log(`node push.mjs init | gen [--force] | check [--json]
notifications.json: {"channels":[{"id":"matches","name":"Partidos","description":"Inicio y resultado de tus partidos","importance":"high"}],
  "topics":[{"id":"news","description":"Novedades de la app"}],
  "notifications":[{"id":"match_started","channel":"matches","description":"Empieza un partido que sigues",
    "params":{"matchId":{"type":"string","required":true},"home":{"type":"string"}},
    "route":"/matches/{matchId}","priority":"high","collapse":"match_{matchId}","ttl":3600}]}
texts in .dualcraft/i18n/<locale>.json: {"push":{"match_started":{"title":"¡Empieza!","body":"{home} ya está jugando"}}}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'push', 'notifications.json')
const apiFile = path.join(dir, 'backend', 'api.json')
const rel = (p) => posix(path.relative(root, p))
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const backend = (...a) => spawnSync(process.execPath, [path.join(HERE, 'backend.mjs'), ...a], { cwd: root, encoding: 'utf8' })

const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
const camel = (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('')
const pascal = (s) => { const c = camel(s); return c[0].toUpperCase() + c.slice(1) }
const snakeUp = (s) => words(s).map((w) => w.toUpperCase()).join('_')
const q = (s) => JSON.stringify(s)

const stacks = projectStacks(root, config)
const provider = () => readJson(apiFile)?.provider || ({ firebase: 'firebase', supabase: 'supabase', 'postgres-prisma': 'http' })[config.backend?.provider] || null
const functionsDir = () => {
  if (config.paths?.functions) return path.join(root, config.paths.functions)
  const s = [].concat(readJson(path.join(root, 'firebase.json'))?.functions || [])[0]?.source
  return path.join(root, s || 'functions')
}

// ---------------------------------------------------------------- i18n texts
function locales() {
  const d = path.join(dir, 'i18n')
  const ls = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.replace('.json', '')) : []
  const def = ls.includes(config.lang) ? config.lang : ls[0]
  return { list: ls, def, texts: Object.fromEntries(ls.map((l) => [l, readJson(path.join(d, l + '.json')) || {}])) }
}
const textOf = (tree, id, part) => tree?.push?.[id]?.[part]
const argNames = (msg) => [...String(msg).matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g)].map((m) => m[1])

// ---------------------------------------------------------------- catalog
const IMPORTANCE = ['min', 'low', 'normal', 'high', 'max']
const TYPES = ['string', 'int', 'double', 'bool']
const RESERVED = new Set(('type route from notification id data priority ttl channel label description importance message ' +
  'abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for fun func function get guard hide if implements import in init interface is late let library mixin new nil null object on operator package part private public repeat required rethrow return sealed self set show static struct super switch sync this throw throws true try typealias typedef val var void when where while with yield').split(' '))
const placeholders = (t) => [...String(t || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])

function load() {
  if (!fs.existsSync(file)) die('no .dualcraft/push/notifications.json yet — run /dualcraft:push (init) first')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`notifications.json is not valid JSON: ${e.message}`) }
}

function validate(c) {
  const errors = []; const warnings = []
  const chans = new Set()
  if (!(c.channels || []).length) errors.push('declare at least one channel (Android shows them in the app settings)')
  for (const ch of c.channels || []) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(ch.id || '')) errors.push(`channel "${ch.id}": snake_case, ≤ 40 chars`)
    if (chans.has(ch.id)) errors.push(`channel "${ch.id}": duplicated`)
    chans.add(ch.id)
    if (!ch.name) errors.push(`channel "${ch.id}": "name" is what users see in Android settings`)
    if (ch.importance && !IMPORTANCE.includes(ch.importance)) errors.push(`channel "${ch.id}": importance must be ${IMPORTANCE.join('|')}`)
  }
  const topics = new Set()
  for (const t of c.topics || []) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(t.id || '')) errors.push(`topic "${t.id}": snake_case, ≤ 40 chars`)
    if (topics.has(t.id)) errors.push(`topic "${t.id}": duplicated`)
    topics.add(t.id)
  }
  const L = locales()
  if (!L.list.length) errors.push('no .dualcraft/i18n/<locale>.json — push texts live in the shared i18n (dualcraft:i18n)')
  const seen = new Set()
  for (const n of c.notifications || []) {
    const w = `notification "${n.id}"`
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(n.id || '')) errors.push(`${w}: id must be snake_case, ≤ 40 chars`)
    if (seen.has(n.id)) errors.push(`${w}: duplicated`)
    seen.add(n.id)
    if (!chans.has(n.channel)) errors.push(`${w}: channel "${n.channel}" is not declared`)
    if (n.priority && !['high', 'normal'].includes(n.priority)) errors.push(`${w}: priority must be high|normal`)
    if (n.ttl !== undefined && !(Number.isInteger(n.ttl) && n.ttl > 0 && n.ttl <= 2419200)) errors.push(`${w}: ttl in seconds, 1–2419200 (28 days)`)
    const params = Object.entries(n.params || {})
    for (const [k, s] of params) {
      if (!/^[a-z][A-Za-z0-9]{0,39}$/.test(k) || RESERVED.has(k) || /^(google|gcm)/.test(k)) errors.push(`${w}: param "${k}" must be lowerCamelCase and not a reserved FCM/language word`)
      if (!TYPES.includes(s.type)) errors.push(`${w}: param "${k}" type must be ${TYPES.join('|')}`)
    }
    const names = new Set(params.map(([k]) => k))
    for (const [what, t] of [['route', n.route], ['collapse', n.collapse]]) for (const ph of placeholders(t)) if (!names.has(ph)) errors.push(`${w}: ${what} uses {${ph}}, which is not a param`)
    if (n.route && !n.route.startsWith('/')) errors.push(`${w}: route is an app path like /matches/{matchId}`)
    if (params.some(([, s]) => s.type === 'string') && !n.description) warnings.push(`${w}: no description`)
    for (const loc of L.list) for (const part of ['title', 'body']) {
      const t = textOf(L.texts[loc], n.id, part)
      if (typeof t !== 'string' || !t.trim()) { errors.push(`${w}: missing text push.${n.id}.${part} in i18n/${loc}.json`); continue }
      for (const a of argNames(t)) if (!names.has(a)) errors.push(`${w}: push.${n.id}.${part} (${loc}) uses {${a}}, which is not a param`)
      if (part === 'title' && t.length > 65) warnings.push(`${w}: title (${loc}) longer than 65 chars gets cut on most devices`)
      if (part === 'body' && t.length > 178) warnings.push(`${w}: body (${loc}) longer than ~178 chars gets cut when collapsed`)
    }
  }
  if (!(c.notifications || []).length) warnings.push('no notifications declared yet')
  return { errors, warnings, L }
}

// ---------------------------------------------------------------- generators
const HEAD = '// GENERATED by DualCraft from .dualcraft/push/notifications.json (+ push texts in .dualcraft/i18n) — do not edit. Run /dualcraft:push gen.'
const ICU = `/** ICU-lite: {name}, {n, plural, =0 {…} one {# …} other {# …}} and {x, select, a {…} other {…}}. */
export function format(msg: string, params: Record<string, unknown>): string {
  let out = ''
  let i = 0
  while (i < msg.length) {
    const c = msg[i]
    if (c !== '{') { out += c; i++; continue }
    let depth = 0
    let j = i
    for (; j < msg.length; j++) { if (msg[j] === '{') depth++; else if (msg[j] === '}') { depth--; if (depth === 0) break } }
    out += arg(msg.slice(i + 1, j), params)
    i = j + 1
  }
  return out
}
function arg(body: string, params: Record<string, unknown>): string {
  const parts = body.split(',')
  const v = params[parts[0].trim()]
  if (parts.length < 3) return v === undefined || v === null ? '' : String(v)
  const kind = parts[1].trim()
  const rest = parts.slice(2).join(',')
  const opts: Record<string, string> = {}
  let k = 0
  while (k < rest.length) {
    while (k < rest.length && /\\s/.test(rest[k])) k++
    let key = ''
    while (k < rest.length && rest[k] !== '{' && !/\\s/.test(rest[k])) key += rest[k++]
    while (k < rest.length && rest[k] !== '{') k++
    const start = k
    let depth = 0
    for (; k < rest.length; k++) { if (rest[k] === '{') depth++; else if (rest[k] === '}') { depth--; if (depth === 0) break } }
    if (key) opts[key] = rest.slice(start + 1, k)
    k++
  }
  if (kind === 'plural') {
    const n = Number(v)
    const pick = opts['=' + n] ?? (n === 1 ? opts.one : undefined) ?? opts.other ?? ''
    return format(pick.split('#').join(String(n)), params)
  }
  return format(opts[String(v)] ?? opts.other ?? '', params)
}`

function genServer(c, L) {
  const tsT = { string: 'string', int: 'number', double: 'number', bool: 'boolean' }
  const texts = Object.fromEntries((c.notifications || []).map((n) => [n.id, Object.fromEntries(L.list.map((l) => [l, { title: textOf(L.texts[l], n.id, 'title'), body: textOf(L.texts[l], n.id, 'body') }]))]))
  const fill = (t) => (t ? t.split(/(\{\w+\})/).filter(Boolean).map((x) => (/^\{\w+\}$/.test(x) ? `String(p.${x.slice(1, -1)} ?? '')` : q(x))).join(' + ') : null)
  const L2 = [HEAD, '// Server side: typed senders. Use with push/send.ts: await sendToUser(uid, push.matchStarted({ matchId }))', '',
    `export const LOCALES: string[] = ${JSON.stringify(L.list)}`, `export const DEFAULT_LOCALE = ${q(L.def)}`,
    `export const TOPICS = ${JSON.stringify((c.topics || []).map((t) => t.id))} as const`, '',
    "export interface PushPayload { type: string; channel: string; priority: 'high' | 'normal'; ttlSeconds?: number; collapseKey?: string; route?: string; params: Record<string, string | number | boolean | undefined> }", '',
    `const TEXTS: Record<string, Record<string, { title: string; body: string }>> = ${JSON.stringify(texts, null, 2)}`, '']
  for (const n of c.notifications || []) {
    const ps = Object.entries(n.params || {})
    L2.push(ps.length ? `export interface ${pascal(n.id)}Params { ${ps.map(([k, s]) => `${k}${s.required ? '' : '?'}: ${tsT[s.type]}`).join('; ')} }` : `export type ${pascal(n.id)}Params = Record<string, never>`)
  }
  L2.push('', 'export const push = {')
  for (const n of c.notifications || []) {
    const fields = [`type: ${q(n.id)}`, `channel: ${q(n.channel)}`, `priority: ${q(n.priority || 'high')}`]
    if (n.ttl) fields.push(`ttlSeconds: ${n.ttl}`)
    if (n.collapse) fields.push(`collapseKey: ${fill(n.collapse)}`)
    if (n.route) fields.push(`route: ${fill(n.route)}`)
    fields.push('params: { ...p }')
    L2.push(`  /** ${(n.description || n.id).replace(/\*\//g, '* /')} */`, `  ${camel(n.id)}: (p: ${pascal(n.id)}Params${Object.keys(n.params || {}).length ? '' : ' = {}'}): PushPayload => ({ ${fields.join(', ')} }),`)
  }
  L2.push('}', '', ICU, '',
    '/** Title, body and data (all strings) of a payload in one language, falling back to the default one. */',
    'export function render(p: PushPayload, locale: string): { title: string; body: string; data: Record<string, string> } {',
    '  const t = TEXTS[p.type]?.[locale] ?? TEXTS[p.type]?.[DEFAULT_LOCALE] ?? { title: p.type, body: \'\' }',
    "  const data: Record<string, string> = { type: p.type }",
    '  if (p.route) data.route = p.route',
    '  for (const [k, v] of Object.entries(p.params)) if (v !== undefined) data[k] = String(v)',
    '  return { title: format(t.title, p.params), body: format(t.body, p.params), data }',
    '}', '')
  return L2.join('\n')
}

const routeExpr = (n, lang) => {
  if (!n.route) return null
  const parts = n.route.split(/(\{\w+\})/).filter(Boolean)
  const req = (k) => n.params?.[k]?.required
  if (lang === 'dart') return "'" + parts.map((x) => (/^\{\w+\}$/.test(x) ? '${' + x.slice(1, -1) + (req(x.slice(1, -1)) ? '' : " ?? ''") + '}' : x.replace(/'/g, "\\'").replace(/\$/g, '\\$'))).join('') + "'"
  return parts.map((x) => (/^\{\w+\}$/.test(x) ? (lang === 'swift' ? (req(x.slice(1, -1)) ? `String(describing: ${x.slice(1, -1)})` : `(${x.slice(1, -1)}.map { String(describing: $0) } ?? "")`) : lang === 'kotlin' ? `${x.slice(1, -1)}${req(x.slice(1, -1)) ? '' : ' ?: ""'}.toString()` : `String(m.${x.slice(1, -1)} ?? '')`) : q(x))).join(' + ')
}

function genDart(c) {
  const imp = { min: 'min', low: 'low', normal: 'normal', high: 'high', max: 'max' }
  const L = [HEAD, '', 'enum PushImportance { min, low, normal, high, max }', '',
    'enum PushChannel {', '  ' + (c.channels || []).map((ch) => `${camel(ch.id)}(${q(ch.id)}, ${q(ch.name)}, ${q(ch.description || '')}, PushImportance.${imp[ch.importance || 'normal']})`).join(',\n  ') + ';',
    '  const PushChannel(this.id, this.label, this.description, this.importance);', '  final String id;', '  final String label;', '  final String description;', '  final PushImportance importance;', '}', '']
  if ((c.topics || []).length) L.push('enum PushTopic {', '  ' + c.topics.map((t) => `${camel(t.id)}(${q(t.id)})`).join(',\n  ') + ';', '  const PushTopic(this.id);', '  final String id;', "  String forLocale(String locale) => '${id}_$locale';", '}', '')
  else L.push('/// No topics declared yet.', 'class PushTopic {', '  const PushTopic._(this.id);', '  final String id;', "  String forLocale(String locale) => '${id}_$locale';", '}', '')
  const dec = (k, s) => {
    const x = `d['${k}']`
    const one = { string: `${x} as String`, int: `int.parse(${x} as String)`, double: `double.parse(${x} as String)`, bool: `(${x} as String) == 'true'` }[s.type]
    return s.required ? one : `${x} == null ? null : ${one}`
  }
  const dT = { string: 'String', int: 'int', double: 'double', bool: 'bool' }
  L.push('/// A received notification, typed. `PushMessage.parse(remoteMessage.data)`; null for unknown or malformed ones.', 'sealed class PushMessage {', '  const PushMessage();', '  String get type;', '  String? get route;', '',
    '  static PushMessage? parse(Map<String, dynamic> d) {', '    try {', '      switch (d[\'type\']) {')
  for (const n of c.notifications || []) L.push(`        case ${q(n.id)}:`, `          return ${pascal(n.id)}Push.fromData(d);`)
  L.push('      }', '    } catch (_) {', '      return null;', '    }', '    return null;', '  }', '}', '')
  for (const n of c.notifications || []) {
    const ps = Object.entries(n.params || {}); const C = pascal(n.id) + 'Push'
    L.push(`/// ${n.description || n.id}`, `final class ${C} extends PushMessage {`, `  const ${C}(${ps.length ? '{' + ps.map(([k, s]) => (s.required ? 'required ' : '') + 'this.' + k).join(', ') + '}' : ''});`)
    for (const [k, s] of ps) L.push(`  final ${dT[s.type]}${s.required ? '' : '?'} ${k};`)
    L.push('  @override', `  String get type => ${q(n.id)};`, '  @override', `  String? get route => ${routeExpr(n, 'dart') || 'null'};`,
      `  factory ${C}.fromData(Map<String, dynamic> d) => ${C}(${ps.map(([k, s]) => `${k}: ${dec(k, s)}`).join(', ')});`, '}', '')
  }
  return L.join('\n')
}

function genTs(c) {
  const tsT = { string: 'string', int: 'number', double: 'number', bool: 'boolean' }
  const L = [HEAD, '',
    `export type PushChannelId = ${(c.channels || []).map((x) => q(x.id)).join(' | ') || 'never'}`,
    `export const pushChannels = ${JSON.stringify((c.channels || []).map((ch) => ({ id: ch.id, label: ch.name, description: ch.description || '', importance: ch.importance || 'normal' })))} as const`,
    `export const pushTopics = { ${(c.topics || []).map((t) => `${camel(t.id)}: ${q(t.id)}`).join(', ')} } as const`,
    'export const topicForLocale = (topic: keyof typeof pushTopics, locale: string): string => pushTopics[topic] + \'_\' + locale', '',
    `export type PushMessage =${(c.notifications || []).length ? '' : ' never'}`]
  for (const n of c.notifications || []) L.push(`  | { type: ${q(n.id)}; route: string | null; ${Object.entries(n.params || {}).map(([k, s]) => `${k}${s.required ? '' : '?'}: ${tsT[s.type]}`).join('; ')} }`)
  L.push('', '/** Typed view of a notification\'s data payload; null for unknown or malformed ones. */', 'export function parsePush(d: Record<string, string | undefined>): PushMessage | null {',
    '  const num = (x: string | undefined) => (x === undefined ? undefined : Number.isFinite(Number(x)) ? Number(x) : NaN)', '  switch (d.type) {')
  for (const n of c.notifications || []) {
    const ps = Object.entries(n.params || {})
    const conv = (k, s) => (s.type === 'string' ? `d.${k}` : s.type === 'bool' ? `d.${k} === undefined ? undefined : d.${k} === 'true'` : `num(d.${k})`)
    L.push(`    case ${q(n.id)}: {`)
    for (const [k, s] of ps) L.push(`      const ${k} = ${conv(k, s)}`, ...(s.required ? [`      if (${k} === undefined${s.type === 'int' || s.type === 'double' ? ` || Number.isNaN(${k})` : ''}) return null`] : []))
    L.push(`      const m = { ${ps.map(([k]) => k).join(', ')} }`, `      return { type: ${q(n.id)}, ...m, route: ${n.route ? routeExpr(n, 'ts') : 'null'} }`, '    }')
  }
  L.push('  }', '  return null', '}', '')
  return L.join('\n')
}

function genKotlin(c, pkg) {
  const kT = { string: 'String', int: 'Long', double: 'Double', bool: 'Boolean' }
  const L = [HEAD, `package ${pkg}`, '', 'enum class PushImportance { MIN, LOW, NORMAL, HIGH, MAX }', '',
    'enum class PushChannel(val id: String, val label: String, val description: String, val importance: PushImportance) {',
    '    ' + (c.channels || []).map((ch) => `${snakeUp(ch.id)}(${q(ch.id)}, ${q(ch.name)}, ${q(ch.description || '')}, PushImportance.${(ch.importance || 'normal').toUpperCase()})`).join(',\n    ') + ';', '}', '',
    'enum class PushTopic(val id: String) {', '    ' + (c.topics || []).map((t) => `${snakeUp(t.id)}(${q(t.id)})`).join(',\n    ') + ';', '    fun forLocale(locale: String): String = id + "_" + locale', '}', '',
    '/** A received notification, typed: `PushMessage.parse(remoteMessage.data)`; null for unknown or malformed ones. */', 'sealed class PushMessage {', '    abstract val type: String', '    abstract val route: String?', '',
    '    companion object {', '        fun parse(d: Map<String, String>): PushMessage? = try {', '            when (d["type"]) {']
  const dec = (k, s) => { const one = (x) => ({ string: x, int: `${x}.toLong()`, double: `${x}.toDouble()`, bool: `(${x} == "true")` }[s.type]); return s.required ? one(`d.getValue("${k}")`) : (s.type === 'string' ? `d["${k}"]` : `d["${k}"]?.let { ${one('it')} }`) }
  for (const n of c.notifications || []) L.push(`                ${q(n.id)} -> ${pascal(n.id)}Push${Object.keys(n.params || {}).length ? '(' + Object.entries(n.params || {}).map(([k, s]) => `${k} = ${dec(k, s)}`).join(', ') + ')' : ''}`)
  L.push('                else -> null', '            }', '        } catch (e: Exception) {', '            null', '        }', '    }', '}', '')
  for (const n of c.notifications || []) {
    const ps = Object.entries(n.params || {}); const C = pascal(n.id) + 'Push'
    L.push(`/** ${(n.description || n.id).replace(/\*\//g, '* /')} */`)
    L.push(ps.length ? `data class ${C}(${ps.map(([k, s]) => `val ${k}: ${kT[s.type]}${s.required ? '' : '? = null'}`).join(', ')}) : PushMessage() {` : `data object ${C} : PushMessage() {`)
    L.push(`    override val type: String = ${q(n.id)}`, '    override val route: String?', `        get() = ${n.route ? routeExpr(n, 'kotlin') : 'null'}`, '}', '')
  }
  return L.join('\n')
}

function genSwift(c) {
  const sT = { string: 'String', int: 'Int', double: 'Double', bool: 'Bool' }
  const L = [HEAD, 'import Foundation', '', 'enum PushImportance: Sendable { case min, low, normal, high, max }', '',
    'struct PushChannel: Sendable {', '    let id: String', '    let label: String', '    let description: String', '    let importance: PushImportance']
  for (const ch of c.channels || []) L.push(`    static let ${camel(ch.id)} = PushChannel(id: ${q(ch.id)}, label: ${q(ch.name)}, description: ${q(ch.description || '')}, importance: .${ch.importance || 'normal'})`)
  L.push(`    static let all: [PushChannel] = [${(c.channels || []).map((ch) => camel(ch.id)).join(', ')}]`, '}', '')
  if ((c.topics || []).length) L.push('enum PushTopic: String, CaseIterable, Sendable {', ...c.topics.map((t) => `    case ${camel(t.id)} = ${q(t.id)}`), '    func forLocale(_ locale: String) -> String { rawValue + "_" + locale }', '}', '')
  else L.push('/// No topics declared yet.', 'enum PushTopic: Sendable {}', '')
  const ns = c.notifications || []
  L.push('/// A received notification, typed: `PushMessage.parse(userInfo)`; nil for unknown or malformed ones.', 'enum PushMessage: Sendable {')
  for (const n of ns) { const ps = Object.entries(n.params || {}); L.push(`    /// ${n.description || n.id}`, `    case ${camel(n.id)}${ps.length ? '(' + ps.map(([k, s]) => `${k}: ${sT[s.type]}${s.required ? '' : '?'}`).join(', ') + ')' : ''}`) }
  if (ns.length) {
    L.push('', '    var type: String {', '        switch self {', ...ns.map((n) => `        case .${camel(n.id)}: return ${q(n.id)}`), '        }', '    }', '', '    var route: String? {', '        switch self {')
    for (const n of ns) {
      const ps = Object.keys(n.params || {}); const used = new Set(placeholders(n.route))
      const pat = ps.length ? `case let .${camel(n.id)}(${ps.map((k) => (used.has(k) ? k : '_')).join(', ')})` : `case .${camel(n.id)}`
      L.push(`        ${ps.length && !ps.some((k) => used.has(k)) ? `case .${camel(n.id)}` : pat}: return ${n.route ? routeExpr(n, 'swift') : 'nil'}`)
    }
    L.push('        }', '    }')
  }
  L.push('', '    static func parse(_ data: [AnyHashable: Any]) -> PushMessage? {', '        func s(_ k: String) -> String? { data[k] as? String }', '        switch s("type") {')
  const dec = (k, s) => ({ string: `s("${k}")`, int: `s("${k}").flatMap({ Int($0) })`, double: `s("${k}").flatMap({ Double($0) })`, bool: `s("${k}").map({ $0 == "true" })` }[s.type])
  for (const n of ns) {
    const ps = Object.entries(n.params || {}); const req = ps.filter(([, s]) => s.required)
    L.push(`        case ${q(n.id)}?:`)
    if (req.length) L.push(`            guard ${req.map(([k, s]) => `let ${k} = ${dec(k, s)}`).join(', ')} else { return nil }`)
    L.push(`            return .${camel(n.id)}${ps.length ? '(' + ps.map(([k, s]) => `${k}: ${s.required ? k : dec(k, s)}`).join(', ') + ')' : ''}`)
  }
  L.push('        default: return nil', '        }', '    }', '}', '')
  return L.join('\n')
}

const DEVICE_FUNCTIONS = [
  { name: 'registerDevice', kind: 'callable', auth: 'user', platforms: ['web', 'mobile'], description: 'Guarda el identificador push (FID o token antiguo) de esta instalación', origin: 'push',
    input: { pushId: { type: 'string', required: true, maxLength: 4096 }, pushIdType: { type: 'string', values: ['fid', 'token'], required: true }, platform: { type: 'string', values: ['android', 'ios', 'web'], required: true }, locale: { type: 'string', maxLength: 20, pattern: '^[a-z]{2}([-_][A-Za-z]{2})?$' }, appVersion: { type: 'string', maxLength: 40 } },
    output: {}, errors: ['unauthenticated', 'invalid-argument'] },
  { name: 'unregisterDevice', kind: 'callable', auth: 'user', platforms: ['web', 'mobile'], description: 'Olvida el identificador push de esta instalación (cerrar sesión)', origin: 'push',
    input: { pushId: { type: 'string', required: true, maxLength: 4096 } }, output: {}, errors: ['unauthenticated', 'invalid-argument'] },
]

function generate(c, force) {
  const { errors, L } = validate(c)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix the push catalog errors first.') }
  const written = []
  for (const s of stacks) {
    const t = outputFor('push', s, root, config)
    const lang = { flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }[s.id] || 'ts'
    written.push(writeGuarded(t.file, stamp(lang === 'dart' ? genDart(c) : lang === 'kotlin' ? genKotlin(c, t.pkg) : lang === 'swift' ? genSwift(c) : genTs(c)), { root, force }))
  }
  if (provider() === 'firebase') written.push(writeGuarded(path.join(functionsDir(), 'src', 'generated', 'push.ts'), stamp(genServer(c, L)), { root, force }))
  return written
}

const INDEX = { collectionGroup: 'devices', fieldPath: 'pushId', indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION' }, { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }] }
const RULES = `Firestore rules (merge into firestore.rules):
  match /users/{uid}/devices/{id} { allow read, write: if false; }   // only registerDevice/unregisterDevice touch tokens`

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const prov = provider()
  if (!prov) die('no backend yet — run /dualcraft:backend init first (tokens are registered and pushes sent from the server)')
  const exists = fs.existsSync(file)
  if (!exists) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ channels: [{ id: 'general', name: config.lang === 'en' ? 'General' : 'General', description: '', importance: 'high' }], topics: [], notifications: [] }, null, 2) + '\n') }
  console.log(`${exists ? 'kept' : 'created'} ${rel(file)}`)
  const made = []
  if (prov === 'firebase') {
    const src = path.join(functionsDir(), 'src')
    made.push(writeNew(path.join(src, 'push', 'send.ts'), T.firebaseSend), writeNew(path.join(src, 'registerDevice.ts'), T.firebaseRegister), writeNew(path.join(src, 'unregisterDevice.ts'), T.firebaseUnregister))
    const ix = path.join(root, 'firestore.indexes.json'); const idx = readJson(ix)
    if (idx && !(idx.fieldOverrides || []).some((f) => f.collectionGroup === 'devices' && f.fieldPath === 'pushId')) { idx.fieldOverrides = [...(idx.fieldOverrides || []), INDEX]; fs.writeFileSync(ix, JSON.stringify(idx, null, 2) + '\n'); made.push('firestore.indexes.json: collection-group index on devices.pushId') }
    else if (!idx) console.log('⚠ add to firestore.indexes.json → "fieldOverrides": ' + JSON.stringify([INDEX]))
  } else console.log(`⚠ provider "${prov}": sending is scaffolded for Firebase (Admin SDK). registerDevice/unregisterDevice get a generic scaffold; send with the FCM HTTP v1 API from your server (references/push-notifications.md).`)
  // device functions in the contract (backend add scaffolds the ones not written above, and the export)
  for (const f of DEVICE_FUNCTIONS) {
    const api = readJson(apiFile)
    if (!(api.functions || []).some((x) => x.name === f.name)) { const r = backend('add', f.name, '--kind', 'callable', '--platforms', 'web,mobile'); if (r.status !== 0) die(r.stdout + r.stderr) }
    const a2 = readJson(apiFile); const i = a2.functions.findIndex((x) => x.name === f.name); a2.functions[i] = { ...a2.functions[i], ...f }; fs.writeFileSync(apiFile, JSON.stringify(a2, null, 2) + '\n')
  }
  const fl = stacks.find((s) => s.id === 'flutter')
  if (fl && prov === 'firebase') made.push(writeNew(path.join(fl.dir, 'lib', 'services', 'push_service.dart'), T.flutterPushService))
  made.filter(Boolean).forEach((m) => console.log('+ ' + m))
  const v = validate(load())
  if (v.errors.length) { v.errors.forEach((e) => console.log('✗ ' + e)); console.log('Declare notifications and their texts, then run gen.') }
  else generate(load(), !!opt.force).forEach((w) => console.log('→ ' + w))
  const g = backend('gen', ...(opt.force ? ['--force'] : [])); if (g.status !== 0) die('backend gen failed:\n' + g.stdout + g.stderr)
  g.stdout.split('\n').filter(Boolean).forEach((l) => console.log(l + ' (backend)'))
  if (fl) console.log('flutter: add firebase_messaging (≥ 17) and flutter_local_notifications to pubspec.yaml')
  console.log('\n' + RULES)
  process.exit(0)
}

if (cmd === 'gen') { generate(load(), !!opt.force).forEach((w) => console.log('→ ' + w)); process.exit(0) }

// ---------------------------------------------------------------- check
const c = load()
const { errors, warnings } = validate(c)
const issues = [...errors.map((m) => ({ level: 'error', m })), ...warnings.map((m) => ({ level: 'warn', m }))]
const prov = provider()
const api = readJson(apiFile)
for (const f of DEVICE_FUNCTIONS) if (!(api?.functions || []).some((x) => x.name === f.name)) issues.push({ level: 'error', m: `${f.name} is not in the backend contract — run init` })
if (prov === 'firebase') {
  const idx = readJson(path.join(root, 'firestore.indexes.json'))
  if (!idx || !(idx.fieldOverrides || []).some((f) => f.collectionGroup === 'devices' && f.fieldPath === 'pushId')) issues.push({ level: 'warn', m: 'firestore.indexes.json: no collection-group index on devices.pushId (registerDevice queries it)' })
  const code = []
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(node_modules|lib|generated)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) code.push(read(p)) } }
  walk(path.join(functionsDir(), 'src'))
  const all = code.join('\n')
  for (const n of c.notifications || []) if (!new RegExp(`push\\.${camel(n.id)}\\(`).test(all)) issues.push({ level: 'warn', m: `notification "${n.id}" is declared but never sent (no push.${camel(n.id)}(…) in functions)` })
}
const walkFiles = (d, re, acc = [], depth = 0) => { if (depth > 12 || !fs.existsSync(d)) return acc; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|build|generated|\.|Pods|functions|supabase|DerivedData)/.test(e.name)) walkFiles(p, re, acc, depth + 1) } else if (re.test(e.name)) acc.push(p) } return acc }
for (const s of stacks.filter((x) => x.kind === 'mobile')) {
  const re = { flutter: /\.dart$/, kmp: /\.kt$/, android: /\.kt$/, ios: /\.swift$/ }[s.id] || /\.(tsx?|jsx?)$/
  const files = walkFiles(s.id === 'flutter' ? path.join(s.dir, 'lib') : s.dir, re)
  const text = files.map(read).join('\n')
  const uses = /firebase_messaging|FirebaseMessaging|@react-native-firebase\/messaging|Messaging\.messaging\(\)|FirebaseMessagingService/.test(text)
  if (!uses) continue
  if (!/requestPermission|requestAuthorization|POST_NOTIFICATIONS/.test(text)) issues.push({ level: 'error', m: `${s.id}: never asks for notification permission (Android 13+ and iOS need it)` })
  if (!/onRegistered|onTokenRefresh|onNewToken|didReceiveRegistrationToken/.test(text)) issues.push({ level: 'error', m: `${s.id}: push id changes not handled — listen to onRegistered (FID) / token refresh and call registerDevice` })
  if (s.id === 'flutter' && /\.getToken\(|onTokenRefresh/.test(text)) issues.push({ level: 'warn', m: 'flutter: getToken/onTokenRefresh are deprecated in firebase_messaging 17 — use register() + onRegistered (FID)' })
  if (s.id === 'flutter' && !/getInitialMessage/.test(text)) issues.push({ level: 'warn', m: 'flutter: getInitialMessage() not used — taps that open the app from closed are lost' })
  if (!/registerDevice/.test(text)) issues.push({ level: 'error', m: `${s.id}: push ids are not sent through registerDevice` })
  for (const f of files) if (/collection\(\s*['"](devices|fcmTokens|tokens)['"]\s*\)[\s\S]{0,160}?\.(set|add|update)\(/.test(read(f))) issues.push({ level: 'warn', m: `${rel(f)}: writes push ids directly — use registerDevice (one owner per id, cleanup)` })
  const manifest = [path.join(s.dir, 'android/app/src/main/AndroidManifest.xml'), path.join(s.dir, 'app/src/main/AndroidManifest.xml'), path.join(s.dir, 'composeApp/src/androidMain/AndroidManifest.xml')].map(read).join('\n')
  if (manifest && !/default_notification_icon/.test(manifest)) issues.push({ level: 'warn', m: `${s.id}: no com.google.firebase.messaging.default_notification_icon in AndroidManifest (Android shows a white square)` })
  if (manifest && s.id !== 'flutter' && !/POST_NOTIFICATIONS/.test(manifest)) issues.push({ level: 'error', m: `${s.id}: AndroidManifest lacks android.permission.POST_NOTIFICATIONS (Android 13+)` })
  if (['flutter', 'ios', 'kmp', 'react-native'].includes(s.id)) {
    const ents = walkFiles(s.dir, /\.entitlements$/)
    if (ents.length && !ents.some((f) => /aps-environment/.test(read(f)))) issues.push({ level: 'error', m: `${s.id}: no aps-environment in the iOS entitlements — enable Push Notifications capability in Xcode` })
    if (!ents.length && (fs.existsSync(path.join(s.dir, 'ios')) || s.id === 'ios')) issues.push({ level: 'warn', m: `${s.id}: no .entitlements file — enable Push Notifications (and Background Modes → Remote notifications) in Xcode` })
  }
}
if (opt.json) console.log(JSON.stringify({ provider: prov, notifications: (c.notifications || []).length, issues }, null, 2))
else {
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
  const n = issues.filter((i) => i.level === 'error').length
  console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `push OK — ${(c.notifications || []).length} notification(s), ${issues.length} warning(s)`)
}
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
