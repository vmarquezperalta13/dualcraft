#!/usr/bin/env node
// Generates DualCraft output for every language into <outdir>, laid out so the CI can compile each one:
//   <out>/ts      → tsc --noEmit --strict
//   <out>/dart    → flutter pub get && flutter gen-l10n && flutter analyze
//   <out>/kotlin  → gradle run (Compose JVM + kotlinx.serialization: compiles and exercises the code)
//   <out>/swift   → swiftc -typecheck *.swift (macOS)
//   <out>/sql     → node pg.mjs (PGlite applies the migrations) · prisma validate
//   <out>/functions   → npm install && tsc (Cloud Functions scaffolds + native payments against the real firebase-functions, Google and Apple types)
//   <out>/functions-rc → same, RevenueCat mode
//   <out>/web-server  → tsc (Next.js route handlers + Nuxt server routes with a small h3 shim)
//   <out>/deno        → deno check (Supabase Edge Functions)
import fs from 'node:fs'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, ROOT } from '../helpers.mjs'

const OUT = path.resolve(process.argv[2] || 'compile-out')
fs.rmSync(OUT, { recursive: true, force: true })
const must = (r, what) => { if (r.code !== 0) { console.error(`✗ ${what}\n${r.out}\n${r.err}`); process.exit(1) } }
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) }

// backend contract: every kind of function, a rich redeemCode (enums, lists, json, reserved names) → scaffolds + clients
const REDEEM = JSON.parse(read(path.join(ROOT, 'test', 'fixtures', 'api-redeem.json')))
const COMMON = [['redeemCode', '--kind', 'callable'], ['ping', '--kind', 'callable', '--auth', 'public'], ['grantAdmin', '--kind', 'callable', '--auth', 'admin'], ['stripeWebhook', '--kind', 'webhook'], ['dailyCleanup', '--kind', 'schedule', '--cron', '0 3 * * *']]
const FB = [...COMMON, ['adminReport', '--kind', 'http', '--auth', 'admin'], ['publicStats', '--kind', 'http', '--auth', 'public'],
  ...['firestore.created:users/{uid}', 'firestore.written:orders/{id}', 'pubsub:play-rtdn', 'storage.finalized', 'auth.beforeCreate', 'auth.beforeSignIn'].map((on, i) => ['trigger' + i, '--kind', 'trigger', '--on', on])]
function backend(p, provider, adds) {
  must(run('backend.mjs', ['init', '--provider', provider, ...(provider === 'firebase' ? ['--region', 'europe-west1'] : [])], p), 'backend init ' + provider)
  for (const a of adds) must(run('backend.mjs', ['add', ...a], p), 'backend add ' + a.join(' '))
  const f = path.join(p, '.dualcraft', 'backend', 'api.json'); const c = JSON.parse(read(f))
  Object.assign(c.functions.find((x) => x.name === 'redeemCode'), REDEEM)
  write(f, JSON.stringify(c, null, 2))
  must(run('backend.mjs', ['gen'], p), 'backend gen ' + provider)
  must(run('backend.mjs', ['check'], p), 'backend check ' + provider)
}
// push catalog (channels, topic, typed params, routes, ICU plural texts in two languages) → sender + parsers
function pushSetup(p) {
  write(path.join(p, '.dualcraft', 'push', 'notifications.json'), read(path.join(ROOT, 'test', 'fixtures', 'notifications.json')))
  const texts = JSON.parse(read(path.join(ROOT, 'test', 'fixtures', 'push-texts.json')))
  for (const [loc, t] of Object.entries(texts)) { const f = path.join(p, '.dualcraft', 'i18n', loc + '.json'); write(f, JSON.stringify({ ...JSON.parse(read(f)), push: t })) }
  write(path.join(p, 'firestore.indexes.json'), '{"indexes":[]}')
  must(run('push.mjs', ['init'], p), 'push init')
  must(run('push.mjs', ['check'], p), 'push check')
  must(run('backend.mjs', ['check'], p), 'backend check after push')
}
// payments catalog (subscriptions with base plans, lifetime unlock, consumable) → server verification + catalogs
function payments(p, mode) {
  write(path.join(p, '.dualcraft', 'payments', 'products.json'), JSON.stringify({ ...JSON.parse(read(path.join(ROOT, 'test', 'fixtures', 'products.json'))), mode }, null, 2))
  must(run('payments.mjs', ['init', '--mode', mode], p), 'payments init ' + mode)
  must(run('payments.mjs', ['check'], p), 'payments check ' + mode)
  must(run('backend.mjs', ['check'], p), 'backend check after payments ' + mode)
}

