#!/usr/bin/env node
// DualCraft payments: .dualcraft/payments/products.json is the catalog of every product sold in the apps
// (subscriptions, one-time unlocks, consumables), the entitlements they unlock and the currencies they credit.
//   init --mode native|revenuecat   catalog + server functions on the backend contract + Flutter PurchaseService
//   gen [--force]                   typed catalog per stack (TS, Dart, Kotlin, Swift), server catalog, contract refresh
//   check [--json]                  catalog valid, store setup, server pieces, client code (restore, listener, client-side grants)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, outputFor } from './lib/targets.mjs'
import * as T from './lib/payments-templates.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check'].includes(cmd)) {
  console.log(`node payments.mjs init --mode native|revenuecat | gen [--force] | check [--json]
products.json: {"mode":"native","android":{"packageName":"com.acme.app"},"apple":{"bundleId":"com.acme.app","appAppleId":1234567890},
  "entitlements":[{"id":"premium","description":"Todo desbloqueado"}],"currencies":[{"id":"coins","description":"Monedas"}],
  "products":[
    {"id":"premium_monthly","type":"subscription","entitlement":"premium","period":"P1M","trial":"P7D","android":"premium","basePlan":"monthly","ios":"com.acme.app.premium.monthly"},
    {"id":"premium_lifetime","type":"nonConsumable","entitlement":"premium"},
    {"id":"coins_100","type":"consumable","grants":{"coins":100}}]}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'payments', 'products.json')
const apiFile = path.join(dir, 'backend', 'api.json')
const rel = (p) => posix(path.relative(root, p))
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const backend = (...a) => spawnSync(process.execPath, [path.join(HERE, 'backend.mjs'), ...a], { cwd: root, encoding: 'utf8' })

const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
const camel = (s) => { const c = words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join(''); return /^\d/.test(c) ? 'p' + c : c }
const snakeUp = (s) => { const c = words(s).map((w) => w.toUpperCase()).join('_'); return /^\d/.test(c) ? 'P' + c : c }

const stacks = projectStacks(root, config)
const canAndroid = stacks.some((s) => ['flutter', 'react-native', 'kmp', 'android'].includes(s.id))
const canIos = stacks.some((s) => ['flutter', 'react-native', 'kmp', 'ios'].includes(s.id))
const provider = () => readJson(apiFile)?.provider || ({ firebase: 'firebase', supabase: 'supabase', 'postgres-prisma': 'http' })[config.backend?.provider] || null
const functionsDir = () => {
  if (config.paths?.functions) return path.join(root, config.paths.functions)
  const s = [].concat(readJson(path.join(root, 'firebase.json'))?.functions || [])[0]?.source
  return path.join(root, s || 'functions')
}

// ---------------------------------------------------------------- catalog
const TYPES = ['subscription', 'nonConsumable', 'consumable']
const PERIODS = ['P1W', 'P1M', 'P2M', 'P3M', 'P6M', 'P1Y']
const storeIds = (p) => ({ android: p.android || p.id, ios: p.ios || p.id })

function load() {
  if (!fs.existsSync(file)) die('no .dualcraft/payments/products.json yet — run /dualcraft:payments (init) first')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`products.json is not valid JSON: ${e.message}`) }
}

function validate(c) {
  const errors = []; const warnings = []
  if (!['native', 'revenuecat'].includes(c.mode)) errors.push('mode must be "native" or "revenuecat"')
  const ents = new Set((c.entitlements || []).map((e) => e.id)); const curs = new Set((c.currencies || []).map((x) => x.id))
  for (const e of c.entitlements || []) if (!/^[a-z][a-z0-9_]{0,39}$/.test(e.id || '')) errors.push(`entitlement "${e.id}": snake_case, ≤ 40 chars`)
  for (const x of c.currencies || []) if (!/^[a-z][a-z0-9_]{0,39}$/.test(x.id || '')) errors.push(`currency "${x.id}": snake_case, ≤ 40 chars`)
  const seen = new Set(); const androidSeen = new Map(); const iosSeen = new Set()
  for (const p of c.products || []) {
    const w = `product "${p.id}"`
    if (!/^[a-z0-9][a-z0-9_.]{0,39}$/.test(p.id || '')) errors.push(`${w}: id must be lowercase letters, digits, _ and . (≤ 40) — store ids are permanent`)
    if (seen.has(p.id)) errors.push(`${w}: duplicated`)
    seen.add(p.id)
    if (!TYPES.includes(p.type)) { errors.push(`${w}: type must be ${TYPES.join('|')}`); continue }
    const ids = storeIds(p)
    if (!/^[a-z0-9][a-z0-9_.]{0,139}$/.test(ids.android)) errors.push(`${w}: Google Play id "${ids.android}" must start with a lowercase letter or digit and use only a-z 0-9 _ .`)
    if (!/^[A-Za-z0-9._]{1,100}$/.test(ids.ios)) errors.push(`${w}: App Store id "${ids.ios}" may only use letters, digits, _ and .`)
    const aKey = ids.android + '|' + (p.type === 'subscription' ? p.basePlan || '' : '')
    if (androidSeen.has(aKey)) errors.push(`${w}: same Google Play product${p.basePlan ? ' and base plan' : ''} as "${androidSeen.get(aKey)}"`)
    androidSeen.set(aKey, p.id)
    if (iosSeen.has(ids.ios)) errors.push(`${w}: App Store id "${ids.ios}" is used twice`)
    iosSeen.add(ids.ios)
    if (p.type === 'consumable') {
      if (p.entitlement) errors.push(`${w}: consumables credit a currency (grants), they don't unlock an entitlement`)
      const g = Object.entries(p.grants || {})
      if (!g.length) errors.push(`${w}: consumables need "grants", e.g. {"coins": 100}`)
      for (const [cur, n] of g) {
        if (!curs.has(cur)) errors.push(`${w}: currency "${cur}" is not declared in "currencies"`)
        if (!Number.isInteger(n) || n <= 0) errors.push(`${w}: grants.${cur} must be a positive integer`)
      }
    } else {
      if (!p.entitlement) errors.push(`${w}: ${p.type} must unlock an "entitlement"`)
      else if (!ents.has(p.entitlement)) errors.push(`${w}: entitlement "${p.entitlement}" is not declared in "entitlements"`)
      if (p.grants) errors.push(`${w}: only consumables have grants`)
    }
    if (p.type === 'subscription') {
      if (!PERIODS.includes(p.period)) errors.push(`${w}: period must be ${PERIODS.join('|')}`)
      if (p.trial && !/^P\d+[DWM]$/.test(p.trial)) errors.push(`${w}: trial like "P7D", "P1W" or "P1M"`)
      if (canAndroid && !p.basePlan) warnings.push(`${w}: no Google Play basePlan (Play subscriptions are sold through a base plan, e.g. "monthly")`)
    } else if (p.period || p.trial || p.basePlan) errors.push(`${w}: period/trial/basePlan are for subscriptions`)
    if (!p.description) warnings.push(`${w}: no description`)
  }
  if (!(c.products || []).length) warnings.push('no products yet')
  for (const e of ents) if (!(c.products || []).some((p) => p.entitlement === e)) warnings.push(`entitlement "${e}" is not unlocked by any product`)
  if (c.mode === 'native') {
    if (canAndroid && !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(c.android?.packageName || '')) errors.push('android.packageName is required (applicationId of the Android app)')
    if (canIos && !c.apple?.bundleId) errors.push('apple.bundleId is required (bundle identifier of the iOS app)')
    if (canIos && !c.apple?.appAppleId) warnings.push('apple.appAppleId missing (App Store Connect → App Information → Apple ID) — production transactions cannot be verified without it')
  }
  if (c.mode === 'revenuecat') warnings.push('RevenueCat: entitlement ids and product ids must be identical in the RevenueCat dashboard')
  return { errors, warnings }
}

