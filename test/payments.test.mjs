// Payments pack: catalog validation, server scaffolds on the backend contract, typed catalogs, client checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeProject, makeMultiProject, write, read, exists, FIXTURES } from './helpers.mjs'

const pay = (p, ...a) => run('payments.mjs', a, p)
const be = (p, ...a) => run('backend.mjs', a, p)
const catalogFile = (p) => path.join(p, '.dualcraft', 'payments', 'products.json')
const fixture = (mode = 'native') => ({ ...JSON.parse(read(path.join(FIXTURES, 'products.json'))), mode })
const flutter = () => {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  write(path.join(p, 'app/android/app/build.gradle.kts'), 'android {\n  defaultConfig {\n    applicationId = "com.acme.hockey"\n  }\n}\n')
  write(path.join(p, 'app/ios/Runner.xcodeproj/project.pbxproj'), 'PRODUCT_BUNDLE_IDENTIFIER = com.acme.hockey.RunnerTests;\nPRODUCT_BUNDLE_IDENTIFIER = com.acme.hockey;\n')
  return p
}

test('init needs a backend; native on Firebase scaffolds verification, notifications and the Flutter service', () => {
  const p = flutter()
  assert.equal(pay(p, 'init', '--mode', 'native').code, 1, 'no backend contract')
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  const r = pay(p, 'init', '--mode', 'native')
  assert.equal(r.code, 0, r.err)
  const c = JSON.parse(read(catalogFile(p)))
  assert.equal(c.android.packageName, 'com.acme.hockey')
  assert.equal(c.apple.bundleId, 'com.acme.hockey', 'test bundle ids are skipped')
  for (const f of ['functions/src/payments/stores.ts', 'functions/src/verifyPurchase.ts', 'functions/src/playRtdn.ts', 'functions/src/appStoreNotifications.ts', 'app/lib/services/purchase_service.dart']) assert.ok(exists(path.join(p, f)), f)
  const pkg = JSON.parse(read(path.join(p, 'functions/package.json')))
  assert.ok(pkg.dependencies['google-auth-library'] && pkg.dependencies['@apple/app-store-server-library'])
  const idx = read(path.join(p, 'functions/src/index.ts'))
  for (const f of ['verifyPurchase', 'playRtdn', 'appStoreNotifications']) assert.match(idx, new RegExp(`export \\{ ${f} \\}`))
  const api = JSON.parse(read(path.join(p, '.dualcraft/backend/api.json')))
  assert.deepEqual(api.functions.map((f) => f.name), ['verifyPurchase', 'playRtdn', 'appStoreNotifications'])
  assert.match(r.out, /purchase_tokens\/\{key\} \{ allow read, write: if false; \}/)
  assert.match(read(path.join(p, 'functions/src/payments/stores.ts')), /purchase_belongs_to_another_user/)
})

test('catalog validation: ids, entitlements, grants, subscriptions', () => {
  const p = flutter()
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  const bad = fixture()
  bad.products.push(
    { id: 'Bad-Id', type: 'nonConsumable', entitlement: 'premium' },
    { id: 'gems_10', type: 'consumable', grants: { gems: 10 } },
    { id: 'vip', type: 'nonConsumable', entitlement: 'vip' },
    { id: 'weekly', type: 'subscription', entitlement: 'premium', period: 'P2W', android: 'premium', basePlan: 'monthly' },
    { id: 'promo', type: 'consumable', entitlement: 'premium', grants: { coins: 0 } })
  write(catalogFile(p), JSON.stringify(bad))
  const r = pay(p, 'check')
  assert.equal(r.code, 1)
  for (const m of [/"Bad-Id": id must be lowercase/, /currency "gems" is not declared/, /entitlement "vip" is not declared/, /period must be/, /same Google Play product and base plan as "premium_monthly"/, /consumables credit a currency/, /grants\.coins must be a positive integer/]) assert.match(r.out, m)
  assert.equal(pay(p, 'gen').code, 1, 'gen refuses an invalid catalog')
})

