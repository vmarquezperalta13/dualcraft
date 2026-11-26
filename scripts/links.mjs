#!/usr/bin/env node
// DualCraft deep links: one spec (.dualcraft/links/links.json) of the app's linkable routes → typed builders and a parser
// per stack, the App Links / Universal Links files (.well-known, merged with what passkeys need), the platform snippets,
// and checks that push notifications and store screenshots only link to routes that exist.
//   init [--domain acme.app] [--scheme acme]   spec (routes imported from push and screenshots) + code + .well-known
//   add <name> <path> [--params id:int] [--query tab:string,page:int] [--web-only|--app-only]   e.g. add match /matches/{id}
//   remove <name> · gen [--force] · check [--json] · snippets [android|ios|flutter|react-native|hosting]
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, LANG, kotlinPackage, kotlinModule, iosAppDir } from './lib/targets.mjs'
import * as G from './lib/links-gen.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'add', 'remove', 'gen', 'check', 'snippets'].includes(cmd)) {
  console.log('node links.mjs init [--domain acme.app] [--scheme acme] | add <name> <path> [--params id:int] [--query tab:string] [--web-only|--app-only] | remove <name> | gen [--force] | check [--json] | snippets [android|ios|flutter|react-native|hosting]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'links', 'links.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config)
const mobile = stacks.filter((s) => s.kind === 'mobile'); const web = stacks.find((s) => s.kind === 'web')
const kebab = (s) => String(s || 'app').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
const PLACEHOLDER_SHA = '<SHA-256 of the app signing certificate: Play Console → Test and release → App signing>'
const PLACEHOLDER_APP = '<TEAMID>.<bundle id>'

// ---------------------------------------------------------------- spec
const load = () => readJson(file) || die(`no ${rel(file)} — run: links.mjs init`)
const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n') }
const nameFor = (p, taken) => { const lits = G.segments(p).filter((s) => s.lit).map((s) => s.lit); let n = G.camel(lits.join('-') || 'home'); if (G.segments(p).some((s) => s.param) && taken.has(n)) n += 'Detail'; let k = n; let i = 2; while (taken.has(k)) k = n + i++; return k }
function androidPackage() {
  for (const s of mobile) {
    if (s.id === 'flutter') { const g = read(path.join(s.dir, 'android/app/build.gradle.kts')) + read(path.join(s.dir, 'android/app/build.gradle')); const m = g.match(/applicationId\s*=?\s*["']([\w.]+)["']/); if (m) return m[1] }
    if (['android', 'kmp'].includes(s.id)) return kotlinPackage(s.dir, config, s.id)
    if (s.id === 'react-native') { const a = readJson(path.join(s.dir, 'app.json')); if (a?.expo?.android?.package) return a.expo.android.package }
  }
  return null
}
/** Routes already used by other DualCraft sources: push notification routes and store screenshot deep links. */
function importedRoutes(scheme) {
  const out = []
  const push = readJson(path.join(dir, 'push', 'notifications.json'))
  for (const n of push?.notifications || []) if (n.route && n.route.startsWith('/')) {
    const params = {}; for (const s of G.segments(n.route.split('?')[0])) if (s.param) params[s.param] = ['int'].includes(n.params?.[s.param]?.type) ? 'int' : 'string'
    out.push({ path: n.route.split('?')[0], params, origin: 'push' })
  }
  const shots = readJson(path.join(dir, 'store', 'screenshots.json'))
  for (const sc of shots?.screens || []) for (const l of [sc.android, sc.ios].filter(Boolean)) {
    const m = String(l).match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)/i); if (!m) continue
    if (scheme && m[1] !== scheme) continue
    out.push({ path: '/' + m[2].replace(/^\/+/, ''), params: {}, origin: 'screenshots' })
  }
  return out
}
function validate(s) {
  const e = []
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s.domain || '')) e.push('domain must be a host name like acme.app (no https://, no path)')
  if (s.scheme && !/^[a-z][a-z0-9+.-]*$/.test(s.scheme)) e.push('scheme must be lowercase letters, digits, + . - (e.g. acme)')
  if (['http', 'https', 'file', 'mailto', 'tel'].includes(s.scheme)) e.push(`scheme "${s.scheme}" is reserved — use the app's own name`)
  const names = new Set(); const paths = new Set()
  for (const r of s.routes || []) {
    const w = `route "${r.name}"`
    if (!/^[a-z][a-zA-Z0-9]*$/.test(r.name || '')) e.push(`${w}: name must be camelCase (e.g. matchDetail)`)
    if (names.has(r.name)) e.push(`${w}: declared twice`); names.add(r.name)
    if (!/^\/([A-Za-z0-9._~-]+|\{[a-zA-Z][a-zA-Z0-9]*\})?(\/([A-Za-z0-9._~-]+|\{[a-zA-Z][a-zA-Z0-9]*\}))*$/.test(r.path || '')) { e.push(`${w}: path must look like /matches/{id} (no query, no trailing slash)`); continue }
    const shape = G.segments(r.path).map((x) => (x.lit !== undefined ? x.lit : '{}')).join('/')
    if (paths.has(shape)) e.push(`${w}: same path shape as another route (${r.path})`); paths.add(shape)
    const ps = G.segments(r.path).filter((x) => x.param).map((x) => x.param)
    if (new Set(ps).size !== ps.length) e.push(`${w}: a parameter appears twice`)
    for (const [k, t] of Object.entries(r.params || {})) { if (!ps.includes(k)) e.push(`${w}: params.${k} is not in the path`); if (!['string', 'int'].includes(t)) e.push(`${w}: params.${k} must be string or int`) }
    for (const [k, t] of Object.entries(r.query || {})) { if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) e.push(`${w}: query "${k}" must be a simple name`); if (!['string', 'int'].includes(t)) e.push(`${w}: query.${k} must be string or int`); if (ps.includes(k)) e.push(`${w}: "${k}" is both a path and a query parameter`) }
    if (r.app === false && r.web === false) e.push(`${w}: neither app nor web`)
  }
  return e
}