// ---------- multi-stack project (Firestore schema: enums, maps, reserved names) ----------
const multi = makeMultiProject('firestore')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], multi), s)
const M = (...p) => path.join(multi, ...p)
backend(multi, 'firebase', FB)
payments(multi, 'native')
pushSetup(multi)
write(M('functions', 'src', 'notify.ts'), `import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { REGION } from './generated/api'
import { push, render, format } from './generated/push'
import { sendToUser, sendToTopic } from './push/send'
export const notifyMatch = onDocumentCreated({ document: 'matches/{id}', region: REGION }, async (event) => {
  await sendToUser('u1', push.matchStarted({ matchId: event.params.id, home: 'Rayo', minute: 3, live: true }))
  await sendToTopic('news', push.weeklyOffer())
  const r = render(push.goalsSummary({ count: 2 }), 'es')
  if (r.body !== '2 goles' || format('{count, plural, =0 {Sin goles} other {# goles}}', { count: 0 }) !== 'Sin goles') throw new Error('icu ' + r.body)
})
`)
fs.cpSync(M('functions'), path.join(OUT, 'functions'), { recursive: true })
// RevenueCat mode on Firebase (its own functions folder)
const rc = makeProject()
backend(rc, 'firebase', COMMON)
payments(rc, 'revenuecat')
fs.cpSync(path.join(rc, 'functions'), path.join(OUT, 'functions-rc'), { recursive: true })

// TypeScript
for (const [f, name] of [['rn/src/theme/ds-tokens.ts', 'rn-tokens.ts'], ['rn/src/types/db.ts', 'rn-db.ts'], ['rn/src/lib/analytics-events.ts', 'rn-analytics.ts'], ['web/src/types/db.ts', 'web-db.ts'], ['web/src/lib/analytics-events.ts', 'web-analytics.ts'], ['rn/src/lib/api-client.ts', 'rn-api.ts'], ['web/src/lib/api-client.ts', 'web-api.ts'], ['functions/src/generated/api.ts', 'server-api.ts'], ['rn/src/lib/payments-catalog.ts', 'rn-payments.ts'], ['rn/src/lib/push-messages.ts', 'rn-push.ts']]) copy(M(f), path.join(OUT, 'ts', name))
write(path.join(OUT, 'ts', 'rn.d.ts'), "declare module 'react-native' { export function useColorScheme(): 'light' | 'dark' | null | undefined }\n")
write(path.join(OUT, 'ts', 'use.ts'), "import { dsTheme, dsText } from './rn-tokens'\nimport { analyticsEvents } from './rn-analytics'\nimport type { Users } from './rn-db'\nconst t = dsTheme('dark'); const c: string = t.colors.onSurface; const w: '600' = dsText.titleLarge.fontWeight\nconst e = analyticsEvents.signUp({ method: 'google' }); const u: Pick<Users, 'id'> = { id: 'x' }\nvoid c; void w; void e; void u\n")
write(path.join(OUT, 'ts', 'use-api.ts'), `import { createApi, ApiError, type ApiTransport } from './rn-api'
import { parseRedeemCodeInput, ApiInputError } from './server-api'
const t: ApiTransport = { call: async (endpoint, data) => { void data; if (endpoint === 'ping') return null; throw new ApiError('not-found') } }
const api = createApi(t)
export async function useApi(): Promise<[number, string]> {
  const r = await api.redeemCode({ code: 'ABC', platform: 'ios', tags: ['a'], class: 1 })
  const lv: ('gold' | 'silver-plus')[] | undefined = r.levels
  await api.ping(); void lv
  return [r.coins, r.level]
}
export function validate(): string {
  const ok = parseRedeemCodeInput({ code: 'ABC', tags: ['x'] })
  try { parseRedeemCodeInput({ code: 'abc', evil: 1 }) } catch (e) { if (e instanceof ApiInputError) return ok.code + ':' + e.field }
  return 'not rejected'
}
`)
write(path.join(OUT, 'ts', 'use-push.ts'), `import { parsePush, topicForLocale, pushChannels, type PushChannelId } from './rn-push'
export function open(data: Record<string, string>): string | null {
  const m = parsePush(data)
  if (!m) return null
  switch (m.type) {
    case 'match_started': return m.route ?? m.matchId + (m.minute ?? 0) + String(m.live)
    case 'goals_summary': return String(m.count + (m.ratio ?? 0))
    case 'weekly_offer': return m.route
  }
}
const ch: PushChannelId = pushChannels[0].id
export const topic = topicForLocale('news', 'es') + ch
`)
write(path.join(OUT, 'ts', 'use-payments.ts'), `import { products, productByStoreId, storeIds, entitlements, type Entitlement } from './rn-payments'
import { createApi, type ApiTransport } from './rn-api'
const e: Entitlement | undefined = products.premiumMonthly.entitlement
const coins: number | undefined = products.coins100.grants.coins
const ids: string[] = storeIds('android')
const found = productByStoreId('com.test.premium.yearly')?.id
const api = createApi({ call: async () => ({ entitlements: ['premium'] }) } satisfies ApiTransport)
export const check = async () => [e, coins, ids, found, entitlements.premium, (await api.verifyPurchase({ platform: 'ios', productId: 'premium_lifetime', token: 'x.y.z' })).entitlements]
`)

