// E2E pack: flows derived from auth/routes/payments/screenshots → Playwright specs + Maestro flows; check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeProject, write, read, exists } from './helpers.mjs'

const e2e = (p, ...a) => run('e2e.mjs', a, p)
const flowsFile = (p) => path.join(p, '.dualcraft', 'e2e', 'flows.json')

function setup() {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  write(path.join(p, 'site', 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'next build', start: 'next start' } }))
  write(path.join(p, 'site', 'src', 'app', 'page.tsx'), 'export default function Home() { return null }\n')
  write(path.join(p, 'site', 'src', 'app', 'login', 'page.tsx'), 'export default function Login() { return null }\n')
  write(path.join(p, 'site', 'src', 'app', 'matches', '[id]', 'page.tsx'), 'export default function M() { return null }\n')
  write(path.join(p, 'app', 'pubspec.yaml'), 'name: app\n')
  write(path.join(p, 'app', 'android', 'app', 'build.gradle.kts'), 'android { defaultConfig { applicationId = "com.acme.app" } }\n')
  write(path.join(p, 'app', 'lib', 'router.dart'), "final r = GoRouter(routes: [GoRoute(path: '/matches', builder: (c, s) => const MatchesScreen())]);\nclass MatchesScreen extends StatelessWidget {}\n")
  run('backend.mjs', ['init', '--provider', 'firebase', '--region', 'europe-west1'], p)
  run('auth.mjs', ['init', '--methods', 'email,google,apple', '--mfa', 'none'], p)
  return p
}

test('init derives auth and smoke flows → Playwright specs (texts from i18n) and Maestro flows', () => {
  const p = setup()
  const r = e2e(p, 'init', '--scheme', 'acme')
  assert.equal(r.code, 0, r.err)
  const spec = JSON.parse(read(flowsFile(p)))
  assert.equal(spec.mobile.appId, 'com.acme.app'); assert.equal(spec.web.baseUrl, 'http://localhost:3000')
  const ids = spec.flows.map((f) => f.id)
  for (const id of ['auth-protected-redirect', 'auth-wrong-password', 'auth-sign-up-validation', 'auth-sign-in', 'auth-sign-up-delete', 'auth-guest', 'smoke-web-home', 'smoke-web-login', 'smoke-app-matches']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.some((i) => /matches-id/.test(i)), 'dynamic routes are not smoke-tested')
  const wrong = read(path.join(p, 'site/e2e/dualcraft/auth-wrong-password.spec.ts'))
  assert.match(wrong, /field\(page, 'Contraseña'\)\.fill\('wrong-Password-123'\)/); assert.match(wrong, /getByText\('Email o contraseña incorrectos', \{ exact: true \}\)/)
  assert.match(read(path.join(p, 'site/e2e/dualcraft/auth-sign-up-validation.spec.ts')), /'Al menos 8 caracteres'/)
  assert.match(read(path.join(p, 'site/e2e/dualcraft/auth-sign-in.spec.ts')), /test\.skip\(!env\('E2E_EMAIL'\)/)
  assert.match(read(path.join(p, 'site/e2e/dualcraft/smoke-web-home.spec.ts')), /u\.pathname === '\/login'/, 'protected home → sign in')
  const m = read(path.join(p, 'app/.maestro/dualcraft/auth-sign-in.yaml'))
  assert.match(m, /^appId: com\.acme\.app$/m); assert.match(m, /openLink: "acme:\/\/login"/); assert.match(m, /inputText: "\$\{E2E_PASSWORD\}"/)
  assert.match(read(path.join(p, 'app/.maestro/dualcraft/auth-wrong-password.yaml')), /text: "Email o contraseña incorrectos"/)
  assert.match(read(path.join(p, 'app/.maestro/dualcraft/auth-sign-up-validation.yaml')), /text: "¿No tienes cuenta\\\\\? Regístrate"/, 'regex characters escaped')
  assert.ok(exists(path.join(p, 'site/playwright.config.ts'))); assert.ok(exists(path.join(p, 'app/.maestro/config.yaml')))
  assert.ok(JSON.parse(read(path.join(p, 'site/package.json'))).devDependencies['@playwright/test'])
  const c = e2e(p, 'check')
  assert.equal(c.code, 0, c.out)
  assert.match(c.out, /no Playwright job/)
})

test('custom flows are kept, derived ones refreshed; check catches drift, bad steps and unknown texts', () => {
  const p = setup()
  e2e(p, 'init', '--scheme', 'acme')
  const spec = JSON.parse(read(flowsFile(p)))
  spec.flows.push({ id: 'buy-coins', title: 'Compra monedas', platforms: ['mobile'], tags: ['payments'], steps: [{ open: '/shop' }, { tap: { id: 'buy-coins' } }, { see: 't:shop.thanks' }] })
  write(flowsFile(p), JSON.stringify(spec))
  assert.equal(e2e(p, 'gen').code, 0)
  assert.ok(exists(path.join(p, 'app/.maestro/dualcraft/buy-coins.yaml')))
  assert.ok(!exists(path.join(p, 'site/e2e/dualcraft/buy-coins.spec.ts')), 'mobile-only flow')
  const c = e2e(p, 'check')
  assert.equal(c.code, 1); assert.match(c.out, /texts not in es\.json: shop\.thanks/)
  // derived flows follow auth.json: guest off → auth-guest removed (spec and generated files)
  const a = path.join(p, '.dualcraft/auth/auth.json'); write(a, JSON.stringify({ ...JSON.parse(read(a)), guest: false }))
  assert.match(e2e(p, 'check').out, /derived flows out of date/)
  const g = e2e(p, 'gen')
  assert.match(g.out, /auth-guest\.spec\.ts \(removed: flow gone\)/)
  assert.ok(JSON.parse(read(flowsFile(p))).flows.some((f) => f.id === 'buy-coins'), 'custom flow kept')
  // validation
  write(flowsFile(p), JSON.stringify({ ...JSON.parse(read(flowsFile(p))), flows: [{ id: 'Bad Id', steps: [{ click: 'x' }, { fill: 'Email' }] }] }))
  const v = e2e(p, 'gen')
  assert.equal(v.code, 1)
  for (const re of [/id must be kebab-case/, /one of open, tap/, /fill needs "with"/]) assert.match(v.out, re)
})

test('payments paywall and store screenshots flows; deploy adds a Playwright job', () => {
  const p = setup()
  write(path.join(p, '.dualcraft/payments/products.json'), read(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'fixtures', 'products.json')))
  write(path.join(p, '.dualcraft/store/screenshots.json'), JSON.stringify({ screens: [{ name: 'home', web: 'http://localhost:3000/', android: 'acme://home' }] }))
  assert.equal(e2e(p, 'init', '--scheme', 'acme').code, 0)
  const pay = read(path.join(p, 'app/.maestro/dualcraft/payments-paywall.yaml'))
  assert.match(pay, /openLink: "acme:\/\/paywall"/); assert.match(pay, /id: "product-coins_100"/)
  assert.match(read(path.join(p, 'app/.maestro/dualcraft/store-screenshots-app.yaml')), /takeScreenshot: "\.\.\/\.dualcraft\/store\/screenshots\/raw\/es\/\$\{maestro\.platform\}\/home"/)
  assert.match(read(path.join(p, 'site/e2e/dualcraft/store-screenshots-web.spec.ts')), /shot\(page, 'home', '\.\.\/\.dualcraft\/store\/screenshots\/raw\/es\/web'\)/)
  assert.equal(run('deploy.mjs', ['init', '--host', 'vercel'], p).code, 0)
  const ci = read(path.join(p, '.github/workflows/dualcraft-ci.yml'))
  assert.match(ci, /e2e-nextjs:[\s\S]*E2E_PASSWORD: \$\{\{ secrets\.E2E_PASSWORD \}\}[\s\S]*playwright install --with-deps chromium[\s\S]*playwright test/)
  assert.doesNotMatch(e2e(p, 'check').out, /no Playwright job/)
})

