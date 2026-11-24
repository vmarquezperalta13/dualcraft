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

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const CMDS = ['inventory', 'init', 'status', 'set', 'backend', 'spec-check']
if (cmd === 'help' || !CMDS.includes(cmd)) { console.log('node convert.mjs inventory --from web|mobile | init --from web|mobile [--target dir] | status | set <feature> <state> | backend <id> <decision> [--why …] | spec-check'); process.exit(cmd === 'help' ? 0 : 1) }

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
const usage = (s, platform) => ({
  entities: entities.filter((n) => new RegExp(`\\b${n}\\b`).test(s)),
  i18n: platform === 'web'
    ? uniq([...s.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)].map((m) => m[1]))
    : uniq([...s.matchAll(/(?:AppLocalizations\.of\([^)]*\)!?|\bl10n|\bloc)\.(\w+)/g)].map((m) => m[1])),
  events: uniq([...s.matchAll(/(?:analyticsEvents|AnalyticsEvents)\.(\w+)\(/g)].map((m) => eventByCamel[m[1]] || m[1])),
})

// ---------- inventory: web ----------
function inventoryWeb() {
  const web = stackDir('web')
  const appDir = ['src/app', 'app'].map((d) => path.join(web, d)).find((d) => fs.existsSync(d))
  const pagesDir = ['src/pages', 'pages'].map((d) => path.join(web, d)).find((d) => fs.existsSync(d))
  const screens = []; const backend = []
  const toRoute = (segs) => '/' + segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).map((s) => s.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, '*$1').replace(/^\[(\w+)\]$/, ':$1')).join('/')
  if (appDir) {
    for (const f of walk(appDir, (p) => /[\\/]page\.(tsx|jsx|ts|js)$/.test(p))) {
      const segs = path.relative(appDir, path.dirname(f)).split(path.sep).filter(Boolean)
      const route = toRoute(segs).replace(/\/$/, '') || '/'
      const s = read(f)
      const feature = segs.filter((x) => !/^[([@]/.test(x))[0] || 'home'
      screens.push({ id: (route === '/' ? 'home' : route.slice(1).replace(/[/:*]+/g, '-').replace(/-+$/, '')), route, feature, file: rel(f), client: /^\s*['"]use client['"]/m.test(s), ...usage(s, 'web'), calls: uniq([...s.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"?]+)/g)].map((m) => m[1])) })
    }
    for (const f of walk(appDir, (p) => /[\\/]route\.(ts|js)$/.test(p))) {
      const segs = path.relative(appDir, path.dirname(f)).split(path.sep).filter(Boolean)
      const route = toRoute(segs); const s = read(f)
      const methods = uniq([...s.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]))
      const admin = /firebase-admin/.test(s); const secrets = uniq([...s.matchAll(/process\.env\.(?!NEXT_PUBLIC_)(\w+)/g)].map((m) => m[1]))
      backend.push({ id: `api:${route}`, kind: 'route-handler', file: rel(f), methods, usesAdmin: admin, secrets, options: ['expose-api', 'move-to-functions', 'skip'], recommended: admin ? 'move-to-functions' : 'expose-api' })
    }
  }
  if (pagesDir) for (const f of walk(pagesDir, (p) => /\.(tsx|jsx|ts|js)$/.test(p) && !/[\\/]_(app|document|error)\./.test(p))) {
    const r = '/' + path.relative(pagesDir, f).replace(/\\/g, '/').replace(/\.(tsx|jsx|ts|js)$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, ':$1')
    if (r.startsWith('/api')) { backend.push({ id: `api:${r.replace(/^\/api/, '/api')}`, kind: 'api-route', file: rel(f), options: ['expose-api', 'move-to-functions', 'skip'], recommended: 'expose-api' }); continue }
    const s = read(f); screens.push({ id: r === '/' ? 'home' : r.slice(1).replace(/[/:]+/g, '-'), route: r || '/', feature: r.split('/')[1] || 'home', file: rel(f), ...usage(s, 'web'), calls: [] })
  }
  for (const f of walk(web, (p) => /\.(ts|tsx|js)$/.test(p) && !/[\\/]node_modules[\\/]/.test(p))) {
    const s = read(f)
    if (/^\s*['"]use server['"]/m.test(s)) {
      const fns = uniq([...s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]))
      backend.push({ id: `action:${rel(f)}`, kind: 'server-action', file: rel(f), functions: fns, usesAdmin: /firebase-admin/.test(s), options: ['move-to-functions', 'expose-api', 'duplicate', 'skip'], recommended: /firebase-admin|process\.env\.(?!NEXT_PUBLIC_)/.test(s) ? 'move-to-functions' : 'duplicate' })
    }
    if (/from\s+['"]stripe['"]|@stripe\//.test(s)) backend.push({ id: `service:stripe:${rel(f)}`, kind: 'payments', file: rel(f), options: ['alternative', 'shared', 'skip'], recommended: 'alternative', note: 'Digital goods inside a store app must use in-app purchases; physical goods/services may keep Stripe' })
  }
  for (const sc of screens) sc.backend = backend.filter((b) => sc.calls?.some((c) => b.id === `api:${c}` || b.id.startsWith(`api:${c}`))).map((b) => b.id)
  return { screens, backend }
}

// ---------- inventory: mobile ----------
const PLUGIN_ALTERNATIVES = {
  in_app_purchase: 'web checkout (Stripe) for allowed goods, or skip on web', purchases_flutter: 'RevenueCat web billing / Stripe, or skip on web',
  firebase_messaging: 'Web Push (FCM for web + service worker)', local_auth: 'WebAuthn / passkeys, or skip', camera: '<input capture> / getUserMedia',
  image_picker: 'file input with accept="image/*"', file_picker: 'file input', geolocator: 'Geolocation API', mobile_scanner: 'web QR scanner library (getUserMedia)',
  shared_preferences: 'localStorage (non-sensitive)', flutter_secure_storage: 'httpOnly cookies / server session', sqflite: 'IndexedDB or server data',
  google_mobile_ads: 'AdSense / web ads, or skip', in_app_review: 'skip (web has no equivalent)', share_plus: 'navigator.share / copy link', url_launcher: 'links',
  firebase_crashlytics: 'web error tracking (Sentry) or skip', firebase_analytics: "shared: Firebase/GA4 web with the same tracking plan", health: 'skip', sensors_plus: 'skip',
}
function inventoryMobile() {
  const mob = stackDir('mobile'); const lib = path.join(mob, 'lib')
  const files = walk(lib, (p) => p.endsWith('.dart') && !/\.(g|freezed|gr)\.dart$/.test(p))
  const routes = {}
  for (const f of files) for (const m of read(f).matchAll(/GoRoute\(\s*(?:name:\s*['"][^'"]*['"],\s*)?path:\s*['"]([^'"]+)['"][\s\S]{0,300}?(?:=>|return)\s*(?:const\s+)?(\w+)\(/g)) routes[m[2]] = m[1]
  const screens = []; const backend = new Map()
  for (const f of files) {
    const s = read(f)
    for (const m of s.matchAll(/class\s+(\w+(?:Screen|Page|View))\s+extends\s+(StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget)/g)) {
      const relLib = path.relative(lib, f).split(path.sep)
      const feature = relLib[0] === 'features' && relLib[1] ? relLib[1] : relLib.length > 1 ? relLib[relLib.length - 2] : 'app'
      const id = m[1].replace(/(Screen|Page|View)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
      const cols = uniq([...s.matchAll(/collection\(\s*['"]([\w-]+)['"]/g)].map((x) => x[1]))
      const fns = uniq([...s.matchAll(/httpsCallable\(\s*['"]([\w-]+)['"]/g)].map((x) => x[1]))
      screens.push({ id, widget: m[1], route: routes[m[1]] || null, feature, file: rel(f), ...usage(s, 'mobile'), backend: [...cols.map((c) => `firestore:${c}`), ...fns.map((n) => `function:${n}`)] })
    }
    for (const c of s.matchAll(/collection\(\s*['"]([\w-]+)['"]/g)) backend.set(`firestore:${c[1]}`, { id: `firestore:${c[1]}`, kind: 'firestore', options: ['shared', 'expose-api'], recommended: 'shared', note: 'Web reads/writes the same collection with the Firebase JS SDK; rules must cover the web access too' })
    for (const c of s.matchAll(/httpsCallable\(\s*['"]([\w-]+)['"]/g)) backend.set(`function:${c[1]}`, { id: `function:${c[1]}`, kind: 'cloud-function', options: ['shared'], recommended: 'shared', note: 'Callable from the web SDK too; check App Check/CORS config for web' })
  }
  const pub = read(path.join(mob, 'pubspec.yaml'))
  for (const [plugin, alt] of Object.entries(PLUGIN_ALTERNATIVES)) if (new RegExp(`^\\s{2}${plugin}:`, 'm').test(pub)) backend.set(`plugin:${plugin}`, { id: `plugin:${plugin}`, kind: 'native-plugin', options: /^shared/.test(alt) ? ['shared', 'skip'] : ['alternative', 'skip'], recommended: /^skip/.test(alt) ? 'skip' : /^shared/.test(alt) ? 'shared' : 'alternative', note: alt })
  for (const sc of screens) for (const b of backend.values()) if (b.kind === 'native-plugin' && new RegExp(b.id.split(':')[1].replace(/_(\w)/g, (_, c) => c.toUpperCase()), 'i').test(read(path.join(root, sc.file)))) sc.backend.push(b.id)
  return { screens, backend: [...backend.values()] }
}

function inventory(from) {
  if (!['web', 'mobile'].includes(from)) die('--from web|mobile')
  if (!config.stacks?.[from]) die(`the project has no ${from} stack in .dualcraft/config.json`)
  const inv = from === 'web' ? inventoryWeb() : inventoryMobile()
  const features = {}
  for (const s of inv.screens) (features[s.feature] ||= []).push(s.id)
  return { from, to: from === 'web' ? 'mobile' : 'web', generated: new Date().toISOString(), features: Object.entries(features).map(([id, screens]) => ({ id, screens })), ...inv }
}

// ---------- commands ----------
if (cmd === 'inventory') {
  const inv = inventory(String(opt.from || ''))
  fs.mkdirSync(cdir, { recursive: true }); fs.writeFileSync(invFile, JSON.stringify(inv, null, 2) + '\n')
  console.log(`Inventory (${inv.from} → ${inv.to}) → ${rel(invFile)}`)
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

const loadStatus = () => (fs.existsSync(statusFile) ? JSON.parse(read(statusFile)) : die('no conversion started — run: convert.mjs init --from web|mobile'))
const saveStatus = (s) => fs.writeFileSync(statusFile, JSON.stringify(s, null, 2) + '\n')

if (cmd === 'init') {
  const inv = inventory(String(opt.from || ''))
  fs.mkdirSync(cdir, { recursive: true }); fs.writeFileSync(invFile, JSON.stringify(inv, null, 2) + '\n')
  const prev = fs.existsSync(statusFile) && !opt.force ? JSON.parse(read(statusFile)) : null
  if (prev && prev.from !== inv.from) die(`a ${prev.from} → ${prev.to} conversion already exists — finish it or use --force`)
  const st = prev || { from: inv.from, to: inv.to, target: opt.target ? posix(String(opt.target)) : config.paths?.[inv.to] || null, createdTarget: !config.stacks?.[inv.to], started: new Date().toISOString(), features: [], backend: [] }
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
