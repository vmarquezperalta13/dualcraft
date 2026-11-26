// Error monitoring: spec → settings per stack, SDK / symbol / DSN / CI / privacy checks, deploy and release integration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, exists } from './helpers.mjs'

const S = (p) => path.join(p, '.dualcraft', 'monitoring', 'monitoring.json')

test('init: providers from the backend, settings per stack with the release name; validation', () => {
  const p = makeMultiProject()
  const r = run('monitoring.mjs', ['init'], p)
  assert.equal(r.code, 0, r.err)
  const spec = JSON.parse(read(S(p)))
  assert.deepEqual(spec.providers, { web: 'sentry', mobile: 'sentry' }, 'no Firebase backend → Sentry on mobile too')
  assert.equal(spec.sendPii, false); assert.equal(spec.consent, true); assert.ok(spec.scrub.includes('password'))
  const ts = read(path.join(p, 'web/src/lib/monitoring.ts'))
  assert.match(ts, /release: "testapp@1\.2\.0",/); assert.match(ts, /dsnEnv: "PUBLIC_SENTRY_DSN",/, 'Astro DSN variable')
  assert.match(read(path.join(p, 'rn/src/lib/monitoring.ts')), /dsnEnv: "EXPO_PUBLIC_SENTRY_DSN"/)
  assert.match(read(path.join(p, 'droid/app/src/main/java/com/test/droid/monitoring/Monitoring.kt')), /^\/\/ dualcraft:hash=\w+\npackage com\.test\.droid\.monitoring\n[\s\S]*const val RELEASE: String = "testapp@1\.2\.0"/)
  assert.match(read(path.join(p, 'iosapp/Demo/Core/Monitoring/Monitoring.swift')), /static let sendDefaultPii = false/)
  // Firebase backend → Crashlytics on mobile; none skips the code
  const f = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' }, extra: { backend: { provider: 'firebase' } } })
  run('monitoring.mjs', ['init', '--web', 'none'], f)
  assert.deepEqual(JSON.parse(read(S(f))).providers, { web: 'none', mobile: 'crashlytics' })
  assert.ok(!exists(path.join(f, 'site/lib/monitoring.ts')))
  assert.match(read(path.join(f, 'app/lib/generated/monitoring.dart')), /static const String provider = 'crashlytics';/)
  // validation
  write(S(f), JSON.stringify({ app: 'Bad App', providers: { web: 'crashlytics', mobile: 'bugsnag' }, sampleRate: { production: 2, other: 1 }, sendPii: true, consent: 'yes', scrub: [''], ignore: [] }))
  const v = run('monitoring.mjs', ['gen'], f)
  assert.equal(v.code, 1)
  for (const re of [/app: lowercase name/, /providers\.web must be sentry, none \(Crashlytics has no web SDK\)/, /providers\.mobile must be crashlytics, sentry, none/, /sampleRate\.production must be 0–1/, /sendPii: true sends IPs/, /consent must be true or false/, /scrub must be a list/]) assert.match(v.out, re)
})

test('check: SDKs, symbol upload, DSN in .env.example, Sentry token in CI, privacy policy; version bump regenerates', () => {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' }, extra: { backend: { provider: 'firebase' } } })
  run('monitoring.mjs', ['init'], p)
  write(path.join(p, 'docs/legal/privacy-policy.es.md'), '# Política de privacidad\nUsamos Google Analytics.\n')
  let c = run('monitoring.mjs', ['check'], p)
  assert.equal(c.code, 0, c.out)
  for (const re of [/nextjs: sentry SDK not installed — npm i @sentry\/nextjs/, /flutter: crashlytics SDK not installed — flutter pub add firebase_crashlytics/, /document NEXT_PUBLIC_SENTRY_DSN in \.env\.example/, /privacy policy does not mention Sentry/, /privacy policy does not mention Firebase Crashlytics/, /consent: start collecting only after the user agrees/]) assert.match(c.out, re)
  write(path.join(p, 'site/package.json'), JSON.stringify({ dependencies: { next: '15.0.0', '@sentry/nextjs': '10.0.0' } }))
  write(path.join(p, 'site/.env.example'), 'NEXT_PUBLIC_SENTRY_DSN=\n')
  write(path.join(p, 'app/pubspec.yaml'), 'name: x\ndependencies:\n  firebase_crashlytics: ^5.0.0\n')
  write(path.join(p, 'docs/legal/privacy-policy.es.md'), 'Sentry y Firebase Crashlytics procesan informes de errores.\n')
  c = run('monitoring.mjs', ['check'], p)
  assert.doesNotMatch(c.out, /SDK not installed|\.env\.example|privacy policy/)
  // deploy workflows without the Sentry token are flagged; deploy gen adds it
  run('deploy.mjs', ['init', '--host', 'vercel'], p)
  const web = read(path.join(p, '.github/workflows/dualcraft-deploy-web.yml'))
  assert.match(web, /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}\n\s+SENTRY_ORG: \$\{\{ vars\.SENTRY_ORG \}\}\n\s+SENTRY_PROJECT: \$\{\{ vars\.SENTRY_PROJECT_WEB \}\}/)
  assert.match(web, /SENTRY_RELEASE=testapp@\$\(node -p "require\('\.\/\.dualcraft\/config\.json'\)\.version"\)/)
  assert.doesNotMatch(read(path.join(p, '.github/workflows/dualcraft-release-mobile.yml')), /SENTRY/, 'Crashlytics needs no Sentry token')
  const sec = run('deploy.mjs', ['secrets'], p).out
  assert.match(sec, /SENTRY_AUTH_TOKEN/); assert.match(sec, /SENTRY_PROJECT_WEB/); assert.doesNotMatch(sec, /SENTRY_PROJECT_MOBILE/)
  assert.doesNotMatch(run('monitoring.mjs', ['check'], p).out, /deploy workflows do not upload/)
  // a version bump regenerates the release name
  const b = run('release.mjs', ['bump', '1.3.0'], p)
  assert.match(b.out, /monitoring settings → release 1\.3\.0/)
  assert.match(read(path.join(p, 'app/lib/generated/monitoring.dart')), /static const String release = 'testapp@1\.3\.0';/)
  assert.equal(run('monitoring.mjs', ['check'], p).code, 0)
})
