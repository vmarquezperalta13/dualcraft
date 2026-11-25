#!/usr/bin/env node
// Performance budgets runner (DualCraft perf) — self-contained (Node 18+, no dependencies), runs in CI and locally.
// Budgets: .dualcraft/perf/budgets.json · results: .dualcraft/perf/results/<kind>.json · startup history: history.json
//   bundle <stack> <dir>                    JS/CSS gzip of a web build (total, largest chunks, per route for Next.js)
//   lighthouse <baseUrl> [--runs 3]         Lighthouse (mobile) on budgets.web.routes: score, LCP, CLS, TBT (median)
//   app-size <file>...                      APK / AAB / IPA sizes
//   startup android <package> [--runs 5]    cold start with adb (am start -W TotalTime), median
//   startup flutter <start_up_info.json>    timeToFirstFrame from flutter run --profile --trace-startup
//   startup ios --value <ms>                a measured value (XCTest launch metric) to record
// Over budget (+ tolerance) → GitHub warning annotations (mode "warn") or failure (mode "fail"); table in the job summary.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const DIR = path.join(ROOT, '.dualcraft', 'perf')
const budgets = JSON.parse(fs.readFileSync(path.join(DIR, 'budgets.json'), 'utf8'))
const tolerance = budgets.tolerance ?? 0.05
const [cmd, ...args] = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1] }
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const kb = (n) => Math.round(n / 102.4) / 10
const walk = (d, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p) } return out }
const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length

/** rows: [{ metric, value, budget, unit, lowerIsBetter = true }] → over-budget rows, summary and annotations. */
function report(kind, rows, extra = []) {
  const over = rows.filter((r) => r.budget != null && r.value != null && (r.higherIsBetter ? r.value < r.budget * (1 - tolerance) : r.value > r.budget * (1 + tolerance)))
  const fmt = (v, u) => (v == null ? '—' : `${v}${u ? ' ' + u : ''}`)
  const md = [`### Performance — ${kind}`, '', '| Metric | Value | Budget | |', '|---|---|---|---|', ...rows.map((r) => `| ${r.metric} | ${fmt(r.value, r.unit)} | ${r.budget == null ? '—' : (r.higherIsBetter ? '≥ ' : '≤ ') + fmt(r.budget, r.unit)} | ${over.includes(r) ? '⚠️ over' : r.budget == null ? '' : '✅'} |`), ...extra, '']
  console.log(md.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n')
  const level = budgets.mode === 'fail' ? 'error' : 'warning'
  for (const r of over) console.log(`::${level} title=Performance budget (${kind})::${r.metric} = ${fmt(r.value, r.unit)} (budget ${fmt(r.budget, r.unit)}, tolerance ${Math.round(tolerance * 100)}%)`)
  fs.mkdirSync(path.join(DIR, 'results'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'results', kind + '.json'), JSON.stringify({ kind, date: new Date().toISOString(), sha: process.env.GITHUB_SHA || null, rows, over: over.map((r) => r.metric) }, null, 2) + '\n')
  if (over.length && budgets.mode === 'fail') process.exitCode = 1
}

// ---------------------------------------------------------------- web bundle
function bundle(stack, dir) {
  const b = budgets.web?.bundle || {}
  const outDirs = { nextjs: ['.next/static'], nuxt: ['.output/public/_nuxt'], astro: ['dist'], 'react-vite': ['dist'] }[stack] || ['dist']
  const files = outDirs.flatMap((d) => walk(path.join(dir, d))).filter((f) => /\.(m?js|css)$/.test(f) && !/\.map$/.test(f))
  if (!files.length) { console.log(`::warning title=Performance budget::no build output in ${outDirs.map((d) => path.join(dir, d)).join(', ')} — run the build first`); return }
  const sized = files.map((f) => ({ f, gz: gz(f), css: f.endsWith('.css') }))
  const js = sized.filter((x) => !x.css); const css = sized.filter((x) => x.css)
  const rows = [
    { metric: 'JS total (gzip)', value: kb(js.reduce((a, x) => a + x.gz, 0)), budget: b.totalJsKb, unit: 'KB' },
    { metric: 'CSS total (gzip)', value: kb(css.reduce((a, x) => a + x.gz, 0)), budget: b.totalCssKb, unit: 'KB' },
    { metric: 'Largest JS chunk (gzip)', value: kb(Math.max(0, ...js.map((x) => x.gz))), budget: b.chunkJsKb, unit: 'KB' },
  ]
  // Next.js App Router: JS each route loads on first visit
  const manifest = path.join(dir, '.next', 'app-build-manifest.json')
  if (stack === 'nextjs' && fs.existsSync(manifest)) {
    const pages = JSON.parse(fs.readFileSync(manifest, 'utf8')).pages || {}
    for (const [page, list] of Object.entries(pages)) {
      if (!/\/page$/.test(page)) continue
      const route = page.replace(/\/page$/, '').replace(/\/\([^)]*\)/g, '') || '/'
      const total = list.filter((f) => f.endsWith('.js')).reduce((a, f) => { const p = path.join(dir, '.next', f); return a + (fs.existsSync(p) ? gz(p) : 0) }, 0)
      rows.push({ metric: `JS for ${route} (gzip)`, value: kb(total), budget: b.routeJsKb, unit: 'KB' })
    }
  }
  const top = js.sort((a, b2) => b2.gz - a.gz).slice(0, 5).map((x) => `- ${path.relative(dir, x.f).replace(/\\/g, '/')} — ${kb(x.gz)} KB`)
  report('web-bundle', rows, ['', 'Largest chunks:', ...top])
}

