#!/usr/bin/env node
// DualCraft end-to-end tests: one neutral spec (.dualcraft/e2e/flows.json) → Playwright specs for the web app and
// Maestro flows for the mobile apps. Flows with an "origin" (auth, smoke, payments, screenshots) are derived from
// what DualCraft already knows (auth.json, the screens/routes, products.json, store/screenshots.json) and refreshed
// by gen; flows without one are yours and kept as written.
//   init [--base-url http://localhost:3000] [--scheme myapp] [--app-id com.acme.app]   (mobile.appIds.<stack> overrides per app)
//   gen [--force]          sync derived flows, write e2e/dualcraft/*.spec.ts and .maestro/dualcraft/*.yaml
//   check [--json]         spec valid, texts exist, generated files current, Playwright installed, CI job
//   run --platform web|android|ios [--tag auth] [--update-snapshots]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks } from './lib/targets.mjs'
import * as G from './lib/e2e-gen.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check', 'run'].includes(cmd)) {
  console.log('node e2e.mjs init [--base-url URL] [--scheme myapp] [--app-id com.acme.app] | gen [--force] | check [--json] | run --platform web|android|ios [--tag auth] [--update-snapshots]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'e2e', 'flows.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const stacks = projectStacks(root, config)
const web = stacks.find((s) => s.kind === 'web')
const mobiles = stacks.filter((s) => s.kind === 'mobile')

// ---------------------------------------------------------------- texts (default locale of the shared i18n)
const i18nDir = path.join(dir, 'i18n')
const locales = fs.existsSync(i18nDir) ? fs.readdirSync(i18nDir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.slice(0, -5)) : []
const defLocale = config.i18n?.default || (locales.includes(config.lang) ? config.lang : locales[0]) || 'es'
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') flat(v, p + k + '.', out); else out[p + k] = String(v) } return out }
const texts = flat(readJson(path.join(i18nDir, defLocale + '.json')))
const missingKeys = new Set()
/** i18n key → default-locale text with simple {param} values (web/mobile scopes too). */
function tr(key, params = {}) {
  const v = texts[key] ?? texts['web.' + key] ?? texts['mobile.' + key]
  if (v === undefined) { missingKeys.add(key); return key }
  return v.replace(/\{(\w+)\}/g, (all, n) => (n in params ? String(params[n]) : all))
}

// ---------------------------------------------------------------- defaults
const PORT = { nextjs: 3000, nuxt: 3000, astro: 4321, 'react-vite': 4173 }
function startCommand(s) {
  const pm = fs.existsSync(path.join(s.dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(s.dir, 'yarn.lock')) ? 'yarn' : 'npm run'
  if (s.id === 'react-vite') return `${pm} build && ${pm} preview --port 4173`
  if (s.id === 'astro') return `${pm} build && ${pm} preview --port 4321`
  return `${pm} build && ${pm} start`
}
function appId() {
  for (const s of mobiles) {
    const files = s.id === 'flutter' ? ['android/app/build.gradle.kts', 'android/app/build.gradle'] : s.id === 'android' ? ['app/build.gradle.kts', 'app/build.gradle'] : s.id === 'kmp' ? ['composeApp/build.gradle.kts', 'androidApp/build.gradle.kts'] : []
    for (const f of files) { const m = read(path.join(s.dir, f)).match(/applicationId\s*=?\s*["']([\w.]+)["']/); if (m) return m[1] }
    if (s.id === 'react-native') { const a = readJson(path.join(s.dir, 'app.json'))?.expo; if (a?.android?.package || a?.ios?.bundleIdentifier) return a.android?.package || a.ios.bundleIdentifier }
  }
  const p = readJson(path.join(dir, 'payments', 'products.json'))
  return p?.android?.packageName || p?.apple?.bundleId || null
}
function scheme() {
  const rn = mobiles.find((s) => s.id === 'react-native')
  const exp = rn && readJson(path.join(rn.dir, 'app.json'))?.expo?.scheme
  return exp || (config.name || 'app').toLowerCase().replace(/[^a-z0-9]/g, '')
}
function defaults() {
  return {
    locale: defLocale,
    web: web ? { stack: web.id, dir: rel(web.dir), baseUrl: opt['base-url'] ? String(opt['base-url']) : `http://localhost:${PORT[web.id] || 3000}`, startCommand: startCommand(web) } : null,
    mobile: mobiles.length ? { appId: opt['app-id'] ? String(opt['app-id']) : appId() || 'com.example.app', scheme: opt.scheme ? String(opt.scheme) : scheme() } : null,
    routes: { account: '/account', paywall: '/paywall' },
    derive: { auth: true, smoke: true, payments: true, screenshots: true },
    flows: [],
  }
}

// ---------------------------------------------------------------- derived flows
const segs = (p) => p.split(/[?#]/)[0].split('/').filter(Boolean)
function match(p, s, i = 0, j = 0) {
  if (i === p.length) return j === s.length
  if (p[i] === '**') { for (let k = j; k <= s.length; k++) if (match(p, s, i + 1, k)) return true; return false }
  if (j === s.length) return false
  return (p[i] === '*' || p[i].startsWith(':') || p[i] === s[j]) && match(p, s, i + 1, j + 1)
}
/** Anonymous visitor on a route: allowed only on "public" (decideAccess with no user). */
const isPublic = (auth, route) => !auth || (auth.routes.rules.find((r) => match(segs(r.path), segs(route)))?.access === 'public')

/** Screens with a static route, from the converter's inventory of each stack. */
function routesOf(s) {
  const inv = path.join(dir, 'convert', 'inventory.json'); const before = read(inv)
  const r = spawnSync(process.execPath, [path.join(HERE, 'convert.mjs'), 'inventory', '--from', s.id], { cwd: root, encoding: 'utf8' })
  const out = r.status === 0 ? readJson(inv) : null
  if (before) fs.writeFileSync(inv, before); else fs.rmSync(inv, { force: true }) // the inventory is the converter's file: leave it as it was
  return [...new Set((out?.screens || []).map((x) => x.route).filter((x) => x && !/[:*[]/.test(x)))].sort()
}

function derived(spec) {
  const out = []; const d = spec.derive || {}
  const auth = readJson(path.join(dir, 'auth', 'auth.json'))
  const both = [...(spec.web ? ['web'] : []), ...(spec.mobile ? ['mobile'] : [])]
  if (d.auth !== false && auth && both.length) {
    const R = auth.routes; const has = (m) => auth.methods.includes(m)
    const protectedRoute = [R.afterSignIn, spec.routes?.account].find((p) => p && !isPublic(auth, p))
    if (protectedRoute) out.push({ id: 'auth-protected-redirect', title: 'Auth — a protected page asks to sign in', origin: 'auth', tags: ['auth'], platforms: both, steps: [{ open: protectedRoute }, { see: 't:auth.ui.sign_in_title' }, { url: R.signIn }] })
    if (has('email')) {
      out.push({ id: 'auth-wrong-password', title: 'Auth — wrong password shows the error', origin: 'auth', tags: ['auth'], platforms: both, steps: [{ open: R.signIn }, { fill: 't:auth.ui.email', with: 'nobody@example.com' }, { fill: 't:auth.ui.password', with: 'wrong-Password-123' }, { tap: 't:auth.ui.sign_in' }, { see: 't:auth.errors.invalid_credentials' }] })
      out.push({ id: 'auth-sign-up-validation', title: 'Auth — sign-up explains the password policy', origin: 'auth', tags: ['auth'], platforms: both, steps: [{ open: R.signIn }, { tap: 't:auth.ui.no_account' }, { fill: 't:auth.ui.password', with: 'a' }, { see: { t: 'auth.password.too_short', min: auth.password?.minLength ?? 8 } }] })
      out.push({ id: 'auth-sign-in', title: 'Auth — sign in with the test account', origin: 'auth', tags: ['auth'], platforms: both, requires: ['E2E_EMAIL', 'E2E_PASSWORD'], steps: [{ open: R.signIn }, { fill: 't:auth.ui.email', with: 'env:E2E_EMAIL' }, { fill: 't:auth.ui.password', with: 'env:E2E_PASSWORD' }, { tap: 't:auth.ui.sign_in' }, { notSee: 't:auth.ui.sign_in_title' }, { url: R.afterSignIn }, { noErrors: true }] })
      out.push({ id: 'auth-sign-up-delete', title: 'Auth — new account, then delete it', origin: 'auth', tags: ['auth', 'destructive'], platforms: both, requires: ['E2E_ALLOW_SIGNUP'], steps: [{ open: R.signIn }, { tap: 't:auth.ui.no_account' }, { fill: 't:auth.ui.display_name', with: 'E2E' }, { fill: 't:auth.ui.email', with: 'unique-email' }, { fill: 't:auth.ui.password', with: 'E2e-Passw0rd!' + 'x'.repeat(Math.max(0, (auth.password?.minLength ?? 8) - 13)) }, { tap: 't:auth.ui.sign_up' }, { notSee: 't:auth.ui.sign_up_title' }, { open: spec.routes?.account || '/account' }, { tap: 't:auth.ui.delete_account' }, { tap: 't:auth.ui.delete_confirm' }, { notSee: 't:auth.ui.account_title' }] })
    }
    if (auth.guest) out.push({ id: 'auth-guest', title: 'Auth — continue as guest', origin: 'auth', tags: ['auth'], platforms: both, steps: [{ open: R.signIn }, { tap: 't:auth.ui.continue_guest' }, { notSee: 't:auth.ui.sign_in_title' }] })
  }
  if (d.smoke !== false) {
    if (web) for (const r of routesOf(web)) out.push({ id: 'smoke-web-' + (r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'), title: `Smoke — ${r} opens`, origin: 'smoke', tags: ['smoke'], platforms: ['web'], steps: [{ open: r }, ...(isPublic(auth, r) ? [{ url: r }] : [{ url: auth.routes.signIn }]), { noErrors: true }] })
    if (spec.mobile) { const routes = [...new Set(mobiles.flatMap(routesOf))]; for (const r of routes) out.push({ id: 'smoke-app-' + (r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'), title: `Smoke — app ${r} opens`, origin: 'smoke', tags: ['smoke'], platforms: ['mobile'], steps: [{ open: r }] }) }
  }
  const products = readJson(path.join(dir, 'payments', 'products.json'))
  if (d.payments !== false && products?.products?.length && spec.mobile) out.push({ id: 'payments-paywall', title: 'Payments — the paywall lists every product', origin: 'payments', tags: ['payments'], platforms: ['mobile'], requires: ['E2E_EMAIL', 'E2E_PASSWORD'], steps: [{ open: spec.routes?.paywall || '/paywall' }, ...products.products.map((p) => ({ see: { id: 'product-' + p.id } })), { tap: { id: 'product-' + products.products[0].id } }] })
  const shots = readJson(path.join(dir, 'store', 'screenshots.json'))
  if (d.screenshots !== false && shots?.screens?.length) {
    const webShots = shots.screens.filter((s) => s.web)
    const appShots = shots.screens.filter((s) => s.android || s.ios)
    if (webShots.length && spec.web) out.push({ id: 'store-screenshots-web', title: 'Store screenshots — web', origin: 'screenshots', tags: ['screenshots'], platforms: ['web'], steps: webShots.flatMap((s) => [{ open: s.web }, { screenshot: s.name }]) })
    if (appShots.length && spec.mobile) out.push({ id: 'store-screenshots-app', title: 'Store screenshots — app', origin: 'screenshots', tags: ['screenshots'], platforms: ['mobile'], keepState: true, steps: appShots.flatMap((s) => [{ open: s.android || s.ios }, { screenshot: s.name }]) })
  }
  return out
}
/** Derived flows replace their previous version unless "locked": true; flows without an origin are the user's. */
function sync(spec) {
  const fresh = derived(spec); const kept = spec.flows.filter((f) => !f.origin || f.locked)
  const ids = new Set(kept.map((f) => f.id))
  return { ...spec, flows: [...kept, ...fresh.filter((f) => !ids.has(f.id))] }
}

// ---------------------------------------------------------------- validate + generate
function validate(spec) {
  const errors = []; const seen = new Set()
  for (const f of spec.flows) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(f.id || '')) errors.push(`flow "${f.id}": id must be kebab-case`)
    if (seen.has(f.id)) errors.push(`flow "${f.id}" is declared twice`); seen.add(f.id)
    for (const p of f.platforms || []) if (!['web', 'mobile'].includes(p)) errors.push(`${f.id}: platform "${p}" must be web or mobile`)
    if (!Array.isArray(f.steps) || !f.steps.length) { errors.push(`${f.id}: no steps`); continue }
    f.steps.forEach((s, i) => {
      const ks = Object.keys(s).filter((k) => k !== 'with')
      if (ks.length !== 1 || !G.STEP_KINDS.includes(ks[0])) errors.push(`${f.id} step ${i + 1}: one of ${G.STEP_KINDS.join(', ')} (got ${ks.join(', ') || 'nothing'})`)
      if ('fill' in s && s.with === undefined) errors.push(`${f.id} step ${i + 1}: fill needs "with"`)
    })
  }
  return errors
}
const forWeb = (f) => (f.platforms || ['web', 'mobile']).includes('web')
const forMobile = (f) => (f.platforms || ['web', 'mobile']).includes('mobile')
function outputs(spec) {
  const files = []
  const raw = (platformDir) => posix(path.relative(platformDir, path.join(dir, 'store', 'screenshots', 'raw', spec.locale || defLocale)))
  if (spec.web && web) {
    const e2eDir = path.join(web.dir, 'e2e', 'dualcraft')
    files.push({ file: path.join(e2eDir, 'support.ts'), text: stamp(G.playwrightSupport) })
    for (const f of spec.flows.filter(forWeb)) files.push({ file: path.join(e2eDir, f.id + '.spec.ts'), text: stamp(G.playwrightSpec(f, { tr, rawDir: posix(path.relative(web.dir, path.join(dir, 'store', 'screenshots', 'raw', spec.locale || defLocale, 'web'))) })) })
  }
  if (spec.mobile) for (const s of mobiles) {
    const mdir = path.join(s.dir, '.maestro', 'dualcraft')
    for (const f of spec.flows.filter(forMobile)) files.push({ file: path.join(mdir, f.id + '.yaml'), text: stamp(G.maestroFlow(f, { tr, appId: spec.mobile.appIds?.[s.id] || spec.mobile.appId, scheme: spec.mobile.scheme, rawDir: raw(s.dir) }), 'hash') })
  }
  return files
}
function generate(spec, force) {
  const errors = validate(spec)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix flows.json first.') }
  const written = []
  const files = outputs(spec)
  for (const o of files) written.push(writeGuarded(o.file, o.text, { root, force }))
  // generated flows that no longer exist
  for (const d of [...new Set(files.map((o) => path.dirname(o.file)))]) for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (!files.some((o) => o.file === p) && /^(\/\/|#) dualcraft:hash=/.test(read(p))) { fs.rmSync(p); written.push(rel(p) + ' (removed: flow gone)') }
  }
  if (spec.web && web) {
    written.push(writeNew(path.join(web.dir, 'playwright.config.ts'), G.playwrightConfig({ baseUrl: spec.web.baseUrl, startCommand: spec.web.startCommand })))
    const pj = path.join(web.dir, 'package.json'); const pkg = readJson(pj)
    if (pkg && !pkg.devDependencies?.['@playwright/test'] && !pkg.dependencies?.['@playwright/test']) {
      pkg.devDependencies = { ...pkg.devDependencies, '@playwright/test': '^1.57.0' }
      pkg.scripts = { ...pkg.scripts, 'test:e2e': pkg.scripts?.['test:e2e'] || 'playwright test' }
      fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n'); written.push(`${rel(pj)}: @playwright/test + "test:e2e" (run npm install && npx playwright install)`)
    }
    const gi = path.join(web.dir, '.gitignore')
    if (fs.existsSync(gi) && !/playwright-report/.test(read(gi))) { fs.appendFileSync(gi, '\n# Playwright\n/test-results/\n/playwright-report/\n/blob-report/\n'); written.push(rel(gi) + ': Playwright outputs') }
  }
  if (spec.mobile) for (const s of mobiles) written.push(writeNew(path.join(s.dir, '.maestro', 'config.yaml'), G.maestroConfig))
  return written.filter(Boolean)
}
const load = () => readJson(file) || die(`no ${rel(file)} — run: e2e.mjs init`)
const save = (spec) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n') }
const summary = (spec) => { const by = {}; for (const f of spec.flows) by[f.origin || 'custom'] = (by[f.origin || 'custom'] || 0) + 1; return Object.entries(by).map(([k, v]) => `${v} ${k}`).join(' · ') }

if (cmd === 'init' || cmd === 'gen') {
  if (!stacks.length) die('no stacks in .dualcraft/config.json')
  const exists = fs.existsSync(file)
  let spec = exists ? load() : defaults()
  spec = sync(spec); save(spec)
  console.log(`${exists ? 'updated' : 'created'} ${rel(file)} — ${spec.flows.length} flows (${summary(spec)})`)
  for (const w of generate(spec, !!opt.force)) console.log('→ ' + w)
  if (missingKeys.size) console.log(`⚠ i18n keys not found in ${defLocale}.json (used as literal text): ${[...missingKeys].slice(0, 6).join(', ')}`)
  if (cmd === 'init') console.log(`\nNext: secrets E2E_EMAIL / E2E_PASSWORD (a test account) for the signed-in flows; web: npm install && npx playwright install, then e2e.mjs run --platform web; mobile: install Maestro (https://maestro.dev), start an emulator/simulator with the app, then e2e.mjs run --platform android. Give the paywall products testID "product-<id>".`)
  process.exit(0)
}

if (cmd === 'run') {
  const spec = load(); const platform = String(opt.platform || 'web')
  const env = { ...process.env }
  if (platform === 'web') {
    if (!web) die('no web stack')
    const args = ['playwright', 'test', 'e2e/dualcraft', ...(opt.tag ? ['--grep', '@' + opt.tag] : []), ...(opt['update-snapshots'] ? ['--update-snapshots'] : [])]
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: web.dir, stdio: 'inherit', env, shell: process.platform === 'win32' })
    process.exit(r.status ?? 1)
  }
  const s = mobiles[0] || die('no mobile stack')
  const flows = spec.flows.filter(forMobile)
  const missing = flows.flatMap((f) => G.flowEnv(f).filter((e) => !process.env[e]).map((e) => `${f.id} (${e})`))
  const skip = new Set(flows.filter((f) => G.flowEnv(f).some((e) => !process.env[e])).map((f) => f.id))
  if (missing.length) console.log(`skipped (missing env): ${missing.join(', ')}`)
  const files = flows.filter((f) => !skip.has(f.id) && (!opt.tag || (f.tags || []).includes(String(opt.tag)))).map((f) => path.join('.maestro', 'dualcraft', f.id + '.yaml'))
  if (!files.length) die('no flows to run')
  const vars = ['E2E_EMAIL', 'E2E_PASSWORD'].filter((e) => process.env[e]).flatMap((e) => ['-e', `${e}=${process.env[e]}`])
  const r = spawnSync('maestro', ['test', ...vars, ...files], { cwd: s.dir, stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (r.error) die('maestro not found — install it: https://maestro.dev (curl -fsSL "https://get.maestro.mobile.dev" | bash)')
  process.exit(r.status ?? 1)
}

// ---------------------------------------------------------------- check
const spec = load()
const issues = validate(spec).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
if (!issues.length) {
  const fresh = sync(spec)
  const drift = [...fresh.flows.filter((f) => f.origin && JSON.stringify(f) !== JSON.stringify(spec.flows.find((x) => x.id === f.id))), ...spec.flows.filter((f) => f.origin && !f.locked && !fresh.flows.some((x) => x.id === f.id))]
  if (drift.length) err(`derived flows out of date (${drift.map((f) => f.id).slice(0, 4).join(', ')}) — run: e2e.mjs gen`)
  for (const o of outputs(spec)) if (read(o.file) !== o.text) err(`${rel(o.file)} out of date — run: e2e.mjs gen`)
  if (missingKeys.size) err(`texts not in ${defLocale}.json: ${[...missingKeys].slice(0, 6).join(', ')}`)
}
if (spec.web && web) {
  const pkg = readJson(path.join(web.dir, 'package.json'))
  if (pkg && !pkg.devDependencies?.['@playwright/test'] && !pkg.dependencies?.['@playwright/test']) err(`${rel(web.dir)}/package.json lacks @playwright/test — run: e2e.mjs gen`)
  const wf = path.join(root, '.github', 'workflows')
  const ci = fs.existsSync(wf) ? fs.readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => read(path.join(wf, f))).join('\n') : ''
  if (!/playwright/.test(ci)) warn('CI: no Playwright job — run /dualcraft:deploy gen (adds an e2e job per web stack) or add one')
}
if (spec.flows.some((f) => G.flowEnv(f).some((e) => /^E2E_(EMAIL|PASSWORD)$/.test(e)))) warn('signed-in flows need a test account: E2E_EMAIL / E2E_PASSWORD (repository secrets for CI; never a real user)')
if (spec.flows.some((f) => f.id === 'payments-paywall')) warn(`payments-paywall: give each product tile testID "product-<id>" and use a license-tester / sandbox account; the store sheet itself is not automated`)
if (spec.mobile && /example/.test(spec.mobile.appId)) err('mobile.appId is a placeholder — set your application id in flows.json')
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`E2E — ${spec.flows.length} flows (${summary(spec)}) · web: ${spec.web ? rel(path.join(root, spec.web.dir || '.')) : '—'} · mobile: ${spec.mobile?.appId || '—'}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `e2e OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
