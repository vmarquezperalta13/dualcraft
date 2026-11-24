// Deep language port: idiom references, dependency mapping, file plan and parity checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeProject, write, read, exists, ROOT } from './helpers.mjs'
import { compare, analyze } from '../scripts/lib/port-analyze.mjs'
import { LANG_TOPICS, UI_TOPICS, LANG_EXT, UI_EXT, ALIASES } from '../scripts/lib/port-data.mjs'

const port = (p, ...a) => run('port.mjs', a, p)
const REF = path.join(ROOT, 'references', 'port')
const ids = (f) => [...read(f).matchAll(/^\s*\/\/\s*@idiom\s+([\w-]+)\s+—/gm)].map((m) => m[1])

test('references: every language and UI framework covers the same idioms', () => {
  for (const t of LANG_TOPICS) {
    const base = ids(path.join(REF, 'lang', 'dart', `${t}.dart`))
    assert.ok(base.length >= 3, `${t}: dart has idioms`)
    for (const l of ['kotlin', 'swift', 'ts']) assert.deepEqual(ids(path.join(REF, 'lang', l, `${t}.${LANG_EXT[l]}`)), base, `lang/${l}/${t}`)
  }
  for (const t of UI_TOPICS) {
    const base = ids(path.join(REF, 'ui', 'flutter', `${t}.dart`)).filter((id) => !ALIASES[id])
    for (const u of ['compose', 'swiftui', 'react-native']) assert.deepEqual(ids(path.join(REF, 'ui', u, `${t}.${UI_EXT[u]}`)), base, `ui/${u}/${t}`)
  }
})

test('analyzer: the reference ports have parity (types, members, enum cases, functions)', () => {
  const src = (l, t) => read(path.join(REF, 'lang', l, `${t}.${LANG_EXT[l]}`))
  for (const t of ['basics', 'types', 'collections', 'async']) assert.deepEqual(compare(src('dart', t), 'dart', src('kotlin', t), 'kotlin'), [], `dart → kotlin ${t}`)
  for (const t of ['basics', 'types', 'collections', 'async']) assert.deepEqual(compare(src('dart', t), 'dart', src('swift', t), 'swift'), [], `dart → swift ${t}`)
  for (const t of ['basics', 'collections']) assert.deepEqual(compare(src('kotlin', t), 'kotlin', src('dart', t), 'dart'), [], `kotlin → dart ${t}`)
  // what the analyzer sees
  const k = analyze(src('kotlin', 'types'), 'kotlin').types
  assert.deepEqual(k.Plan.members.sort(), ['FREE', 'PRO', 'isPaid', 'priceCents'])
  assert.deepEqual(k.User.members, ['id', 'name', 'email'])
  assert.deepEqual(k.Loading.members, [])
  const s = analyze(src('swift', 'types'), 'swift').types
  assert.deepEqual(s.LoadState.members, ['loading', 'loaded', 'failed'])
  assert.ok(s.Counter.members.includes('value'), 'private(set) is readable')
  assert.deepEqual(analyze(src('dart', 'basics'), 'dart').top.includes('counter'), true)
  // a widget class may become a function; members of UI are not compared
  assert.deepEqual(compare(read(path.join(REF, 'ui', 'flutter', 'lists.dart')), 'dart', read(path.join(REF, 'ui', 'compose', 'lists.kt')), 'kotlin', { kind: 'widget' }), [])
  // dropped member + ignore
  const dart = 'class Cart {\n  void add(String id) {}\n  void clear() {}\n}\n'
  assert.deepEqual(compare(dart, 'dart', 'class CartViewModel {\n    fun add(id: String) {}\n}\n', 'kotlin', { rename: { Cart: 'CartViewModel' } }), ['member Cart.clear'])
  assert.deepEqual(compare(dart, 'dart', 'class CartViewModel {\n    fun add(id: String) {}\n}\n', 'kotlin', { ignore: ['Cart.clear'] }), [])
  // tests match by name
  assert.deepEqual(compare("test('adds an item', () {});\ntest('clears the cart', () {});", 'dart', '@Test fun `adds an item`() {}', 'kotlin', { kind: 'test' }), ['test "clears the cart"'])
  assert.deepEqual(compare("it('clears the cart', () => {})", 'ts', 'func testClearsTheCart() {}', 'swift', { kind: 'test' }), [])
})

