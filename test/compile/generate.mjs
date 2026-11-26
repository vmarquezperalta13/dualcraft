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
//   <out>/auth-vue    → npm install && vue-tsc (Nuxt auth screens)
//   <out>/auth-ts     → npm install && tsc (AuthService: web with Firebase, supabase-js for the web and React Native)
//   <out>/ui-rn       → npm install && tsc (React Native idioms of references/port against the real library types)
//   references/port idioms are also copied into dart/lib/port, kotlin/idioms, swift/port-{lang,ui} and ts/port
import fs from 'node:fs'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, ROOT, png } from '../helpers.mjs'
import { flutterSupabase } from '../../scripts/lib/auth-clients.mjs'
import { tsFirebase, tsSupabase } from '../../scripts/lib/auth-clients-ts.mjs'
import { reactWebScreens } from '../../scripts/lib/auth-screens-ts.mjs'
import { vueAuthFlow, vueAccount, vueRedirect } from '../../scripts/lib/auth-screens-vue.mjs'
import { kotlinSupabase } from '../../scripts/lib/auth-clients-kt.mjs'
import { swiftSupabase } from '../../scripts/lib/auth-clients-swift.mjs'

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

// auth (every method, roles, guest, linking, MFA) → catalogs per stack + deleteAccount/setUserRole on the server
function authSetup(p) {
  must(run('auth.mjs', ['init', '--methods', 'email,google,apple,passkey,phone', '--mfa', 'totp,sms', '--rp-id', 'acme.app', '--roles', 'admin,editor,user'], p), 'auth init')
  must(run('auth.mjs', ['check'], p), 'auth check')
  must(run('backend.mjs', ['check'], p), 'backend check after auth')
  if (fs.existsSync(path.join(p, '.dualcraft', 'i18n'))) { must(run('i18n.mjs', ['gen'], p), 'i18n gen after auth') }
}

// feature flags (every type, an enum, quotes and $ in descriptions, a web-only flag) → typed accessors per stack
function flagsSetup(p) {
  write(path.join(p, '.dualcraft', 'flags', 'flags.json'), read(path.join(ROOT, 'test', 'fixtures', 'flags.json')))
  must(run('flags.mjs', ['gen'], p), 'flags gen')
  const c = run('flags.mjs', ['check'], p); if (c.code !== 0) { console.error(c.out); process.exit(1) }
}

// error monitoring (Sentry everywhere in the multi project, Crashlytics in Flutter) → settings per stack + Sentry in the deploy workflows
function monitoringSetup(p, args) {
  must(run('monitoring.mjs', ['init', ...args], p), 'monitoring init')
  const spec = path.join(p, '.dualcraft', 'monitoring', 'monitoring.json'); const m = JSON.parse(read(spec))
  m.scrub = [...m.scrub, 'user.name', 'x$y']; m.ignore = [...m.ignore, "it's \"quoted\" $x"]
  write(spec, JSON.stringify(m, null, 2)); must(run('monitoring.mjs', ['gen'], p), 'monitoring gen')
  must(run('monitoring.mjs', ['check'], p), 'monitoring check')
}

// deep links (routes imported from push, a literal that beats a parameter, int path param, string + int query) → builders + parsers
function linksSetup(p) {
  must(run('links.mjs', ['init', '--domain', 'acme.app', '--scheme', 'acme'], p), 'links init')
  must(run('links.mjs', ['add', 'newMatch', '/matches/new'], p), 'links add newMatch')
  must(run('links.mjs', ['add', 'team', '/teams/{teamId}', '--params', 'teamId:int', '--query', 'tab:string,page:int'], p), 'links add team')
  const c = run('links.mjs', ['check'], p); if (c.code !== 0) { console.error(c.out); process.exit(1) }
}

// ---------- multi-stack project (Firestore schema: enums, maps, reserved names) ----------
const multi = makeMultiProject('firestore')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], multi), s)
const M = (...p) => path.join(multi, ...p)
backend(multi, 'firebase', FB)
payments(multi, 'native')
pushSetup(multi)
authSetup(multi)
must(run('e2e.mjs', ['init', '--app-id', 'com.test.app', '--scheme', 'acme'], multi), 'e2e init multi')
must(run('perf.mjs', ['init'], multi), 'perf init multi')
flagsSetup(multi)
monitoringSetup(multi, ['--web', 'sentry', '--mobile', 'sentry'])
linksSetup(multi)
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
for (const [f, name] of [['rn/src/theme/ds-tokens.ts', 'rn-tokens.ts'], ['rn/src/types/db.ts', 'rn-db.ts'], ['rn/src/lib/analytics-events.ts', 'rn-analytics.ts'], ['web/src/types/db.ts', 'web-db.ts'], ['web/src/lib/analytics-events.ts', 'web-analytics.ts'], ['rn/src/lib/api-client.ts', 'rn-api.ts'], ['web/src/lib/api-client.ts', 'web-api.ts'], ['functions/src/generated/api.ts', 'server-api.ts'], ['rn/src/lib/payments-catalog.ts', 'rn-payments.ts'], ['rn/src/lib/push-messages.ts', 'rn-push.ts'], ['rn/src/lib/auth-catalog.ts', 'rn-auth.ts'], ['web/src/lib/auth-catalog.ts', 'web-auth.ts']]) copy(M(f), path.join(OUT, 'ts', name))
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

copy(M('rn/src/lib/feature-flags.ts'), path.join(OUT, 'ts', 'rn-flags.ts'))
write(path.join(OUT, 'ts', 'use-flags.ts'), `import { flags, setFlagSource, setFlagOverrides, flagDefaults, type FlagName } from './rn-flags'
const remote: Record<string, unknown> = { new_checkout: 'true', home_layout: 'grid', max_upload_mb: '7.5', price_factor: 2 }
setFlagSource((k) => remote[k])
const a: boolean = flags.newCheckout; const b: 'grid' | 'list' = flags.homeLayout; const n: number = flags.maxUploadMb + flags.priceFactor; const e: string = flags.supportEmail
setFlagOverrides({ newCheckout: false, homeLayout: 'list' })
const name: FlagName = 'maxUploadMb'
void a; void b; void n; void e; void name; void flagDefaults
`)

