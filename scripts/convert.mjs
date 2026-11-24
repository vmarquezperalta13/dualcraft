#!/usr/bin/env node
// DualCraft converter helper (web ⇄ mobile). The conversion itself is done by the agent following
// skills/convert; this script inventories the source, tracks progress and validates the neutral spec.
//   inventory --from web|mobile          screens, features, data/i18n/analytics usage, backend touchpoints
//   init --from web|mobile [--target dir] [--force]   create .dualcraft/convert/status.json from the inventory
//   status                               progress per feature + backend decisions
//   set <feature> <state> [--task T-001] state: pending|spec|adapted|generated|verified|done|skipped
//   backend <id> <decision> [--why "…"]  decision: shared|expose-api|move-to-functions|duplicate|alternative|skip|pending
//   spec-check                           validate .dualcraft/convert/spec against schema, i18n, analytics, status
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { parseDbml } from './lib/dbml.mjs'
import { projectStacks } from './lib/targets.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const CMDS = ['inventory', 'init', 'status', 'set', 'backend', 'spec-check']
if (cmd === 'help' || !CMDS.includes(cmd)) { console.log('node convert.mjs inventory --from <stack|web|mobile> [--to <stack>] | init --from <stack|web|mobile> --to <stack> [--target dir] [--force] | status | set <feature> <state> | backend <id> <decision> [--why …] | spec-check'); console.log('  stacks: nextjs react-vite astro nuxt flutter react-native kmp android ios'); process.exit(cmd === 'help' ? 0 : 1) }

const { root, dir, config } = project()
const cdir = path.join(dir, 'convert')
const statusFile = path.join(cdir, 'status.json')
const invFile = path.join(cdir, 'inventory.json')
const STATES = ['pending', 'spec', 'adapted', 'generated', 'verified', 'done', 'skipped']
const DECISIONS = ['pending', 'shared', 'expose-api', 'move-to-functions', 'duplicate', 'alternative', 'skip']
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const rel = (f) => posix(path.relative(root, f))
const stackDir = (k) => path.join(root, config.paths?.[k] || '')
function walk(d, test, out = []) {
  if (!fs.existsSync(d)) return out
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|\.|build|generated|l10n|\.dart_tool)/.test(e.name)) walk(p, test, out) } else if (test(p)) out.push(p)
  }
  return out
}
const uniq = (a) => [...new Set(a)]