// Kotlin (KMP outputs: theme, models, analytics)
const K = (...p) => M('kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', ...p)
for (const [f, to] of [[K('theme', 'DsTokens.kt'), 'theme/DsTokens.kt'], [K('model', 'DbModels.kt'), 'model/DbModels.kt'], [K('analytics', 'AnalyticsEvents.kt'), 'analytics/AnalyticsEvents.kt'], [K('api', 'ApiClient.kt'), 'api/ApiClient.kt'], [K('payments', 'PaymentsCatalog.kt'), 'payments/PaymentsCatalog.kt'], [K('push', 'PushMessages.kt'), 'push/PushMessages.kt']]) copy(f, path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'com', 'test', 'app', to))
write(path.join(OUT, 'kotlin', 'settings.gradle.kts'), 'pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\ndependencyResolutionManagement { repositories { mavenCentral(); google() } }\nrootProject.name = "dualcraft-kotlin-check"\n')
write(path.join(OUT, 'kotlin', 'build.gradle.kts'), 'plugins {\n    kotlin("jvm") version "2.0.21"\n    kotlin("plugin.serialization") version "2.0.21"\n    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"\n    id("org.jetbrains.compose") version "1.7.0"\n    application\n}\ndependencies {\n    implementation(compose.desktop.currentOs)\n    implementation(compose.material3)\n    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")\n}\napplication { mainClass.set("check.MainKt") }\n')
write(path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'check', 'Main.kt'), `package check
import com.test.app.model.*
import com.test.app.analytics.*
import com.test.app.theme.*
import com.test.app.api.*
import com.test.app.payments.*
import com.test.app.push.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
class FakeTransport : ApiTransport {
    var last: Map<String, Any?> = emptyMap()
    override suspend fun call(endpoint: String, data: Map<String, Any?>): Any? {
        last = data
        if (endpoint == "ping") return null
        return mapOf("coins" to 5, "ratio" to 1, "level" to "silver-plus", "items" to listOf("a"), "levels" to listOf("gold"), "default" to true)
    }
}
fun main() {
    val fake = FakeTransport(); val api = Api(fake)
    val out = runBlocking { api.ping(); api.redeemCode(RedeemCodeInput(code = "ABC", platform = RedeemCodePlatform.IOS, \`class\` = 3)) }
    check(out.coins == 5L && out.ratio == 1.0 && out.level == RedeemCodeLevel.SILVER_PLUS && out.levels == listOf(RedeemCodeLevels.GOLD) && out.default == true) { "api decode " + out }
    check(fake.last == mapOf("code" to "ABC", "platform" to "ios", "class" to 3L)) { "api encode " + fake.last }
    val pm = PushMessage.parse(mapOf("type" to "match_started", "matchId" to "m9", "minute" to "12", "live" to "true"))
    check(pm == MatchStartedPush(matchId = "m9", minute = 12L, live = true) && pm.route == "/matches/m9") { "push parse " + pm }
    check(PushMessage.parse(mapOf("type" to "goals_summary", "count" to "x")) == null && PushMessage.parse(mapOf("type" to "weekly_offer")) == WeeklyOfferPush) { "push malformed/no params" }
    check(PushTopic.NEWS.forLocale("es") == "news_es" && PushChannel.MATCHES.importance == PushImportance.HIGH) { "push catalog" }
    check(PaymentsCatalog.byStoreId("com.test.premium.yearly") == PaymentsCatalog.premiumYearly && PaymentsCatalog.premiumYearly.entitlement == Entitlement.PREMIUM) { "payments lookup" }
    check(PaymentsCatalog.storeIds(StorePlatform.ANDROID) == setOf("premium", "premium_lifetime", "coins_100") && PaymentsCatalog.coins100.grants["coins"] == 100L) { "payments ids " + PaymentsCatalog.storeIds(StorePlatform.ANDROID) }
    val json = Json { ignoreUnknownKeys = true }
    val u = json.decodeFromString<Users>("""{"id":"u1","displayName":"Ana","email":"a@b.c","role":"in-progress","createdAt":"2026-01-01T00:00:00Z","class":"vip"}""")
    check(u.role == Role.IN_PROGRESS && u.classValue == "vip") { "serialization names" }
    check(json.encodeToString(Users.serializer(), u).contains("\\"class\\":\\"vip\\"")) { "SerialName on encode" }
    val e = AnalyticsEvents.matchViewed("m1", fromPush = true, position = 3)
    check(e.params["from_push"] == 1L) { "bool sent as 1" }
    check(DsSpacing.s4.value == 16f) { "spacing" }
    println("kotlin OK: \${e.name} \${DsColorsLight.primary}")
}
`)