test('idioms: index, one topic with pitfalls, UI state, same language, cheat sheet', () => {
  const p = makeProject({ mobile: 'flutter' })
  const idx = port(p, 'idioms', '--from', 'flutter', '--to', 'android').out
  assert.match(idx, /types\s+class, data-class, enum, sealed/); assert.match(idx, /state\s+local-state, shared-state, shared-state-bloc/)
  const asy = port(p, 'idioms', '--from', 'flutter', '--to', 'ios', '--topic', 'async').out
  assert.match(asy, /```dart\nFuture<User\?> loadUser/); assert.match(asy, /```swift\nfunc loadUser/); assert.match(asy, /\*\*Pitfalls\*\*[\s\S]*Kotlin suspend and Swift async calls run when awaited/)
  const st = port(p, 'idioms', '--from', 'flutter', '--to', 'kmp', '--topic', 'state').out
  assert.match(st, /class CartNotifier extends Notifier<CartState>[\s\S]*class CartViewModel : ViewModel\(\)/)
  assert.match(st, /shared-state-bloc[\s\S]*```kotlin\n\/\/? ?data class CartState|shared-state-bloc[\s\S]*class CartViewModel/)
  assert.match(st, /compose pitfalls/)
  assert.match(port(p, 'idioms', '--from', 'react-native', '--to', 'flutter', '--topic', 'navigation').out, /createNativeStackNavigator[\s\S]*GoRouter/)
  assert.match(port(p, 'idioms', '--from', 'android', '--to', 'kmp').out, /Same language \(kotlin\)/)
  assert.equal(port(p, 'idioms', '--from', 'dart', '--to', 'kotlin', '--topic', 'layout').code, 1, 'UI topic needs UI frameworks')
  const w = port(p, 'idioms', '--from', 'flutter', '--to', 'android', '--write')
  assert.equal(w.code, 0, w.err)
  const sheet = read(path.join(p, '.dualcraft', 'convert', 'port-flutter-android.md'))
  assert.equal((sheet.match(/^## /gm) || []).length, LANG_TOPICS.length + UI_TOPICS.length)
})

function shop() {
  const p = makeProject({ mobile: 'flutter,android', paths: { flutter: 'app', android: 'droid' } })
  write(path.join(p, 'app/pubspec.yaml'), 'name: shop\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_riverpod: ^2.5.0\n  dio: any\n  go_router: any\n  shared_preferences: any\n  firebase_auth: any\n  weird_pkg: any\ndev_dependencies:\n  flutter_lints: any\n  build_runner: any\n  mocktail: any\n')
  write(path.join(p, 'app/lib/core/models/product.dart'), "enum Plan { free, pro }\nclass Product {\n  const Product({required this.id, required this.price, this.plan = Plan.free});\n  factory Product.fromJson(Map<String, dynamic> j) => Product(id: j['id'] as String, price: (j['price'] as num).toDouble());\n  final String id;\n  final double price;\n  final Plan plan;\n}\n")
  write(path.join(p, 'app/lib/core/models/product.g.dart'), '// generated\n')
  write(path.join(p, 'app/lib/features/cart/data/cart_repository.dart'), "import 'package:shop/core/models/product.dart';\nclass CartRepository {\n  Future<List<Product>> fetch() async => [];\n  Future<void> save(Product p) async {}\n  void _secret() {}\n}\n")
  write(path.join(p, 'app/lib/features/cart/application/cart_notifier.dart'), "import 'package:flutter_riverpod/flutter_riverpod.dart';\nimport '../data/cart_repository.dart';\nclass CartState { const CartState({this.items = const []}); final List<String> items; }\nclass CartNotifier extends Notifier<CartState> {\n  @override\n  CartState build() => const CartState();\n  void add(String id) => state = CartState(items: [...state.items, id]);\n  void clear() => state = const CartState();\n}\nfinal cartProvider = NotifierProvider<CartNotifier, CartState>(CartNotifier.new);\n")
  write(path.join(p, 'app/lib/features/cart/presentation/cart_screen.dart'), "import 'package:flutter/material.dart';\nimport '../application/cart_notifier.dart';\nimport 'widgets/cart_row.dart';\nclass CartScreen extends ConsumerWidget {\n  const CartScreen({super.key});\n  @override\n  Widget build(BuildContext context, WidgetRef ref) => const CartRow(label: 'x');\n}\n")
  write(path.join(p, 'app/lib/features/cart/presentation/widgets/cart_row.dart'), "import 'package:flutter/material.dart';\nclass CartRow extends StatelessWidget {\n  const CartRow({super.key, required this.label});\n  final String label;\n  @override\n  Widget build(BuildContext context) => Text(label);\n}\n")
  write(path.join(p, 'app/lib/features/profile/profile_screen.dart'), "import 'package:flutter/material.dart';\nclass ProfileScreen extends StatelessWidget {\n  const ProfileScreen({super.key});\n  @override\n  Widget build(BuildContext context) => const Text('p');\n}\n")
  write(path.join(p, 'app/test/cart_notifier_test.dart'), "import 'package:shop/features/cart/application/cart_notifier.dart';\nvoid main() {\n  test('adds an item to the cart', () {});\n  test('clear empties the cart', () {});\n}\n")
  write(path.join(p, 'droid/app/build.gradle.kts'), 'plugins { id("com.android.application") }\nandroid { namespace = "com.acme.shop" }\n')
  return p
}

test('deps: Flutter → Android / KMP / iOS / React Native, and back from Gradle, SPM and npm', () => {
  const p = shop()
  const a = port(p, 'deps', '--from', 'flutter', '--to', 'android', '--write')
  assert.equal(a.code, 0, a.err)
  assert.match(a.out, /✓ flutter_riverpod\s+state\s+→ androidx\.lifecycle:lifecycle-viewmodel-compose/)
  assert.match(a.out, /✓ dio\s+http\s+→ com\.squareup\.retrofit2:retrofit \| com\.squareup\.okhttp3:okhttp \| io\.ktor:ktor-client-okhttp/)
  assert.match(a.out, /\? weird_pkg\s+no known equivalent/)
  assert.match(a.out, /tooling, no runtime equivalent: flutter, flutter_lints, build_runner/)
  assert.match(a.out, /retrofit = \{ module = "com\.squareup\.retrofit2:retrofit", version = "<latest>" \}/)
  const dj = JSON.parse(read(path.join(p, '.dualcraft/convert/deps.json')))
  assert.equal(dj.deps.find((d) => d.source === 'dio').choice, 'com.squareup.retrofit2:retrofit')
  // a recorded choice survives a re-run
  dj.deps.find((d) => d.source === 'dio').choice = 'io.ktor:ktor-client-okhttp'; write(path.join(p, '.dualcraft/convert/deps.json'), JSON.stringify(dj))
  assert.match(port(p, 'deps', '--from', 'flutter', '--to', 'android').out, /dio\s+http\s+→ io\.ktor:ktor-client-okhttp \| com\.squareup/)
  assert.match(port(p, 'deps', '--from', 'flutter', '--to', 'kmp', '--target', 'droid').out, /dio\s+http\s+→ io\.ktor:ktor-client-core[\s\S]*commonMain\.dependencies/)
  const ios = port(p, 'deps', '--from', 'flutter', '--to', 'ios').out
  assert.match(ios, /firebase_auth\s+firebase-auth\s+→ https:\/\/github\.com\/firebase\/firebase-ios-sdk#FirebaseAuth/)
  assert.match(ios, /\.package\(url: "https:\/\/github\.com\/firebase\/firebase-ios-sdk", from: "<latest>"\)\s+\/\/ products: FirebaseAuth/)
  assert.match(port(p, 'deps', '--from', 'flutter', '--to', 'react-native').out, /npx expo install @tanstack\/react-query|npx expo install zustand/)
  // reverse: Gradle catalog + build file → pub
  const k = makeProject({ mobile: 'android', paths: { mobile: 'droid' } })
  write(path.join(k, 'droid/gradle/libs.versions.toml'), '[versions]\nroom = "2.7"\n[libraries]\nroom-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }\nhilt = { group = "com.google.dagger", name = "hilt-android", version = "2.5" }\n')
  write(path.join(k, 'droid/app/build.gradle.kts'), 'dependencies {\n  implementation(libs.room.runtime)\n  implementation(libs.hilt)\n  implementation("io.coil-kt.coil3:coil-compose:3.0.4")\n  implementation("androidx.core:core-ktx:1.15.0")\n  testImplementation("io.mockk:mockk:1.13.13")\n}\n')
  const kf = port(k, 'deps', '--from', 'android', '--to', 'flutter').out
  for (const re of [/androidx\.room:room-runtime\s+database\s+→ sqflite \| drift/, /com\.google\.dagger:hilt-android\s+di\s+→ get_it/, /io\.coil-kt\.coil3:coil-compose\s+image-loading\s+→ cached_network_image/, /io\.mockk:mockk \(dev\)\s+mocks\s+→ mocktail/, /tooling[^\n]*androidx\.core:core-ktx/, /flutter pub add cached_network_image mocktail sqflite get_it/]) assert.match(kf, re)
  // reverse: SPM + framework imports → Kotlin
  const i = makeProject({ mobile: 'ios', paths: { mobile: 'iosapp' } })
  write(path.join(i, 'iosapp/Package.swift'), '.package(url: "https://github.com/Alamofire/Alamofire.git", from: "5.0.0"),\n.package(url: "https://github.com/firebase/firebase-ios-sdk", from: "11.0.0"),\n.product(name: "FirebaseFirestore", package: "firebase-ios-sdk")\n')
  write(path.join(i, 'iosapp/App/Pay.swift'), 'import StoreKit\nimport SwiftUI\n')
  const io = port(i, 'deps', '--from', 'ios', '--to', 'kmp').out
  for (const re of [/Alamofire\s+http\s+→ io\.ktor:ktor-client-core/, /FirebaseFirestore\s+firestore\s+→ dev\.gitlive:firebase-firestore/, /import StoreKit\s+iap\s+→ expect\/actual/]) assert.match(io, re)
  // npm → Kotlin
  const r = makeProject({ mobile: 'react-native', paths: { mobile: 'rn' } })
  write(path.join(r, 'rn/package.json'), JSON.stringify({ dependencies: { expo: '52', zustand: '5', 'expo-image': '2', '@react-native-firebase/auth': '21' }, devDependencies: { jest: '29' } }))
  assert.match(port(r, 'deps', '--from', 'react-native', '--to', 'android').out, /zustand\s+state\s+→ androidx\.lifecycle[\s\S]*expo-image\s+image-loading\s+→ io\.coil-kt\.coil3:coil-compose[\s\S]*@react-native-firebase\/auth\s+firebase-auth\s+→ com\.google\.firebase:firebase-auth/)
})

test('files + parity: plan from the conversion inventory, gaps reported, intentional drops, full parity', () => {
  const p = shop()
  assert.equal(run('convert.mjs', ['init', '--from', 'flutter', '--to', 'android'], p).code, 0)
  const f = port(p, 'files', 'cart')
  assert.equal(f.code, 0, f.err)
  const plan = JSON.parse(read(path.join(p, '.dualcraft/convert/files/cart.json')))
  const by = (s) => plan.files.find((e) => e.source.endsWith(s))
  assert.equal(plan.from, 'flutter'); assert.equal(plan.to, 'android'); assert.equal(plan.target, 'droid')
  assert.deepEqual([by('cart_screen.dart').kind, by('cart_row.dart').kind, by('cart_notifier.dart').kind, by('cart_repository.dart').kind, by('product.dart').kind, by('cart_notifier_test.dart').kind], ['screen', 'widget', 'state', 'repository', 'model', 'test'])
  assert.equal(by('cart_notifier.dart').target, 'app/src/main/java/com/acme/shop/ui/cart/CartViewModel.kt')
  assert.deepEqual(by('cart_notifier.dart').rename, { CartNotifier: 'CartViewModel' })
  assert.equal(by('product.dart').target, 'app/src/main/java/com/acme/shop/data/model/Product.kt'); assert.equal(by('product.dart').shared, true)
  assert.equal(by('cart_notifier_test.dart').target, 'app/src/test/java/com/acme/shop/cart/CartViewModelTest.kt'); assert.equal(by('cart_notifier_test.dart').tests, 2)
  assert.ok(!plan.files.some((e) => e.source.includes('profile') || e.source.endsWith('.g.dart')), 'other features and generated parts are not pulled in')
  // the same plan for iOS and Flutter-side naming
  const ios = JSON.parse(read(path.join(p, '.dualcraft/convert/files/cart.json'))) && port(p, 'files', 'cart', '--from', 'flutter', '--to', 'ios', '--force').out
  assert.match(ios, /App\/Features\/Cart\/CartView\.swift/); assert.match(ios, /App\/Features\/Cart\/CartViewModel\.swift/); assert.match(ios, /AppTests\/CartViewModelTests\.swift/); assert.match(ios, /App\/Core\/Models\/Product\.swift/)
  port(p, 'files', 'cart', '--force')

  const K = (...x) => path.join(p, 'droid/app/src/main/java/com/acme/shop', ...x)
  write(K('ui/cart/CartViewModel.kt'), 'data class CartState(val items: List<String> = emptyList())\nclass CartViewModel : ViewModel() {\n    fun add(id: String) {}\n}\n')
  write(K('data/CartRepository.kt'), 'class CartRepository {\n    suspend fun fetch(): List<Product> = emptyList()\n    suspend fun save(p: Product) {}\n}\n')
  write(K('data/model/Product.kt'), 'enum class Plan { FREE }\n@Serializable\ndata class Product(\n    val id: String,\n    val price: Double,\n)\n')
  write(K('ui/cart/CartScreen.kt'), '@Composable\nfun CartScreen() { Text("x") }\n')
  write(path.join(p, 'droid/app/src/test/java/com/acme/shop/cart/CartViewModelTest.kt'), 'class CartViewModelTest {\n    @Test fun `adds an item to the cart`() {}\n}\n')
  const r = port(p, 'parity', 'cart')
  assert.equal(r.code, 1)
  for (const re of [/missing member CartNotifier\.clear/, /missing case Plan\.pro/, /missing member Product\.plan/, /missing test "clear empties the cart"/, /cart_row\.dart → .*CartRow\.kt: not written yet/, /✓ app\/lib\/features\/cart\/data\/cart_repository\.dart/, /2\/6 files ported/]) assert.match(r.out, re)
  assert.doesNotMatch(r.out, /_secret|cartProvider|fromJson|build/)
  // finish the port; record one intentional drop
  write(K('ui/cart/CartRow.kt'), '@Composable\nfun CartRow(label: String) { Text(label) }\n')
  write(K('data/model/Product.kt'), 'enum class Plan { FREE, PRO }\ndata class Product(val id: String, val price: Double, val plan: Plan = Plan.FREE)\n')
  write(path.join(p, 'droid/app/src/test/java/com/acme/shop/cart/CartViewModelTest.kt'), 'class CartViewModelTest {\n    @Test fun `adds an item to the cart`() {}\n    @Test fun `clear empties the cart`() {}\n}\n')
  const pl = JSON.parse(read(path.join(p, '.dualcraft/convert/files/cart.json')))
  Object.assign(pl.files.find((e) => e.source.endsWith('cart_notifier.dart')), { ignore: ['CartNotifier.clear'], note: 'the cart is cleared by the backend after checkout' })
  write(path.join(p, '.dualcraft/convert/files/cart.json'), JSON.stringify(pl))
  const ok = port(p, 'parity', 'cart')
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /6\/6 files ported with parity/)
  assert.ok(JSON.parse(read(path.join(p, '.dualcraft/convert/files/cart.json'))).files.every((e) => e.status === 'ported'))
  // re-planning keeps the edited entries
  port(p, 'files', 'cart')
  assert.equal(JSON.parse(read(path.join(p, '.dualcraft/convert/files/cart.json'))).files.find((e) => e.source.endsWith('cart_notifier.dart')).note, 'the cart is cleared by the backend after checkout')
  assert.ok(exists(path.join(p, '.dualcraft/convert/status.json')))
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'port', 'SKILL.md')))
})
