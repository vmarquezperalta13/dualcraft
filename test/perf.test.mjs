// Performance budgets: budgets.json + self-contained runner (bundle, app size, startup), warnings vs failure, CI jobs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { run, makeProject, write, read, exists } from './helpers.mjs'

const perf = (p, ...a) => run('perf.mjs', a, p)
const runner = (p, args, env = {}) => { const r = spawnSync(process.execPath, [path.join(p, '.dualcraft/perf/perf-check.mjs'), ...args], { cwd: p, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } }); return { code: r.status, out: r.stdout + r.stderr } }
const noise = (kb) => crypto.randomBytes(kb * 1024).toString('base64') // incompressible-ish

function setup() {
  const p = makeProject({ web: 'react-vite', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  write(path.join(p, 'site', 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'vite build' } }))
  write(path.join(p, 'app', 'pubspec.yaml'), 'name: app\n')
  return p
}

test('init writes budgets with defaults and the runner; bundle and app size warn over budget (exit 0)', () => {
  const p = setup()
  const r = perf(p, 'init', '--routes', '/,/precios')
  assert.equal(r.code, 0, r.err)
  const b = JSON.parse(read(path.join(p, '.dualcraft/perf/budgets.json')))
  assert.deepEqual(b.web.routes, ['/', '/precios']); assert.equal(b.mode, 'warn'); assert.equal(b.web.lighthouse.lcpMs, 2500); assert.equal(b.mobile.size.aabMb, 40)
  assert.match(read(path.join(p, '.dualcraft/perf/perf-check.mjs')), /^\/\/ dualcraft:hash=/)
  write(path.join(p, '.dualcraft/perf/budgets.json'), JSON.stringify({ ...b, web: { ...b.web, bundle: { ...b.web.bundle, totalJsKb: 50, chunkJsKb: 150 } } }))
  write(path.join(p, 'site/dist/assets/index-abc.js'), noise(90)); write(path.join(p, 'site/dist/assets/vendor-def.js'), noise(20)); write(path.join(p, 'site/dist/assets/index.css'), 'body{color:red}')
  const bu = runner(p, ['bundle', 'react-vite', 'site'])
  assert.equal(bu.code, 0, bu.out)
  assert.match(bu.out, /\| JS total \(gzip\) \| \d+(\.\d)? KB \| ≤ 50 KB \| ⚠️ over \|/); assert.match(bu.out, /::warning title=Performance budget \(web-bundle\)::JS total/)
  assert.match(bu.out, /Largest chunks:\n- dist\/assets\/index-abc\.js/)
  assert.deepEqual(JSON.parse(read(path.join(p, '.dualcraft/perf/results/web-bundle.json'))).over, ['JS total (gzip)'])
  write(path.join(p, 'out/app-release.aab'), Buffer.alloc(3 * 1024 * 1024))
  assert.match(runner(p, ['app-size', 'out/app-release.aab']).out, /\| app-release\.aab \| 3 MB \| ≤ 40 MB \| ✅ \|/)
  const c = perf(p, 'check')
  assert.equal(c.code, 0, c.out)
  for (const re of [/no performance job for the web/, /does not report the app size/, /no measurement recorded yet/, /last web-bundle run .*over budget — JS total/]) assert.match(c.out, re)
})

test('mode fail exits 1; startup history keeps the previous value; validation', () => {
  const p = setup()
  perf(p, 'init', '--mode', 'fail')
  write(path.join(p, 'build/start_up_info.json'), JSON.stringify({ timeToFirstFrameMicros: 1720000 }))
  const s = runner(p, ['startup', 'flutter', 'build/start_up_info.json'])
  assert.equal(s.code, 1, s.out); assert.match(s.out, /::error title=Performance budget \(startup-flutter\)::flutter cold start = 1720 ms/)
  const s2 = runner(p, ['startup', 'ios', '--value', '640'])
  assert.equal(s2.code, 0, s2.out)
  const s3 = runner(p, ['startup', 'flutter', 'build/start_up_info.json'])
  assert.match(s3.out, /Previous: 1720 ms .* → \+0 ms/)
  assert.equal(JSON.parse(read(path.join(p, '.dualcraft/perf/history.json'))).length, 3)
  // a hand-edited runner is refused; bad budgets are reported
  write(path.join(p, '.dualcraft/perf/budgets.json'), JSON.stringify({ mode: 'loud', tolerance: 2, web: { routes: ['precios'], lighthouse: { score: 120, lcpMs: -1 } } }))
  const v = perf(p, 'check')
  assert.equal(v.code, 1)
  for (const re of [/mode must be "warn" or "fail"/, /tolerance must be/, /web\.lighthouse\.lcpMs must be a positive number/, /"precios" must start with \//, /score is 0–100/]) assert.match(v.out, re)
})

test('deploy adds the web perf job and the app-size step of the mobile release', () => {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  write(path.join(p, 'site', 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'next build', start: 'next start' } }))
  write(path.join(p, 'app', 'pubspec.yaml'), 'name: app\n')
  write(path.join(p, 'app', 'android', 'app', 'build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.app" } }\n')
  assert.equal(perf(p, 'init').code, 0)
  assert.equal(run('deploy.mjs', ['init', '--host', 'vercel'], p).code, 0)
  const ci = read(path.join(p, '.github/workflows/dualcraft-ci.yml'))
  assert.match(ci, /perf-nextjs:[\s\S]*perf-check\.mjs bundle nextjs site[\s\S]*npm run start > "\$RUNNER_TEMP\/app\.log" 2>&1 &\) && npx -y wait-on@8\.0\.1 -t 120000 http:\/\/localhost:3000[\s\S]*perf-check\.mjs lighthouse http:\/\/localhost:3000/)
  assert.match(read(path.join(p, '.github/workflows/dualcraft-release-mobile.yml')), /perf-check\.mjs app-size app\/build\/app\/outputs\/bundle\/release\/app-release\.aab/)
  const c = perf(p, 'check')
  assert.doesNotMatch(c.out, /no performance job|does not report the app size/)
  assert.ok(exists(path.join(p, '.dualcraft/perf/.gitignore')))
})
