#!/usr/bin/env node
// DualCraft CI/CD: GitHub Actions workflows generated from the project's stacks and .dualcraft/deploy/pipeline.json.
//   init [--host firebase|vercel|cloudflare|netlify] [--android-track internal|alpha|beta]   pipeline + workflows + iOS ExportOptions
//   gen [--force]        regenerate .github/workflows/dualcraft-*.yml (hash-protected)
//   secrets [--json]     secrets/variables every workflow needs, per GitHub environment, and which are missing in the repo
//   check [--json]       workflows up to date, release signing in the projects, host/stack fit, secrets kept out of git
// Flow: pull request → CI + web preview · push to main → CI + deploy to dev · tag v* → deploy to production (environment
// "production", add required reviewers) + mobile builds to Play internal testing / TestFlight.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks } from './lib/targets.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'secrets', 'check'].includes(cmd)) {
  console.log(`node deploy.mjs init [--host firebase|vercel|cloudflare|netlify] | gen [--force] | secrets [--json] | check [--json]
pipeline.json: {"web":{"host":"vercel","project":"acme-web"},"mobile":{"release":"testing","androidTrack":"internal"},"branch":"main"}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'deploy', 'pipeline.json')
const WF = path.join(root, '.github', 'workflows')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const exists = (...p) => fs.existsSync(path.join(...p))
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const stacks = projectStacks(root, config)
const HOSTS = ['firebase', 'vercel', 'cloudflare', 'netlify']
const provider = () => readJson(path.join(dir, 'backend', 'api.json'))?.provider || ({ firebase: 'firebase', supabase: 'supabase', 'postgres-prisma': 'http' })[config.backend?.provider] || null
const functionsDir = () => {
  if (config.paths?.functions) return path.join(root, config.paths.functions)
  const s = [].concat(readJson(path.join(root, 'firebase.json'))?.functions || [])[0]?.source
  return path.join(root, s || 'functions')
}
const E = (x) => '${{ ' + x + ' }}' // GitHub expression
const TAG = "startsWith(github.ref, 'refs/tags/v')"
const ENV_EXPR = E(`${TAG} && 'production' || 'dev'`)

// ---------------------------------------------------------------- project facts
function nodePm(d) {
  if (exists(d, 'pnpm-lock.yaml')) return { name: 'pnpm', install: 'corepack enable && pnpm install --frozen-lockfile', run: 'pnpm run', cache: 'pnpm', lock: 'pnpm-lock.yaml', x: 'pnpm exec' }
  if (exists(d, 'yarn.lock')) return { name: 'yarn', install: 'corepack enable && yarn install --immutable', run: 'yarn run', cache: 'yarn', lock: 'yarn.lock', x: 'yarn' }
  return { name: 'npm', install: 'npm ci', run: 'npm run', cache: 'npm', lock: 'package-lock.json', x: 'npx' }
}
const scripts = (d) => readJson(path.join(d, 'package.json'))?.scripts || {}
function webOut(s) {
  const pj = readJson(path.join(s.dir, 'package.json')) || {}
  const deps = { ...pj.dependencies, ...pj.devDependencies }
  const nextCfg = ['next.config.ts', 'next.config.mjs', 'next.config.js'].map((n) => read(path.join(s.dir, n))).join('\n')
  if (s.id === 'nextjs') { const exp = /output:\s*['"]export['"]/.test(nextCfg); return { out: exp ? 'out' : null, ssr: !exp } }
  if (s.id === 'nuxt') return { out: '.output/public', ssr: !/ssr:\s*false/.test(read(path.join(s.dir, 'nuxt.config.ts'))), build: 'nuxi generate' }
  if (s.id === 'astro') return { out: 'dist', ssr: Object.keys(deps).some((d) => /^@astrojs\/(node|vercel|netlify|cloudflare)$/.test(d)) }
  return { out: 'dist', ssr: false }
}
const gradleApp = (s) => (s.id === 'kmp' ? (['composeApp', 'androidApp', 'app'].find((m) => exists(s.dir, m, 'build.gradle.kts') || exists(s.dir, m, 'build.gradle')) || 'composeApp') : 'app')
function applicationId(s) {
  const files = s.id === 'flutter' ? [path.join(s.dir, 'android/app/build.gradle.kts'), path.join(s.dir, 'android/app/build.gradle')] : [path.join(s.dir, gradleApp(s), 'build.gradle.kts'), path.join(s.dir, gradleApp(s), 'build.gradle')]
  for (const f of files) { const m = read(f).match(/applicationId\s*=?\s*["']([\w.]+)["']/); if (m) return m[1] }
  return readJson(path.join(dir, 'payments', 'products.json'))?.android?.packageName || null
}
function iosProject(s) {
  const base = s.id === 'flutter' ? path.join(s.dir, 'ios') : s.id === 'kmp' ? path.join(s.dir, 'iosApp') : s.dir
  if (!fs.existsSync(base)) return null
  const entries = fs.readdirSync(base)
  const ws = entries.find((e) => e.endsWith('.xcworkspace'))
  const pr = entries.find((e) => e.endsWith('.xcodeproj'))
  if (!pr && !ws) return null
  const scheme = s.id === 'flutter' ? 'Runner' : (pr || ws).replace(/\.(xcodeproj|xcworkspace)$/, '')
  return { dir: base, flag: ws ? `-workspace ${ws}` : `-project ${pr}`, scheme }
}
const canAndroid = (s) => ['flutter', 'android', 'kmp'].includes(s.id)
const canIos = (s) => ['flutter', 'ios', 'kmp'].includes(s.id) && iosProject(s)
const jobId = (s) => s.id.replace(/[^a-z0-9]/g, '-')
const wd = (d) => rel(d)

// ---------------------------------------------------------------- pipeline
function load() {
  if (!fs.existsSync(file)) die('no .dualcraft/deploy/pipeline.json yet — run /dualcraft:deploy (init) first')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`pipeline.json is not valid JSON: ${e.message}`) }
}
function validate(p) {
  const errors = []; const warnings = []
  const web = stacks.filter((s) => s.kind === 'web')
  if (web.length && !HOSTS.includes(p.web?.host)) errors.push(`web.host must be ${HOSTS.join('|')}`)
  if (p.mobile?.androidTrack && !['internal', 'alpha', 'beta'].includes(p.mobile.androidTrack)) errors.push('mobile.androidTrack must be internal|alpha|beta (production is promoted by hand in Play Console)')
  for (const s of web) {
    const o = webOut(s)
    if (p.web?.host === 'firebase' && o.ssr) warnings.push(`${s.id}: server rendering doesn't run on Firebase Hosting — use Firebase App Hosting (deploys itself from GitHub; no workflow) or Vercel/Netlify. The workflow deploys the static output only.`)
    if (p.web?.host === 'cloudflare' && s.id === 'nextjs' && o.ssr) warnings.push('nextjs on Cloudflare needs @opennextjs/cloudflare (its build replaces the static deploy below)')
    if (p.web?.host === 'cloudflare' && !p.web?.project) errors.push('web.project: the Cloudflare Pages project name')
  }
  return { errors, warnings }
}

