// Deep links: spec → builders + parsers per stack, .well-known files merged with passkeys, platform and cross checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, exists, ROOT } from './helpers.mjs'

const S = (p) => path.join(p, '.dualcraft', 'links', 'links.json')

test('init imports push and screenshot routes; add orders literals first; code per stack and .well-known', () => {
  const p = makeMultiProject()
  write(path.join(p, '.dualcraft/push/notifications.json'), read(path.join(ROOT, 'test/fixtures/notifications.json')))
  write(path.join(p, '.dualcraft/store/screenshots.json'), JSON.stringify({ screens: [{ name: 'profile', android: 'acme://profile' }, { name: 'web', web: 'http://localhost:3000/' }] }))
  const r = run('links.mjs', ['init', '--domain', 'acme.app', '--scheme', 'acme'], p)
  assert.equal(r.code, 0, r.err)
  const spec = JSON.parse(read(S(p)))
  assert.deepEqual(spec.routes.map((x) => [x.name, x.path, x.origin]), [['home', '/', undefined], ['matches', '/matches/{matchId}', 'push'], ['stats', '/stats/{count}', 'push'], ['profile', '/profile', 'screenshots']])
  assert.deepEqual(spec.routes[2].params, { count: 'int' }, 'int params from the push catalog')
  assert.equal(spec.android.package, 'com.test.app', 'first mobile stack with a package (kmp)'); assert.deepEqual(spec.ios, { appId: '' })
  assert.equal(run('links.mjs', ['add', 'newMatch', '/matches/new'], p).code, 0)
  assert.equal(run('links.mjs', ['add', 'team', '/teams/{teamId}', '--params', 'teamId:int', '--query', 'tab:string,page:int', '--app-only'], p).code, 0)
  const ts = read(path.join(p, 'rn/src/lib/app-links.ts'))
  assert.ok(ts.indexOf('s[1] === "new"') < ts.indexOf('name: "matches", matchId'), '/matches/new is tried before /matches/{matchId}')
  assert.match(ts, /team: \(p: \{ teamId: number; tab\?: string; page\?: number \}\): string => withQuery\(`\/teams\/\$\{enc\(p\.teamId\)\}`, \{ "tab": p\.tab, "page": p\.page \}\),/)
  assert.doesNotMatch(read(path.join(p, 'web/src/lib/app-links.ts')), /teamId/, 'app-only route stays out of the web')
  assert.match(read(path.join(p, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/links/AppLinks.kt')), /data class Team\(val teamId: Long, val tab: String\? = null, val page: Long\? = null\)/)
  assert.match(read(path.join(p, 'iosapp/Demo/Core/Links/AppLinks.swift')), /case team\(teamId: Int, tab: String\?, page: Int\?\)/)
  const aasa = JSON.parse(read(path.join(p, 'web/public/.well-known/apple-app-site-association')))
  assert.deepEqual(aasa.applinks.details[0].components.map((c) => c['/']), ['/', '/matches/*', '/stats/*', '/profile', '/matches/new', '/teams/*'])
  const al = JSON.parse(read(path.join(p, 'web/public/.well-known/assetlinks.json')))
  assert.deepEqual(al[0].relation, ['delegate_permission/common.handle_all_urls']); assert.equal(al[0].target.package_name, 'com.test.app')
  // validation
  for (const [args, re] of [[['add', 'match', '/matches/{id}'], /same path shape/], [['add', 'Bad', '/x'], /name must be camelCase/], [['add', 'x', 'matches/{id}/'], /path must look like/], [['add', 'y', '/y/{id}', '--params', 'id:uuid'], /params\.id must be string or int/], [['add', 'z', '/z/{id}', '--query', 'id:string'], /both a path and a query parameter/]]) {
    const v = run('links.mjs', args, p); assert.equal(v.code, 1, args.join(' ')); assert.match(v.out + v.err, re)
  }
})

test('.well-known merge keeps passkeys; check: placeholders, manifest and entitlements, push routes, screenshots, drift', () => {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  write(path.join(p, '.dualcraft/auth/auth.json'), JSON.stringify({ provider: 'firebase', methods: ['email', 'passkey'], passkey: { rpId: 'acme.app', iosAppId: 'ABCDE12345.com.acme.app' } }))
  write(path.join(p, 'site/public/.well-known/assetlinks.json'), JSON.stringify([{ relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: ['<SHA-256 placeholder>'] } }]))
  write(path.join(p, 'app/android/app/build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.app" } }\n')
  assert.equal(run('links.mjs', ['init', '--scheme', 'acme'], p).code, 0)
  const spec = JSON.parse(read(S(p)))
  assert.equal(spec.domain, 'acme.app', 'domain from the passkey relying party'); assert.equal(spec.ios.appId, 'ABCDE12345.com.acme.app'); assert.equal(spec.android.package, 'com.acme.app')
  const al = JSON.parse(read(path.join(p, 'site/public/.well-known/assetlinks.json')))
  assert.deepEqual(al, [{ relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: 'com.acme.app', sha256_cert_fingerprints: ['<SHA-256 of the app signing certificate: Play Console → Test and release → App signing>'] } }])
  assert.deepEqual(JSON.parse(read(path.join(p, 'site/public/.well-known/apple-app-site-association'))).webcredentials, { apps: ['ABCDE12345.com.acme.app'] })
  let c = run('links.mjs', ['check'], p)
  assert.equal(c.code, 0, c.out)
  assert.match(c.out, /android\.sha256: add the SHA-256/); assert.match(c.out, /flutter: AndroidManifest\.xml has no verified intent filter for acme\.app — links\.mjs snippets flutter/); assert.match(c.out, /flutter: no Associated Domains entitlement applinks:acme\.app/)
  write(path.join(p, 'app/android/app/src/main/AndroidManifest.xml'), '<manifest><application><activity><intent-filter android:autoVerify="true"><data android:scheme="https" android:host="acme.app" /></intent-filter></activity></application></manifest>\n')
  write(path.join(p, 'app/ios/Runner/Runner.entitlements'), '<plist><dict><key>com.apple.developer.associated-domains</key><array><string>applinks:acme.app</string></array></dict></plist>\n')
  const spec2 = JSON.parse(read(S(p))); spec2.android.sha256 = ['AA:BB']; write(S(p), JSON.stringify(spec2))
  assert.match(run('links.mjs', ['check'], p).out, /out of date — run: links\.mjs gen/, 'fingerprint changes the .well-known file')
  run('links.mjs', ['gen'], p)
  c = run('links.mjs', ['check'], p)
  assert.doesNotMatch(c.out, /sha256|intent filter|Associated Domains/); assert.equal(c.code, 0)
  // a push route or screenshot link that opens no route
  write(path.join(p, '.dualcraft/push/notifications.json'), JSON.stringify({ notifications: [{ id: 'offer', route: '/offers/{offerId}' }] }))
  write(path.join(p, '.dualcraft/store/screenshots.json'), JSON.stringify({ screens: [{ name: 'shop', android: 'acme://shop' }] }))
  c = run('links.mjs', ['check'], p)
  assert.equal(c.code, 1)
  assert.match(c.out, /push "offer": route \/offers\/\{offerId\} is not an app route/); assert.match(c.out, /screenshot "shop": acme:\/\/shop is not an app route/)
  run('links.mjs', ['add', 'offer', '/offers/{offerId}'], p); run('links.mjs', ['add', 'shop', '/shop'], p)
  assert.equal(run('links.mjs', ['check'], p).code, 0)
  // snippets
  assert.match(run('links.mjs', ['snippets', 'android'], p).out, /<data android:pathPattern="\/offers\/\.\*" \/>/)
  assert.match(run('links.mjs', ['snippets', 'hosting'], p).out, /Content-Type: application\/json/)
  assert.ok(exists(path.join(p, 'app/lib/generated/app_links.dart')))
})