// ---------------------------------------------------------------- outputs
function out(stack) {
  const { id, dir: d } = stack
  const custom = config.links?.out?.[id]; if (custom) return { file: path.join(root, custom), pkg: config.design?.kotlinPackage }
  const src = fs.existsSync(path.join(d, 'src')) ? 'src' : ''
  if (['nextjs', 'react-vite', 'astro', 'react-native'].includes(id)) return { file: path.join(d, id === 'nextjs' ? src : 'src', 'lib', 'app-links.ts') }
  if (id === 'nuxt') return { file: path.join(d, fs.existsSync(path.join(d, 'app')) ? 'app' : '', 'utils', 'app-links.ts') }
  if (id === 'flutter') return { file: path.join(d, 'lib', 'generated', 'app_links.dart') }
  if (id === 'ios') return { file: path.join(iosAppDir(d, config), 'Core', 'Links', 'AppLinks.swift') }
  const pkg = kotlinPackage(d, config, id); const mod = kotlinModule(d, id)
  const base = id === 'kmp' ? path.join(d, mod, 'src', 'commonMain', 'kotlin') : path.join(d, mod, 'src', 'main', 'java')
  return { file: path.join(base, ...pkg.split('.'), 'links', 'AppLinks.kt'), pkg: pkg + '.links' }
}
const wellKnownDir = () => (web ? path.join(web.dir, 'public', '.well-known') : path.join(dir, 'links', 'well-known'))
const appRoutes = (s) => s.routes.filter((r) => r.app !== false)
/** Auth passkeys share these files (webcredentials, get_login_creds): keep them whichever generator runs first. */
const passkeys = () => (readJson(path.join(dir, 'auth', 'auth.json'))?.methods || []).includes('passkey')
/** assetlinks.json and apple-app-site-association, merged into what is already there (passkeys: get_login_creds, webcredentials). */
function wellKnown(s) {
  const wk = wellKnownDir(); const files = []
  if (mobile.some((m) => m.id !== 'ios')) {
    const cur = readJson(path.join(wk, 'assetlinks.json')); const list = Array.isArray(cur) ? cur.map((x) => JSON.parse(JSON.stringify(x))) : []
    const pkg = s.android?.package || PLACEHOLDER_APP.replace('<TEAMID>.<bundle id>', '<application id>')
    let st = list.find((x) => x.target?.namespace === 'android_app' && (x.target.package_name === pkg || /^</.test(x.target.package_name || '') || x.target.package_name === 'com.example.app'))
    if (!st) { st = { relation: [], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [] } }; list.push(st) }
    st.target.package_name = pkg
    if (!st.relation.includes('delegate_permission/common.handle_all_urls')) st.relation = ['delegate_permission/common.handle_all_urls', ...st.relation]
    if (passkeys() && !st.relation.includes('delegate_permission/common.get_login_creds')) st.relation.push('delegate_permission/common.get_login_creds')
    const fps = s.android?.sha256?.length ? s.android.sha256 : (st.target.sha256_cert_fingerprints || []).filter((f) => !/^</.test(f))
    st.target.sha256_cert_fingerprints = fps.length ? fps : [PLACEHOLDER_SHA]
    files.push({ file: path.join(wk, 'assetlinks.json'), text: JSON.stringify(list, null, 2) + '\n' })
  }
  if (mobile.some((m) => m.id !== 'android')) {
    const cur = readJson(path.join(wk, 'apple-app-site-association')) || {}
    const appId = s.ios?.appId || PLACEHOLDER_APP
    const next = { ...cur, applinks: { details: [{ appIDs: [appId], components: appRoutes(s).map((r) => ({ '/': G.aasaPattern(r.path), comment: r.name })) }] } }
    if (passkeys() && !next.webcredentials) next.webcredentials = { apps: [appId] }
    if (next.webcredentials?.apps) next.webcredentials.apps = next.webcredentials.apps.map((a) => (/^</.test(a) && s.ios?.appId ? s.ios.appId : a))
    files.push({ file: path.join(wk, 'apple-app-site-association'), text: JSON.stringify(next, null, 2) + '\n' })
  }
  return files
}
function outputs(s) {
  const files = []
  for (const st of stacks) {
    const routes = s.routes.filter((r) => (st.kind === 'web' ? r.web !== false : r.app !== false))
    const o = out(st); const lang = LANG[st.id]
    const code = lang === 'ts' ? G.tsLinks(s, routes) : lang === 'dart' ? G.dartLinks(s, routes) : lang === 'kotlin' ? G.kotlinLinks(s, routes, o.pkg) : G.swiftLinks(s, routes)
    files.push({ file: o.file, text: stamp(code) })
  }
  return [...files, ...wellKnown(s).map((f) => ({ ...f, raw: true }))]
}
function generate(s, force) {
  const errors = validate(s)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix links.json first.') }
  const written = []
  for (const f of outputs(s)) {
    if (f.raw) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); written.push(rel(f.file)) }
    else written.push(writeGuarded(f.file, f.text, { root, force }))
  }
  return written
}