// ---------------------------------------------------------------- Lighthouse
function lighthouse(baseUrl) {
  const w = budgets.web?.lighthouse || {}
  const runs = Number(flag('runs', 3))
  const rows = []
  for (const route of budgets.web?.routes || ['/']) {
    const url = new URL(route, baseUrl).toString(); const got = []
    for (let i = 0; i < runs; i++) {
      const out = path.join(DIR, 'results', 'lh.json'); fs.mkdirSync(path.dirname(out), { recursive: true })
      const lh = ['-y', 'lighthouse@12.6.0', url, '--quiet', '--output=json', `--output-path=${out}`, '--only-categories=performance', '--form-factor=mobile', '--chrome-flags=--headless=new --no-sandbox']
      // Windows: npx is a .cmd, which needs a shell — pass one quoted command line
      const r = process.platform === 'win32' ? spawnSync(['npx', ...lh].map((a) => `"${a}"`).join(' '), { stdio: 'inherit', shell: true }) : spawnSync('npx', lh, { stdio: 'inherit' })
      if (r.status !== 0 || !fs.existsSync(out)) { console.log(`::warning title=Performance budget::Lighthouse failed on ${url}`); continue }
      const j = JSON.parse(fs.readFileSync(out, 'utf8')); fs.rmSync(out)
      got.push({ score: j.categories.performance.score, lcp: j.audits['largest-contentful-paint'].numericValue, cls: j.audits['cumulative-layout-shift'].numericValue, tbt: j.audits['total-blocking-time'].numericValue })
    }
    if (!got.length) continue
    const m = (k) => median(got.map((g) => g[k]))
    rows.push({ metric: `${route} performance score`, value: Math.round(m('score') * 100), budget: w.score, unit: '', higherIsBetter: true },
      { metric: `${route} LCP`, value: Math.round(m('lcp')), budget: w.lcpMs, unit: 'ms' },
      { metric: `${route} CLS`, value: Math.round(m('cls') * 1000) / 1000, budget: w.cls, unit: '' },
      { metric: `${route} TBT`, value: Math.round(m('tbt')), budget: w.tbtMs, unit: 'ms' })
  }
  report('web-lighthouse', rows, ['', `Lighthouse 12 · mobile emulation · median of ${runs} run(s)`])
}

// ---------------------------------------------------------------- app size
function appSize(files) {
  const m = budgets.mobile?.size || {}
  const rows = files.filter((f) => fs.existsSync(f)).map((f) => {
    const ext = path.extname(f).slice(1).toLowerCase()
    return { metric: `${path.basename(f)}`, value: Math.round(fs.statSync(f).size / 104857.6) / 10, budget: { apk: m.apkMb, aab: m.aabMb, ipa: m.ipaMb }[ext], unit: 'MB' }
  })
  if (!rows.length) { console.log(`::warning title=Performance budget::no app file found (${files.join(', ')})`); return }
  report('app-size', rows)
}

// ---------------------------------------------------------------- startup
function record(platform, ms) {
  const f = path.join(DIR, 'history.json')
  const h = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
  let sha = null; try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
  const prev = [...h].reverse().find((x) => x.platform === platform)
  h.push({ date: new Date().toISOString().slice(0, 10), sha, platform, startupMs: ms })
  fs.writeFileSync(f, JSON.stringify(h, null, 2) + '\n')
  report(`startup-${platform}`, [{ metric: `${platform} cold start`, value: ms, budget: budgets.mobile?.startupMs?.[platform], unit: 'ms' }], prev ? ['', `Previous: ${prev.startupMs} ms (${prev.date}${prev.sha ? ', ' + prev.sha : ''}) → ${ms - prev.startupMs >= 0 ? '+' : ''}${ms - prev.startupMs} ms`] : [])
}
function startup(platform) {
  if (platform === 'android') {
    const pkg = pos[1] || budgets.mobile?.androidPackage
    if (!pkg) throw new Error('startup android <package>')
    const times = []
    for (let i = 0; i < Number(flag('runs', 5)); i++) {
      execFileSync('adb', ['shell', 'am', 'force-stop', pkg])
      const out = execFileSync('adb', ['shell', 'am', 'start', '-W', '-S', `${pkg}/${flag('activity', '.MainActivity')}`], { encoding: 'utf8' })
      const t = Number((out.match(/TotalTime:\s*(\d+)/) || [])[1]); if (t) times.push(t)
    }
    return record('android', median(times))
  }
  if (platform === 'flutter') {
    const info = JSON.parse(fs.readFileSync(pos[1] || 'build/start_up_info.json', 'utf8'))
    return record('flutter', Math.round((info.timeToFirstFrameMicros ?? info.timeToFirstFrameRasterizedMicros) / 1000))
  }
  if (platform === 'ios') return record('ios', Number(flag('value')))
  throw new Error('startup android|flutter|ios')
}

if (cmd === 'bundle') bundle(pos[0], path.resolve(pos[1] || '.'))
else if (cmd === 'lighthouse') lighthouse(pos[0] || 'http://localhost:3000')
else if (cmd === 'app-size') appSize(pos)
else if (cmd === 'startup') startup(pos[0])
else { console.log('node .dualcraft/perf/perf-check.mjs bundle <stack> <dir> | lighthouse <baseUrl> [--runs 3] | app-size <file>... | startup android <pkg> | startup flutter <start_up_info.json> | startup ios --value <ms>'); process.exitCode = cmd ? 1 : 0 }
