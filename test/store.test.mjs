// Store upload with fastlane: listing, release notes and framed screenshots exported to fastlane's layout; checks;
// the release workflow uploads them (supply with the bundle, deliver after TestFlight, never submitting for review).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeProject, write, read, exists, png } from './helpers.mjs'

function storeProject() {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  const cfg = path.join(p, '.dualcraft/config.json'); write(cfg, JSON.stringify({ ...JSON.parse(read(cfg)), version: '1.3.0' }))
  write(path.join(p, 'app/pubspec.yaml'), 'name: app\nversion: 1.3.0+7\n')
  write(path.join(p, 'app/android/app/build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.liga" } }\n')
  write(path.join(p, 'app/ios/Runner.xcodeproj/project.pbxproj'), 'PRODUCT_BUNDLE_IDENTIFIER = com.acme.liga.RunnerTests;\nPRODUCT_BUNDLE_IDENTIFIER = com.acme.liga;\n')
  write(path.join(p, '.dualcraft/store/listing.json'), JSON.stringify({
    es: { play: { title: 'Liga', short: 'Tu liga en el bolsillo', full: 'Sigue a tu equipo.' }, appstore: { name: 'Liga', subtitle: 'Tu liga', description: 'Sigue a tu equipo.', keywords: 'liga,fútbol' } },
    it: { play: { title: 'Lega', short: 'La tua lega', full: 'Segui la squadra.' }, appstore: { name: 'Lega', description: 'Segui la squadra.', keywords: 'lega,calcio' } },
  }))
  write(path.join(p, '.dualcraft/release/1.2.0.json'), JSON.stringify({ es: { play: '• Antigua' } }))
  write(path.join(p, '.dualcraft/release/1.3.0.json'), JSON.stringify({ es: { play: '• Favoritos', appstore: { notes: 'Favoritos y modo oscuro.' } }, it: { play: '• Preferiti' } }))
  const F = (...x) => path.join(p, '.dualcraft/store/screenshots/framed', ...x)
  for (const l of ['es', 'it']) { for (const n of ['01-home', '02-stats']) { fs.mkdirSync(F(l, 'play-phone'), { recursive: true }); fs.writeFileSync(F(l, 'play-phone', n + '.png'), png(54, 96, [10, 20, 30])) } }
  fs.mkdirSync(F('es', 'ios-6.9'), { recursive: true }); fs.writeFileSync(F('es', 'ios-6.9', '01-home.png'), png(66, 143, [40, 50, 60]))
  return p
}

test('init + export: fastlane layout per store with each store\'s locale codes, notes of the latest version, screenshots', () => {
  const p = storeProject()
  const r = run('store.mjs', ['init', '--support-url', 'https://acme.app/ayuda', '--privacy-url', 'https://acme.app/privacidad'], p)
  assert.equal(r.code, 0, r.err)
  const s = JSON.parse(read(path.join(p, '.dualcraft/store/store.json')))
  assert.deepEqual(s.android, { package: 'com.acme.liga' }); assert.deepEqual(s.ios, { bundleId: 'com.acme.liga' }, 'the app target, not the tests target')
  assert.match(r.out, /notes of 1\.3\.0/)
  const M = (...x) => read(path.join(p, 'fastlane', ...x))
  assert.equal(M('metadata/android/es-ES/title.txt'), 'Liga\n')
  assert.equal(M('metadata/android/it-IT/changelogs/default.txt'), '• Preferiti\n')
  assert.equal(M('metadata/es-ES/release_notes.txt'), 'Favoritos y modo oscuro.\n')
  assert.equal(M('metadata/it/keywords.txt'), 'lega,calcio\n', 'Italian is "it" on the App Store')
  assert.equal(M('metadata/es-ES/privacy_url.txt'), 'https://acme.app/privacidad\n')
  assert.ok(exists(path.join(p, 'fastlane/metadata/android/es-ES/images/phoneScreenshots/01_home.png')))
  assert.ok(exists(path.join(p, 'fastlane/screenshots/es-ES/ios-6.9_01_home.png')))
  assert.match(M('README.md'), /never submits for review/)
  // a screenshot removed from the source disappears from fastlane/ on export
  fs.rmSync(path.join(p, '.dualcraft/store/screenshots/framed/it/play-phone/02-stats.png'))
  assert.match(run('store.mjs', ['check'], p).out, /fastlane\/ out of date/)
  assert.match(run('store.mjs', ['export'], p).out, /1 removed/)
  assert.ok(!exists(path.join(p, 'fastlane/metadata/android/it-IT/images/phoneScreenshots/02_stats.png')))
})

test('check: required texts and urls per store, screenshot counts, notes for the current version', () => {
  const p = storeProject()
  run('store.mjs', ['init'], p)
  let c = run('store.mjs', ['check'], p)
  assert.equal(c.code, 1)
  for (const re of [/urls\.support missing/, /urls\.privacy missing/]) assert.match(c.out, re)
  assert.match(c.out, /it: no 6\.9" iPhone screenshots/)
  assert.doesNotMatch(c.out, /it: .*Play phone screenshot/, 'two Play screenshots are enough')
  // the subtitle is optional, keywords are not
  const l = path.join(p, '.dualcraft/store/listing.json'); const L = JSON.parse(read(l)); delete L.it.appstore.keywords; write(l, JSON.stringify(L))
  run('store.mjs', ['init', '--support-url', 'https://acme.app/ayuda', '--privacy-url', 'https://acme.app/privacidad'], p)
  c = run('store.mjs', ['check'], p)
  assert.match(c.out, /it: listing\.json appstore\.keywords missing/); assert.doesNotMatch(c.out, /subtitle/)
  // notes for an older version are flagged
  const cfg = path.join(p, '.dualcraft/config.json'); write(cfg, JSON.stringify({ ...JSON.parse(read(cfg)), version: '1.4.0' }))
  assert.match(run('store.mjs', ['check'], p).out, /release notes are for 1\.3\.0, the app is 1\.4\.0/)
})

test('deploy: the tag release uploads with fastlane supply and deliver (no review submission); r0adkll without it', () => {
  const p = storeProject()
  run('deploy.mjs', ['init'], p)
  let wf = read(path.join(p, '.github/workflows/dualcraft-release-mobile.yml'))
  assert.match(wf, /r0adkll\/upload-google-play@v1/); assert.doesNotMatch(wf, /fastlane/)
  run('store.mjs', ['init', '--support-url', 'https://acme.app/ayuda', '--privacy-url', 'https://acme.app/privacidad'], p)
  assert.match(run('store.mjs', ['check'], p).out, /does not upload with fastlane yet — run: deploy\.mjs gen/)
  run('deploy.mjs', ['gen'], p)
  wf = read(path.join(p, '.github/workflows/dualcraft-release-mobile.yml'))
  assert.doesNotMatch(wf, /r0adkll/)
  assert.match(wf, /fastlane supply --aab "app\/build\/app\/outputs\/bundle\/release\/app-release\.aab" --package_name com\.acme\.liga --track internal --release_status completed --json_key_data "\$PLAY_JSON" --metadata_path fastlane\/metadata\/android/)
  assert.match(wf, /fastlane deliver --api_key_path "\$RUNNER_TEMP\/asc-key\.json" --app_identifier com\.acme\.liga --app_version "\$VERSION" --skip_binary_upload true[^\n]*--submit_for_review false/)
  assert.doesNotMatch(run('store.mjs', ['check'], p).out, /does not upload with fastlane/)
})
