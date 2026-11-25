#!/usr/bin/env node
// DualCraft performance budgets: .dualcraft/perf/budgets.json (web Core Web Vitals + bundle, app size, cold start)
// and a self-contained runner copied into the repo (.dualcraft/perf/perf-check.mjs) that CI and you run.
//   init [--routes /,/login] [--mode warn|fail]   budgets with sensible defaults + the runner
//   gen [--force]                                  refresh the runner (budgets are yours to edit)
//   check [--json]                                 budgets valid, runner current, CI jobs, last results
//   run bundle|lighthouse|app-size|startup …       the runner, locally (same arguments)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks } from './lib/targets.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check', 'run'].includes(cmd)) {
  console.log('node perf.mjs init [--routes /,/login] [--mode warn|fail] | gen [--force] | check [--json] | run bundle|lighthouse|app-size|startup …')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const pdir = path.join(dir, 'perf')
const budgetsFile = path.join(pdir, 'budgets.json')
const runnerFile = path.join(pdir, 'perf-check.mjs')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config)
const web = stacks.find((s) => s.kind === 'web')
const mobiles = stacks.filter((s) => s.kind === 'mobile')
const runnerText = () => stamp(read(path.join(HERE, 'lib', 'perf-runner.mjs')).replace(/^#!.*\n/, ''))

/** Public routes worth measuring: the e2e smoke flows that stay on their page, else "/" and the sign-in page. */
function defaultRoutes() {
  if (opt.routes) return String(opt.routes).split(',').map((s) => s.trim()).filter(Boolean)
  const flows = readJson(path.join(dir, 'e2e', 'flows.json'))?.flows || []
  const smoke = flows.filter((f) => f.origin === 'smoke' && (f.platforms || []).includes('web')).filter((f) => f.steps[0]?.open && f.steps.some((s) => s.url === f.steps[0].open)).map((f) => f.steps[0].open)
  const auth = readJson(path.join(dir, 'auth', 'auth.json'))
  return [...new Set(smoke.length ? smoke.slice(0, 5) : ['/', ...(auth ? [auth.routes.signIn] : [])])]
}
function defaults() {
  return {
    mode: opt.mode === 'fail' ? 'fail' : 'warn',
    tolerance: 0.05,
    web: web ? {
      routes: defaultRoutes(),
      // Google "good" thresholds (mobile, lab): score ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms
      lighthouse: { score: 90, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      bundle: { totalJsKb: 350, chunkJsKb: 150, routeJsKb: 200, totalCssKb: 60 },
    } : null,
    mobile: mobiles.length ? { size: { apkMb: 40, aabMb: 40, ipaMb: 80 }, startupMs: { android: 1500, ios: 1000, flutter: 1500 } } : null,
  }
}
const NUM = { web: { lighthouse: ['score', 'lcpMs', 'cls', 'tbtMs'], bundle: ['totalJsKb', 'chunkJsKb', 'routeJsKb', 'totalCssKb'] }, mobile: { size: ['apkMb', 'aabMb', 'ipaMb'], startupMs: ['android', 'ios', 'flutter'] } }
function validate(b) {
  const errors = []
  if (!['warn', 'fail'].includes(b.mode)) errors.push('mode must be "warn" or "fail"')
  if (typeof b.tolerance !== 'number' || b.tolerance < 0 || b.tolerance > 0.5) errors.push('tolerance must be a number between 0 and 0.5 (e.g. 0.05 = 5 %)')
  for (const [area, groups] of Object.entries(NUM)) for (const [g, keys] of Object.entries(groups)) for (const k of keys) {
    const v = b[area]?.[g]?.[k]
    if (v !== undefined && v !== null && !(typeof v === 'number' && v > 0)) errors.push(`${area}.${g}.${k} must be a positive number (or null to skip)`)
  }
  if (b.web) for (const r of b.web.routes || []) if (!String(r).startsWith('/')) errors.push(`web.routes: "${r}" must start with /`)
  if (b.web?.lighthouse?.score > 100) errors.push('web.lighthouse.score is 0–100')
  return errors
}

if (cmd === 'init' || cmd === 'gen') {
  if (!stacks.length) die('no stacks in .dualcraft/config.json')
  const existed = fs.existsSync(budgetsFile)
  if (!existed) { fs.mkdirSync(pdir, { recursive: true }); fs.writeFileSync(budgetsFile, JSON.stringify(defaults(), null, 2) + '\n') }
  const b = readJson(budgetsFile) || die(`${rel(budgetsFile)} is not valid JSON`)
  const errors = validate(b)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix budgets.json first.') }
  console.log(`${existed ? 'kept' : 'created'} ${rel(budgetsFile)} (mode ${b.mode}, tolerance ${Math.round(b.tolerance * 100)} %)`)
  console.log('→ ' + writeGuarded(runnerFile, runnerText(), { root, force: !!opt.force }))
  const gi = path.join(pdir, '.gitignore')
  if (!fs.existsSync(gi)) { fs.writeFileSync(gi, 'results/\n'); console.log(`→ ${rel(gi)} (results stay out of git; history.json is kept)`) }
  if (cmd === 'init') console.log(`\nNext: /dualcraft:deploy gen adds a perf job per web stack (bundle + Lighthouse) and an app-size step to the mobile release; startup is measured locally:\n  Android: node .dualcraft/perf/perf-check.mjs startup android <applicationId>  (device/emulator, release build)\n  Flutter: flutter run --profile --trace-startup, then node .dualcraft/perf/perf-check.mjs startup flutter build/start_up_info.json\n  iOS:     XCTest launch metric → node .dualcraft/perf/perf-check.mjs startup ios --value <ms>`)
  process.exit(0)
}

if (cmd === 'run') {
  if (!fs.existsSync(runnerFile)) die('no runner yet — run: perf.mjs init')
  const r = spawnSync(process.execPath, [runnerFile, ...rest], { cwd: root, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

// ---------------------------------------------------------------- check
const b = readJson(budgetsFile) || die(`no ${rel(budgetsFile)} — run: perf.mjs init`)
const issues = validate(b).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
if (read(runnerFile) !== runnerText()) err(`${rel(runnerFile)} missing or out of date — run: perf.mjs gen`)
const wf = path.join(root, '.github', 'workflows')
const ci = fs.existsSync(wf) ? fs.readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => read(path.join(wf, f))).join('\n') : ''
if (b.web && web && !/perf-check\.mjs (bundle|lighthouse)/.test(ci)) warn('CI: no performance job for the web — run /dualcraft:deploy gen')
if (b.mobile && mobiles.length && !/perf-check\.mjs app-size/.test(ci)) warn('CI: the mobile release does not report the app size — run /dualcraft:deploy gen')
if (b.mobile?.startupMs && !fs.existsSync(path.join(pdir, 'history.json'))) warn('startup: no measurement recorded yet (measured locally — see perf.mjs init for the commands)')
for (const f of fs.existsSync(path.join(pdir, 'results')) ? fs.readdirSync(path.join(pdir, 'results')).filter((x) => x.endsWith('.json')) : []) {
  const r = readJson(path.join(pdir, 'results', f))
  if (r?.over?.length) warn(`last ${r.kind} run (${String(r.date).slice(0, 10)}): over budget — ${r.over.slice(0, 4).join(', ')}`)
}
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Performance budgets — mode ${b.mode} · web: ${b.web ? (b.web.routes || []).join(', ') : '—'} · mobile: ${b.mobile ? 'size + startup' : '—'}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `perf OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