// ---------------------------------------------------------------- snippets
function snippets(s, which) {
  const D = s.domain; const app = appRoutes(s)
  const A = { android: [
    `<!-- AndroidManifest.xml, inside the main <activity> (App Links: verified https links open the app) -->`,
    `<intent-filter android:autoVerify="true">`, '    <action android:name="android.intent.action.VIEW" />', '    <category android:name="android.intent.category.DEFAULT" />', '    <category android:name="android.intent.category.BROWSABLE" />',
    `    <data android:scheme="https" android:host="${D}" />`, ...app.map((r) => `    <data android:pathPattern="${G.androidPattern(r.path)}" />`), '</intent-filter>',
    ...(s.scheme ? [`<intent-filter>`, '    <action android:name="android.intent.action.VIEW" />', '    <category android:name="android.intent.category.DEFAULT" />', '    <category android:name="android.intent.category.BROWSABLE" />', `    <data android:scheme="${s.scheme}" />`, '</intent-filter>'] : []),
    'Then route the incoming intent: AppRoute.parse(intent.data.toString()).'],
  ios: ['Signing & Capabilities → Associated Domains (the .entitlements file):', '<key>com.apple.developer.associated-domains</key>', '<array>', `    <string>applinks:${D}</string>`, '</array>',
    ...(s.scheme ? ['Info.plist → URL Types: add the scheme', `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${s.scheme}</string></array></dict></array>`] : []),
    'SwiftUI: .onOpenURL { url in if let route = AppRoute.parse(url.absoluteString) { … } }'],
  flutter: ['Android: the intent filters of "android" in android/app/src/main/AndroidManifest.xml, plus', '<meta-data android:name="flutter_deeplinking_enabled" android:value="true" />',
    'iOS: the Associated Domains of "ios" in ios/Runner/Runner.entitlements, plus FlutterDeepLinkingEnabled = YES in Info.plist.',
    'go_router receives the path; elsewhere: AppRoute.parse(uri.toString()).'],
  'react-native': ['app.json (Expo):', JSON.stringify({ expo: { scheme: s.scheme || undefined, ios: { associatedDomains: [`applinks:${D}`] }, android: { intentFilters: [{ action: 'VIEW', autoVerify: true, data: app.map((r) => ({ scheme: 'https', host: D, pathPattern: G.androidPattern(r.path) })), category: ['BROWSABLE', 'DEFAULT'] }] } } }, null, 2),
    'Expo Router maps the path to a screen; elsewhere: parseLink(url) from Linking.'],
  hosting: [`Serve https://${D}/.well-known/assetlinks.json and https://${D}/.well-known/apple-app-site-association over https, no redirects, Content-Type application/json.`,
    'Firebase Hosting (firebase.json → hosting.headers): [{ "source": "/.well-known/apple-app-site-association", "headers": [{ "key": "Content-Type", "value": "application/json" }] }]',
    'Vercel (vercel.json): { "headers": [{ "source": "/.well-known/apple-app-site-association", "headers": [{ "key": "Content-Type", "value": "application/json" }] }] }',
    'Netlify / Cloudflare Pages (_headers):', '/.well-known/apple-app-site-association', '  Content-Type: application/json',
    `Verify: https://${D}/.well-known/assetlinks.json in Google's Statement List tester, and the AASA with Apple's CDN: https://app-site-association.cdn-apple.com/a/v1/${D}`] }
  return which ? A[which] || die(`snippets: android | ios | flutter | react-native | hosting`) : Object.entries(A).flatMap(([k, v]) => [`## ${k}`, ...v, ''])
}

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const existed = fs.existsSync(file)
  const s = existed ? load() : {}
  const auth = readJson(path.join(dir, 'auth', 'auth.json'))
  s.domain = opt.domain ? String(opt.domain) : s.domain || auth?.passkey?.rpId || config.domain || 'example.com'
  s.scheme = opt.scheme !== undefined ? String(opt.scheme) : s.scheme ?? kebab(config.name).replace(/-/g, '')
  if (mobile.length) {
    const pkg = s.android?.package || androidPackage()
    if (mobile.some((m) => m.id !== 'ios')) s.android = { package: pkg || 'com.example.app', sha256: s.android?.sha256 || auth?.passkey?.androidSha256 || [] }
    if (mobile.some((m) => m.id !== 'android')) s.ios = { appId: s.ios?.appId || auth?.passkey?.iosAppId || '' }
  }
  s.routes = s.routes || [{ name: 'home', path: '/' }]
  const taken = new Set(s.routes.map((r) => r.name)); const shapes = new Set(s.routes.map((r) => G.segments(r.path).map((x) => (x.lit !== undefined ? x.lit : '{}')).join('/')))
  for (const r of importedRoutes(s.scheme)) {
    const shape = G.segments(r.path).map((x) => (x.lit !== undefined ? x.lit : '{}')).join('/'); if (shapes.has(shape)) continue
    const name = nameFor(r.path, taken); taken.add(name); shapes.add(shape)
    s.routes.push({ name, path: r.path, ...(Object.keys(r.params).length ? { params: r.params } : {}), origin: r.origin })
  }
  save(s)
  console.log(`${existed ? 'updated' : 'created'} ${rel(file)} — https://${s.domain}${s.scheme ? ` + ${s.scheme}://` : ''}, ${s.routes.length} route(s): ${s.routes.map((r) => `${r.name} ${r.path}`).join(' · ')}`)
  for (const w of generate(s, !!opt.force)) console.log('→ ' + w)
  if (s.domain === 'example.com') console.log('⚠ set the real domain: links.mjs init --domain <your domain>')
  console.log('Next: add the routes the app opens (links.mjs add), wire the platforms (links.mjs snippets), publish the .well-known files with the web, then links.mjs check.')
  process.exit(0)
}

