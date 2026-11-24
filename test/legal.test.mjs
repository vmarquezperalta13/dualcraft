// Legal & privacy pack: scan from SDKs/schema, data map validation, generated drafts and privacy manifest, compliance checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeProject, write, read, exists } from './helpers.mjs'

const legal = (p, ...a) => run('legal.mjs', a, p)
const mapFile = (p) => path.join(p, '.dualcraft', 'legal', 'data-map.json')
function app({ ads = false } = {}) {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' }, schema: 'firestore' })
  write(path.join(p, 'app/pubspec.yaml'), 'name: x\ndependencies:\n  firebase_auth: any\n  cloud_firestore: any\n  firebase_crashlytics: any\n  in_app_purchase: any\n  image_picker: any\n' + (ads ? '  google_mobile_ads: any\n' : ''))
  write(path.join(p, 'app/ios/Runner/Info.plist'), '<dict><key>NSPhotoLibraryUsageDescription</key><string>Para elegir la foto de tu perfil</string></dict>')
  write(path.join(p, 'app/lib/settings.dart'), "void deleteAccount() { FirebaseAuth.instance.currentUser!.delete(); }\nconst privacy = 'https://acme.app/privacy';\n")
  return p
}
function complete(p, patch = {}) {
  const m = JSON.parse(read(mapFile(p)))
  Object.assign(m.controller, { legalName: 'Acme Apps S.L.', taxId: 'B12345678', address: 'Calle Mayor 1, Madrid', email: 'privacy@acme.app' })
  m.privacyPolicyUrl = 'https://acme.app/privacy'; m.accountDeletionUrl = 'https://acme.app/delete'
  for (const x of m.data) { x.retention = 'Hasta que elimines tu cuenta'; delete x.needsReview }
  write(mapFile(p), JSON.stringify({ ...m, ...patch }, null, 2))
  return m
}

test('scan infers data, processors and permissions from SDKs and the schema', () => {
  const p = app({ ads: true })
  const r = legal(p, 'scan')
  assert.match(r.out, /Firebase Authentication, Cloud Firestore, Firebase Crashlytics, Store billing, Google AdMob, Photo picker/)
  assert.match(r.out, /\+ email\s+account,app_functionality\s+contract\s+← Firebase Authentication, schema users\.email/)
  assert.match(r.out, /tracking: true/)
  assert.equal(legal(p, 'scan', '--write').code, 0)
  const m = JSON.parse(read(mapFile(p)))
  assert.ok(m.data.every((x) => x.needsReview))
  assert.deepEqual(m.processors.map((x) => x.id).sort(), ['apple', 'firebase', 'google_ads', 'google_play'])
  assert.equal(m.tracking, true)
  // incomplete map → gen refuses with the reasons
  const g = legal(p, 'gen')
  assert.equal(g.code, 1)
  assert.match(g.out, /controller\.legalName is required/); assert.match(g.out, /retention .* is required/); assert.match(g.out, /privacyPolicyUrl/)
})

test('validation: consent for ads/tracking/special data, transfers, unknown processors', () => {
  const p = app()
  legal(p, 'scan', '--write'); complete(p)
  const m = JSON.parse(read(mapFile(p)))
  m.data.push({ category: 'health', purposes: ['app_functionality'], legalBasis: 'contract', retention: '1 año', processors: [] }, { category: 'advertising_data', purposes: ['advertising'], legalBasis: 'legitimate_interest', retention: '1 año', processors: ['acme_ads'] })
  m.processors.push({ id: 'custom', name: 'Custom Inc.', country: 'US' })
  write(mapFile(p), JSON.stringify(m))
  const r = legal(p, 'check')
  for (const re of [/health: special category data .* explicit consent/, /advertising\/marketing needs consent/, /processor "acme_ads" is not listed/, /processor "custom" \(US\): international transfer needs a mechanism/]) assert.match(r.out, re)
})

test('gen: policies in every language, store answers and the iOS privacy manifest', () => {
  const p = app()
  write(path.join(p, '.dualcraft/payments/products.json'), JSON.stringify({ mode: 'native', products: [{ id: 'pro', type: 'subscription' }] }))
  legal(p, 'scan', '--write'); complete(p)
  const g = legal(p, 'gen')
  assert.equal(g.code, 0, g.out)
  const es = read(path.join(p, 'docs/legal/privacy-policy.es.md'))
  assert.match(es, /Borrador generado por DualCraft/)
  assert.match(es, /\| Correo electrónico \| Crear y gestionar tu cuenta; Prestar el servicio de la app \| Ejecución del contrato \(art\. 6\.1\.b RGPD\) \| Hasta que elimines tu cuenta \|/)
  assert.match(es, /Agencia Española de Protección de Datos/)
  assert.match(read(path.join(p, 'docs/legal/privacy-policy.en.md')), /Your rights/)
  assert.match(read(path.join(p, 'docs/legal/terms.es.md')), /se renuevan automáticamente/)
  assert.match(read(path.join(p, 'docs/legal/app-store-privacy.md')), /## Data Not Linked to You[\s\S]*CrashData/)
  assert.match(read(path.join(p, 'docs/legal/google-data-safety.md')), /Personal info › Email address \| Yes \| No/)
  const x = read(path.join(p, 'app/ios/Runner/PrivacyInfo.xcprivacy'))
  assert.match(x, /<key>NSPrivacyTracking<\/key>\n\t<false\/>/)
  assert.match(x, /NSPrivacyCollectedDataTypePurchaseHistory/)
  assert.ok(!exists(path.join(p, 'docs/legal/cookies.es.md')), 'no web → no cookie policy')
  assert.equal(legal(p, 'check').code, 0, legal(p, 'check').out)
  // the map changes → everything is stale until gen
  const m = JSON.parse(read(mapFile(p))); m.data[0].retention = '3 años'; m.data[0].linked = false; write(mapFile(p), JSON.stringify(m))
  const c = legal(p, 'check').out
  assert.match(c, /privacy-policy\.es\.md out of date/); assert.match(c, /PrivacyInfo\.xcprivacy out of date/)
})

test('check: account deletion, ATT, permission texts, undeclared SDKs, cookie consent', () => {
  const p = app({ ads: true })
  legal(p, 'scan', '--write'); complete(p, { trackingDomains: ['googleads.g.doubleclick.net'] }); legal(p, 'gen')
  write(path.join(p, 'app/lib/settings.dart'), 'void x() {}\n')
  write(path.join(p, 'app/pubspec.yaml'), read(path.join(p, 'app/pubspec.yaml')) + '  geolocator: any\n')
  const r = legal(p, 'check')
  assert.equal(r.code, 1)
  for (const re of [/no in-app account deletion/, /tracking on iOS without App Tracking Transparency/, /NSUserTrackingUsageDescription missing/, /NSLocationWhenInUseUsageDescription missing/, /undeclared collection: precise_location \(Location\)/, /no link to the privacy policy/]) assert.match(r.out, re)
  // web with analytics cookies and no banner
  const w = makeProject({ web: 'nextjs', paths: { web: 'web' } })
  write(path.join(w, 'web/package.json'), JSON.stringify({ dependencies: { next: '15', '@next/third-parties': '15' } }))
  write(path.join(w, 'web/src/app/layout.tsx'), "import { GoogleAnalytics } from '@next/third-parties/google'\nexport default function L(){ return <GoogleAnalytics gaId='G-1' /> }\n")
  legal(w, 'scan', '--write'); complete(w); legal(w, 'gen')
  assert.ok(exists(path.join(w, 'docs/legal/cookies.es.md')))
  assert.match(legal(w, 'check').out, /non-essential cookies without a consent banner/)
})
