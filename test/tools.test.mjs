// Database, detector, converter, security, release, docs, map, GitHub sync.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { run, makeProject, makeMultiProject, read, write, exists } from './helpers.mjs'

test('database: initial migration with RLS, incremental diff, destructive changes flagged, Prisma relations', () => {
  const dir = makeProject({ schema: 'hockey', extra: { backend: { provider: 'supabase' } } })
  const schema = path.join(dir, '.dualcraft', 'db', 'schema.dbml')
  assert.equal(run('database.mjs', ['migration', 'init'], dir).code, 0)
  const migs = () => require_dir(path.join(dir, 'supabase', 'migrations'))
  const init = read(migs()[0])
  assert.match(init, /create type "position" as enum/)
  assert.match(init, /alter table "PlayoffRound" enable row level security/)
  write(schema, read(schema).replace('  logo varchar', '  logo varchar\n  city varchar [not null]').replace(/  description varchar\n/, '') + '\nTable Comment {\n  id uuid [pk]\n  user_id uuid [not null]\n}\n')
  const r = run('database.mjs', ['migration', 'changes'], dir)
  assert.match(r.out, /HockeyGame\.description removed — destructive/)
  assert.match(r.out, /HockeyTeam\.city is NOT NULL without default/)
  const diff = read(migs()[1])
  assert.match(diff, /alter table "HockeyTeam" add column "city" text not null/)
  assert.match(diff, /create policy "Comment_select_own"/)
  const statements = diff.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(statements, /drop column|drop table/i)
  assert.ok(require_dir(path.join(dir, 'supabase', 'migrations')).length === 2)
  assert.match(run('database.mjs', ['migration', 'again'], dir).out, /No schema changes/)
  const prisma = run('database.mjs', ['prisma', '--stdout'], dir).out
  assert.match(prisma, /hockeyGame HockeyGame @relation\("GameScores_id", fields: \[id\], references: \[id\]\)/)
  assert.match(prisma, /team1 HockeyTeam @relation\("HockeyGame_team1Id"/)
})
function require_dir(d) { return spawnSync(process.execPath, ['-e', `console.log(require('fs').readdirSync(${JSON.stringify(d)}).filter(f=>f.endsWith('.sql')).sort().map(f=>require('path').join(${JSON.stringify(d)},f)).join('\\n'))`], { encoding: 'utf8' }).stdout.trim().split('\n') }

test('detect: all stacks in a multi-stack folder, Supabase', () => {
  const dir = makeMultiProject()
  write(path.join(dir, 'supabase', 'config.toml'), '')
  const j = JSON.parse(run('detect.mjs', ['--json'], dir).out)
  assert.equal(j.web.stack, 'astro')
  assert.deepEqual(j.mobileAll.map((m) => m.stack).sort(), ['android', 'ios', 'kmp', 'react-native'])
  assert.equal(j.backend.supabase, true)
})

test('detect: platform folders inside a Flutter project are not separate apps', () => {
  const dir = makeProject()
  write(path.join(dir, 'pubspec.yaml'), 'name: app\nversion: 1.0.0+1\ndependencies:\n  flutter:\n    sdk: flutter\n')
  write(path.join(dir, 'macos', 'Runner.xcodeproj', 'x'), '')
  const j = JSON.parse(run('detect.mjs', ['--json'], dir).out)
  assert.deepEqual(j.mobileAll.map((m) => m.stack), ['flutter'])
})

test('convert: inventory per source stack and gates on pending backend decisions', () => {
  const dir = makeMultiProject()
  const rn = run('convert.mjs', ['inventory', '--from', 'react-native', '--to', 'astro'], dir).out
  assert.match(rn, /matches-id\s+\/matches\/:id/); assert.match(rn, /capability:camera-scanner/); assert.match(rn, /supabase:matches/)
  const kmp = run('convert.mjs', ['inventory', '--from', 'kmp', '--to', 'astro'], dir).out
  assert.match(kmp, /match-detail\s+\/matches\/:id/); assert.match(kmp, /capability:payments-iap/)
  assert.doesNotMatch(kmp.split('match-detail')[1].split('\n')[0], /events/)
  const ios = run('convert.mjs', ['inventory', '--from', 'ios', '--to', 'astro'], dir).out
  assert.match(ios, /match-list/); assert.doesNotMatch(ios, /\brow\b/)
  const astro = run('convert.mjs', ['inventory', '--from', 'astro', '--to', 'kmp'], dir).out
  assert.match(astro, /endpoint:\/api\/reserve\s+astro-endpoint recommended: move-to-functions/)
  assert.equal(run('convert.mjs', ['init', '--from', 'astro', '--to', 'kmp'], dir).code, 0)
  const set = run('convert.mjs', ['set', 'matches', 'generated'], dir)
  assert.equal(set.code, 1); assert.match(set.err, /backend decisions pending/)
  const same = run('convert.mjs', ['inventory', '--from', 'android', '--to', 'ios'], dir)
  assert.equal(same.code, 0)
})

test('security: scanner finds the classic holes and stays quiet on clean code', () => {
  const dir = makeProject({ web: 'nextjs', mobile: 'flutter' })
  write(path.join(dir, 'firestore.rules'), "rules_version = '2';\nservice cloud.firestore { match /databases/{d}/documents {\n match /{document=**} { allow read, write: if request.auth != null; }\n match /pub/{id} { allow read: if true; }\n} }\n")
  write(path.join(dir, '.env.local'), 'NEXT_PUBLIC_STRIPE_SECRET_KEY=x\nEXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=y\n')
  write(path.join(dir, 'functions', 'src', 'index.ts'), "export const grant = onCall(async (req) => ({ ok: true }))\n")
  write(path.join(dir, 'lib', 'x.dart'), "import 'package:shared_preferences/shared_preferences.dart';\nvoid s(p) { p.setString('auth_token', t); }\n")
  write(path.join(dir, 'supabase', 'migrations', '1_x.sql'), 'create table public.leaks (id int);\n')
  write(path.join(dir, 'pubspec.yaml'), 'name: a\ndependencies:\n  in_app_purchase: ^3.0.0\n')
  const out = run('security.mjs', ['--json'], dir).out
  const rules = JSON.parse(out).findings.map((f) => f.rule)
  for (const r of ['rules.open', 'rules.any-signed-in', 'web.public-secret-env', 'supabase.service-role-public', 'functions.oncall-no-auth', 'flutter.prefs-secret', 'supabase.no-rls', 'flutter.iap-client-only']) assert.ok(rules.includes(r), `missing ${r}`)
  // production lessons: emulator outside kDebugMode, region mismatch, IAP without complete/restore
  const p2 = makeProject({ mobile: 'flutter' })
  write(path.join(p2, 'functions', 'src', 'index.js'), 'const REGION = "europe-west1";\nexports.f = onCall({ region: REGION }, async (request) => { if (!request.auth) throw 1 })\n')
  write(path.join(p2, 'lib', 'main.dart'), "void setup() {\n  FirebaseFunctions.instance.useFunctionsEmulator('localhost', 5001);\n}\nvoid call() { FirebaseFunctions.instance.httpsCallable('f'); FirebaseFunctions.instanceFor(region: 'us-east1'); }\nvoid iap() { InAppPurchase.instance.purchaseStream.listen((p) {}); }\n")
  write(path.join(p2, 'lib', 'debug.dart'), "void ok() {\n  if (kDebugMode) {\n    FirebaseFirestore.instance.useFirestoreEmulator('localhost', 8080);\n  }\n}\n")
  write(path.join(p2, 'firestore.rules'), "service cloud.firestore { match /databases/{d}/documents { match /u/{id} { allow read: if request.auth != null; } } }\n")
  // fake keys for the scanner, assembled at run time so the source never holds a literal that secret scanners flag
  const fakeSendGrid = ['SG', 'abcdefghijklmnopqrstuv', 'abcdefghijklmnopqrstuvwxyz0123'].join('.')
  const fakeStripeWebhook = ['whsec', 'abcdefghijklmnopqrstuvwxyz012345'].join('_')
  write(path.join(p2, 'lib', 'keys.dart'), `const sg = '${fakeSendGrid}';\nconst wh = '${fakeStripeWebhook}';\n`)
  const f2 = JSON.parse(run('security.mjs', ['--json'], p2).out).findings
  const r2 = f2.map((f) => f.rule)
  for (const r of ['flutter.emulator-in-release', 'flutter.functions-default-region', 'flutter.functions-region-mismatch', 'flutter.iap-no-complete', 'flutter.iap-no-restore', 'rules.no-default-deny', 'secret.sendgrid', 'secret.stripe-webhook']) assert.ok(r2.includes(r), `missing ${r}`)
  assert.equal(f2.filter((f) => f.rule === 'flutter.emulator-in-release').length, 1, 'guarded emulator must not be reported')
  const clean = makeProject()
  write(path.join(clean, 'lib', 'main.dart'), "void main() { runApp(const App()); }\n")
  assert.equal(JSON.parse(run('security.mjs', ['--json', '--min', 'medium'], clean).out).findings.length, 0)
})

test('release: suggest from commits, bump every version, store text limits', () => {
  const dir = makeProject({ web: 'nextjs', mobile: 'flutter' })
  write(path.join(dir, 'pubspec.yaml'), 'name: a\nversion: 1.2.0+14\n')
  write(path.join(dir, 'package.json'), '{"name":"w","version":"1.1.0"}')
  write(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n### Added\n- algo\n')
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '-A'); g('commit', '-qm', 'chore: base'); g('tag', 'v1.2.0')
  g('commit', '-q', '--allow-empty', '-m', 'feat(shared): x'); g('commit', '-q', '--allow-empty', '-m', 'fix(mobile): y')
  assert.match(run('release.mjs', ['suggest'], dir).out, /Suggested: minor → 1\.3\.0/)
  assert.equal(run('release.mjs', ['bump'], dir).code, 0)
  assert.match(read(path.join(dir, 'pubspec.yaml')), /version: 1\.3\.0\+15/)
  assert.match(read(path.join(dir, 'package.json')), /"version": "1\.3\.0"/)
  assert.match(read(path.join(dir, 'CHANGELOG.md')), /## \[Unreleased\]\n\n## \[1\.3\.0\]/)
  write(path.join(dir, '.dualcraft', 'store', 'listing.json'), JSON.stringify({ es: { play: { title: 'Un título demasiado largo para Google Play' } } }))
  const sc = run('release.mjs', ['store-check'], dir)
  assert.equal(sc.code, 1); assert.match(sc.out, /title: \d+\/30/)
})

test('docs and map: functional doc traceability, shareable roadmap without internal details', () => {
  const dir = makeProject()
  run('brain.mjs', ['new', 'decision', 'Secreto interno', '--area', 'product'], dir)
  run('brain.mjs', ['new', 'task', 'Login', '--target', '1.3.0', '--body', 'detalle privado'], dir)
  run('brain.mjs', ['set', 'T-001', 'status=done'], dir)
  run('docs.mjs', ['init'], dir)
  assert.match(run('docs.mjs', ['status'], dir).out, /T-001 \[task\] Login/)
  run('map.mjs', ['--share', '--view', 'road', '--no-details'], dir)
  const pub = read(path.join(dir, '.dualcraft', 'out', 'share', 'roadmap-public.html'))
  assert.doesNotMatch(pub, /Secreto interno|detalle privado|<html|<!doctype/i)
  assert.match(pub, /Login/)
})

test('github: push creates issues with milestones, closes finished ones, pull imports', async () => {
  const issues = new Map([[50, { number: 50, title: 'Importada', body: '', state: 'open', labels: [{ name: 'bug' }], assignee: { login: 'ana' }, milestone: null }]])
  const ms = []; let next = 100; const log = []
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; const p = new URL(req.url, 'http://x').pathname; log.push(`${req.method} ${p}`)
      const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      let m
      if (/\/milestones$/.test(p)) { if (req.method === 'GET') return send(200, ms); const x = { number: ms.length + 1, title: body.title }; ms.push(x); return send(201, x) }
      if (/\/comments$/.test(p)) return send(201, {})
      if ((m = p.match(/\/issues\/(\d+)$/))) { const i = issues.get(+m[1]); if (req.method === 'PATCH' && body.state) i.state = body.state; return send(200, i) }
      if (/\/issues$/.test(p)) { if (req.method === 'GET') return send(200, new URL(req.url, 'http://x').searchParams.get('page') === '1' ? [...issues.values()].filter((i) => i.state === 'open') : []); const i = { number: next++, ...body, state: 'open', assignee: null, milestone: ms.find((x) => x.number === body.milestone) || null }; issues.set(i.number, i); return send(201, i) }
      send(404, {})
    })
  })
  await new Promise((r) => srv.listen(0, r))
  const api = `http://localhost:${srv.address().port}`
  const dir = makeProject()
  run('brain.mjs', ['new', 'task', 'Ranking', '--target', '1.4.0'], dir)
  const gh = (...a) => new Promise((resolve) => { const c = spawnSync; void c; const child = require_spawn(['github.mjs', ...a, '--repo', 'me/repo', '--api', api], dir); child.then(resolve) })
  const push = await gh('push')
  assert.match(push, /T-001 → #100/)
  assert.ok(log.includes('POST /repos/me/repo/milestones'))
  run('brain.mjs', ['set', 'T-001', 'status=done'], dir)
  assert.match(await gh('push'), /1 closed/)
  assert.match(await gh('pull', '--import'), /#50 → B-001/)
  srv.close()
})
import { spawn } from 'node:child_process'
import { SCRIPTS } from './helpers.mjs'
function require_spawn(args, cwd) {
  return new Promise((resolve) => { const c = spawn(process.execPath, [path.join(SCRIPTS, args[0]), ...args.slice(1)], { cwd }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d)); c.on('close', () => resolve(o)) })
}
void exists