// Swift (iOS outputs)
for (const [f, to] of [['iosapp/Demo/DesignSystem/DsTokens.swift', 'DsTokens.swift'], ['iosapp/Demo/Core/Models/DbModels.swift', 'DbModels.swift'], ['iosapp/Demo/Core/Analytics/AnalyticsEvents.swift', 'AnalyticsEvents.swift'], ['iosapp/Demo/Resources/DualCraft.xcstrings', 'DualCraft.xcstrings'], ['iosapp/Demo/Core/Api/ApiClient.swift', 'ApiClient.swift'], ['iosapp/Demo/Core/Payments/PaymentsCatalog.swift', 'PaymentsCatalog.swift'], ['iosapp/Demo/Core/Push/PushMessages.swift', 'PushMessages.swift']]) copy(M(f), path.join(OUT, 'swift', to))
write(path.join(OUT, 'swift', 'Use.swift'), 'import SwiftUI\nfunc dualcraftCheck() -> [Any] {\n    let u = Users(id: "1", displayName: "a", email: "e", role: .inProgress, tags: nil, createdAt: Date(), lastSeen: nil, settings: ["k": .string("v")], classValue: "vip")\n    return [DsColor.primary, DsSpacing.s4, DsText.titleLarge.font, AnalyticsEvents.signUp(method: .google).name, u.classValue as Any]\n}\n' +
  'struct FakeTransport: ApiTransport {\n    func call(_ endpoint: String, _ data: [String: Any]) async throws -> Any? {\n        if endpoint == "ping" { return nil }\n        return ["coins": 5, "ratio": 1, "level": "silver-plus", "items": ["a"], "levels": ["gold"], "default": true] as [String: Any]\n    }\n}\n' +
  'func apiCheck() async throws -> Int {\n    let api = Api(transport: FakeTransport())\n    try await api.ping()\n    let r = try await api.redeemCode(RedeemCodeInput(code: "ABC", platform: .ios, class: 3))\n    return r.coins + (r.levels?.count ?? 0) + (r.level == .silverPlus ? 1 : 0)\n}\n' +
  'func paymentsCheck() -> Bool {\n    PaymentsCatalog.byStoreId("com.test.premium.yearly")?.entitlement == .premium && PaymentsCatalog.storeIds(.android).contains("premium") && PaymentsCatalog.coins100.grants["coins"] == 100\n}\n' +
  'func pushCheck() -> String? {\n    guard let m = PushMessage.parse(["type": "goals_summary", "count": "3"]) else { return nil }\n    if case let .goalsSummary(count, ratio) = m { _ = count + Int(ratio ?? 0) }\n    return (m.route ?? "") + m.type + PushTopic.news.forLocale("es") + PushChannel.all[0].id\n}\n')