if (cmd === 'add' || cmd === 'remove') {
  const s = load(); const name = pos[0] || die(`usage: links.mjs ${cmd} <name>${cmd === 'add' ? ' <path>' : ''}`)
  if (cmd === 'remove') { if (!s.routes.some((r) => r.name === name)) die(`no route "${name}"`); s.routes = s.routes.filter((r) => r.name !== name) }
  else {
    if (s.routes.some((r) => r.name === name)) die(`route "${name}" already exists — edit it in ${rel(file)}`)
    const p = pos[1] || die('usage: links.mjs add <name> <path>, e.g. add match /matches/{id}')
    const kv = (v) => Object.fromEntries(String(v || '').split(',').filter(Boolean).map((x) => { const [k, t = 'string'] = x.split(':'); return [k.trim(), t.trim()] }))
    const params = Object.fromEntries(G.segments(p).filter((x) => x.param).map((x) => [x.param, 'string']))
    Object.assign(params, kv(opt.params))
    s.routes.push({ name, path: p, ...(Object.keys(params).length ? { params } : {}), ...(opt.query ? { query: kv(opt.query) } : {}), ...(opt['web-only'] ? { app: false } : {}), ...(opt['app-only'] ? { web: false } : {}) })
  }
  const errors = validate(s); if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('not saved.') }
  save(s)
  console.log(`${cmd === 'add' ? 'added' : 'removed'} "${name}"`)
  for (const w of generate(s, !!opt.force)) console.log('→ ' + w)
  process.exit(0)
}