copy(M('rn/src/lib/monitoring.ts'), path.join(OUT, 'ts', 'rn-monitoring.ts'))
write(path.join(OUT, 'ts', 'use-monitoring.ts'), `import { monitoring, scrubReport, shouldReport, tracesSampleRate, monitoringEnvironment } from './rn-monitoring'
const ev = { user: { id: 'u1', email: 'a@b.c' }, extra: [{ password: 'p', ok: 1 }] }
const clean: typeof ev = scrubReport(ev)
const keep: boolean = shouldReport('TypeError') && monitoring.sendDefaultPii === false
const rate: number = tracesSampleRate(monitoringEnvironment(undefined))
void clean; void keep; void rate
`)

copy(M('rn/src/lib/app-links.ts'), path.join(OUT, 'ts', 'rn-links.ts'))
write(path.join(OUT, 'ts', 'use-links.ts'), `import { links, linkUrl, parseLink, type AppRoute } from './rn-links'
const url: string = linkUrl(links.team({ teamId: 7, tab: 'stats', page: 2 }))
const r: AppRoute | null = parseLink('acme://matches/new')
const name: string | undefined = r?.name
void url; void name
`)

// Kotlin (KMP outputs: theme, models, analytics)
const K = (...p) => M('kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', ...p)
for (const [f, to] of [[K('theme', 'DsTokens.kt'), 'theme/DsTokens.kt'], [K('model', 'DbModels.kt'), 'model/DbModels.kt'], [K('analytics', 'AnalyticsEvents.kt'), 'analytics/AnalyticsEvents.kt'], [K('api', 'ApiClient.kt'), 'api/ApiClient.kt'], [K('payments', 'PaymentsCatalog.kt'), 'payments/PaymentsCatalog.kt'], [K('push', 'PushMessages.kt'), 'push/PushMessages.kt'], [K('auth', 'AuthCatalog.kt'), 'auth/AuthCatalog.kt'], [K('flags', 'FeatureFlags.kt'), 'flags/FeatureFlags.kt'], [K('monitoring', 'Monitoring.kt'), 'monitoring/Monitoring.kt'], [K('links', 'AppLinks.kt'), 'links/AppLinks.kt']]) copy(f, path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'com', 'test', 'app', to))
write(path.join(OUT, 'kotlin', 'settings.gradle.kts'), 'pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\ndependencyResolutionManagement { repositories { mavenCentral(); google() } }\nrootProject.name = "dualcraft-kotlin-check"\n')
write(path.join(OUT, 'kotlin', 'build.gradle.kts'), 'plugins {\n    kotlin("jvm") version "2.0.21"\n    kotlin("plugin.serialization") version "2.0.21"\n    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"\n    id("org.jetbrains.compose") version "1.7.0"\n    application\n}\ndependencies {\n    implementation(compose.desktop.currentOs)\n    implementation(compose.material3)\n    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")\n    implementation("org.jetbrains.androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")\n    implementation("org.jetbrains.androidx.lifecycle:lifecycle-runtime-compose:2.8.3")\n    implementation("org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10")\n    implementation("io.coil-kt.coil3:coil-compose:3.0.4")\n}\napplication { mainClass.set("check.MainKt") }\n')
write(path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'check', 'Main.kt'), `package check
import com.test.app.model.*
import com.test.app.flags.*
import com.test.app.monitoring.*
import com.test.app.links.*
import com.test.app.analytics.*
import com.test.app.theme.*
import com.test.app.api.*
import com.test.app.payments.*
import com.test.app.push.*
import com.test.app.auth.*
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
    val guest = AuthUser(uid = "g", isAnonymous = true)
    val editor = AuthUser(uid = "e", email = "e@x.y", role = roleFrom("editor"))
    check(decideAccess("/login?next=/x", null) == AccessDecision.ALLOW && decideAccess("/admin/users", null) == AccessDecision.SIGN_IN) { "access anonymous" }
    check(decideAccess("/feed", guest) == AccessDecision.ALLOW && decideAccess("/account/profile", guest) == AccessDecision.SIGN_IN) { "access guest" }
    check(decideAccess("/admin", editor) == AccessDecision.FORBIDDEN && decideAccess("/admin/a/b", AuthUser(uid = "a", role = roleFrom("admin"))) == AccessDecision.ALLOW && decideAccess("/account", editor) == AccessDecision.ALLOW) { "access roles" }
    check(roleFrom(null) == AuthRole.USER && roleFrom("nope") == AuthRole.USER && ADMIN_ROLE == AuthRole.ADMIN) { "roles" }
    check(authErrorFrom("auth/email-already-in-use") == AuthErrorCode.EMAIL_IN_USE && authErrorFrom("ERROR_WRONG_PASSWORD") == AuthErrorCode.INVALID_CREDENTIALS && authErrorFrom("invalid_credentials") == AuthErrorCode.INVALID_CREDENTIALS && authErrorFrom("weird") == AuthErrorCode.UNKNOWN) { "auth errors" }
    check(AuthErrorCode.ACCOUNT_EXISTS_WITH_DIFFERENT_METHOD.key == "auth.errors.account_exists_with_different_method") { "error key" }
    check(passwordProblems("abc") == listOf(PasswordProblem.TOO_SHORT, PasswordProblem.NO_DIGIT) && passwordProblems("abcdefg1").isEmpty()) { "password policy" }
    FeatureFlags.source = { k -> mapOf<String, Any?>("new_checkout" to "true", "home_layout" to "grid", "max_upload_mb" to "7.5", "price_factor" to 2)[k] }
    check(FeatureFlags.newCheckout && FeatureFlags.homeLayout == "grid" && FeatureFlags.maxUploadMb == 20L && FeatureFlags.priceFactor == 2.0 && FeatureFlags.supportEmail == "help@acme.app") { "flags source and fallback" }
    FeatureFlags.overrides["home_layout"] = "carousel"
    check(FeatureFlags.homeLayout == "list") { "flags enum fallback" }
    val scrubbed = Monitoring.scrubReport(mapOf("user" to mapOf("id" to "u1", "Email" to "a@b.c"), "extra" to listOf(mapOf("api_key" to "k", "n" to 1)))) as Map<*, *>
    check((scrubbed["user"] as Map<*, *>)["Email"] == "[redacted]" && (scrubbed["user"] as Map<*, *>)["id"] == "u1" && ((scrubbed["extra"] as List<*>)[0] as Map<*, *>)["api_key"] == "[redacted]") { "monitoring scrub " + scrubbed }
    check(!Monitoring.shouldReport("ResizeObserver loop") && Monitoring.shouldReport("boom") && Monitoring.tracesSampleRate(Monitoring.environment(null)) == 0.1 && Monitoring.RELEASE.startsWith("testapp@")) { "monitoring settings" }
    check(AppRoute.Team(teamId = 7, tab = "a b", page = 2).path == "/teams/7?tab=a%20b&page=2" && AppLinks.url(AppRoute.NewMatch) == "https://acme.app/matches/new") { "links build" }
    check(AppRoute.parse("https://acme.app/matches/new") == AppRoute.NewMatch && AppRoute.parse("acme://teams/7?tab=a%20b&page=x") == AppRoute.Team(7, "a b", null)) { "links parse" }
    check(AppRoute.parse("https://evil.com/matches/new") == null && AppRoute.parse("https://acme.app/teams/abc") == null && AppRoute.parse("https://acme.app/matches/%E2%82%AC") is AppRoute.Matches) { "links reject / decode" }
    println("kotlin OK: \${e.name} \${DsColorsLight.primary}")
}
`)