// ---------------------------------------------------------------- app ids from the projects
function detectIds() {
  const found = { packageName: null, bundleId: null }
  const walk = (d, re, depth = 0, acc = []) => {
    if (depth > 4 || !fs.existsSync(d)) return acc
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && /^(node_modules|build|Pods|\.|DerivedData)/.test(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, re, depth + 1, acc); else if (re.test(e.name)) acc.push(p)
    }
    return acc
  }
  for (const s of stacks) {
    if (!found.packageName) for (const g of walk(s.dir, /^build\.gradle(\.kts)?$/)) { const m = read(g).match(/applicationId\s*=?\s*["']([\w.]+)["']/); if (m) { found.packageName = m[1]; break } }
    if (!found.bundleId) for (const x of walk(s.dir, /^project\.pbxproj$/)) { const m = [...read(x).matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([\w.-]+)"?;/g)].map((y) => y[1]).find((b) => !/Tests$/.test(b) && !b.includes('$(')); if (m) { found.bundleId = m; break } }
    const appJson = readJson(path.join(s.dir, 'app.json'))?.expo
    if (appJson) { found.packageName ||= appJson.android?.package || null; found.bundleId ||= appJson.ios?.bundleIdentifier || null }
  }
  return found
}

// ---------------------------------------------------------------- generators
const DART_RESERVED = new Set('abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield'.split(' '))
const SW_RESERVED = new Set('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try all'.split(' '))
const KT_RESERVED = new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while all'.split(' '))
const q = (s) => JSON.stringify(s)
const HEAD = '// GENERATED by DualCraft from .dualcraft/payments/products.json — do not edit. Change the catalog and run /dualcraft:payments gen.'

function genTs(c) {
  const ents = c.entitlements || []; const curs = c.currencies || []
  const L = [HEAD, '',
    "export type StorePlatform = 'android' | 'ios'",
    "export type ProductType = 'subscription' | 'nonConsumable' | 'consumable'",
    `export type Entitlement = ${ents.length ? ents.map((e) => q(e.id)).join(' | ') : 'never'}`,
    `export type Currency = ${curs.length ? curs.map((x) => q(x.id)).join(' | ') : 'never'}`,
    'export interface CatalogProduct { id: string; type: ProductType; android: string; ios: string; basePlan?: string; entitlement?: Entitlement; grants: Partial<Record<Currency, number>> }', '',
    'export const entitlements = {', ...ents.map((e) => `  /** ${e.description || e.id} */ ${camel(e.id)}: ${q(e.id)},`), '} as const', '',
    'export const products = {']
  for (const p of c.products || []) {
    const ids = storeIds(p)
    L.push(`  /** ${(p.description || p.id).replace(/\*\//g, '* /')} */`, `  ${camel(p.id)}: { id: ${q(p.id)}, type: ${q(p.type)}, android: ${q(ids.android)}, ios: ${q(ids.ios)}${p.basePlan ? `, basePlan: ${q(p.basePlan)}` : ''}${p.entitlement ? `, entitlement: ${q(p.entitlement)}` : ''}, grants: ${JSON.stringify(p.grants || {})} },`)
  }
  L.push('} as const satisfies Record<string, CatalogProduct>', '',
    'export const allProducts: readonly CatalogProduct[] = Object.values(products)',
    'export const storeIds = (platform: StorePlatform): string[] => allProducts.map((p) => p[platform])',
    'export const productByStoreId = (storeId: string): CatalogProduct | undefined => allProducts.find((p) => p.android === storeId || p.ios === storeId)', '')
  return L.join('\n')
}

function genDart(c) {
  const ents = c.entitlements || []
  const id = (s) => { const x = camel(s); return DART_RESERVED.has(x) ? x + 'Value' : x }
  const L = [HEAD, '', 'enum StorePlatform { android, ios }', '', 'enum ProductType { subscription, nonConsumable, consumable }', '']
  if (ents.length) L.push('enum Entitlement {', '  ' + ents.map((e) => `${id(e.id)}(${q(e.id)})`).join(',\n  ') + ';', '  const Entitlement(this.id);', '  final String id;', '}', '')
  else L.push('/// No entitlements declared yet.', 'class Entitlement {', '  const Entitlement._(this.id);', '  final String id;', '}', '')
  L.push('class CatalogProduct {',
    '  const CatalogProduct({required this.id, required this.type, required this.android, required this.ios, this.basePlan, this.entitlement, this.grants = const {}});',
    '  final String id;', '  final ProductType type;', '  final String android;', '  final String ios;', '  final String? basePlan;', '  final Entitlement? entitlement;', '  final Map<String, int> grants;',
    '  String storeId(StorePlatform p) => p == StorePlatform.ios ? ios : android;', '}', '',
    'abstract final class PaymentsCatalog {')
  for (const p of c.products || []) {
    const ids = storeIds(p)
    L.push(`  /// ${p.description || p.id}`, `  static const ${id(p.id)} = CatalogProduct(id: ${q(p.id)}, type: ProductType.${p.type}, android: ${q(ids.android)}, ios: ${q(ids.ios)}${p.basePlan ? `, basePlan: ${q(p.basePlan)}` : ''}${p.entitlement ? `, entitlement: Entitlement.${id(p.entitlement)}` : ''}${p.grants ? `, grants: {${Object.entries(p.grants).map(([k, n]) => `${q(k)}: ${n}`).join(', ')}}` : ''});`)
  }
  L.push(`  static const all = <CatalogProduct>[${(c.products || []).map((p) => id(p.id)).join(', ')}];`,
    '  static Set<String> storeIds(StorePlatform p) => {for (final x in all) x.storeId(p)};',
    '  static CatalogProduct? byStoreId(String storeId) {', '    for (final x in all) {', '      if (x.android == storeId || x.ios == storeId) return x;', '    }', '    return null;', '  }', '}', '')
  return L.join('\n')
}

function genKotlin(c, pkg) {
  const ents = c.entitlements || []
  const id = (s) => { const x = camel(s); return KT_RESERVED.has(x) ? '`' + x + '`' : x }
  const L = [HEAD, `package ${pkg}`, '', 'enum class StorePlatform { ANDROID, IOS }', '', 'enum class ProductType { SUBSCRIPTION, NON_CONSUMABLE, CONSUMABLE }', '',
    'enum class Entitlement(val id: String) {', (ents.length ? '    ' + ents.map((e) => `${snakeUp(e.id)}(${q(e.id)})`).join(',\n    ') : '') + ';', '}', '',
    'data class CatalogProduct(', '    val id: String,', '    val type: ProductType,', '    val android: String,', '    val ios: String,', '    val basePlan: String? = null,', '    val entitlement: Entitlement? = null,', '    val grants: Map<String, Long> = emptyMap(),',
    ') {', '    fun storeId(platform: StorePlatform): String = if (platform == StorePlatform.IOS) ios else android', '}', '', 'object PaymentsCatalog {']
  const TY = { subscription: 'SUBSCRIPTION', nonConsumable: 'NON_CONSUMABLE', consumable: 'CONSUMABLE' }
  for (const p of c.products || []) {
    const ids = storeIds(p)
    L.push(`    /** ${(p.description || p.id).replace(/\*\//g, '* /')} */`, `    val ${id(p.id)} = CatalogProduct(${q(p.id)}, ProductType.${TY[p.type]}, ${q(ids.android)}, ${q(ids.ios)}${p.basePlan ? `, basePlan = ${q(p.basePlan)}` : ''}${p.entitlement ? `, entitlement = Entitlement.${snakeUp(p.entitlement)}` : ''}${p.grants ? `, grants = mapOf(${Object.entries(p.grants).map(([k, n]) => `${q(k)} to ${n}L`).join(', ')})` : ''})`)
  }
  L.push(`    val all: List<CatalogProduct> = listOf(${(c.products || []).map((p) => id(p.id)).join(', ')})`,
    '    fun storeIds(platform: StorePlatform): Set<String> = all.map { it.storeId(platform) }.toSet()',
    '    fun byStoreId(storeId: String): CatalogProduct? = all.firstOrNull { it.android == storeId || it.ios == storeId }', '}', '')
  return L.join('\n')
}

function genSwift(c) {
  const ents = c.entitlements || []
  const id = (s) => { const x = camel(s); return SW_RESERVED.has(x) ? '`' + x + '`' : x }
  const L = [HEAD, 'import Foundation', '', 'enum StorePlatform: Sendable { case android, ios }', '', 'enum ProductType: Sendable { case subscription, nonConsumable, consumable }', '']
  if (ents.length) L.push('enum Entitlement: String, CaseIterable, Sendable {', ...ents.map((e) => `    case ${id(e.id)} = ${q(e.id)}`), '}', '')
  else L.push('/// No entitlements declared yet.', 'enum Entitlement: Sendable {}', '')
  L.push('struct CatalogProduct: Sendable {', '    let id: String', '    let type: ProductType', '    let android: String', '    let ios: String', '    var basePlan: String? = nil', '    var entitlement: Entitlement? = nil', '    var grants: [String: Int] = [:]',
    '    func storeId(_ platform: StorePlatform) -> String { platform == .ios ? ios : android }', '}', '', 'enum PaymentsCatalog {')
  for (const p of c.products || []) {
    const ids = storeIds(p)
    L.push(`    /// ${p.description || p.id}`, `    static let ${id(p.id)} = CatalogProduct(id: ${q(p.id)}, type: .${p.type}, android: ${q(ids.android)}, ios: ${q(ids.ios)}${p.basePlan ? `, basePlan: ${q(p.basePlan)}` : ''}${p.entitlement ? `, entitlement: .${id(p.entitlement)}` : ''}${p.grants ? `, grants: [${Object.entries(p.grants).map(([k, n]) => `${q(k)}: ${n}`).join(', ')}]` : ''})`)
  }
  L.push(`    static let all: [CatalogProduct] = [${(c.products || []).map((p) => id(p.id)).join(', ')}]`,
    '    static func storeIds(_ platform: StorePlatform) -> Set<String> { Set(all.map { $0.storeId(platform) }) }',
    '    static func byStoreId(_ storeId: String) -> CatalogProduct? { all.first { $0.android == storeId || $0.ios == storeId } }', '}', '')
  return L.join('\n')
}

function genServer(c) {
  const prods = Object.fromEntries((c.products || []).map((p) => { const ids = storeIds(p); return [p.id, { id: p.id, type: p.type, android: ids.android, ios: ids.ios, ...(p.basePlan ? { basePlan: p.basePlan } : {}), ...(p.entitlement ? { entitlement: p.entitlement } : {}), grants: p.grants || {} }] }))
  return [HEAD, '// Server side: the catalog the purchase verification trusts (never the client).', '',
    `export const PACKAGE_NAME = ${q(c.android?.packageName || '')}`,
    `export const BUNDLE_ID = ${q(c.apple?.bundleId || '')}`,
    `export const APP_APPLE_ID: number | undefined = ${c.apple?.appAppleId ? Number(c.apple.appAppleId) : 'undefined'}`, '',
    "export interface CatalogProduct { id: string; type: 'subscription' | 'nonConsumable' | 'consumable'; android: string; ios: string; basePlan?: string; entitlement?: string; grants: Record<string, number> }",
    `export const PRODUCTS: Record<string, CatalogProduct> = ${JSON.stringify(prods, null, 2)}`,
    'export const PRODUCTS_BY_STORE_ID: Record<string, CatalogProduct> = Object.fromEntries(Object.values(PRODUCTS).flatMap((p) => [[p.android, p], [p.ios, p]]))', ''].join('\n')
}

const serverCatalogFile = (prov) => (prov === 'firebase' ? path.join(functionsDir(), 'src', 'generated', 'payments.ts') : prov === 'supabase' ? path.join(root, 'supabase', 'functions', '_shared', 'payments.ts') : null)

// verifyPurchase in the backend contract (native mode): productId values follow the catalog
function verifyContract(c) {
  return {
    name: 'verifyPurchase', kind: 'callable', auth: 'user', platforms: ['mobile'],
    description: 'Verifica una compra con Google Play / App Store y la concede en el servidor',
    input: {
      platform: { type: 'string', values: ['android', 'ios'], required: true },
      productId: { type: 'string', values: (c.products || []).map((p) => p.id).length ? (c.products || []).map((p) => p.id) : ['none'], required: true },
      token: { type: 'string', required: true, maxLength: 20000, description: 'Play purchase token or StoreKit 2 signed transaction (JWS)' },
    },
    output: {
      entitlements: { type: 'string', array: true, required: true, description: 'entitlements active after this purchase' },
      expiresAt: { type: 'string', description: 'ISO date for subscriptions' },
      granted: { type: 'json', description: 'currency → amount credited by a consumable' },
    },
    errors: ['unauthenticated', 'invalid-argument', 'not-found', 'permission-denied', 'failed-precondition', 'unavailable'],
    origin: 'payments',
  }
}
const SERVER_FUNCTIONS = (c) => (c.mode === 'native'
  ? [verifyContract(c), { name: 'playRtdn', kind: 'trigger', on: 'pubsub:play-rtdn', description: 'Notificaciones en tiempo real de Google Play (renovaciones, cancelaciones, reembolsos)', origin: 'payments' }, { name: 'appStoreNotifications', kind: 'webhook', auth: 'public', description: 'App Store Server Notifications V2 (firmadas por Apple)', origin: 'payments' }]
  : [{ name: 'revenuecatWebhook', kind: 'webhook', description: 'Webhook de RevenueCat: refleja los entitlements en la base de datos', origin: 'payments' }])

function syncContract(c) {
  const api = readJson(apiFile)
  if (!api) return false
  let changed = false
  for (const f of SERVER_FUNCTIONS(c)) {
    const i = (api.functions || []).findIndex((x) => x.name === f.name)
    if (i < 0) { (api.functions ||= []).push(f); changed = true } else if (f.name === 'verifyPurchase' && JSON.stringify(api.functions[i].input?.productId) !== JSON.stringify(f.input.productId)) { api.functions[i].input = f.input; changed = true }
  }
  if (changed) fs.writeFileSync(apiFile, JSON.stringify(api, null, 2) + '\n')
  return changed
}

function generate(c, force) {
  const { errors } = validate(c)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix the catalog errors first.') }
  const written = []
  for (const s of stacks) {
    const t = outputFor('payments', s, root, config)
    const lang = { flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }[s.id] || 'ts'
    if (s.kind === 'web' && !(c.web)) continue // store purchases are mobile; web payments come later
    written.push(writeGuarded(t.file, stamp(lang === 'dart' ? genDart(c) : lang === 'kotlin' ? genKotlin(c, t.pkg) : lang === 'swift' ? genSwift(c) : genTs(c)), { root, force }))
  }
  const prov = provider()
  const sf = serverCatalogFile(prov)
  if (sf && (prov === 'firebase' || c.mode === 'revenuecat')) written.push(writeGuarded(sf, stamp(genServer(c)), { root, force }))
  if (syncContract(c)) written.push(rel(apiFile) + ' (server functions)')
  if (fs.existsSync(apiFile)) { const r = backend('gen', ...(force ? ['--force'] : [])); if (r.status !== 0) die('backend gen failed:\n' + r.stdout + r.stderr); r.stdout.split('\n').filter(Boolean).forEach((l) => written.push(l.replace(/^→ /, '') + ' (backend)')) }
  return written
}

const RULES = `Firestore rules (merge into firestore.rules):
  match /users/{uid}/entitlements/{entitlement} { allow read: if request.auth != null && request.auth.uid == uid; allow write: if false; }
  match /purchase_tokens/{key} { allow read, write: if false; }
  match /webhook_events/{id} { allow read, write: if false; }
  // and in match /users/{uid}: the client must never change the wallet:
  //   allow update: if request.auth.uid == uid && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['wallet']);`

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const exists = fs.existsSync(file)
  const c = exists ? load() : { mode: null, entitlements: [{ id: 'premium', description: 'Contenido premium' }], currencies: [], products: [] }
  if (opt.mode) c.mode = String(opt.mode)
  if (!['native', 'revenuecat'].includes(c.mode)) die('which mode? --mode native (store APIs + your server) | revenuecat')
  const ids = detectIds()
  if (c.mode === 'native') {
    if (canAndroid) c.android = { packageName: c.android?.packageName || ids.packageName || '', ...c.android }
    if (canIos) c.apple = { bundleId: c.apple?.bundleId || ids.bundleId || '', ...(c.apple?.appAppleId ? { appAppleId: c.apple.appAppleId } : {}), ...c.apple }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n')
  console.log(`${exists ? 'updated' : 'created'} ${rel(file)} (mode ${c.mode})`)
  const prov = provider()
  if (!prov) die('no backend yet — run /dualcraft:backend init first (purchases are verified on the server)')
  const made = []
  if (prov === 'firebase') {
    const fd = functionsDir(); const src = path.join(fd, 'src')
    const files = c.mode === 'native'
      ? [['payments/stores.ts', T.firebaseStores], ['verifyPurchase.ts', T.firebaseVerify], ['playRtdn.ts', T.firebaseRtdn], ['appStoreNotifications.ts', T.firebaseAppleNotifications]]
      : [['revenuecatWebhook.ts', T.firebaseRevenueCat]]
    for (const [f, s] of files) made.push(writeNew(path.join(src, f), s))
    const idx = path.join(src, 'index.ts')
    if (fs.existsSync(idx)) for (const f of SERVER_FUNCTIONS(c)) if (!new RegExp(`\\b${f.name}\\b`).test(read(idx))) { fs.appendFileSync(idx, `export { ${f.name} } from './${f.name}'\n`); made.push(`${rel(idx)}: export ${f.name}`) }
    const pj = path.join(fd, 'package.json'); const pkg = readJson(pj)
    if (pkg && c.mode === 'native') {
      pkg.dependencies = { ...pkg.dependencies, 'google-auth-library': pkg.dependencies?.['google-auth-library'] || '^11.0.0', '@apple/app-store-server-library': pkg.dependencies?.['@apple/app-store-server-library'] || '^3.1.0' }
      fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n'); made.push(`${rel(pj)}: google-auth-library, @apple/app-store-server-library (run npm install)`)
    }
    if (c.mode === 'native' && canIos) { fs.mkdirSync(path.join(fd, 'certs'), { recursive: true }); made.push(`${rel(path.join(fd, 'certs'))}/ ← put Apple root certificates here (.cer)`) }
  } else if (prov === 'supabase' && c.mode === 'revenuecat') {
    made.push(writeNew(path.join(root, 'supabase', 'functions', 'revenuecat-webhook', 'index.ts'), T.supabaseRevenueCat))
    const toml = path.join(root, 'supabase', 'config.toml')
    if (fs.existsSync(toml) && !read(toml).includes('[functions.revenuecat-webhook]')) { fs.appendFileSync(toml, '\n[functions.revenuecat-webhook]\nverify_jwt = false\n'); made.push('supabase/config.toml: verify_jwt = false for revenuecat-webhook') }
  } else {
    console.log(`⚠ provider "${prov}": ${c.mode === 'native' ? 'server verification is scaffolded for Firebase. Use --mode revenuecat, or implement verifyPurchase following references/play-billing.md and app-store-iap.md' : 'write the RevenueCat webhook as an API route (see references/revenuecat.md)'} — the contract entries are added so /dualcraft:backend check tracks them.`)
  }
  const fl = stacks.find((s) => s.id === 'flutter')
  if (fl && c.mode === 'native') made.push(writeNew(path.join(fl.dir, 'lib', 'services', 'purchase_service.dart'), T.flutterPurchaseService))
  made.filter(Boolean).forEach((m) => console.log('+ ' + m))
  if (validate(c).errors.length) { validate(c).errors.forEach((e) => console.log('✗ ' + e)); console.log('Fill the catalog (products, ids), then run gen.'); process.exit(0) }
  generate(c, !!opt.force).forEach((w) => console.log('→ ' + w))
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
if (!api) issues.push({ level: 'error', m: 'no backend contract — purchases must be verified on the server: /dualcraft:backend init' })
else {
  for (const f of SERVER_FUNCTIONS(c)) if (!(api.functions || []).some((x) => x.name === f.name)) issues.push({ level: 'error', m: `${f.name} is missing from the backend contract — run gen` })
  const v = (api.functions || []).find((x) => x.name === 'verifyPurchase')
  if (c.mode === 'native' && v && JSON.stringify(v.input?.productId?.values) !== JSON.stringify(verifyContract(c).input.productId.values)) issues.push({ level: 'error', m: 'verifyPurchase accepts a different product list than the catalog — run gen' })
}
if (prov === 'firebase' && c.mode === 'native') {
  const fd = functionsDir(); const deps = readJson(path.join(fd, 'package.json'))?.dependencies || {}
  for (const d of ['google-auth-library', '@apple/app-store-server-library']) if (!deps[d]) issues.push({ level: 'error', m: `${rel(path.join(fd, 'package.json'))}: dependency ${d} missing` })
  const certs = path.join(fd, 'certs')
  if (canIos && !(fs.existsSync(certs) && fs.readdirSync(certs).some((f) => f.endsWith('.cer')))) issues.push({ level: 'warn', m: `${rel(certs)}/ has no Apple root certificates (.cer) — App Store purchases can't be verified` })
}
// client code
const CODE = { flutter: /\.dart$/, kmp: /\.kt$/, android: /\.kt$/, ios: /\.swift$/ }
const codeFiles = (s) => {
  const acc = []; const re = CODE[s.id] || /\.(tsx?|jsx?|vue)$/
  const walk = (d, depth = 0) => { if (depth > 12 || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(node_modules|build|generated|\.|Pods|functions|supabase)/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (re.test(e.name)) acc.push(p) } }
  walk(s.id === 'flutter' ? path.join(s.dir, 'lib') : s.dir); return acc
}
for (const s of stacks) {
  const files = codeFiles(s); const all = files.map((f) => [f, read(f)])
  for (const [f, t] of all) {
    const m = t.match(/collection\(\s*['"]entitlements['"]\s*\)[\s\S]{0,200}?\.(set|update|add)\(|from\(\s*['"]entitlements['"]\s*\)\s*\.\s*(insert|update|upsert)\(/)
    if (m) issues.push({ level: 'error', m: `${rel(f)}: the app writes entitlements itself — only the server grants purchases (verifyPurchase / webhook)` })
    if (c.mode === 'native' && s.id === 'flutter' && /buyConsumable\((?![^)]*autoConsume:\s*false)/.test(t)) issues.push({ level: 'warn', m: `${rel(f)}: buyConsumable without autoConsume: false — consume server-side after crediting, or a failed verification loses the coins` })
  }
  if (s.kind !== 'mobile') continue
  const text = all.map(([, t]) => t).join('\n')
  const buys = /buyNonConsumable|buyConsumable|launchBillingFlow|\.purchase\(|Product\.purchase|purchasePackage|requestPurchase/.test(text)
  if (!buys) continue
  if (!/restorePurchases|AppStore\.sync|restoreCompletedTransactions|Purchases\.restore|restorePurchase|getAvailablePurchases|queryPurchasesAsync/.test(text)) issues.push({ level: canIos ? 'error' : 'warn', m: `${s.id}: purchases without a restore path — the App Store requires a visible "Restaurar compras"` })
  if (s.id === 'flutter' && !/purchaseStream/.test(text)) issues.push({ level: 'error', m: 'flutter: buys products but never listens to purchaseStream (purchases get lost and refunded)' })
  if (c.mode === 'native' && !/verifyPurchase/.test(text)) issues.push({ level: 'error', m: `${s.id}: purchases are not verified on the server (call api.verifyPurchase before unlocking)` })
}
if (opt.json) console.log(JSON.stringify({ mode: c.mode, provider: prov, products: (c.products || []).length, issues }, null, 2))
else {
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
  const n = issues.filter((i) => i.level === 'error').length
  console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `payments OK — ${(c.products || []).length} product(s), mode ${c.mode}, ${issues.length} warning(s)`)
  if (!n && c.mode === 'native' && prov === 'firebase') console.log('\n' + RULES)
}
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
