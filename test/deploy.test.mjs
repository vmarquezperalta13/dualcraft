// Deploy pack: workflows per stack and host, hash protection, secrets per environment (mock GitHub API), release checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { run, makeProject, makeMultiProject, write, read, exists, SCRIPTS } from './helpers.mjs'

const dep = (p, ...a) => run('deploy.mjs', a, p)
const wf = (p, f) => read(path.join(p, '.github', 'workflows', f))
function flutter() {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  write(path.join(p, 'app/android/app/build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.hockey" } }\n')
  for (const d of ['app/ios/Runner.xcworkspace', 'app/ios/Runner.xcodeproj']) write(path.join(p, d, '.keep'), '')
  write(path.join(p, 'app/test/a_test.dart'), '')
  return p
}

test('flutter + firebase: CI, backend per environment, mobile release to testing', () => {
  const p = flutter()
  run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
  const r = dep(p, 'init')
  assert.equal(r.code, 0, r.err)
  const ci = wf(p, 'dualcraft-ci.yml')
  assert.match(ci, /^# dualcraft:hash=/)
  assert.match(ci, /flutter analyze --no-fatal-infos/); assert.match(ci, /flutter test/); assert.match(ci, /working-directory: functions/)
  const be = wf(p, 'dualcraft-deploy-backend.yml')
  assert.match(be, /environment: \$\{\{ startsWith\(github.ref, 'refs\/tags\/v'\) && 'production' \|\| 'dev' \}\}/)
  assert.match(be, /firebase-tools@latest deploy --only functions,firestore:rules,firestore:indexes --project "\$\{\{ vars.FIREBASE_PROJECT_ID \}\}"/)
  const mob = wf(p, 'dualcraft-release-mobile.yml')
  assert.match(mob, /tags: \['v\*'\]/)
  assert.match(mob, /packageName: com.acme.hockey/); assert.match(mob, /track: internal/)
  assert.match(mob, /KEYSTORE_BASE64: \$\{\{ secrets.ANDROID_KEYSTORE_BASE64 \}\}/)
  assert.doesNotMatch(mob, /run: .*\$\{\{ secrets\./, 'secrets only through env, never inlined in scripts')
  assert.match(mob, /xcodebuild -workspace Runner.xcworkspace -scheme Runner/)
  assert.ok(exists(path.join(p, 'app/ios/ExportOptions.plist')))
  assert.match(read(path.join(p, '.gitignore')), /\*\.jks/)
  assert.ok(!exists(path.join(p, '.github/workflows/dualcraft-deploy-web.yml')))
  // release signing not configured → check fails with the fix
  const c = dep(p, 'check')
  assert.equal(c.code, 1)
  assert.match(c.out, /doesn't read key\.properties/)
  write(path.join(p, 'app/android/app/build.gradle.kts'), 'val k = rootProject.file("key.properties")\nandroid { defaultConfig { applicationId = "com.acme.hockey" } }\n')
  assert.equal(dep(p, 'check').code, 0, dep(p, 'check').out)
  // hand edit → protected; stack change → stale
  write(path.join(p, '.github/workflows/dualcraft-ci.yml'), wf(p, 'dualcraft-ci.yml') + '# mine\n')
  assert.equal(dep(p, 'gen').code, 1)
})

test('web hosts: preview per PR, dev on main, production on tags', () => {
  const hosts = { vercel: /vercel deploy --prebuilt \$\{\{ startsWith\(github.ref, 'refs\/tags\/v'\) && '--prod' \|\| '' \}\}/, netlify: /netlify-cli deploy --build "\$@"/, cloudflare: /pages deploy dist --project-name=testapp --branch=\$\{\{ startsWith\(github.ref, 'refs\/tags\/v'\) && 'production' \|\| \(github.head_ref \|\| github.ref_name\) \}\}/, firebase: /FirebaseExtended\/action-hosting-deploy@v0[\s\S]*channelId: \$\{\{ github.event_name == 'pull_request' && '' \|\| 'live' \}\}/ }
  for (const [host, re] of Object.entries(hosts)) {
    const p = makeProject({ web: 'astro', paths: { web: 'web' } })
    write(path.join(p, 'web/package.json'), JSON.stringify({ scripts: { build: 'astro build' }, dependencies: { astro: '5' } }))
    assert.equal(dep(p, 'init', '--host', host).code, 0, host)
    const w = wf(p, 'dualcraft-deploy-web.yml')
    assert.match(w, re, host)
    assert.match(w, /environment: \$\{\{ github.event_name == 'pull_request' && 'preview' \|\| \(startsWith\(github.ref, 'refs\/tags\/v'\) && 'production' \|\| 'dev'\) \}\}/)
    assert.match(w, /head.repo.full_name == github.repository/, 'no deploys from forks')
  }
  const ssr = makeProject({ web: 'nextjs', paths: { web: 'web' } })
  write(path.join(ssr, 'web/package.json'), JSON.stringify({ dependencies: { next: '15' } }))
  assert.match(dep(ssr, 'init', '--host', 'firebase').out, /Firebase App Hosting/)
  assert.equal(dep(makeProject({ web: 'astro', paths: { web: 'web' } }), 'init').code, 1, 'host required')
})

test('multi-stack: one job per stack, native signing checks, EAS for React Native', () => {
  const p = makeMultiProject('firestore')
  write(path.join(p, 'droid/app/build.gradle.kts'), 'android { defaultConfig { applicationId = "com.test.droid" } }\n')
  assert.equal(dep(p, 'init', '--host', 'vercel').code, 0)
  const ci = wf(p, 'dualcraft-ci.yml')
  for (const j of ['astro:', 'react-native:', 'kmp:', 'android:', 'ios:']) assert.ok(ci.includes('  ' + j), j)
  assert.match(ci, /\.\/gradlew :composeApp:testDebugUnitTest :composeApp:assembleDebug/)
  assert.match(ci, /xcodebuild -project Demo.xcodeproj -scheme Demo -destination 'generic\/platform=iOS Simulator' build-for-testing/)
  const mob = wf(p, 'dualcraft-release-mobile.yml')
  assert.match(mob, /eas build --platform all --profile production --non-interactive --no-wait --auto-submit/)
  assert.match(mob, /\.\/gradlew :app:bundleRelease -PversionName="\$VERSION" -PversionCode="\$BUILD"/)
  assert.match(mob, /releaseFiles: droid\/app\/build\/outputs\/bundle\/release\/app-release.aab/)
  const c = dep(p, 'check').out
  for (const m of [/react-native: eas.json has no build.production profile/, /android: app\/build.gradle.kts has no release signingConfig from ANDROID_KEYSTORE_PATH/, /kmp: applicationId not found/]) assert.match(c, m)
})

test('secrets: per environment, against the GitHub API', async () => {
  const p = flutter()
  run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
  dep(p, 'init')
  const off = dep(p, 'secrets', '--offline')
  assert.match(off.out, /FIREBASE_SERVICE_ACCOUNT\s+dev/); assert.match(off.out, /FIREBASE_SERVICE_ACCOUNT\s+production/)
  assert.match(off.out, /APPSTORE_PRIVATE_KEY\s+repo/); assert.match(off.out, /ANDROID_KEYSTORE_BASE64\s+repo/)
  const routes = {
    '/repos/o/r/actions/secrets': { secrets: [{ name: 'ANDROID_KEYSTORE_BASE64' }] },
    '/repos/o/r/actions/variables': { variables: [] },
    '/repos/o/r/environments': { environments: [{ name: 'dev', protection_rules: [] }, { name: 'production', protection_rules: [] }] },
    '/repos/o/r/environments/dev/secrets': { secrets: [{ name: 'FIREBASE_SERVICE_ACCOUNT' }] },
    '/repos/o/r/environments/dev/variables': { variables: [{ name: 'FIREBASE_PROJECT_ID' }] },
    '/repos/o/r/environments/production/secrets': { secrets: [] },
    '/repos/o/r/environments/production/variables': { variables: [] },
  }
  const srv = http.createServer((req, res) => { const body = routes[req.url.split('?')[0]]; res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body || {})) })
  await new Promise((r) => srv.listen(0, r))
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'deploy.mjs'), 'secrets', '--repo', 'o/r', '--api', `http://127.0.0.1:${srv.address().port}`], { cwd: p })
    let o = ''; c.stdout.on('data', (d) => { o += d }); c.on('close', (code) => resolve({ code, o }))
  })
  srv.close()
  assert.equal(out.code, 1)
  assert.match(out.o, /✓ secret FIREBASE_SERVICE_ACCOUNT\s+dev/)
  assert.match(out.o, /✗ secret FIREBASE_SERVICE_ACCOUNT\s+production/)
  assert.match(out.o, /✓ secret ANDROID_KEYSTORE_BASE64\s+repo/)
  assert.match(out.o, /production" has no required reviewers/)
})