// Swift (iOS outputs)
for (const [f, to] of [['iosapp/Demo/DesignSystem/DsTokens.swift', 'DsTokens.swift'], ['iosapp/Demo/Core/Models/DbModels.swift', 'DbModels.swift'], ['iosapp/Demo/Core/Analytics/AnalyticsEvents.swift', 'AnalyticsEvents.swift'], ['iosapp/Demo/Resources/DualCraft.xcstrings', 'DualCraft.xcstrings'], ['iosapp/Demo/Core/Api/ApiClient.swift', 'ApiClient.swift'], ['iosapp/Demo/Core/Payments/PaymentsCatalog.swift', 'PaymentsCatalog.swift'], ['iosapp/Demo/Core/Push/PushMessages.swift', 'PushMessages.swift'], ['iosapp/Demo/Core/Auth/AuthCatalog.swift', 'AuthCatalog.swift'], ['iosapp/Demo/Core/Flags/FeatureFlags.swift', 'FeatureFlags.swift'], ['iosapp/Demo/Core/Monitoring/Monitoring.swift', 'Monitoring.swift'], ['iosapp/Demo/Core/Links/AppLinks.swift', 'AppLinks.swift']]) copy(M(f), path.join(OUT, 'swift', to))
write(path.join(OUT, 'swift', 'Use.swift'), 'import SwiftUI\nfunc dualcraftCheck() -> [Any] {\n    let u = Users(id: "1", displayName: "a", email: "e", role: .inProgress, tags: nil, createdAt: Date(), lastSeen: nil, settings: ["k": .string("v")], classValue: "vip")\n    return [DsColor.primary, DsSpacing.s4, DsText.titleLarge.font, AnalyticsEvents.signUp(method: .google).name, u.classValue as Any]\n}\n' +
  'struct FakeTransport: ApiTransport {\n    func call(_ endpoint: String, _ data: [String: Any]) async throws -> Any? {\n        if endpoint == "ping" { return nil }\n        return ["coins": 5, "ratio": 1, "level": "silver-plus", "items": ["a"], "levels": ["gold"], "default": true] as [String: Any]\n    }\n}\n' +
  'func apiCheck() async throws -> Int {\n    let api = Api(transport: FakeTransport())\n    try await api.ping()\n    let r = try await api.redeemCode(RedeemCodeInput(code: "ABC", platform: .ios, class: 3))\n    return r.coins + (r.levels?.count ?? 0) + (r.level == .silverPlus ? 1 : 0)\n}\n' +
  'func paymentsCheck() -> Bool {\n    PaymentsCatalog.byStoreId("com.test.premium.yearly")?.entitlement == .premium && PaymentsCatalog.storeIds(.android).contains("premium") && PaymentsCatalog.coins100.grants["coins"] == 100\n}\n' +
  'func pushCheck() -> String? {\n    guard let m = PushMessage.parse(["type": "goals_summary", "count": "3"]) else { return nil }\n    if case let .goalsSummary(count, ratio) = m { _ = count + Int(ratio ?? 0) }\n    return (m.route ?? "") + m.type + PushTopic.news.forLocale("es") + PushChannel.all[0].id\n}\n')