if (cmd === 'gen') { for (const w of generate(load(), !!opt.force)) console.log('→ ' + w); process.exit(0) }
if (cmd === 'snippets') { console.log(snippets(load(), pos[0]).join('\n')); process.exit(0) }

// ---------------------------------------------------------------- check
const s = load()
const issues = validate(s).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
/** Does a concrete path (/matches/7) or a pattern (/matches/{matchId}) fit a declared route? */
const fits = (p, routes) => { const a = G.segments(p.split('?')[0]); return routes.some((r) => { const b = G.segments(r.path); return a.length === b.length && b.every((x, i) => x.param !== undefined || (a[i].lit !== undefined && a[i].lit === x.lit)) && a.every((x, i) => x.lit !== undefined || b[i].param !== undefined) }) }
if (!issues.length) {
  for (const f of outputs(s)) if (read(f.file) !== f.text) err(`${rel(f.file)} out of date — run: links.mjs gen`)
  if (s.domain === 'example.com') err('domain is still example.com — links.mjs init --domain <your domain>')
  if (s.android && !(s.android.sha256 || []).length) warn('android.sha256: add the SHA-256 of the app signing certificate (Play Console → App signing; also the upload key for local builds), or App Links will not verify')
  if (s.android && /example/.test(s.android.package || '')) warn(`android.package is ${s.android.package} — set the real application id`)
  if (s.ios && !s.ios.appId) warn('ios.appId: set "<TEAMID>.<bundle id>" (developer.apple.com → Membership), or Universal Links will not open the app')
  // the platforms declare the domain
  const find = (d, re, test, depth = 0) => { if (depth > 5 || !fs.existsSync(d)) return false; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(node_modules|build|Pods|DerivedData|\.gradle|\.dart_tool|\.git)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) { if (find(p, re, test, depth + 1)) return true } else if (re.test(e.name) && test(read(p))) return true } return false }
  const hostRe = new RegExp(`android:host="${s.domain.replace(/\./g, '\\.')}"`)
  for (const st of mobile) {
    const androidOk = () => find(st.dir, /^AndroidManifest\.xml$/, (t) => hostRe.test(t) && /autoVerify="true"/.test(t))
    const iosOk = () => find(st.dir, /\.entitlements$/, (t) => t.includes(`applinks:${s.domain}`))
    if (st.id === 'react-native') { const a = read(path.join(st.dir, 'app.json')) + read(path.join(st.dir, 'app.config.ts')) + read(path.join(st.dir, 'app.config.js')); if (!a.includes(`applinks:${s.domain}`) || !a.includes(s.domain)) warn(`react-native: app.json lacks the associated domain / intent filters — links.mjs snippets react-native`); continue }
    if (st.id !== 'ios' && !androidOk()) warn(`${st.id}: AndroidManifest.xml has no verified intent filter for ${s.domain} — links.mjs snippets ${st.id === 'flutter' ? 'flutter' : 'android'}`)
    if (st.id !== 'android' && !iosOk()) warn(`${st.id}: no Associated Domains entitlement applinks:${s.domain} — links.mjs snippets ${st.id === 'flutter' ? 'flutter' : 'ios'}`)
  }
  // push notifications and store screenshots must link to routes the apps can open
  const app = appRoutes(s)
  for (const n of readJson(path.join(dir, 'push', 'notifications.json'))?.notifications || []) if (n.route && n.route.startsWith('/') && !fits(n.route, app)) err(`push "${n.id || n.type || n.name}": route ${n.route} is not an app route in links.json — links.mjs add …`)
  for (const sc of readJson(path.join(dir, 'store', 'screenshots.json'))?.screens || []) for (const l of [sc.android, sc.ios].filter(Boolean)) {
    const m = String(l).match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)/i)
    if (m && m[1] === s.scheme && !fits('/' + m[2].replace(/^\/+/, ''), app)) warn(`screenshot "${sc.name}": ${l} is not an app route in links.json`)
  }
  if (!mobile.length) warn('no mobile stack: links only build web URLs')
}
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Links — https://${s.domain}${s.scheme ? ` · ${s.scheme}://` : ''} · ${s.routes.length} route(s)`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `links OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