// shared sources (for usage detection and spec-check)
const schemaFile = path.join(dir, 'db', 'schema.dbml')
const entities = fs.existsSync(schemaFile) ? parseDbml(read(schemaFile)).tables.map((t) => t.name) : []
const planFile = path.join(dir, 'analytics', 'events.json')
const plan = fs.existsSync(planFile) ? JSON.parse(read(planFile)) : { events: [] }
const camel = (s) => s.split('_').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
const eventByCamel = Object.fromEntries((plan.events || []).map((e) => [camel(e.name), e.name]))
const LANG_OF = { nextjs: 'js', 'react-vite': 'js', astro: 'js', nuxt: 'js', 'react-native': 'js', flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }
const usage = (s, lang) => ({
  entities: entities.filter((n) => new RegExp(`\\b${n}\\b`).test(s)),
  i18n: uniq([...s.matchAll(
    lang === 'js' ? /(?:\$t|\bt|i18n\.t)\(\s*['"]([\w.]+)['"]/g
      : lang === 'dart' ? /(?:AppLocalizations\.of\([^)]*\)!?|\bl10n|\bloc)\.(\w+)/g
        : lang === 'kotlin' ? /(?:R|Res)\.(?:string|plurals)\.(\w+)/g
          : /(?:String\(localized:\s*|NSLocalizedString\(\s*)"([\w.]+)"/g)].map((m) => m[1])),
  events: uniq([...s.matchAll(/[Aa]nalyticsEvents\.(\w+)\(/g)].map((m) => eventByCamel[m[1]] || m[1])),
})
const screenId = (route, fallback) => (route === '/' ? 'home' : route ? route.replace(/^\//, '').replace(/[/:*]+/g, '-').replace(/-+$/, '') : fallback)
const kebab = (s) => s.replace(/(Screen|Page|View)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const BK = new Map() // backend/platform touchpoints of the current inventory, by id
const addB = (b) => { if (!BK.has(b.id)) BK.set(b.id, b) }

// shared detection of data clients in any language
function dataTouchpoints(s, lang, toKind) {
  const ids = []
  const firestore = lang === 'js' ? /(?:collection|doc)\(\s*\w+\s*,\s*['"]([\w-]+)['"]/g : /collection\(\s*['"]([\w-]+)['"]/g
  for (const m of s.matchAll(firestore)) { const id = `firestore:${m[1]}`; ids.push(id); addB({ id, kind: 'firestore', options: ['shared', 'expose-api'], recommended: 'shared', note: `Both apps use the same collection with their Firebase SDK; rules must cover the ${toKind} client too` }) }
  for (const m of s.matchAll(/\.from\(\s*['"]([\w-]+)['"]\s*\)/g)) { const id = `supabase:${m[1]}`; ids.push(id); addB({ id, kind: 'supabase-table', options: ['shared', 'expose-api'], recommended: 'shared', note: 'Same table through the Supabase SDK with the anon key; RLS must cover the new client' }) }
  for (const m of s.matchAll(/httpsCallable\(\s*(?:\w+\s*,\s*)?['"]([\w-]+)['"]/g)) { const id = `function:${m[1]}`; ids.push(id); addB({ id, kind: 'cloud-function', options: ['shared'], recommended: 'shared', note: 'Callable from every Firebase SDK; check App Check/CORS for the new client' }) }
  for (const m of s.matchAll(/(?:fetch|axios\.\w+|\$fetch|useFetch|client\.(?:get|post|put|delete)|URL\(string:)\s*\(?\s*[`'"](https?:\/\/[^/`'"]+)/g)) { const id = `external:${m[1].replace(/^https?:\/\//, '')}`; ids.push(id); addB({ id, kind: 'external-api', options: ['shared', 'expose-api', 'skip'], recommended: 'shared', note: 'Third-party API: check the new client can call it (CORS on web, keys must not ship in client code)' }) }
  return ids
}

// native capabilities with no direct equivalent on the other kind of platform
const CAPABILITIES = {
  toWeb: [
    [/in_app_purchase|purchases_flutter|react-native-iap|react-native-purchases|expo-in-app-purchases|billingclient|com\.android\.billingclient|\bimport StoreKit/, 'payments-iap', 'web checkout (Stripe) for goods allowed outside the stores, or keep purchases app-only'],
    [/firebase_messaging|expo-notifications|@react-native-firebase\/messaging|firebase-messaging|\bimport UserNotifications/, 'push', 'Web Push (FCM for web + service worker), or email'],
    [/mobile_scanner|expo-camera|expo-barcode-scanner|camerax|barcode-scanning|\bimport (AVFoundation|VisionKit)/, 'camera-scanner', 'getUserMedia + a web QR/barcode library, or skip on desktop'],
    [/image_picker|expo-image-picker|PhotosUI/, 'image-picker', '<input type="file" accept="image/*" capture>'],
    [/geolocator|expo-location|play-services-location|\bimport CoreLocation/, 'location', 'Geolocation API (permission prompt in context)'],
    [/local_auth|expo-local-authentication|androidx\.biometric|\bimport LocalAuthentication/, 'biometrics', 'WebAuthn / passkeys, or skip'],
    [/google_mobile_ads|react-native-google-mobile-ads|play-services-ads|GoogleMobileAds/, 'ads', 'AdSense / web ad network, or skip'],
    [/in_app_review|expo-store-review|play-review|SKStoreReviewController|requestReview/, 'store-review', 'skip (web has no store review prompt)'],
    [/flutter_secure_storage|expo-secure-store|security-crypto|EncryptedSharedPreferences|Keychain/, 'secure-storage', 'httpOnly cookies / server session (never localStorage for tokens)'],
    [/health|HealthKit|sensors_plus|expo-sensors/, 'device-sensors', 'skip (no web equivalent)'],
    [/firebase_crashlytics|firebase-crashlytics|@react-native-firebase\/crashlytics|FirebaseCrashlytics|sentry/i, 'crash-reporting', 'web error tracking (e.g. Sentry for the browser)'],
  ],
  toMobile: [
    [/from\s+['"]stripe['"]|@stripe\/|stripe\.com/, 'payments-web', 'digital goods inside a store app must use in-app purchases; physical goods/services may keep Stripe (decide with the user)'],
    [/navigator\.serviceWorker|web-push|PushManager/, 'web-push', 'native push (FCM / APNs) with a permission prompt in context'],
    [/navigator\.geolocation/, 'geolocation-web', 'native location API with permission rationale'],
    [/getUserMedia|BarcodeDetector/, 'camera-web', 'native camera / scanner'],
    [/document\.cookie|cookies\(\)/, 'cookies-session', 'mobile apps use SDK session persistence + secure storage, not cookies'],
  ],
}
function capabilityTouchpoints(text, fromKind) {
  const list = fromKind === 'mobile' ? CAPABILITIES.toWeb : CAPABILITIES.toMobile
  const ids = []
  for (const [re, key, alt] of list) if (re.test(text)) { const id = `capability:${key}`; ids.push(id); addB({ id, kind: 'platform-capability', options: ['alternative', 'skip'], recommended: /^skip/.test(alt) ? 'skip' : 'alternative', note: alt }) }
  return ids
}
const analyticsShared = (text) => { if (/firebase_analytics|@react-native-firebase\/analytics|firebase-analytics|FirebaseAnalytics|gtag\(|posthog/.test(text)) addB({ id: 'service:analytics', kind: 'analytics', options: ['shared', 'skip'], recommended: 'shared', note: 'Same tracking plan (dualcraft:analytics) on both platforms' }) }

// ---------- web sources ----------
const fileRoute = (relPath, { dynamic = /^\[(\w+)\]$/, catchAll = /^\[\.\.\.(\w+)\]$/ } = {}) => '/' + relPath.split(/[\\/]/).filter((seg) => !/^\(.*\)$/.test(seg) && !seg.startsWith('@')).map((seg) => seg.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, '*$1').replace(dynamic, ':$1').replace(catchAll, '*$1')).join('/')
function inventoryNext(dir) {
  const appDir = ['src/app', 'app'].map((d) => path.join(dir, d)).find((d) => fs.existsSync(d))
  const pagesDir = ['src/pages', 'pages'].map((d) => path.join(dir, d)).find((d) => fs.existsSync(d))
  const screens = []
  if (appDir) {
    for (const f of walk(appDir, (p) => /[\\/]page\.(tsx|jsx|ts|js)$/.test(p))) {
      const segs = path.relative(appDir, path.dirname(f))
      const route = fileRoute(segs).replace(/\/$/, '') || '/'
      const s = read(f)
      screens.push({ id: screenId(route), route, feature: segs.split(path.sep).filter((x) => x && !/^[([@]/.test(x))[0] || 'home', file: rel(f), client: /^\s*['"]use client['"]/m.test(s), ...usage(s, 'js'), calls: uniq([...s.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"?]+)/g)].map((m) => m[1])), backend: [...dataTouchpoints(s, 'js', 'mobile'), ...capabilityTouchpoints(s, 'web')] })
    }
    for (const f of walk(appDir, (p) => /[\\/]route\.(ts|js)$/.test(p))) {
      const route = fileRoute(path.relative(appDir, path.dirname(f))); const s = read(f)
      const admin = /firebase-admin|service_role|SERVICE_ROLE/.test(s)
      addB({ id: `api:${route}`, kind: 'route-handler', file: rel(f), methods: uniq([...s.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1])), options: ['expose-api', 'move-to-functions', 'skip'], recommended: admin ? 'move-to-functions' : 'expose-api' })
    }
  }
  if (pagesDir) for (const f of walk(pagesDir, (p) => /\.(tsx|jsx|ts|js)$/.test(p) && !/[\\/]_(app|document|error)\./.test(p))) {
    const r = '/' + path.relative(pagesDir, f).replace(/\\/g, '/').replace(/\.(tsx|jsx|ts|js)$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, ':$1')
    if (r.startsWith('/api')) { addB({ id: `api:${r}`, kind: 'api-route', file: rel(f), options: ['expose-api', 'move-to-functions', 'skip'], recommended: 'expose-api' }); continue }
    const s = read(f); screens.push({ id: screenId(r || '/'), route: r || '/', feature: r.split('/')[1] || 'home', file: rel(f), ...usage(s, 'js'), calls: [], backend: dataTouchpoints(s, 'js', 'mobile') })
  }
  for (const f of walk(dir, (p) => /\.(ts|tsx|js)$/.test(p))) {
    const s = read(f)
    if (/^\s*['"]use server['"]/m.test(s)) addB({ id: `action:${rel(f)}`, kind: 'server-action', file: rel(f), functions: uniq([...s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1])), options: ['move-to-functions', 'expose-api', 'duplicate', 'skip'], recommended: /firebase-admin|process\.env\.(?!NEXT_PUBLIC_)/.test(s) ? 'move-to-functions' : 'duplicate' })
  }
  for (const sc of screens) sc.backend.push(...[...BK.keys()].filter((id) => sc.calls?.some((c) => id === `api:${c}` || id.startsWith(`api:${c}`))))
  return screens
}
function inventoryReactVite(dir) {
  const files = walk(path.join(dir, 'src'), (p) => /\.(tsx|jsx)$/.test(p))
  const routes = {}
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/path:\s*['"]([^'"]+)['"][^}]*?(?:element:\s*<(\w+)|Component:\s*(\w+)|lazy:)/g)) if (m[2] || m[3]) routes[m[2] || m[3]] = m[1]
    for (const m of s.matchAll(/<Route[^>]*path=["']([^"']+)["'][^>]*element=\{\s*<(\w+)/g)) routes[m[2]] = m[1]
  }
  const screens = []
  for (const f of files) {
    const s = read(f); const base = path.basename(f).replace(/\.(tsx|jsx)$/, '')
    const comps = uniq([...s.matchAll(/(?:export\s+default\s+)?function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=\s*\(/g)].map((m) => m[1] || m[2]))
    const routed = comps.filter((c) => routes[c] !== undefined)
    const isPage = /[\\/](pages|routes|screens)[\\/]/.test(f) || routed.length
    if (!isPage) continue
    const name = routed[0] || comps.find((c) => c === base) || base
    const route = routes[name] ?? null
    const parts = path.relative(path.join(dir, 'src'), f).split(path.sep)
    screens.push({ id: route ? screenId(route.startsWith('/') ? route : '/' + route) : kebab(name), route, feature: parts[0] === 'features' && parts[1] ? parts[1] : (route || '').split('/').filter(Boolean)[0] || 'home', file: rel(f), ...usage(s, 'js'), backend: [...dataTouchpoints(s, 'js', 'mobile'), ...capabilityTouchpoints(s, 'web')] })
  }
  return screens
}
function inventoryAstro(dir) {
  const pages = path.join(dir, 'src', 'pages'); const screens = []
  for (const f of walk(pages, (p) => /\.(astro|md|mdx|ts|js)$/.test(p))) {
    const relp = path.relative(pages, f).replace(/\.(astro|md|mdx|ts|js)$/, '').replace(/(^|[\\/])index$/, '')
    const route = (fileRoute(relp).replace(/\/$/, '') || '/')
    if (route.startsWith('/api') || /\.(ts|js)$/.test(f)) { const s = read(f); addB({ id: `endpoint:${route}`, kind: 'astro-endpoint', file: rel(f), options: ['expose-api', 'move-to-functions', 'skip'], recommended: /service_role|firebase-admin|import\.meta\.env\.(?!PUBLIC_)/.test(s) ? 'move-to-functions' : 'expose-api' }); continue }
    const s = read(f)
    screens.push({ id: screenId(route), route, feature: route.split('/')[1] || 'home', file: rel(f), content: /\.(md|mdx)$/.test(f), ...usage(s, 'js'), backend: [...dataTouchpoints(s, 'js', 'mobile'), ...capabilityTouchpoints(s, 'web')] })
  }
  return screens
}
function inventoryNuxt(dir) {
  const base = fs.existsSync(path.join(dir, 'app', 'pages')) ? path.join(dir, 'app') : dir
  const pages = path.join(base, 'pages'); const screens = []
  for (const f of walk(pages, (p) => p.endsWith('.vue'))) {
    const relp = path.relative(pages, f).replace(/\.vue$/, '').replace(/(^|[\\/])index$/, '')
    const route = fileRoute(relp).replace(/\/$/, '') || '/'
    const s = read(f)
    screens.push({ id: screenId(route), route, feature: route.split('/')[1] || 'home', file: rel(f), ...usage(s, 'js'), backend: [...dataTouchpoints(s, 'js', 'mobile'), ...capabilityTouchpoints(s, 'web'), ...uniq([...s.matchAll(/(?:useFetch|\$fetch)\(\s*[`'"](\/api\/[^`'"?]+)/g)].map((m) => `api:${m[1]}`))] })
  }
  for (const f of walk(path.join(dir, 'server', 'api'), (p) => /\.(ts|js)$/.test(p))) {
    const route = '/api/' + path.relative(path.join(dir, 'server', 'api'), f).replace(/\\/g, '/').replace(/\.(get|post|put|patch|delete)?\.?(ts|js)$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, ':$1')
    const s = read(f)
    addB({ id: `api:${route.replace(/\/$/, '')}`, kind: 'nitro-handler', file: rel(f), options: ['expose-api', 'move-to-functions', 'skip'], recommended: /firebase-admin|service_role|useRuntimeConfig\(\)\.(?!public)/.test(s) ? 'move-to-functions' : 'expose-api' })
  }
  return screens
}

// ---------- mobile sources ----------
function inventoryFlutter(dir) {
  const lib = path.join(dir, 'lib')
  const files = walk(lib, (p) => p.endsWith('.dart') && !/\.(g|freezed|gr)\.dart$/.test(p))
  const routes = {}
  for (const f of files) for (const m of read(f).matchAll(/GoRoute\(\s*(?:name:\s*['"][^'"]*['"],\s*)?path:\s*['"]([^'"]+)['"][\s\S]{0,300}?(?:=>|return)\s*(?:const\s+)?(\w+)\(/g)) routes[m[2]] = m[1]
  const screens = []
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/class\s+(\w+(?:Screen|Page|View))\s+extends\s+(StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget)/g)) {
      const relLib = path.relative(lib, f).split(path.sep)
      screens.push({ id: kebab(m[1]), widget: m[1], route: routes[m[1]] || null, feature: relLib[0] === 'features' && relLib[1] ? relLib[1] : relLib.length > 1 ? relLib[relLib.length - 2] : 'app', file: rel(f), ...usage(s, 'dart'), backend: [...dataTouchpoints(s, 'dart', 'web'), ...capabilityTouchpoints(s, 'mobile')] })
    }
  }
  const pub = read(path.join(dir, 'pubspec.yaml')); capabilityTouchpoints(pub, 'mobile'); analyticsShared(pub)
  return screens
}
function inventoryReactNative(dir) {
  const appDir = path.join(dir, 'app'); const screens = []
  const pkg = read(path.join(dir, 'package.json')); capabilityTouchpoints(pkg, 'mobile'); analyticsShared(pkg)
  if (fs.existsSync(appDir)) {
    for (const f of walk(appDir, (p) => /\.(tsx|jsx)$/.test(p) && !/[\\/](_layout|\+not-found|\+html)\.(tsx|jsx)$/.test(p))) {
      const relp = path.relative(appDir, f).replace(/\.(tsx|jsx)$/, '').replace(/(^|[\\/])index$/, '')
      const route = fileRoute(relp).replace(/\/$/, '') || '/'
      const s = read(f)
      screens.push({ id: screenId(route), route, feature: route.split('/')[1] || 'home', file: rel(f), ...usage(s, 'js'), backend: [...dataTouchpoints(s, 'js', 'web'), ...capabilityTouchpoints(s, 'mobile')] })
    }
  } else {
    for (const f of walk(path.join(dir, 'src'), (p) => /\.(tsx|jsx)$/.test(p))) {
      const s = read(f)
      for (const m of s.matchAll(/(?:function|const)\s+(\w+Screen)\b/g)) screens.push({ id: kebab(m[1]), widget: m[1], route: null, feature: path.basename(path.dirname(f)), file: rel(f), ...usage(s, 'js'), backend: [...dataTouchpoints(s, 'js', 'web'), ...capabilityTouchpoints(s, 'mobile')] })
    }
  }
  return screens
}
function inventoryKotlin(dir) {
  // skip test source sets and build output — judged on the path relative to the stack (a package like com.test.app is fine)
  const files = walk(dir, (p) => { const r = path.relative(dir, p); return p.endsWith('.kt') && !/(^|[\\/])build[\\/]|[\\/]src[\\/]\w*[Tt]est[\\/]/.test(r) && !/DbModels|DsTokens|AnalyticsEvents/.test(path.basename(p)) })
  const routes = {}
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/composable\(\s*(?:route\s*=\s*)?"([^"]+)"[^)]*\)\s*\{[\s\S]{0,300}?(\w+Screen)\(/g)) routes[m[2]] = '/' + m[1].replace(/\{(\w+)\}/g, ':$1').replace(/^\//, '')
    for (const m of s.matchAll(/composable<(\w+)>\s*(?:\{|\([^)]*\)\s*\{)[\s\S]{0,300}?(\w+Screen)\(/g)) routes[m[2]] = '/' + kebab(m[1])
  }
  const screens = []
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/@Composable\s+(?:internal\s+|private\s+)?fun\s+(\w+Screen)\s*\(/g)) {
      const next = s.slice(m.index + m[0].length).search(/\n(?:@Composable|(?:private\s+|internal\s+)?fun\s|class\s|object\s)/)
      const body = next < 0 ? s.slice(m.index) : s.slice(m.index, m.index + m[0].length + next)
      screens.push({ id: kebab(m[1]), widget: m[1], route: routes[m[1]] || null, feature: kebab(path.basename(path.dirname(f))), file: rel(f), ...usage(body, 'kotlin'), backend: [...dataTouchpoints(body, 'kotlin', 'web'), ...capabilityTouchpoints(body, 'mobile')] })
    }
  }
  const builds = walk(dir, (p) => /(build\.gradle(\.kts)?|libs\.versions\.toml)$/.test(p) && !/[\\/]build[\\/]/.test(p)).map(read).join('\n')
  capabilityTouchpoints(builds, 'mobile'); analyticsShared(builds)
  return screens
}
function inventoryIos(dir) {
  const files = walk(dir, (p) => p.endsWith('.swift') && !/(^|[\\/])\w*Tests?[\\/]/.test(path.relative(dir, p)) && !/DbModels|DsTokens|AnalyticsEvents/.test(path.basename(p)))
  const all = files.map(read).join('\n')
  const screens = []
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/struct\s+(\w+(?:Screen|View))\s*:\s*(?:some\s+)?View\b/g)) {
      const mainOfFile = path.basename(f, '.swift') === m[1] && /[\\/](Features|Screens|Scenes)[\\/]/.test(f)
      const isNavTarget = new RegExp(`(navigationDestination|NavigationLink|TabView|sheet|fullScreenCover)[\\s\\S]{0,200}\\b${m[1]}\\(`).test(all)
      if (!/Screen$/.test(m[1]) && !mainOfFile && !isNavTarget) continue
      const next = s.slice(m.index + m[0].length).search(/\n(?:struct|class|enum|extension)\s/)
      const body = next < 0 ? s.slice(m.index) : s.slice(m.index, m.index + m[0].length + next)
      screens.push({ id: kebab(m[1]), widget: m[1], route: null, feature: kebab(path.basename(path.dirname(f))), file: rel(f), ...usage(body, 'swift'), backend: [...dataTouchpoints(body, 'swift', 'web'), ...capabilityTouchpoints(body, 'mobile')] })
    }
  }
  capabilityTouchpoints(all, 'mobile'); analyticsShared(all)
  return screens
}
const INVENTORY = { nextjs: inventoryNext, 'react-vite': inventoryReactVite, astro: inventoryAstro, nuxt: inventoryNuxt, flutter: inventoryFlutter, 'react-native': inventoryReactNative, kmp: inventoryKotlin, android: inventoryKotlin, ios: inventoryIos }

/** --from / --to accept a stack id or a kind (web|mobile → the project's stack of that kind). */
function resolveStack(v, { required = true, exclude } = {}) {
  const stacks = projectStacks(root, config)
  if (!v) return null
  if (v === 'web' || v === 'mobile') { const s = stacks.find((x) => x.kind === v && x.id !== exclude); if (!s && required) die(`the project has no ${v} stack in .dualcraft/config.json`); return s || { id: null, kind: v } }
  const s = stacks.find((x) => x.id === v)
  if (s) return s
  if (!KINDS_OF[v]) die(`unknown stack "${v}" (node stacks.mjs list)`)
  if (required) die(`stack "${v}" is not in this project (add it with /dualcraft:stacks)`)
  return { id: v, kind: KINDS_OF[v] }
}
const KINDS_OF = { nextjs: 'web', 'react-vite': 'web', astro: 'web', nuxt: 'web', flutter: 'mobile', 'react-native': 'mobile', kmp: 'mobile', android: 'mobile', ios: 'mobile' }

function inventory(fromArg, toArg) {
  if (!fromArg) die('--from <stack|web|mobile> is required')
  const src = resolveStack(fromArg)
  const otherKind = src.kind === 'web' ? 'mobile' : 'web'
  const dst = toArg ? resolveStack(toArg, { required: false, exclude: src.id }) : (resolveStack(otherKind, { required: false }) || { id: null, kind: otherKind })
  BK.clear()
  const screens = INVENTORY[src.id](src.dir)
  // data access usually lives in services/repositories, not in screen files: scan the whole source tree
  const EXT = { js: /\.(tsx?|jsx?|vue|astro|mjs)$/, dart: /\.dart$/, kotlin: /\.kt$/, swift: /\.swift$/ }[LANG_OF[src.id]]
  for (const f of walk(src.dir, (p) => EXT.test(p) && !/\.(g|freezed|d)\.(dart|ts)$/.test(p) && !/DbModels|DsTokens|AnalyticsEvents|analytics[_-]events|ds-tokens|design_tokens|db_models/.test(p))) dataTouchpoints(read(f), LANG_OF[src.id], otherKind)
  if (dst?.kind === src.kind) for (const b of BK.values()) if (b.kind === 'platform-capability') { b.options = ['alternative', 'skip']; b.recommended = 'alternative'; b.note = `same kind of platform: use ${dst.id ? `the ${dst.id}` : 'the target\'s'} native library for it (stacks/${dst.id || '<target>'}.md)` }
  const features = {}
  for (const s of screens) (features[s.feature] ||= []).push(s.id)
  return { from: src.id, fromKind: src.kind, to: dst?.id || null, toKind: dst?.kind || otherKind, generated: new Date().toISOString(), features: Object.entries(features).map(([id, ids]) => ({ id, screens: uniq(ids) })), screens, backend: [...BK.values()] }
}

// ---------- commands ----------
if (cmd === 'inventory') {
  const inv = inventory(opt.from ? String(opt.from) : '', opt.to ? String(opt.to) : null)
  fs.mkdirSync(cdir, { recursive: true }); fs.writeFileSync(invFile, JSON.stringify(inv, null, 2) + '\n')
  console.log(`Inventory (${inv.from} → ${inv.to || inv.toKind + ' — target stack to choose'}) → ${rel(invFile)}`)
  console.log(`${inv.screens.length} screens in ${inv.features.length} features · ${inv.backend.length} backend/platform touchpoints\n`)
  for (const f of inv.features) {
    console.log(`■ ${f.id}`)
    for (const id of f.screens) { const s = inv.screens.find((x) => x.id === id); console.log(`   ${s.id.padEnd(26)} ${String(s.route || '—').padEnd(24)} ${s.file}${s.entities.length ? '  data: ' + s.entities.join(',') : ''}${s.events.length ? '  events: ' + s.events.join(',') : ''}`) }
  }
  if (inv.backend.length) { console.log('\nBackend / platform touchpoints (decide each one with the user):'); for (const b of inv.backend) console.log(`   ${b.id.padEnd(40)} ${b.kind.padEnd(14)} recommended: ${b.recommended}${b.note ? '  — ' + b.note : ''}`) }
  const noI18n = inv.screens.filter((s) => !s.i18n.length).length
  if (noI18n) console.log(`\n⚠ ${noI18n} screen(s) use no shared i18n keys — texts are probably hard-coded (i18n.mjs scan) and must be extracted first.`)
  process.exit(0)
}

const loadStatus = () => (fs.existsSync(statusFile) ? JSON.parse(read(statusFile)) : die('no conversion started — run: convert.mjs init --from <stack|web|mobile> --to <stack>'))
const saveStatus = (s) => fs.writeFileSync(statusFile, JSON.stringify(s, null, 2) + '\n')

if (cmd === 'init') {
  const inv = inventory(opt.from ? String(opt.from) : '', opt.to ? String(opt.to) : null)
  if (!inv.to) die(`choose the target stack: --to <${inv.toKind === 'web' ? 'nextjs|react-vite|astro|nuxt' : 'flutter|react-native|kmp|android|ios'}>`)
  fs.mkdirSync(cdir, { recursive: true }); fs.writeFileSync(invFile, JSON.stringify(inv, null, 2) + '\n')
  const prev = fs.existsSync(statusFile) && !opt.force ? JSON.parse(read(statusFile)) : null
  if (prev && (prev.from !== inv.from || prev.to !== inv.to)) die(`a ${prev.from} → ${prev.to} conversion already exists — finish it or use --force`)
  const inProject = projectStacks(root, config).find((x) => x.id === inv.to)
  const st = prev || { from: inv.from, fromKind: inv.fromKind, to: inv.to, toKind: inv.toKind, target: opt.target ? posix(String(opt.target)) : inProject ? rel(inProject.dir) || '.' : null, createdTarget: !inProject, started: new Date().toISOString(), features: [], backend: [] }
  for (const f of inv.features) { const ex = st.features.find((x) => x.id === f.id); if (ex) ex.screens = uniq([...ex.screens, ...f.screens]); else st.features.push({ id: f.id, screens: f.screens, state: 'pending', task: null }) }
  for (const b of inv.backend) if (!st.backend.some((x) => x.id === b.id)) st.backend.push({ id: b.id, kind: b.kind, options: b.options, recommended: b.recommended, decision: 'pending', why: null, note: b.note || null })
  saveStatus(st)
  console.log(`${prev ? 'Updated' : 'Started'} conversion ${st.from} → ${st.to}${st.target ? ` (target ${st.target}${st.createdTarget ? ', to be created' : ''})` : ''}: ${st.features.length} features, ${st.backend.length} backend decisions → ${rel(statusFile)}`)
  process.exit(0)
}

if (cmd === 'status') {
  const st = loadStatus()
  console.log(`Conversion ${st.from} → ${st.to}${st.target ? ` · target ${st.target}` : ''}`)
  const bar = (state) => { const i = STATES.indexOf(state); return state === 'skipped' ? '  skipped' : '▰'.repeat(i) + '▱'.repeat(5 - Math.min(i, 5)) + ' ' + state }
  for (const f of st.features) console.log(`  ${f.id.padEnd(22)} ${bar(f.state)}${f.task ? '  ' + f.task : ''}  (${f.screens.length} screens)`)
  const done = st.features.filter((f) => ['done', 'skipped'].includes(f.state)).length
  console.log(`  ${done}/${st.features.length} features done`)
  const pend = st.backend.filter((b) => b.decision === 'pending')
  console.log(`\nBackend decisions: ${st.backend.length - pend.length}/${st.backend.length} decided`)
  for (const b of st.backend) console.log(`  ${b.decision === 'pending' ? '?' : '✓'} ${b.id.padEnd(40)} ${b.decision === 'pending' ? `pending (recommended: ${b.recommended})` : b.decision}${b.why ? ' — ' + b.why : ''}`)
  process.exit(0)
}

if (cmd === 'set') {
  const st = loadStatus(); const [id, state] = pos
  const f = st.features.find((x) => x.id === id) || die(`feature "${id}" not in the conversion (status lists them)`)
  if (!STATES.includes(state)) die(`state must be one of: ${STATES.join(', ')}`)
  if (['generated', 'verified', 'done'].includes(state)) {
    const blocking = st.backend.filter((b) => b.decision === 'pending' && (JSON.parse(read(invFile) || '{"screens":[]}').screens || []).some((s) => f.screens.includes(s.id) && (s.backend || []).includes(b.id)))
    if (blocking.length && !opt.force) die(`backend decisions pending for this feature: ${blocking.map((b) => b.id).join(', ')} — decide them first (convert.mjs backend …)`)
  }
  f.state = state; if (opt.task) f.task = String(opt.task)
  saveStatus(st); console.log(`${id} → ${state}`)
  process.exit(0)
}

if (cmd === 'backend') {
  const st = loadStatus(); const [id, decision] = pos
  const b = st.backend.find((x) => x.id === id) || die(`backend item "${id}" not found (status lists them)`)
  if (!DECISIONS.includes(decision)) die(`decision must be one of: ${DECISIONS.join(', ')}`)
  b.decision = decision; if (opt.why) b.why = String(opt.why)
  saveStatus(st); console.log(`${id} → ${decision}${b.why ? ' — ' + b.why : ''}`)
  process.exit(0)
}

// ---------- spec-check ----------
if (cmd === 'spec-check') {
  const sdir = path.join(cdir, 'spec'); const errors = []; const warnings = []
  if (!fs.existsSync(path.join(sdir, 'app.json'))) die('no .dualcraft/convert/spec/app.json yet')
  let app; try { app = JSON.parse(read(path.join(sdir, 'app.json'))) } catch (e) { die(`app.json: ${e.message}`) }
  const screens = {}
  for (const f of walk(path.join(sdir, 'screens'), (p) => p.endsWith('.json'))) { try { const s = JSON.parse(read(f)); screens[s.id || path.basename(f, '.json')] = s } catch (e) { errors.push(`${path.basename(f)}: ${e.message}`) } }
  const st = fs.existsSync(statusFile) ? JSON.parse(read(statusFile)) : { backend: [] }
  const i18nDef = (() => { const d = path.join(dir, 'i18n'); if (!fs.existsSync(d)) return null; const l = config.i18n?.default || config.lang; const f = path.join(d, `${l}.json`); if (!fs.existsSync(f)) return null; const flat = {}; const fl = (o, p = '') => { for (const [k, v] of Object.entries(o)) v && typeof v === 'object' ? fl(v, p + k + '.') : (flat[p + k] = v) }; fl(JSON.parse(read(f))); return flat })()
  const eventNames = new Set((plan.events || []).map((e) => e.name))
  for (const f of app.features || []) for (const s of f.screens || []) if (!screens[s]) errors.push(`app.json feature ${f.id}: screen "${s}" has no spec file`)
  for (const r of app.navigation?.routes || []) if (!screens[r.screen]) errors.push(`app.json route ${r.path}: unknown screen "${r.screen}"`)
  for (const p of app.navigation?.primary || []) if (!screens[p]) errors.push(`app.json navigation.primary: unknown screen "${p}"`)
  const visit = (node, sid) => {
    if (!node || typeof node !== 'object') return
    for (const v of Object.values(node)) {
      if (typeof v === 'string') {
        let m
        if ((m = v.match(/^i18n:([\w.]+)$/)) && i18nDef && !(m[1] in i18nDef)) warnings.push(`${sid}: i18n key "${m[1]}" not in the default locale — add it to .dualcraft/i18n`)
        if ((m = v.match(/^data:(\w+)\./)) && entities.length && !entities.includes(m[1])) errors.push(`${sid}: entity "${m[1]}" not in the schema`)
        if ((m = v.match(/^navigate:([\w-]+)$/)) && !screens[m[1]]) errors.push(`${sid}: navigates to unknown screen "${m[1]}"`)
        if ((m = v.match(/^mutate:(\w+)\./)) && entities.length && !entities.includes(m[1])) errors.push(`${sid}: mutates unknown entity "${m[1]}"`)
        if ((m = v.match(/^backend:([\w/:.-]+)$/)) && st.backend.length && !st.backend.some((b) => b.id === m[1] || b.id.endsWith(':' + m[1]) || b.id.endsWith('/' + m[1]))) warnings.push(`${sid}: backend operation "${m[1]}" not in the conversion's backend decisions`)
      } else visit(v, sid)
    }
  }
  for (const [sid, s] of Object.entries(screens)) {
    for (const k of ['purpose', 'feature', 'states', 'layout']) if (!s[k] || (Array.isArray(s[k]) && !s[k].length)) errors.push(`${sid}: missing "${k}"`)
    for (const d of s.data || []) if (entities.length && !entities.includes(d.entity)) errors.push(`${sid}: data entity "${d.entity}" not in the schema`)
    for (const e of s.events || []) if (plan.events?.length && !eventNames.has(e)) warnings.push(`${sid}: event "${e}" not in the tracking plan`)
    if (!(s.rules || []).length) warnings.push(`${sid}: no business rules listed (fine only if the screen has none)`)
    visit(s.layout, sid); visit(s.data, sid)
  }
  errors.forEach((e) => console.log('✗ ' + e)); warnings.forEach((w) => console.log('⚠ ' + w))
  console.log(`${Object.keys(screens).length} screen spec(s), ${(app.features || []).length} feature(s) — ${errors.length ? errors.length + ' error(s)' : 'spec OK'}`)
  process.exit(errors.length ? 1 : 0)
}