write(path.join(OUT, 'swift', 'UseFlags.swift'), 'func flagsCheck() -> Bool {\n    FeatureFlags.source = { k in ["new_checkout": "true", "home_layout": "grid", "max_upload_mb": "7.5", "price_factor": 2][k] }\n    let ok = FeatureFlags.newCheckout && FeatureFlags.homeLayout == "grid" && FeatureFlags.maxUploadMb == 20 && FeatureFlags.priceFactor == 2.0 && !FeatureFlags.supportEmail.isEmpty\n    FeatureFlags.overrides["new_checkout"] = false\n    return ok && !FeatureFlags.newCheckout\n}\n')
write(path.join(OUT, 'swift', 'UseMonitoring.swift'), 'func monitoringCheck() -> Bool {\n    let s = Monitoring.scrubReport(["user": ["id": "u1", "Email": "a@b.c"]] as [String: Any]) as? [String: Any]\n    let user = s?["user"] as? [String: Any]\n    return (user?["Email"] as? String) == "[redacted]" && !Monitoring.shouldReport("Load failed") && Monitoring.tracesSampleRate(Monitoring.environment(nil)) == 0.1 && !Monitoring.sendDefaultPii\n}\n')
write(path.join(OUT, 'swift', 'UseLinks.swift'), 'func linksCheck() -> Bool {\n    let built = AppRoute.team(teamId: 7, tab: "a b", page: 2).path == "/teams/7?tab=a%20b&page=2" && AppLinks.url(.newMatch) == "https://acme.app/matches/new"\n    let parsed = AppRoute.parse("https://acme.app/matches/new") == .newMatch && AppRoute.parse("acme://teams/7?tab=a%20b&page=x") == .team(teamId: 7, tab: "a b", page: nil)\n    return built && parsed && AppRoute.parse("https://evil.com/x") == nil\n}\n')
// ---------- Flutter project (hockey schema) ----------
const fl = makeProject({ mobile: 'flutter', paths: { mobile: 'app' }, schema: 'hockey' })
write(path.join(fl, 'app', 'pubspec.yaml'), 'name: dualcraft_check\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_localizations:\n    sdk: flutter\n  intl: any\n  in_app_purchase: any\n  firebase_messaging: ">=17.0.0"\n  flutter_local_notifications: any\n  flutter_riverpod: any\n  flutter_bloc: any\n  go_router: any\n  firebase_auth: any\n  google_sign_in: ^7.0.0\n  sign_in_with_apple: any\n  crypto: any\n  supabase_flutter: ^2.15.0\n  passkeys: ^2.21.0\nflutter:\n  generate: true\n')
write(path.join(fl, 'app', 'l10n.yaml'), 'arb-dir: lib/l10n\ntemplate-arb-file: app_es.arb\noutput-localization-file: app_localizations.dart\n')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], fl), `flutter ${s}`)
backend(fl, 'firebase', COMMON)
authSetup(fl)
payments(fl, 'native')
pushSetup(fl)
flagsSetup(fl)
monitoringSetup(fl, ['--mobile', 'crashlytics'])
linksSetup(fl)
write(path.join(fl, 'app', 'lib', 'main.dart'), "import 'package:flutter/material.dart';\nimport 'generated/design_tokens.dart';\nimport 'generated/db_models.dart';\nimport 'generated/analytics_events.dart';\nimport 'generated/api_client.dart';\nimport 'generated/payments_catalog.dart';\nimport 'services/purchase_service.dart';\nimport 'generated/push_catalog.dart';\nimport 'services/push_service.dart';\nimport 'generated/feature_flags.dart';\nimport 'generated/monitoring.dart';\nimport 'generated/app_links.dart';\nvoid main() => runApp(MaterialApp(theme: DsTheme.light(), darkTheme: DsTheme.dark(), home: Builder(builder: (c) => Container(color: c.ds.surface, padding: const EdgeInsets.all(DsSpacing.s4)))));\nfinal t = HockeyTeam(id: 1, name: 'x');\nfinal e = AnalyticsEvents.signUp(method: SignUpMethod.google);\n" +
  "class FakeTransport implements ApiTransport {\n  @override\n  Future<Object?> call(String endpoint, Map<String, Object?> data) async => endpoint == 'ping' ? null : <String, Object?>{'coins': 5, 'level': 'silver-plus', 'levels': ['gold'], 'default': true};\n}\n" +
  "Future<int> apiCheck() async {\n  final api = Api(FakeTransport());\n  await api.ping();\n  final r = await api.redeemCode(RedeemCodeInput(code: 'ABC', platform: RedeemCodePlatform.ios, classValue: 3));\n  return r.coins + (r.levels?.length ?? 0) + (r.level == RedeemCodeLevel.silverPlus ? 1 : 0);\n}\n" +
  "class MemoryCache implements EntitlementCache {\n  Set<String> _s = {};\n  @override\n  Future<Set<String>> load() async => _s;\n  @override\n  Future<void> save(Set<String> e) async => _s = {...e};\n}\n" +
  "bool paymentsCheck(PurchaseService s) => s.has(Entitlement.premium) || PaymentsCatalog.byStoreId('premium')?.type == ProductType.subscription;\nfinal service = PurchaseService(Api(FakeTransport()), MemoryCache());\n" +
  "String? pushCheck() {\n  final m = PushMessage.parse({'type': 'match_started', 'matchId': 'm9', 'minute': '12'});\n  return switch (m) {\n    MatchStartedPush(:final matchId, :final minute) => '$matchId ${minute ?? 0} ${PushTopic.news.forLocale('es')}',\n    GoalsSummaryPush(:final count) => '$count',\n    WeeklyOfferPush() => PushChannel.promos.label,\n    null => null,\n  };\n}\n" +
  "PushService pushService(Api api) => PushService(api, onOpen: (m) => debugPrint(m.route), onForeground: (m, n) => debugPrint(n?.title));\n" +
  "bool linksCheck() => AppRoute.parse('acme://teams/7?tab=x') == const TeamRoute(teamId: 7, tab: 'x') && AppLinks.url(const NewMatchRoute()) == 'https://acme.app/matches/new';\n" +
  "bool monitoringCheck() {\n  final s = Monitoring.scrubReport({'user': {'id': 'u1', 'Email': 'a@b.c'}}) as Map;\n  return (s['user'] as Map)['Email'] == '[redacted]' && !Monitoring.shouldReport('Network request failed') && Monitoring.provider == 'crashlytics';\n}\n" +
  "bool flagsCheck() {\n  FeatureFlags.source = (k) => <String, Object?>{'new_checkout': 'true', 'home_layout': 'grid', 'max_upload_mb': '7.5', 'price_factor': 2}[k];\n  final ok = FeatureFlags.newCheckout && FeatureFlags.homeLayout == 'grid' && FeatureFlags.maxUploadMb == 20 && FeatureFlags.priceFactor == 2.0 && FeatureFlags.supportEmail.isNotEmpty;\n  FeatureFlags.overrides['new_checkout'] = false;\n  return ok && !FeatureFlags.newCheckout;\n}\n")