test('gen: typed catalogs per stack, server catalog and verifyPurchase product list', () => {
  const p = makeMultiProject('firestore')
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  write(catalogFile(p), JSON.stringify(fixture()))
  assert.equal(pay(p, 'init').code, 0)
  const ts = read(path.join(p, 'rn/src/lib/payments-catalog.ts'))
  assert.match(ts, /premiumMonthly: \{ id: "premium_monthly", type: "subscription", android: "premium", ios: "com.test.premium.monthly", basePlan: "monthly", entitlement: "premium"/)
  assert.match(ts, /export type Entitlement = "premium"/)
  assert.ok(!exists(path.join(p, 'web/src/lib/payments-catalog.ts')), 'store purchases are mobile-only')
  assert.match(read(path.join(p, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/payments/PaymentsCatalog.kt')), /val coins100 = CatalogProduct\("coins_100", ProductType.CONSUMABLE, "coins_100", "coins_100", grants = mapOf\("coins" to 100L\)\)/)
  assert.match(read(path.join(p, 'iosapp/Demo/Core/Payments/PaymentsCatalog.swift')), /case premium = "premium"/)
  const server = read(path.join(p, 'functions/src/generated/payments.ts'))
  assert.match(server, /PACKAGE_NAME = "com.test.app"/); assert.match(server, /APP_APPLE_ID: number \| undefined = 1234567890/)
  // catalog change → contract follows, check reports drift until gen
  const c = fixture(); c.products.push({ id: 'coins_500', type: 'consumable', grants: { coins: 500 }, description: '500' }); write(catalogFile(p), JSON.stringify(c))
  assert.match(pay(p, 'check').out, /verifyPurchase accepts a different product list/)
  assert.equal(pay(p, 'gen').code, 0)
  const v = JSON.parse(read(path.join(p, '.dualcraft/backend/api.json'))).functions.find((f) => f.name === 'verifyPurchase')
  assert.ok(v.input.productId.values.includes('coins_500'))
  assert.match(read(path.join(p, 'functions/src/generated/api.ts')), /"coins_500"/)
  assert.equal(be(p, 'check').code, 0, be(p, 'check').out)
})

test('check: client-side grants, missing restore, unverified purchases, autoConsume', () => {
  const p = flutter()
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  write(catalogFile(p), JSON.stringify(fixture()))
  pay(p, 'init')
  write(path.join(p, 'app/lib/services/purchase_service.dart'), '// replaced\n')
  write(path.join(p, 'app/lib/shop.dart'), "void buy() { iap.buyConsumable(purchaseParam: x); }\nvoid unlock() { db.collection('users').doc(uid).collection('entitlements').doc('premium').set({'active': true}); }\n")
  const r = pay(p, 'check')
  assert.equal(r.code, 1)
  assert.match(r.out, /shop\.dart: the app writes entitlements itself/)
  assert.match(r.out, /buyConsumable without autoConsume: false/)
  assert.match(r.out, /purchases without a restore path/)
  assert.match(r.out, /never listens to purchaseStream/)
  assert.match(r.out, /not verified on the server/)
})

test('revenuecat on Supabase: webhook function, no native verification', () => {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' }, extra: { backend: { provider: 'supabase' } } })
  write(path.join(p, 'supabase/config.toml'), 'project_id = "x"\n')
  be(p, 'init')
  write(catalogFile(p), JSON.stringify(fixture('revenuecat')))
  const r = pay(p, 'init')
  assert.equal(r.code, 0, r.err)
  assert.match(read(path.join(p, 'supabase/functions/revenuecat-webhook/index.ts')), /\$RCAnonymousID/)
  assert.match(read(path.join(p, 'supabase/config.toml')), /\[functions\.revenuecat-webhook\]\nverify_jwt = false/)
  assert.ok(exists(path.join(p, 'supabase/functions/_shared/payments.ts')))
  assert.ok(!exists(path.join(p, 'app/lib/services/purchase_service.dart')))
  assert.deepEqual(JSON.parse(read(path.join(p, '.dualcraft/backend/api.json'))).functions.map((f) => f.name), ['revenuecatWebhook'])
  assert.equal(be(p, 'check').code, 0)
})