// ---------- Flutter project (hockey schema) ----------
const fl = makeProject({ mobile: 'flutter', paths: { mobile: 'app' }, schema: 'hockey' })
write(path.join(fl, 'app', 'pubspec.yaml'), 'name: dualcraft_check\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_localizations:\n    sdk: flutter\n  intl: any\n  in_app_purchase: any\n  firebase_messaging: ">=17.0.0"\n  flutter_local_notifications: any\nflutter:\n  generate: true\n')
write(path.join(fl, 'app', 'l10n.yaml'), 'arb-dir: lib/l10n\ntemplate-arb-file: app_es.arb\noutput-localization-file: app_localizations.dart\n')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], fl), `flutter ${s}`)
backend(fl, 'firebase', COMMON)
payments(fl, 'native')
pushSetup(fl)
write(path.join(fl, 'app', 'lib', 'main.dart'), "import 'package:flutter/material.dart';\nimport 'generated/design_tokens.dart';\nimport 'generated/db_models.dart';\nimport 'generated/analytics_events.dart';\nimport 'generated/api_client.dart';\nimport 'generated/payments_catalog.dart';\nimport 'services/purchase_service.dart';\nimport 'generated/push_catalog.dart';\nimport 'services/push_service.dart';\nvoid main() => runApp(MaterialApp(theme: DsTheme.light(), darkTheme: DsTheme.dark(), home: Builder(builder: (c) => Container(color: c.ds.surface, padding: const EdgeInsets.all(DsSpacing.s4)))));\nfinal t = HockeyTeam(id: 1, name: 'x');\nfinal e = AnalyticsEvents.signUp(method: SignUpMethod.google);\n" +
  "class FakeTransport implements ApiTransport {\n  @override\n  Future<Object?> call(String endpoint, Map<String, Object?> data) async => endpoint == 'ping' ? null : <String, Object?>{'coins': 5, 'level': 'silver-plus', 'levels': ['gold'], 'default': true};\n}\n" +
  "Future<int> apiCheck() async {\n  final api = Api(FakeTransport());\n  await api.ping();\n  final r = await api.redeemCode(RedeemCodeInput(code: 'ABC', platform: RedeemCodePlatform.ios, classValue: 3));\n  return r.coins + (r.levels?.length ?? 0) + (r.level == RedeemCodeLevel.silverPlus ? 1 : 0);\n}\n" +
  "class MemoryCache implements EntitlementCache {\n  Set<String> _s = {};\n  @override\n  Future<Set<String>> load() async => _s;\n  @override\n  Future<void> save(Set<String> e) async => _s = {...e};\n}\n" +
  "bool paymentsCheck(PurchaseService s) => s.has(Entitlement.premium) || PaymentsCatalog.byStoreId('premium')?.type == ProductType.subscription;\nfinal service = PurchaseService(Api(FakeTransport()), MemoryCache());\n" +
  "String? pushCheck() {\n  final m = PushMessage.parse({'type': 'match_started', 'matchId': 'm9', 'minute': '12'});\n  return switch (m) {\n    MatchStartedPush(:final matchId, :final minute) => '$matchId ${minute ?? 0} ${PushTopic.news.forLocale('es')}',\n    GoalsSummaryPush(:final count) => '$count',\n    WeeklyOfferPush() => PushChannel.promos.label,\n    null => null,\n  };\n}\n" +
  "PushService pushService(Api api) => PushService(api, onOpen: (m) => debugPrint(m.route), onForeground: (m, n) => debugPrint(n?.title));\n")
fs.cpSync(path.join(fl, 'app'), path.join(OUT, 'dart'), { recursive: true })