fs.cpSync(path.join(fl, 'app'), path.join(OUT, 'dart'), { recursive: true })

// ---------- SQL / Prisma (hockey schema, Supabase) ----------
const db = makeProject({ schema: 'hockey', extra: { backend: { provider: 'supabase' } } })
must(run('database.mjs', ['migration', 'init'], db), 'migration init')
const schema = path.join(db, '.dualcraft', 'db', 'schema.dbml')
write(schema, read(schema).replace('  logo varchar', '  logo varchar\n  city varchar [default: \'\']') + '\nTable comment {\n  id uuid [pk]\n  user_id uuid [not null]\n  body text [not null]\n  created_at timestamp [not null, default: `now()`]\n}\n')
must(run('database.mjs', ['migration', 'changes'], db), 'migration diff')
fs.cpSync(path.join(db, 'supabase', 'migrations'), path.join(OUT, 'sql', 'migrations'), { recursive: true })
write(path.join(db, '.dualcraft', 'flags', 'flags.json'), JSON.stringify({ ...JSON.parse(read(path.join(ROOT, 'test', 'fixtures', 'flags.json'))), provider: 'supabase' }))
must(run('flags.mjs', ['gen'], db), 'flags gen supabase')
copy(path.join(db, '.dualcraft', 'flags', 'supabase-feature-flags.sql'), path.join(OUT, 'sql', 'migrations', '99999999999999_feature_flags.sql'))
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
// 11 schema tables + feature_flags; the flags table is readable by everyone and seeded with every flag
const flagRows = await db.query("select key, value from public.feature_flags order by key")
if (t.rows[0].n !== 12 || p.rows[0].n < 5 || flagRows.rows.length !== 6 || flagRows.rows.find((r) => r.key === 'max_upload_mb')?.value !== 20) { console.error('unexpected result', t.rows[0], p.rows[0], flagRows.rows); process.exit(1) }
console.log('postgres OK: ' + t.rows[0].n + ' tables, ' + p.rows[0].n + ' policies')
`)
// ---------- Supabase Edge Functions (Deno) ----------
const sb = makeProject({ extra: { backend: { provider: 'supabase' } } })
backend(sb, 'supabase', [...COMMON, ['trigger0', '--kind', 'trigger', '--on', 'db:orders.insert']])
authSetup(sb)
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

// ---------- iOS privacy manifests (plutil -lint on macOS) ----------
function legalSetup(p) {
  must(run('legal.mjs', ['scan', '--write'], p), 'legal scan')
  const f = path.join(p, '.dualcraft', 'legal', 'data-map.json'); const m = JSON.parse(read(f))
  Object.assign(m.controller, { legalName: 'Acme Apps S.L.', taxId: 'B12345678', address: 'Calle Mayor 1, Madrid', email: 'privacy@acme.app' })
  Object.assign(m, { privacyPolicyUrl: 'https://acme.app/privacy', accountDeletionUrl: 'https://acme.app/delete', trackingDomains: ['example-tracker.com'] })
  for (const x of m.data) { x.retention = 'Hasta que elimines tu cuenta'; delete x.needsReview }
  write(f, JSON.stringify(m, null, 2))
  must(run('legal.mjs', ['gen'], p), 'legal gen')
}
legalSetup(fl)
copy(path.join(fl, 'app', 'ios', 'Runner', 'PrivacyInfo.xcprivacy'), path.join(OUT, 'swift', 'PrivacyInfo-flutter.xcprivacy'))
write(M('iosapp', 'Demo', 'Prefs.swift'), 'import Foundation\nlet seen = UserDefaults.standard.bool(forKey: "seen")\n')
legalSetup(multi)
copy(M('iosapp', 'Demo', 'PrivacyInfo.xcprivacy'), path.join(OUT, 'swift', 'PrivacyInfo-ios.xcprivacy'))

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
// store upload with fastlane: the release workflow uploads with supply / deliver (actionlint checks those steps)
write(path.join(fl, '.dualcraft', 'store', 'listing.json'), JSON.stringify({ es: { play: { title: 'Hockey', short: 'Tu liga', full: 'Sigue a tu equipo.' }, appstore: { name: 'Hockey', description: 'Sigue a tu equipo.', keywords: 'hockey,liga' } } }))
must(run('store.mjs', ['init', '--support-url', 'https://acme.app/help', '--privacy-url', 'https://acme.app/privacy'], fl), 'store init')
must(run('deploy.mjs', ['init'], fl), 'deploy init flutter')
if (!/fastlane supply/.test(read(path.join(fl, '.github', 'workflows', 'dualcraft-release-mobile.yml')))) { console.error('✗ release workflow without fastlane'); process.exit(1) }
fs.cpSync(path.join(fl, '.github', 'workflows'), path.join(OUT, 'workflows', 'flutter'), { recursive: true })
// Dependabot configs (validated against SchemaStore's dependabot-2.0 in CI): npm, gradle, swift, pub, deno, github-actions
write(M('kmp', 'settings.gradle.kts'), 'rootProject.name = "k"\n'); write(M('iosapp', 'Package.swift'), '// swift-tools-version:5.9\n')
must(run('deploy.mjs', ['gen'], multi), 'deploy gen multi (dependabot)')
write(path.join(sb, 'supabase', 'functions', 'deno.json'), '{}'); must(run('deploy.mjs', ['gen'], sb), 'deploy gen supabase (dependabot)')
for (const [name, p] of [['multi', multi], ['supabase', sb], ['flutter', fl]]) copy(path.join(p, '.github', 'dependabot.yml'), path.join(OUT, 'dependabot', name + '.yml'))
for (const [name, eco] of [['multi', 'swift'], ['supabase', 'deno'], ['flutter', 'pub']]) if (!read(path.join(OUT, 'dependabot', name + '.yml')).includes('package-ecosystem: ' + eco)) { console.error(`✗ dependabot ${name} without ${eco}`); process.exit(1) }

// ---------- auth implementations (AuthService) against the real SDKs ----------
const AC = JSON.parse(read(path.join(fl, '.dualcraft', 'auth', 'auth.json'))) // every method, MFA, guest, linking
write(path.join(OUT, 'dart', 'lib', 'services', 'auth_service_supabase.dart'), flutterSupabase(AC)) // the Firebase one comes from the Flutter project
copy(M('web', 'src', 'lib', 'api-client.ts'), path.join(OUT, 'auth-ts', 'src', 'api-client.ts'))
copy(M('web', 'src', 'lib', 'auth-catalog.ts'), path.join(OUT, 'auth-ts', 'src', 'auth-catalog.ts'))
copy(M('web', 'src', 'lib', 'auth-service.ts'), path.join(OUT, 'auth-ts', 'src', 'auth-firebase.ts'))
copy(M('rn', 'src', 'lib', 'auth-service.ts'), path.join(OUT, 'auth-ts', 'src', 'auth-rn-firebase.ts'))
write(path.join(OUT, 'auth-ts', 'src', 'auth-firebase-full.ts'), tsFirebase(AC).replace('class FirebaseAuthService implements AuthService', 'class FullFirebase'))
write(path.join(OUT, 'auth-ts', 'src', 'auth-supabase.ts'), tsSupabase(AC).replace('class SupabaseAuthService implements AuthService', 'class WebSupabase'))
write(path.join(OUT, 'auth-ts', 'src', 'auth-supabase-native.ts'), tsSupabase(AC, { native: true }).replace('class SupabaseAuthService implements AuthService', 'class NativeSupabase'))
write(path.join(OUT, 'auth-ts', 'src', 'screens-next.tsx'), reactWebScreens(AC, { catalog: './auth-catalog', i18n: 'next-intl', next: true }))
write(path.join(OUT, 'auth-ts', 'src', 'screens-web.tsx'), reactWebScreens(AC, { catalog: './auth-catalog', i18n: 'react-i18next' }))
write(path.join(OUT, 'auth-ts', 'src', 'screens-rn.tsx'), read(M('rn', 'src', 'screens', 'auth', 'AuthScreens.tsx')).replace("from '../../lib/auth-catalog'", "from './auth-catalog'"))
write(path.join(OUT, 'auth-ts', 'package.json'), JSON.stringify({ name: 'auth-ts-check', private: true, dependencies: { react: '18.3.1', 'react-dom': '18.3.1', next: '15.1.3', 'next-intl': '3.26.3', i18next: '24.2.0', 'react-i18next': '15.4.0', typescript: '5.6.3', firebase: '11.10.0', '@supabase/supabase-js': '2.119.2', '@simplewebauthn/browser': '13.3.0', 'react-native-passkey': '3.6.2', '@react-native-google-signin/google-signin': '13.2.0', 'expo-apple-authentication': '7.1.3', 'expo-crypto': '14.0.2', 'react-native': '0.76.5', '@types/react': '18.3.12', '@react-native-firebase/app': '22.4.0', '@react-native-firebase/auth': '22.4.0' } }, null, 2))
// Kotlin: supabase-kt on the JVM (Android/KMP code), Firebase on an Android library module (AGP + Android SDK)
const KS = (...p) => path.join(OUT, 'auth-kotlin', 'src', 'main', 'kotlin', 'com', 'test', 'app', ...p)
copy(K('api', 'ApiClient.kt'), KS('api', 'ApiClient.kt'))
copy(K('auth', 'AuthCatalog.kt'), KS('auth', 'AuthCatalog.kt'))
write(KS('auth', 'SupabaseAuthService.kt'), kotlinSupabase(AC, { pkg: 'com.test.app.auth', apiPkg: 'com.test.app.api' }))
write(path.join(OUT, 'auth-kotlin', 'settings.gradle.kts'), 'pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\ndependencyResolutionManagement { repositories { mavenCentral(); google() } }\nrootProject.name = "auth-kotlin"\n')
write(path.join(OUT, 'auth-kotlin', 'build.gradle.kts'), 'plugins {\n    kotlin("jvm") version "2.1.21"\n    kotlin("plugin.serialization") version "2.1.21"\n}\ndependencies {\n    implementation(platform("io.github.jan-tennert.supabase:bom:3.2.6"))\n    implementation("io.github.jan-tennert.supabase:auth-kt")\n    implementation("io.ktor:ktor-client-cio:3.2.3")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")\n}\n')
const DR = (...p) => M('droid', 'app', 'src', 'main', 'java', 'com', 'test', 'droid', 'data', ...p)
for (const [from, to] of [[DR('api', 'ApiClient.kt'), 'api/ApiClient.kt'], [DR('auth', 'AuthCatalog.kt'), 'auth/AuthCatalog.kt'], [DR('auth', 'FirebaseAuthService.kt'), 'auth/FirebaseAuthService.kt']]) copy(from, path.join(OUT, 'auth-android', 'src', 'main', 'java', 'com', 'test', 'droid', 'data', to))
// Compose screens + the generated string resources they use
copy(M('droid', 'app', 'src', 'main', 'java', 'com', 'test', 'droid', 'ui', 'auth', 'AuthScreens.kt'), path.join(OUT, 'auth-android', 'src', 'main', 'java', 'com', 'test', 'droid', 'ui', 'auth', 'AuthScreens.kt'))
for (const v of fs.readdirSync(M('droid', 'app', 'src', 'main', 'res'))) copy(M('droid', 'app', 'src', 'main', 'res', v, 'ds_strings.xml'), path.join(OUT, 'auth-android', 'src', 'main', 'res', v, 'ds_strings.xml'))
write(path.join(OUT, 'auth-android', 'settings.gradle.kts'), 'pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\ndependencyResolutionManagement { repositories { mavenCentral(); google() } }\nrootProject.name = "auth-android"\n')
write(path.join(OUT, 'auth-android', 'gradle.properties'), 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2g\n')
write(path.join(OUT, 'auth-android', 'build.gradle.kts'), 'plugins {\n    id("com.android.library") version "8.7.3"\n    id("org.jetbrains.kotlin.android") version "2.1.21"\n    id("org.jetbrains.kotlin.plugin.serialization") version "2.1.21"\n    id("org.jetbrains.kotlin.plugin.compose") version "2.1.21"\n}\nandroid {\n    namespace = "com.test.droid"\n    compileSdk = 35\n    defaultConfig { minSdk = 24 }\n    buildFeatures { compose = true }\n    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }\n}\nkotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }\ndependencies {\n    implementation(platform("com.google.firebase:firebase-bom:33.16.0"))\n    implementation("com.google.firebase:firebase-auth")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")\n    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")\n    implementation("androidx.credentials:credentials:1.5.0")\n    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")\n    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")\n    implementation(platform("androidx.compose:compose-bom:2024.12.01"))\n    implementation("androidx.compose.material3:material3")\n    implementation("androidx.compose.ui:ui")\n    implementation("androidx.compose.foundation:foundation")\n}\n')
// Swift: a SwiftPM package (two targets: Firebase and Supabase) built for the iOS simulator in CI
for (const t of ['AuthFirebase', 'AuthSupabase']) for (const f of ['Core/Api/ApiClient.swift', 'Core/Auth/AuthCatalog.swift']) copy(M('iosapp', 'Demo', ...f.split('/')), path.join(OUT, 'auth-swift', 'Sources', t, path.basename(f)))
copy(M('iosapp', 'Demo', 'Core', 'Auth', 'FirebaseAuthService.swift'), path.join(OUT, 'auth-swift', 'Sources', 'AuthFirebase', 'FirebaseAuthService.swift'))
copy(M('iosapp', 'Demo', 'Features', 'Auth', 'AuthScreens.swift'), path.join(OUT, 'auth-swift', 'Sources', 'AuthFirebase', 'AuthScreens.swift'))
write(path.join(OUT, 'auth-swift', 'Sources', 'AuthSupabase', 'SupabaseAuthService.swift'), swiftSupabase(AC))
write(path.join(OUT, 'auth-swift', 'Package.swift'), `// swift-tools-version:5.9
import PackageDescription
let package = Package(
    name: "AuthSwift",
    platforms: [.iOS(.v17)],
    products: [.library(name: "AuthSwift", targets: ["AuthFirebase", "AuthSupabase"])],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "11.0.0"),
        .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "8.0.0"),
        .package(url: "https://github.com/supabase/supabase-swift", from: "2.48.0"),
    ],
    targets: [
        .target(name: "AuthFirebase", dependencies: [.product(name: "FirebaseAuth", package: "firebase-ios-sdk"), .product(name: "FirebaseCore", package: "firebase-ios-sdk"), .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS")]),
        .target(name: "AuthSupabase", dependencies: [.product(name: "Supabase", package: "supabase-swift"), .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS")]),
    ]
)
`)
write(path.join(OUT, 'auth-ts', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', lib: ['es2022', 'dom'], module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, jsx: 'react-jsx' }, include: ['src/*.ts', 'src/*.tsx'] }, null, 2))
// Vue (Nuxt) auth screens: vue-tsc with real vue + vue-i18n types
for (const [n, gen] of [['AuthFlow.vue', vueAuthFlow], ['AccountScreen.vue', vueAccount]]) write(path.join(OUT, 'auth-vue', 'src', n), gen(AC, { catalog: './auth-catalog' }))
write(path.join(OUT, 'auth-vue', 'src', 'auth-redirect.ts'), vueRedirect(AC, { catalog: './auth-catalog' }))
copy(M('web', 'src', 'lib', 'auth-catalog.ts'), path.join(OUT, 'auth-vue', 'src', 'auth-catalog.ts'))
write(path.join(OUT, 'auth-vue', 'package.json'), JSON.stringify({ name: 'auth-vue-check', private: true, dependencies: { typescript: '5.6.3', vue: '3.5.13', 'vue-i18n': '10.0.5', 'vue-tsc': '2.2.0' } }, null, 2))
write(path.join(OUT, 'auth-vue', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', lib: ['es2022', 'dom'], module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, jsx: 'preserve' }, include: ['src/*.ts', 'src/*.vue'] }, null, 2))

// ---------- port idioms (references/port): every language and UI framework compiles ----------
const PR = path.join(ROOT, 'references', 'port')
fs.cpSync(path.join(PR, 'lang', 'dart'), path.join(OUT, 'dart', 'lib', 'port', 'lang'), { recursive: true })
fs.cpSync(path.join(PR, 'ui', 'flutter'), path.join(OUT, 'dart', 'lib', 'port', 'ui'), { recursive: true })
fs.cpSync(path.join(PR, 'lang', 'kotlin'), path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'idioms', 'lang'), { recursive: true })
fs.cpSync(path.join(PR, 'ui', 'compose'), path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'idioms', 'ui'), { recursive: true })
fs.cpSync(path.join(PR, 'lang', 'swift'), path.join(OUT, 'swift', 'port-lang'), { recursive: true })
fs.cpSync(path.join(PR, 'ui', 'swiftui'), path.join(OUT, 'swift', 'port-ui'), { recursive: true })
fs.cpSync(path.join(PR, 'lang', 'ts'), path.join(OUT, 'ts', 'port'), { recursive: true })
fs.cpSync(path.join(PR, 'ui', 'react-native'), path.join(OUT, 'ui-rn', 'src'), { recursive: true })
write(path.join(OUT, 'ui-rn', 'package.json'), JSON.stringify({ name: 'ui-rn-check', private: true, dependencies: { typescript: '5.6.3', react: '18.3.1', '@types/react': '18.3.12', 'react-native': '0.76.5', '@react-navigation/native': '7.0.14', '@react-navigation/native-stack': '7.2.0', '@react-navigation/bottom-tabs': '7.2.0', zustand: '5.0.2', '@tanstack/react-query': '5.62.8' } }, null, 2))
write(path.join(OUT, 'ui-rn', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, jsx: 'react-jsx', target: 'es2022', lib: ['es2022'], module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, types: ['react-native'] }, include: ['src/*.tsx'] }, null, 2))

// E2E: flows derived from auth.json + the routes of a Next.js app → Playwright specs, RUN against a fixture site
// that renders the auth screens' texts (out/e2e-web), and Maestro flows checked with `maestro check-syntax` (out/e2e-maestro)
const ew = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
write(path.join(ew, 'site', 'package.json'), JSON.stringify({ name: 'site', private: true, scripts: { build: 'node -e 0', start: 'node server.mjs' } }))
write(path.join(ew, 'site', 'src', 'app', 'page.tsx'), 'export default function Home() { return null }\n')
write(path.join(ew, 'site', 'src', 'app', 'login', 'page.tsx'), 'export default function Login() { return null }\n')
write(path.join(ew, 'app', 'pubspec.yaml'), 'name: e2e_app\n')
write(path.join(ew, 'app', 'android', 'app', 'build.gradle.kts'), 'android { defaultConfig { applicationId = "com.test.e2e" } }\n')
must(run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], ew), 'e2e backend init')
must(run('auth.mjs', ['init', '--methods', 'email', '--mfa', 'none'], ew), 'e2e auth init')
write(path.join(ew, 'app', 'lib', 'router.dart'), "final r = GoRouter(routes: [GoRoute(path: '/matches', builder: (c, s) => const MatchesScreen())]);\nclass MatchesScreen extends StatelessWidget {}\n")
write(path.join(ew, '.dualcraft', 'payments', 'products.json'), read(path.join(ROOT, 'test', 'fixtures', 'products.json')))
write(path.join(ew, '.dualcraft', 'store', 'screenshots.json'), JSON.stringify({ package: 'com.test.e2e', screens: [{ name: 'login', web: 'http://localhost:3000/login', android: 'e2eapp://login', ios: 'e2eapp://login', caption: { es: 'Entra' } }] }))
must(run('e2e.mjs', ['init', '--scheme', 'e2eapp'], ew), 'e2e init')
must(run('e2e.mjs', ['check'], ew), 'e2e check')
fs.cpSync(path.join(ew, 'site', 'e2e'), path.join(OUT, 'e2e-web', 'e2e'), { recursive: true })
copy(path.join(ew, 'site', 'playwright.config.ts'), path.join(OUT, 'e2e-web', 'playwright.config.ts'))
copy(path.join(ROOT, 'test', 'fixtures', 'e2e-site', 'server.mjs'), path.join(OUT, 'e2e-web', 'server.mjs'))
write(path.join(OUT, 'e2e-web', 'package.json'), JSON.stringify({ name: 'e2e-web-check', private: true, type: 'module', scripts: { build: 'node -e 0', start: 'node server.mjs' }, devDependencies: { '@playwright/test': '1.65.1', '@axe-core/playwright': '4.14.1', '@types/node': '22.10.2', typescript: '5.6.3' } }, null, 2))
write(path.join(OUT, 'e2e-web', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true }, include: ['e2e/**/*.ts', 'playwright.config.ts'] }, null, 2))
fs.cpSync(path.join(ew, 'app', '.maestro'), path.join(OUT, 'e2e-maestro'), { recursive: true })
// Performance runner: real Lighthouse on the fixture site + bundle of a fake build (out/perf, CI e2e job)
must(run('perf.mjs', ['init', '--routes', '/login'], ew), 'perf init')
fs.cpSync(path.join(ew, '.dualcraft', 'perf'), path.join(OUT, 'perf', '.dualcraft', 'perf'), { recursive: true })
copy(path.join(ROOT, 'test', 'fixtures', 'e2e-site', 'server.mjs'), path.join(OUT, 'perf', 'server.mjs'))
write(path.join(OUT, 'perf', 'site', '.next', 'static', 'chunks', 'main.js'), 'console.log(' + JSON.stringify('x'.repeat(4000)) + ')\n')
// Marketing videos: the generated Remotion project, type-checked and one composition rendered in CI (out/video)
const vp = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
const VD = (...x) => path.join(vp, '.dualcraft', ...x)
write(VD('store', 'screenshots.json'), JSON.stringify({ screens: [{ name: 'home', android: 'liga://home', caption: { es: 'Sigue a tu equipo en directo', en: 'Follow your team live' } }, { name: 'stats', web: 'http://localhost:3000/stats', caption: { es: 'Estadísticas de cada partido', en: 'Stats for every match' } }] }))
for (const l of ['es', 'en']) { write(VD('store', 'screenshots', 'raw', l, 'android', 'home.png'), ''); fs.writeFileSync(VD('store', 'screenshots', 'raw', l, 'android', 'home.png'), png(90, 195, [40, 90, 200])); write(VD('store', 'screenshots', 'raw', l, 'web', 'stats.png'), ''); fs.writeFileSync(VD('store', 'screenshots', 'raw', l, 'web', 'stats.png'), png(240, 150, [200, 80, 60])) }
write(VD('store', 'listing.json'), JSON.stringify({ es: { appstore: { name: 'Liga', subtitle: 'Tu liga en el bolsillo' } }, en: { appstore: { name: 'Liga', subtitle: 'Your league in your pocket' } } }))
write(VD('release', '1.3.0.json'), JSON.stringify({ es: { play: '• Favoritos\n• Modo oscuro' }, en: { play: '• Favourites\n• Dark mode' } }))
must(run('video.mjs', ['init'], vp), 'video init')
must(run('video.mjs', ['check'], vp), 'video check')
fs.cpSync(path.join(vp, 'marketing', 'video'), path.join(OUT, 'video'), { recursive: true })

console.log(`compile fixtures → ${OUT}`)
for (const d of fs.readdirSync(OUT)) console.log(`  ${d}: ${fs.readdirSync(path.join(OUT, d)).length} entries`)
