// Feature flags: catalog → typed accessors per stack, provider files, parked flags, expiry and usage checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, exists, ROOT } from './helpers.mjs'

const F = (p, ...x) => path.join(p, '.dualcraft', 'flags', ...x)

test('init: provider from the backend, parked brain flags imported, code for every stack', () => {
  const p = makeMultiProject()
  const cfg = path.join(p, '.dualcraft', 'config.json'); write(cfg, JSON.stringify({ ...JSON.parse(read(cfg)), backend: { provider: 'firebase' }, version: '1.3.0' }))
  run('brain.mjs', ['new', 'task', 'Nuevo checkout'], p)
  run('brain.mjs', ['set', 'T-001', 'status=parked', 'target=1.4.0', 'flag=new_checkout'], p)
  const r = run('flags.mjs', ['init'], p)
  assert.equal(r.code, 0, r.err)
  const c = JSON.parse(read(F(p, 'flags.json')))
  assert.equal(c.provider, 'firebase')
  assert.deepEqual(c.flags, [{ key: 'new_checkout', type: 'bool', default: false, kind: 'release', description: 'Parked: Nuevo checkout', task: 'T-001', expires: '1.4.0' }])
  for (const f of ['web/src/lib/feature-flags.ts', 'rn/src/lib/feature-flags.ts', 'kmp/composeApp/src/commonMain/kotlin/com/test/app/flags/FeatureFlags.kt', 'droid/app/src/main/java/com/test/droid/flags/FeatureFlags.kt', 'iosapp/Demo/Core/Flags/FeatureFlags.swift']) assert.ok(exists(path.join(p, f)), f)
  assert.match(read(path.join(p, 'web/src/lib/feature-flags.ts')), /get newCheckout\(\): boolean \{ return bool\("new_checkout", false\) \}/)
  assert.match(read(path.join(p, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/flags/FeatureFlags.kt')), /^\/\/ dualcraft:hash=\w+\npackage com\.test\.app\.flags\n/)
  const tpl = JSON.parse(read(F(p, 'remoteconfig.template.json')))
  assert.deepEqual(tpl.parameters.new_checkout, { defaultValue: { value: 'false' }, description: 'Parked: Nuevo checkout', valueType: 'BOOLEAN' })
  assert.match(r.out, /firebase deploy --only remoteconfig/)
})

test('add/remove: typed flags per platform, only the helpers each file needs; validation', () => {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  assert.equal(run('flags.mjs', ['init', '--provider', 'supabase'], p).code, 0)
  assert.equal(run('flags.mjs', ['add', 'home_layout', '--type', 'string', '--values', 'grid,list', '--default', 'list', '--kind', 'experiment', '--expires', '2.0.0'], p).code, 0)
  assert.equal(run('flags.mjs', ['add', 'max_upload_mb', '--type', 'int', '--default', '20', '--description', 'Upload limit'], p).code, 0)
  assert.equal(run('flags.mjs', ['add', 'price_factor', '--type', 'double', '--default', '1.5', '--platforms', 'web'], p).code, 0)
  const ts = read(path.join(p, 'site/lib/feature-flags.ts'))
  assert.match(ts, /get homeLayout\(\): "grid" \| "list" \{ return str<"grid" \| "list">\("home_layout", "list", \["grid","list"\]\) \}/)
  assert.match(ts, /get priceFactor\(\): number \{ return num\("price_factor", 1\.5\) \}/)
  assert.doesNotMatch(ts, /function bool\(/, 'no bool flags → no bool helper')
  const dart = read(path.join(p, 'app/lib/generated/feature_flags.dart'))
  assert.match(dart, /static String get homeLayout => _string\('home_layout', 'list', const <String>\['grid', 'list'\]\);/)
  assert.match(dart, /static int get maxUploadMb => _int\('max_upload_mb', 20\);/)
  assert.doesNotMatch(dart, /priceFactor|_double/, 'web-only flag and its helper stay out of the app')
  const sql = read(F(p, 'supabase-feature-flags.sql'))
  assert.match(sql, /create policy "feature flags are readable" on public\.feature_flags for select to anon, authenticated using \(true\);/)
  assert.match(sql, /values \('home_layout', '"list"'::jsonb, null\) on conflict \(key\) do update set description = excluded\.description;/)
  assert.ok(!exists(F(p, 'remoteconfig.template.json')))
  // validation
  for (const [args, re] of [[['add', 'Bad-Key'], /key must be snake_case/], [['add', 'x_flag', '--type', 'int', '--default', '1.5'], /default must be of type int/], [['add', 'y_flag', '--type', 'string', '--values', 'a,b', '--default', 'c'], /default "c" is not one of values/], [['add', 'home_layout'], /already exists/], [['add', 'z_flag', '--expires', 'soon'], /expires must be a version/]]) {
    const r = run('flags.mjs', args, p); assert.equal(r.code, 1, args.join(' ')); assert.match(r.out + r.err, re)
  }
  assert.equal(run('flags.mjs', ['remove', 'max_upload_mb'], p).code, 0)
  assert.doesNotMatch(read(path.join(p, 'app/lib/generated/feature_flags.dart')), /maxUploadMb/)
})

test('check: expired flags block, temporary flags need expires, unused flags, parked flag missing, drift; release check includes it', () => {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  const cfg = path.join(p, '.dualcraft', 'config.json'); write(cfg, JSON.stringify({ ...JSON.parse(read(cfg)), version: '1.3.0' }))
  run('flags.mjs', ['init', '--provider', 'local'], p)
  run('flags.mjs', ['add', 'new_checkout', '--expires', '1.3.0', '--description', 'New checkout'], p)
  run('flags.mjs', ['add', 'dark_banner', '--description', 'Banner'], p)
  run('flags.mjs', ['add', 'support_email', '--type', 'string', '--default', 'help@acme.app', '--kind', 'config'], p)
  write(path.join(p, 'site/app/checkout/page.tsx'), "import { flags } from '@/lib/feature-flags'\nexport default function P() { return flags.newCheckout ? null : null }\n")
  write(path.join(p, 'app/lib/main.dart'), "import 'generated/feature_flags.dart';\nfinal e = FeatureFlags.supportEmail;\n")
  let c = run('flags.mjs', ['check'], p)
  assert.equal(c.code, 1)
  assert.match(c.out, /✗ new_checkout: expired \(remove in 1\.3\.0, app is 1\.3\.0\)/)
  assert.match(c.out, /⚠ dark_banner: temporary release flag without "expires"/)
  assert.match(c.out, /⚠ dark_banner: not read anywhere in the app code yet/)
  assert.doesNotMatch(c.out, /new_checkout: not read|support_email: not read/)
  assert.match(c.out, /⚠ support_email: no description/)
  // the release readiness check blocks on it
  assert.match(run('release.mjs', ['check', '--version', '1.3.0'], p).out, /flags: new_checkout: expired/)
  // drift and parked flag missing from the catalog
  fs.appendFileSync(path.join(p, 'app/lib/generated/feature_flags.dart'), '// edited\n')
  run('brain.mjs', ['new', 'task', 'Perfil nuevo'], p); run('brain.mjs', ['set', 'T-001', 'status=parked', 'flag=new_profile'], p)
  c = run('flags.mjs', ['check'], p)
  assert.match(c.out, /feature_flags\.dart out of date/); assert.match(c.out, /T-001 is parked behind flag "new_profile", which is not in the catalog/)
  // init imports it
  run('flags.mjs', ['init', '--force'], p)
  assert.ok(JSON.parse(read(F(p, 'flags.json'))).flags.some((f) => f.key === 'new_profile' && f.task === 'T-001'))
})

test('fixture catalog generates in every language (compiled for real in CI)', () => {
  const p = makeMultiProject()
  write(F(p, 'flags.json'), read(path.join(ROOT, 'test', 'fixtures', 'flags.json')))
  assert.equal(run('flags.mjs', ['gen'], p).code, 0)
  const kt = read(path.join(p, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/flags/FeatureFlags.kt'))
  assert.match(kt, /val maxUploadMb: Long get\(\) = long\("max_upload_mb", 20L\)/); assert.match(kt, /val priceFactor: Double get\(\) = double\("price_factor", 1\.0\)/)
  assert.match(kt, /Upload limit in \$MB/, 'descriptions are comments, $ kept')
  assert.doesNotMatch(kt, /webOnlyBanner/)
  const sw = read(path.join(p, 'iosapp/Demo/Core/Flags/FeatureFlags.swift'))
  assert.match(sw, /static var homeLayout: String \{ string\("home_layout", "list", \["grid", "list"\]\) \}/)
  assert.match(sw, /nonisolated\(unsafe\) static var source/)
})