// ---------- SQL / Prisma (hockey schema, Supabase) ----------
const db = makeProject({ schema: 'hockey', extra: { backend: { provider: 'supabase' } } })
must(run('database.mjs', ['migration', 'init'], db), 'migration init')
const schema = path.join(db, '.dualcraft', 'db', 'schema.dbml')
write(schema, read(schema).replace('  logo varchar', '  logo varchar\n  city varchar [default: \'\']') + '\nTable comment {\n  id uuid [pk]\n  user_id uuid [not null]\n  body text [not null]\n  created_at timestamp [not null, default: `now()`]\n}\n')
must(run('database.mjs', ['migration', 'changes'], db), 'migration diff')
fs.cpSync(path.join(db, 'supabase', 'migrations'), path.join(OUT, 'sql', 'migrations'), { recursive: true })
must(run('database.mjs', ['prisma', '--out', path.join(OUT, 'sql', 'prisma', 'schema.prisma')], db), 'prisma')
write(path.join(OUT, 'sql', 'pg.mjs'), `// Applies the migrations, in order, on an in-memory Postgres (PGlite) with a minimal Supabase auth stub.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
const dir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const db = new PGlite()
await db.exec("create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;")
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('applied ' + f) }
const t = await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")
const p = await db.query('select count(*)::int n from pg_policies')
if (t.rows[0].n !== 11 || p.rows[0].n < 4) { console.error('unexpected result', t.rows[0], p.rows[0]); process.exit(1) }
console.log('postgres OK: ' + t.rows[0].n + ' tables, ' + p.rows[0].n + ' policies')
`)
// ---------- Supabase Edge Functions (Deno) ----------
const sb = makeProject({ extra: { backend: { provider: 'supabase' } } })
backend(sb, 'supabase', [...COMMON, ['trigger0', '--kind', 'trigger', '--on', 'db:orders.insert']])
payments(sb, 'revenuecat')
fs.cpSync(path.join(sb, 'supabase', 'functions'), path.join(OUT, 'deno'), { recursive: true })
write(path.join(OUT, 'deno', 'deno.json'), '{ "nodeModulesDir": "auto" }\n') // the repo's package.json would otherwise switch Deno to manual node_modules

// ---------- Next.js route handlers and Nuxt server routes (provider http) ----------
for (const id of ['nextjs', 'nuxt']) {
  const w = makeProject({ web: id, paths: { web: 'web' } })
  write(path.join(w, 'web', 'package.json'), JSON.stringify({ dependencies: id === 'nextjs' ? { next: '15.0.0' } : { nuxt: '3.14.0' } }))
  if (id === 'nextjs') fs.mkdirSync(path.join(w, 'web', 'src', 'app'), { recursive: true })
  backend(w, 'http', COMMON)
  fs.cpSync(path.join(w, 'web'), path.join(OUT, 'web-server', id), { recursive: true, filter: (f) => !f.endsWith('package.json') })
}
write(path.join(OUT, 'web-server', 'h3-shim.d.ts'), 'interface H3Event { readonly __h3: true }\ndeclare function defineEventHandler<T>(h: (event: H3Event) => T | Promise<T>): unknown\ndeclare function createError(o: { statusCode: number; statusMessage?: string; data?: unknown }): Error\ndeclare function readBody(e: H3Event): Promise<unknown>\ndeclare function readRawBody(e: H3Event): Promise<string | undefined>\ndeclare function getHeader(e: H3Event, name: string): string | undefined\n')
write(path.join(OUT, 'web-server', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2022', 'dom'], types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }, null, 2))

// ---------- GitHub Actions workflows (actionlint) ----------
// multi-stack project (Firebase backend) with every web host, Supabase backend, and a Flutter-only project
write(M('web', 'package.json'), JSON.stringify({ scripts: { build: 'astro build', lint: 'eslint .', test: 'vitest run' }, dependencies: { astro: '5.1.0' } }))
write(M('web', 'package-lock.json'), '{}')
write(M('droid', 'app', 'build.gradle.kts'), 'android { namespace = "com.test.droid"\n  defaultConfig { applicationId = "com.test.droid" } }\n')
for (const host of ['firebase', 'vercel', 'cloudflare', 'netlify']) {
  must(run('deploy.mjs', ['init', '--host', host, '--force'], multi), 'deploy init ' + host)
  fs.cpSync(M('.github', 'workflows'), path.join(OUT, 'workflows', host), { recursive: true })
}
must(run('deploy.mjs', ['init'], sb), 'deploy init supabase')
fs.cpSync(path.join(sb, '.github', 'workflows'), path.join(OUT, 'workflows', 'supabase'), { recursive: true })
fs.mkdirSync(path.join(fl, 'app', 'ios', 'Runner.xcworkspace'), { recursive: true }); fs.mkdirSync(path.join(fl, 'app', 'ios', 'Runner.xcodeproj'), { recursive: true })
write(path.join(fl, 'app', 'android', 'app', 'build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.hockey" } }\n')
must(run('deploy.mjs', ['init'], fl), 'deploy init flutter')
fs.cpSync(path.join(fl, '.github', 'workflows'), path.join(OUT, 'workflows', 'flutter'), { recursive: true })

console.log(`compile fixtures → ${OUT}`)
for (const d of fs.readdirSync(OUT)) console.log(`  ${d}: ${fs.readdirSync(path.join(OUT, d)).length} entries`)