// ---------------------------------------------------------------- workflow builders (YAML as lines)
const HEADER = (title) => [`# GENERATED by DualCraft from .dualcraft/deploy/pipeline.json — change the pipeline and run /dualcraft:deploy gen.`, `name: ${title}`, '']
const checkout = ['      - uses: actions/checkout@v5']
const setupNode = (d, pm) => ['      - uses: actions/setup-node@v5', '        with:', '          node-version: 22', `          cache: ${pm.cache}`, `          cache-dependency-path: ${posix(path.join(wd(d), pm.lock))}`]
const flutterSetup = (s) => {
  const fvm = readJson(path.join(s.dir, '.fvmrc'))?.flutter || readJson(path.join(s.dir, '.fvm', 'fvm_config.json'))?.flutterSdkVersion
  return ['      - uses: subosito/flutter-action@v2', '        with:', fvm ? `          flutter-version: ${fvm}` : '          channel: stable', '          cache: true']
}
const javaSetup = ['      - uses: actions/setup-java@v4', '        with:', '          distribution: temurin', '          java-version: 17']

function ciWorkflow(p) {
  const L = [...HEADER('CI'), 'on:', '  pull_request:', '  push:', `    branches: [${p.branch || 'main'}]`, '', 'concurrency:', `  group: ci-${E('github.ref')}`, '  cancel-in-progress: true', '', 'permissions:', '  contents: read', '', 'jobs:']
  for (const s of stacks) {
    L.push(`  ${jobId(s)}:`, `    name: ${s.id} (${wd(s.dir)})`)
    if (s.id === 'ios') {
      const x = iosProject(s)
      L.push('    runs-on: macos-latest', '    steps:', ...checkout, `      - working-directory: ${wd(x?.dir || s.dir)}`, `        run: xcodebuild ${x?.flag || ''} -scheme ${x?.scheme || 'App'} -destination 'generic/platform=iOS Simulator' build-for-testing CODE_SIGNING_ALLOWED=NO`)
    } else if (s.id === 'flutter') {
      const pub = read(path.join(s.dir, 'pubspec.yaml'))
      L.push('    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...javaSetup, ...flutterSetup(s), '      - run: flutter pub get')
      if (/^\s+build_runner:/m.test(pub)) L.push('      - run: dart run build_runner build --delete-conflicting-outputs')
      L.push('      - run: flutter analyze --no-fatal-infos')
      if (exists(s.dir, 'test')) L.push('      - run: flutter test')
      L.push('      - run: flutter build apk --debug')
    } else if (s.id === 'android' || s.id === 'kmp') {
      const m = gradleApp(s)
      L.push('    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...javaSetup, '      - uses: gradle/actions/setup-gradle@v4', '      - run: chmod +x gradlew', `      - run: ./gradlew :${m}:testDebugUnitTest :${m}:assembleDebug${s.id === 'android' ? ` :${m}:lintDebug` : ''}`)
    } else {
      const pm = nodePm(s.dir); const sc = scripts(s.dir)
      L.push('    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...setupNode(s.dir, pm), `      - run: ${pm.install}`)
      if (sc.lint) L.push(`      - run: ${pm.run} lint`)
      if (sc.typecheck) L.push(`      - run: ${pm.run} typecheck`)
      else if (s.id === 'react-native') L.push(`      - run: ${pm.x} tsc --noEmit`)
      if (sc.test && !/no test specified/.test(sc.test)) L.push(`      - run: ${pm.run} test`)
      if (s.kind === 'web') L.push(`      - run: ${pm.run} build`)
    }
  }
  const prov = provider()
  if (prov === 'firebase' && exists(functionsDir(), 'package.json')) {
    const fd = functionsDir(); const pm = nodePm(fd); const sc = scripts(fd)
    L.push('  functions:', '    name: Cloud Functions', '    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(fd)}`, '    steps:', ...checkout, ...setupNode(fd, pm), `      - run: ${pm.install}`)
    if (sc.lint) L.push(`      - run: ${pm.run} lint`)
    L.push(`      - run: ${pm.run} build`)
  }
  if (prov === 'supabase' && exists(root, 'supabase', 'functions')) L.push('  edge-functions:', '    name: Supabase Edge Functions', '    runs-on: ubuntu-latest', '    steps:', ...checkout, '      - uses: denoland/setup-deno@v2', '        with:', '          deno-version: v2.x', "      - run: deno check --node-modules-dir=auto supabase/functions/*/index.ts")
  return L.join('\n') + '\n'
}

const forkGuard = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"
function webWorkflow(p) {
  const host = p.web.host
  const L = [...HEADER('Deploy web'), 'on:', '  pull_request:', '  push:', `    branches: [${p.branch || 'main'}]`, "    tags: ['v*']", '  workflow_dispatch:', '', 'concurrency:', `  group: deploy-web-${E('github.ref')}`, '  cancel-in-progress: false', '', 'permissions:', '  contents: read', '  pull-requests: write', '', 'jobs:']
  for (const s of stacks.filter((x) => x.kind === 'web')) {
    const pm = nodePm(s.dir); const o = webOut(s); const out = posix(path.join(wd(s.dir), o.out || 'dist'))
    L.push(`  ${jobId(s)}:`, `    name: ${s.id} → ${host}`, `    if: ${forkGuard}`, '    runs-on: ubuntu-latest',
      `    environment: ${E(`github.event_name == 'pull_request' && 'preview' || (${TAG} && 'production' || 'dev')`)}`,
      '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...setupNode(s.dir, pm), `      - run: ${pm.install}`)
    if (host === 'vercel') {
      const prod = `${E(TAG + " && '--prod' || ''")}`
      L.push('      - run: npm i -g vercel@latest', '      - name: Build and deploy', '        env:', `          VERCEL_TOKEN: ${E('secrets.VERCEL_TOKEN')}`, `          VERCEL_ORG_ID: ${E('vars.VERCEL_ORG_ID')}`, `          VERCEL_PROJECT_ID: ${E('vars.VERCEL_PROJECT_ID')}`, '        run: |',
        `          vercel pull --yes --environment=${E(TAG + " && 'production' || 'preview'")} --token="$VERCEL_TOKEN"`,
        `          vercel build ${prod} --token="$VERCEL_TOKEN"`,
        `          url=$(vercel deploy --prebuilt ${prod} --token="$VERCEL_TOKEN")`,
        '          echo "Deployed: $url" >> "$GITHUB_STEP_SUMMARY"')
    } else if (host === 'netlify') {
      L.push('      - name: Build and deploy', '        env:', `          NETLIFY_AUTH_TOKEN: ${E('secrets.NETLIFY_AUTH_TOKEN')}`, `          NETLIFY_SITE_ID: ${E('vars.NETLIFY_SITE_ID')}`, '        run: |',
        `          if [ "${E('github.event_name')}" = "pull_request" ]; then set -- "--alias=pr-${E('github.event.number')}"; elif [ "${E(TAG)}" = "true" ]; then set -- --prod; else set -- --alias=dev; fi`,
        `          ${pm.x} --yes netlify-cli deploy --build "$@" --site="$NETLIFY_SITE_ID" --auth="$NETLIFY_AUTH_TOKEN" --message="${E('github.sha')}"`)
    } else if (host === 'cloudflare') {
      L.push(`      - run: ${o.build ? pm.x + ' ' + o.build : pm.run + ' build'}`, '      - uses: cloudflare/wrangler-action@v3', '        with:', `          apiToken: ${E('secrets.CLOUDFLARE_API_TOKEN')}`, `          accountId: ${E('vars.CLOUDFLARE_ACCOUNT_ID')}`, `          workingDirectory: ${wd(s.dir)}`,
        `          command: pages deploy ${o.out || 'dist'} --project-name=${p.web.project} --branch=${E(`${TAG} && '${p.web.productionBranch || 'production'}' || (github.head_ref || github.ref_name)`)} --commit-hash=${E('github.sha')}`)
    } else {
      L.push(`      - run: ${o.build ? pm.x + ' ' + o.build : pm.run + ' build'}`, '      - uses: FirebaseExtended/action-hosting-deploy@v0', '        with:', `          repoToken: ${E('secrets.GITHUB_TOKEN')}`, `          firebaseServiceAccount: ${E('secrets.FIREBASE_SERVICE_ACCOUNT')}`, `          projectId: ${E('vars.FIREBASE_PROJECT_ID')}`, `          channelId: ${E("github.event_name == 'pull_request' && '' || 'live'")}`, `          entryPoint: ${wd(s.dir)}`)
      void out
    }
  }
  return L.join('\n') + '\n'
}

function backendWorkflow(p) {
  const prov = provider()
  const fd = rel(functionsDir())
  const paths = prov === 'firebase' ? [`${fd}/**`, 'firestore.rules', 'firestore.indexes.json', 'storage.rules', 'firebase.json'] : ['supabase/**']
  const L = [...HEADER('Deploy backend'), 'on:', '  push:', `    branches: [${p.branch || 'main'}]`, '    paths:', ...paths.map((x) => `      - '${x}'`), "    tags: ['v*']", '  workflow_dispatch:', '', 'concurrency:', `  group: deploy-backend-${E(`${TAG} && 'production' || 'dev'`)}`, '  cancel-in-progress: false', '', 'permissions:', '  contents: read', '', 'jobs:', '  deploy:', `    name: ${prov} → ${ENV_EXPR}`, '    runs-on: ubuntu-latest', `    environment: ${ENV_EXPR}`, '    steps:', ...checkout]
  if (prov === 'firebase') {
    const pm = nodePm(functionsDir())
    L.push(...setupNode(functionsDir(), pm), `      - working-directory: ${fd}`, `        run: ${pm.install}`,
      '      - uses: google-github-actions/auth@v2', '        with:', `          credentials_json: ${E('secrets.FIREBASE_SERVICE_ACCOUNT')}`,
      '      - name: Deploy functions, rules and indexes', `        run: npx -y firebase-tools@latest deploy --only functions,firestore:rules,firestore:indexes --project "${E('vars.FIREBASE_PROJECT_ID')}" --non-interactive`)
  } else {
    L.push('      - uses: supabase/setup-cli@v1', '        with:', '          version: latest', '      - name: Migrations and Edge Functions', '        env:', `          SUPABASE_ACCESS_TOKEN: ${E('secrets.SUPABASE_ACCESS_TOKEN')}`, `          SUPABASE_DB_PASSWORD: ${E('secrets.SUPABASE_DB_PASSWORD')}`, `          PROJECT_REF: ${E('vars.SUPABASE_PROJECT_REF')}`, '        run: |',
      '          supabase link --project-ref "$PROJECT_REF"', '          supabase db push', '          supabase functions deploy --project-ref "$PROJECT_REF"')
  }
  return L.join('\n') + '\n'
}

function mobileWorkflow(p) {
  const track = p.mobile?.androidTrack || 'internal'
  const L = [...HEADER('Release mobile (testing)'), 'on:', '  push:', "    tags: ['v*']", '  workflow_dispatch:', '', 'concurrency:', `  group: release-mobile-${E('github.ref')}`, '  cancel-in-progress: false', '', 'permissions:', '  contents: read', '', 'env:',
    `  BUILD_NUMBER: ${E('github.run_number')}`, '', 'jobs:']
  const version = ['      - name: Version from the tag', '        run: |', '          v="${GITHUB_REF_NAME#v}"; case "$v" in [0-9]*) ;; *) v="0.0.0" ;; esac', '          echo "VERSION=$v" >> "$GITHUB_ENV"', `          echo "BUILD=$(( BUILD_NUMBER + ${E('vars.BUILD_NUMBER_OFFSET || 0')} ))" >> "$GITHUB_ENV"`]
  const playUpload = (s, aab) => ['      - uses: r0adkll/upload-google-play@v1', '        with:', `          serviceAccountJsonPlainText: ${E('secrets.PLAY_SERVICE_ACCOUNT_JSON')}`, `          packageName: ${applicationId(s) || 'com.example.app'}`, `          releaseFiles: ${aab}`, `          track: ${track}`, '          status: completed']
  const keystoreEnv = ['        env:', `          KEYSTORE_BASE64: ${E('secrets.ANDROID_KEYSTORE_BASE64')}`, `          KEYSTORE_PASSWORD: ${E('secrets.ANDROID_KEYSTORE_PASSWORD')}`, `          KEY_ALIAS: ${E('secrets.ANDROID_KEY_ALIAS')}`, `          KEY_PASSWORD: ${E('secrets.ANDROID_KEY_PASSWORD')}`]
  const iosSteps = (s) => {
    const x = iosProject(s); const d = wd(x.dir)
    return ['      - name: App Store Connect API key', '        env:', `          KEY_ID: ${E('secrets.APPSTORE_KEY_ID')}`, `          PRIVATE_KEY: ${E('secrets.APPSTORE_PRIVATE_KEY')}`, '        run: |', '          mkdir -p ~/private_keys', '          printf "%s" "$PRIVATE_KEY" > "$HOME/private_keys/AuthKey_$KEY_ID.p8"',
      '      - name: Archive and upload to TestFlight (automatic signing with the API key)', `        working-directory: ${d}`, '        env:', `          KEY_ID: ${E('secrets.APPSTORE_KEY_ID')}`, `          ISSUER_ID: ${E('secrets.APPSTORE_ISSUER_ID')}`, `          TEAM_ID: ${E('vars.IOS_TEAM_ID')}`, '        run: |',
      '          set -- -allowProvisioningUpdates -authenticationKeyPath "$HOME/private_keys/AuthKey_$KEY_ID.p8" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID"',
      `          xcodebuild ${x.flag} -scheme ${x.scheme} -configuration Release -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/app.xcarchive" archive DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" "$@"`,
      '          xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/app.xcarchive" -exportOptionsPlist ExportOptions.plist -exportPath "$RUNNER_TEMP/export" "$@"']
  }
  for (const s of stacks.filter((x) => x.kind === 'mobile')) {
    if (s.id === 'react-native') {
      L.push('  expo:', '    name: react-native → EAS build + submit', '    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...setupNode(s.dir, nodePm(s.dir)),
        '      - uses: expo/expo-github-action@v8', '        with:', '          eas-version: latest', `          token: ${E('secrets.EXPO_TOKEN')}`, `      - run: ${nodePm(s.dir).install}`, '      - run: eas build --platform all --profile production --non-interactive --no-wait --auto-submit')
      continue
    }
    if (canAndroid(s)) {
      L.push(`  ${jobId(s)}-android:`, `    name: ${s.id} → Google Play (${track})`, '    runs-on: ubuntu-latest', '    defaults:', '      run:', `        working-directory: ${wd(s.dir)}`, '    steps:', ...checkout, ...javaSetup, ...version)
      if (s.id === 'flutter') {
        L.push(...flutterSetup(s), '      - name: Upload keystore', ...keystoreEnv, '        run: |', '          printf "%s" "$KEYSTORE_BASE64" | base64 -d > android/app/upload-keystore.jks', '          {', '            echo "storeFile=upload-keystore.jks"', '            echo "storePassword=$KEYSTORE_PASSWORD"', '            echo "keyAlias=$KEY_ALIAS"', '            echo "keyPassword=$KEY_PASSWORD"', '          } > android/key.properties',
          '      - run: flutter pub get', '      - run: flutter build appbundle --release --build-name="$VERSION" --build-number="$BUILD"', ...playUpload(s, posix(path.join(wd(s.dir), 'build/app/outputs/bundle/release/app-release.aab'))))
      } else {
        const m = gradleApp(s)
        L.push('      - uses: gradle/actions/setup-gradle@v4', '      - name: Build signed bundle', ...keystoreEnv, '        run: |', '          printf "%s" "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/upload-keystore.jks"', '          export ANDROID_KEYSTORE_PATH="$RUNNER_TEMP/upload-keystore.jks"', '          chmod +x gradlew',
          `          ./gradlew :${m}:bundleRelease -PversionName="$VERSION" -PversionCode="$BUILD"`, ...playUpload(s, posix(path.join(wd(s.dir), m, 'build/outputs/bundle/release', `${m}-release.aab`))))
      }
    }
    if (canIos(s)) {
      L.push(`  ${jobId(s)}-ios:`, `    name: ${s.id} → TestFlight`, '    runs-on: macos-latest', '    steps:', ...checkout, ...version)
      if (s.id === 'flutter') L.push(...flutterSetup(s), `      - working-directory: ${wd(s.dir)}`, '        run: |', '          flutter pub get', '          flutter build ios --release --no-codesign --build-name="$VERSION" --build-number="$BUILD"')
      if (s.id === 'kmp') L.push(...javaSetup)
      L.push(...iosSteps(s))
    }
  }
  return L.join('\n') + '\n'
}

const exportOptions = (team) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${team || 'YOUR_TEAM_ID'}</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
`

function workflows(p) {
  const out = [['dualcraft-ci.yml', ciWorkflow(p)]]
  if (stacks.some((s) => s.kind === 'web') && p.web?.host) out.push(['dualcraft-deploy-web.yml', webWorkflow(p)])
  if (['firebase', 'supabase'].includes(provider())) out.push(['dualcraft-deploy-backend.yml', backendWorkflow(p)])
  if (stacks.some((s) => s.kind === 'mobile') && p.mobile?.release !== 'none') out.push(['dualcraft-release-mobile.yml', mobileWorkflow(p)])
  return out
}

// ---------------------------------------------------------------- secrets
function needed(p) {
  const n = []
  const add = (name, kind, envs, why) => n.push({ name, kind, envs, why })
  const host = p.web?.host
  const hasWeb = stacks.some((s) => s.kind === 'web')
  const webEnvs = ['preview', 'dev', 'production']
  if (hasWeb && host === 'vercel') { add('VERCEL_TOKEN', 'secret', ['repo'], 'vercel.com → Account settings → Tokens'); add('VERCEL_ORG_ID', 'variable', ['repo'], '.vercel/project.json after `vercel link` (orgId)'); add('VERCEL_PROJECT_ID', 'variable', ['repo'], '.vercel/project.json (projectId)') }
  if (hasWeb && host === 'netlify') { add('NETLIFY_AUTH_TOKEN', 'secret', ['repo'], 'Netlify → User settings → Applications → Personal access tokens'); add('NETLIFY_SITE_ID', 'variable', ['repo'], 'Site configuration → Site ID') }
  if (hasWeb && host === 'cloudflare') { add('CLOUDFLARE_API_TOKEN', 'secret', ['repo'], 'Cloudflare → My Profile → API Tokens (template "Edit Cloudflare Pages")'); add('CLOUDFLARE_ACCOUNT_ID', 'variable', ['repo'], 'Cloudflare dashboard → Account ID') }
  const prov = provider()
  if ((hasWeb && host === 'firebase') || prov === 'firebase') {
    add('FIREBASE_SERVICE_ACCOUNT', 'secret', hasWeb && host === 'firebase' ? webEnvs : ['dev', 'production'], 'JSON key of a deploy service account of that environment\'s project (`firebase init hosting:github` creates one; for functions it needs Cloud Functions Admin, Service Account User, Firebase Rules Admin)')
    add('FIREBASE_PROJECT_ID', 'variable', hasWeb && host === 'firebase' ? webEnvs : ['dev', 'production'], 'project id of that environment (preview uses dev)')
  }
  if (prov === 'supabase') { add('SUPABASE_ACCESS_TOKEN', 'secret', ['dev', 'production'], 'supabase.com → Account → Access tokens'); add('SUPABASE_DB_PASSWORD', 'secret', ['dev', 'production'], 'database password of that project'); add('SUPABASE_PROJECT_REF', 'variable', ['dev', 'production'], 'project ref of that environment') }
  const mob = stacks.filter((s) => s.kind === 'mobile')
  if (p.mobile?.release !== 'none') {
    if (mob.some((s) => s.id === 'react-native')) add('EXPO_TOKEN', 'secret', ['repo'], 'expo.dev → Access tokens; submit credentials live in EAS')
    if (mob.some(canAndroid)) {
      add('ANDROID_KEYSTORE_BASE64', 'secret', ['repo'], 'base64 of the upload keystore (.jks): `base64 -w0 upload-keystore.jks`')
      for (const x of ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) add(x, 'secret', ['repo'], 'of the upload keystore')
      add('PLAY_SERVICE_ACCOUNT_JSON', 'secret', ['repo'], 'Google Cloud service account JSON invited in Play Console with "Release to testing tracks"')
      add('BUILD_NUMBER_OFFSET', 'variable', ['repo'], 'optional: added to the run number so versionCode/build number stay above the last manual upload')
    }
    if (mob.some(canIos)) {
      add('APPSTORE_KEY_ID', 'secret', ['repo'], 'App Store Connect → Users and Access → Integrations → Team keys (Admin role: cloud signing)')
      add('APPSTORE_ISSUER_ID', 'secret', ['repo'], 'same page, Issuer ID')
      add('APPSTORE_PRIVATE_KEY', 'secret', ['repo'], 'content of the AuthKey_XXXX.p8')
      add('IOS_TEAM_ID', 'variable', ['repo'], 'developer.apple.com → Membership → Team ID')
    }
  }
  return n
}

function repoSlug() {
  if (opt.repo) return String(opt.repo)
  let url = ''
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : null
}
function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const gh = spawnSync('gh auth token', { encoding: 'utf8', shell: true })
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim()
  const cred = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return ((cred.stdout || '').match(/^password=(.+)$/m) || [])[1]?.trim() || null
}
async function present(slug) {
  const API = String(opt.api || 'https://api.github.com').replace(/\/$/, '')
  const t = opt.api ? 'test-token' : token()
  if (!t) return null
  const get = async (u) => { const r = await fetch(API + u, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dualcraft' } }); return r.ok ? r.json() : null }
  const have = { repo: new Set() }
  for (const x of (await get(`/repos/${slug}/actions/secrets?per_page=100`))?.secrets || []) have.repo.add(x.name)
  for (const x of (await get(`/repos/${slug}/actions/variables?per_page=100`))?.variables || []) have.repo.add(x.name)
  const envs = (await get(`/repos/${slug}/environments`))?.environments || []
  for (const e of envs) {
    have[e.name] = new Set()
    for (const x of (await get(`/repos/${slug}/environments/${e.name}/secrets?per_page=100`))?.secrets || []) have[e.name].add(x.name)
    for (const x of (await get(`/repos/${slug}/environments/${e.name}/variables?per_page=100`))?.variables || []) have[e.name].add(x.name)
    have[e.name].protected = !!(e.protection_rules || []).some((r) => r.type === 'required_reviewers')
  }
  return have
}

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const prev = readJson(file) || {}
  let host = opt.host ? String(opt.host) : prev.web?.host
  if (!host) host = exists(root, 'vercel.json') || stacks.some((s) => exists(s.dir, 'vercel.json')) ? 'vercel' : exists(root, 'netlify.toml') || stacks.some((s) => exists(s.dir, 'netlify.toml')) ? 'netlify' : stacks.some((s) => exists(s.dir, 'wrangler.toml')) ? 'cloudflare' : readJson(path.join(root, 'firebase.json'))?.hosting ? 'firebase' : null
  const p = { ...prev, branch: prev.branch || 'main' }
  if (stacks.some((s) => s.kind === 'web')) {
    if (!HOSTS.includes(host)) die(`where does the web deploy? --host ${HOSTS.join('|')}`)
    p.web = { ...prev.web, host, ...(host === 'cloudflare' ? { project: prev.web?.project || String(opt.project || (config.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')) } : {}) }
  }
  if (stacks.some((s) => s.kind === 'mobile')) p.mobile = { release: 'testing', androidTrack: String(opt['android-track'] || prev.mobile?.androidTrack || 'internal'), ...prev.mobile }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n')
  console.log(`${Object.keys(prev).length ? 'updated' : 'created'} ${rel(file)}`)
  const { errors, warnings } = validate(p)
  warnings.forEach((w) => console.log('⚠ ' + w))
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix the pipeline first.') }
  for (const [f, y] of workflows(p)) console.log('→ ' + writeGuarded(path.join(WF, f), stamp(y, 'hash'), { root, force: !!opt.force }))
  for (const s of stacks.filter(canIos)) { const made = writeNew(path.join(iosProject(s).dir, 'ExportOptions.plist'), exportOptions(null)); if (made) console.log('+ ' + made + ' (teamID comes from DEVELOPMENT_TEAM at archive time)') }
  const gi = path.join(root, '.gitignore'); const cur = read(gi); const want = ['*.jks', '*.keystore', 'key.properties', '*.p8', '*.p12', '.env*', '!.env.example'].filter((x) => !cur.split(/\r?\n/).includes(x))
  if (want.length) { fs.writeFileSync(gi, cur.replace(/\s*$/, '\n') + '# signing & secrets (DualCraft deploy)\n' + want.join('\n') + '\n'); console.log('+ .gitignore: ' + want.join(' ')) }
  console.log('\nNext: create the GitHub environments preview, dev and production (production with required reviewers), add the secrets (`deploy secrets` lists them) and check the release signing (`deploy check`).')
  process.exit(0)
}

if (cmd === 'gen') {
  const p = load(); const { errors, warnings } = validate(p)
  warnings.forEach((w) => console.log('⚠ ' + w))
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix the pipeline first.') }
  for (const [f, y] of workflows(p)) console.log('→ ' + writeGuarded(path.join(WF, f), stamp(y, 'hash'), { root, force: !!opt.force }))
  process.exit(0)
}

if (cmd === 'secrets') {
  const p = load(); const list = needed(p); const slug = repoSlug()
  const have = slug && !opt.offline ? await present(slug) : null
  const rows = []
  for (const s of list) for (const env of s.envs) rows.push({ ...s, env, ok: have ? (have[env]?.has(s.name) || (env !== 'repo' && have.repo.has(s.name))) : null })
  // no process.exit() after fetch: on Windows it can crash Node while keep-alive sockets are still open
  if (opt.json) console.log(JSON.stringify({ repo: slug, checked: !!have, rows, environments: have ? Object.fromEntries(Object.entries(have).map(([k, v]) => [k, { protected: !!v.protected }])) : null }, null, 2))
  else {
  console.log(`GitHub ${slug || '(no origin)'} — ${have ? 'checked' : 'not checked (no token or --offline)'}`)
  for (const r of rows) console.log(`  ${r.ok === null ? '·' : r.ok ? '✓' : '✗'} ${(r.kind === 'secret' ? 'secret ' : 'var    ') + r.name.padEnd(28)} ${r.env.padEnd(11)} ${r.why}`)
  if (have) {
    for (const env of [...new Set(list.flatMap((x) => x.envs))].filter((e) => e !== 'repo')) if (!have[env]) console.log(`  ✗ environment "${env}" doesn't exist (Settings → Environments)`)
    if (have.production && !have.production.protected) console.log('  ⚠ environment "production" has no required reviewers — anyone who pushes a tag deploys to prod')
  }
  console.log('\nSet them with the GitHub CLI, e.g.: gh secret set NAME --env production < file  ·  gh variable set NAME --env dev --body value')
  process.exitCode = have && rows.some((r) => r.ok === false) ? 1 : 0
  }
}

if (cmd === 'check') {
const p = load()
const { errors, warnings } = validate(p)
const issues = [...errors.map((m) => ({ level: 'error', m })), ...warnings.map((m) => ({ level: 'warn', m }))]
for (const [f, y] of workflows(p)) {
  const cur = read(path.join(WF, f)).replace(/\r\n/g, '\n')
  if (!cur) issues.push({ level: 'error', m: `.github/workflows/${f} missing — run gen` })
  else if (cur !== stamp(y, 'hash')) issues.push({ level: 'error', m: `.github/workflows/${f} out of date (stacks or pipeline changed) — run gen` })
}
for (const s of stacks) {
  if (canAndroid(s) && p.mobile?.release !== 'none') {
    if (s.id === 'flutter') {
      const g = read(path.join(s.dir, 'android/app/build.gradle.kts')) + read(path.join(s.dir, 'android/app/build.gradle'))
      if (!/key\.properties/.test(g)) issues.push({ level: 'error', m: `${s.id}: android/app/build.gradle(.kts) doesn't read key.properties — the release build would be signed with the debug key. Add a "release" signingConfig from key.properties (skill: Android signing).` })
    } else {
      const g = read(path.join(s.dir, gradleApp(s), 'build.gradle.kts')) + read(path.join(s.dir, gradleApp(s), 'build.gradle'))
      if (!/ANDROID_KEYSTORE_PATH/.test(g)) issues.push({ level: 'error', m: `${s.id}: ${gradleApp(s)}/build.gradle.kts has no release signingConfig from ANDROID_KEYSTORE_PATH / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD env vars` })
      if (!/versionCode\s*=.*(findProperty|property)\(\s*"versionCode"/.test(g)) issues.push({ level: 'warn', m: `${s.id}: versionCode is not read from -PversionCode (the workflow passes the build number)` })
    }
    if (!applicationId(s)) issues.push({ level: 'error', m: `${s.id}: applicationId not found — the Play upload needs the package name` })
  }
  if (canIos(s) && p.mobile?.release !== 'none' && !exists(iosProject(s).dir, 'ExportOptions.plist')) issues.push({ level: 'error', m: `${s.id}: ${rel(path.join(iosProject(s).dir, 'ExportOptions.plist'))} missing — run init` })
  if (s.id === 'react-native' && p.mobile?.release !== 'none') {
    const eas = readJson(path.join(s.dir, 'eas.json'))
    if (!eas?.build?.production) issues.push({ level: 'error', m: 'react-native: eas.json has no build.production profile (eas build:configure)' })
    if (!eas?.submit?.production) issues.push({ level: 'warn', m: 'react-native: eas.json has no submit.production profile (track "internal" for Play, ascAppId for iOS)' })
  }
}
const ignored = read(path.join(root, '.gitignore'))
for (const x of ['*.jks', 'key.properties', '*.p8']) if (!ignored.includes(x)) issues.push({ level: 'warn', m: `.gitignore doesn't ignore ${x}` })
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')
  for (const f of tracked.filter((x) => /\.(jks|keystore|p8|p12)$|(^|\/)key\.properties$|service-account.*\.json$/i.test(x))) issues.push({ level: 'error', m: `${f} is committed — remove it from git and rotate that credential` })
} catch { /* not a git repo */ }
if (opt.json) console.log(JSON.stringify({ issues }, null, 2))
else {
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
  const n = issues.filter((i) => i.level === 'error').length
  console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `deploy OK — ${workflows(p).length} workflow(s), ${issues.length} warning(s)`)
}
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
}