test('accessibility: axe on public smoke routes and a11y steps, settings validated, dependency added; opt-in for existing specs', () => {
  const p = setup()
  assert.equal(e2e(p, 'init', '--scheme', 'acme').code, 0)
  const spec = JSON.parse(read(flowsFile(p)))
  assert.deepEqual(spec.a11y, { level: 'serious', tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], disable: [], exclude: [] })
  assert.deepEqual(spec.flows.find((f) => f.id === 'smoke-web-login').steps.at(-1), { a11y: true }, 'public route checked')
  assert.ok(!spec.flows.find((f) => f.id === 'smoke-web-matches-id')?.steps.some((s) => 'a11y' in s), 'protected route (redirects to sign-in) not checked twice')
  const support = read(path.join(p, 'site/e2e/dualcraft/support.ts'))
  assert.match(support, /import AxeBuilder from '@axe-core\/playwright'/); assert.match(support, /const A11Y = \{ level: "serious", tags: \["wcag2a"/)
  assert.match(read(path.join(p, 'site/e2e/dualcraft/smoke-web-login.spec.ts')), /import \{ test, expect, expectAccessible \} from "\.\/support"[\s\S]*await expectAccessible\(page, 'smoke-web-login'\)/)
  assert.match(read(path.join(p, 'site/package.json')), /"@axe-core\/playwright": "\^4\.14\.1"/)
  // a custom flow with a named check
  spec.flows.push({ id: 'profile-a11y', platforms: ['web'], steps: [{ open: '/login' }, { a11y: 'login form' }] }); write(flowsFile(p), JSON.stringify(spec))
  e2e(p, 'gen'); assert.match(read(path.join(p, 'site/e2e/dualcraft/profile-a11y.spec.ts')), /await expectAccessible\(page, 'login form'\)/)
  // dependency removed → check fails; bad settings → validation
  const pj = path.join(p, 'site/package.json'); const pkg = JSON.parse(read(pj)); delete pkg.devDependencies['@axe-core/playwright']; write(pj, JSON.stringify(pkg))
  assert.match(e2e(p, 'check').out, /lacks @axe-core\/playwright/)
  write(flowsFile(p), JSON.stringify({ ...spec, a11y: { level: 'blocker', tags: 'wcag2aa' } }))
  const v = e2e(p, 'gen'); assert.equal(v.code, 1); assert.match(v.out, /a11y\.level must be minor, moderate, serious, critical/); assert.match(v.out, /a11y\.tags must be a list of strings/)
  // turning it off removes the checks; an a11y step then needs the settings back
  write(flowsFile(p), JSON.stringify(spec)); assert.equal(e2e(p, 'init', '--no-a11y').code, 1, 'the custom a11y step still needs settings')
  const off = JSON.parse(read(flowsFile(p))); off.flows = off.flows.filter((f) => f.id !== 'profile-a11y'); write(flowsFile(p), JSON.stringify(off))
  assert.equal(e2e(p, 'init', '--no-a11y').code, 0)
  assert.ok(!JSON.parse(read(flowsFile(p))).flows.some((f) => f.steps.some((s) => 'a11y' in s)))
  assert.doesNotMatch(read(path.join(p, 'site/e2e/dualcraft/support.ts')), /AxeBuilder/)
  assert.equal(e2e(p, 'init', '--a11y').code, 0); assert.ok(JSON.parse(read(flowsFile(p))).a11y)
})
