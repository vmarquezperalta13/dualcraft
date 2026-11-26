#!/usr/bin/env node
// DualCraft error monitoring: one spec (.dualcraft/monitoring/monitoring.json) → the same settings in every stack
// (release name, environment, sample rate, ignored errors, personal data off, a scrubber for sensitive keys), and checks
// that each app really reports: SDK installed, symbols/source maps uploaded, DSN documented, privacy policy up to date.
//   init [--web sentry|none] [--mobile crashlytics|sentry|none] [--app <name>]   spec + settings code
//   gen [--force]      regenerate the settings code (also after a version bump)
//   check [--json]     spec, generated code, SDKs, symbol upload, DSN, CI secrets, privacy policy
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, LANG, kotlinPackage, kotlinModule, iosAppDir } from './lib/targets.mjs'
import * as G from './lib/monitoring-gen.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check'].includes(cmd)) {
  console.log('node monitoring.mjs init [--web sentry|none] [--mobile crashlytics|sentry|none] [--app name] | gen [--force] | check [--json]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'monitoring', 'monitoring.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config)
const kebab = (s) => String(s || 'app').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'

const PROVIDERS = { web: ['sentry', 'none'], mobile: ['crashlytics', 'sentry', 'none'] }
const DSN = { nextjs: 'NEXT_PUBLIC_SENTRY_DSN', 'react-vite': 'VITE_SENTRY_DSN', astro: 'PUBLIC_SENTRY_DSN', nuxt: 'NUXT_PUBLIC_SENTRY_DSN', 'react-native': 'EXPO_PUBLIC_SENTRY_DSN', flutter: 'SENTRY_DSN', kmp: 'SENTRY_DSN', android: 'SENTRY_DSN', ios: 'SENTRY_DSN' }
const DEFAULT_SCRUB = ['password', 'passwd', 'secret', 'token', 'authorization', 'cookie', 'api_key', 'apikey', 'email', 'phone', 'card', 'iban', 'address']
const DEFAULT_IGNORE = ['ResizeObserver loop', 'Network request failed', 'Load failed', 'AbortError']

// ---------------------------------------------------------------- spec
function defaults() {
  const fb = config.backend?.provider === 'firebase'
  return {
    app: opt.app ? String(opt.app) : kebab(config.name),
    providers: { web: opt.web ? String(opt.web) : 'sentry', mobile: opt.mobile ? String(opt.mobile) : fb ? 'crashlytics' : 'sentry' },
    sampleRate: { production: 0.1, other: 1 },
    sendPii: false,
    consent: true,
    scrub: DEFAULT_SCRUB,
    ignore: DEFAULT_IGNORE,
  }
}
const load = () => readJson(file) || die(`no ${rel(file)} — run: monitoring.mjs init`)
const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n') }
function validate(s) {
  const e = []
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s.app || '')) e.push('app: lowercase name for the release (letters, digits, . _ -)')
  for (const k of ['web', 'mobile']) if (!PROVIDERS[k].includes(s.providers?.[k])) e.push(`providers.${k} must be ${PROVIDERS[k].join(', ')}${k === 'web' ? ' (Crashlytics has no web SDK)' : ''}`)
  for (const k of ['production', 'other']) if (!(typeof s.sampleRate?.[k] === 'number' && s.sampleRate[k] >= 0 && s.sampleRate[k] <= 1)) e.push(`sampleRate.${k} must be 0–1`)
  if (typeof s.sendPii !== 'boolean') e.push('sendPii must be true or false')
  if (typeof s.consent !== 'boolean') e.push('consent must be true or false')
  for (const k of ['scrub', 'ignore']) if (!Array.isArray(s[k]) || s[k].some((x) => typeof x !== 'string' || !x)) e.push(`${k} must be a list of non-empty strings`)
  if (s.sendPii === true && !s.sendPiiReviewed) e.push('sendPii: true sends IPs and user data to the provider — keep it false unless the privacy policy and a legal basis cover it (then set "sendPiiReviewed": true)')
  return e
}

// ---------------------------------------------------------------- outputs
function out(stack) {
  const { id, dir: d } = stack
  const custom = config.monitoring?.out?.[id]; if (custom) return { file: path.join(root, custom), pkg: config.design?.kotlinPackage }
  const src = fs.existsSync(path.join(d, 'src')) ? 'src' : ''
  if (['nextjs', 'react-vite', 'astro', 'react-native'].includes(id)) return { file: path.join(d, id === 'nextjs' ? src : 'src', 'lib', 'monitoring.ts') }
  if (id === 'nuxt') return { file: path.join(d, fs.existsSync(path.join(d, 'app')) ? 'app' : '', 'utils', 'monitoring.ts') }
  if (id === 'flutter') return { file: path.join(d, 'lib', 'generated', 'monitoring.dart') }
  if (id === 'ios') return { file: path.join(iosAppDir(d, config), 'Core', 'Monitoring', 'Monitoring.swift') }
  const pkg = kotlinPackage(d, config, id); const mod = kotlinModule(d, id)
  const base = id === 'kmp' ? path.join(d, mod, 'src', 'commonMain', 'kotlin') : path.join(d, mod, 'src', 'main', 'java')
  return { file: path.join(base, ...pkg.split('.'), 'monitoring', 'Monitoring.kt'), pkg: pkg + '.monitoring' }
}
const providerFor = (s, stack) => s.providers[stack.kind]
function outputs(s) {
  const files = []
  for (const st of stacks) {
    const provider = providerFor(s, st); if (provider === 'none') continue
    const m = { provider, release: `${s.app}@${config.version || '0.0.0'}`, dsnEnv: provider === 'sentry' ? DSN[st.id] : '', sampleRate: s.sampleRate, sendPii: s.sendPii, consent: s.consent, scrub: s.scrub, ignore: s.ignore }
    const o = out(st); const lang = LANG[st.id]
    const code = lang === 'ts' ? G.tsMonitoring(m) : lang === 'dart' ? G.dartMonitoring(m) : lang === 'kotlin' ? G.kotlinMonitoring(m, o.pkg) : G.swiftMonitoring(m)
    files.push({ file: o.file, text: stamp(code), stack: st, provider })
  }
  return files
}
function generate(s, force) {
  const errors = validate(s)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix monitoring.json first.') }
  return outputs(s).map((f) => writeGuarded(f.file, f.text, { root, force }))
}

if (cmd === 'init' || cmd === 'gen') {
  const existed = fs.existsSync(file)
  if (cmd === 'gen' && !existed) die(`no ${rel(file)} — run: monitoring.mjs init`)
  const s = existed ? load() : defaults()
  if (cmd === 'init' && existed) { if (opt.web) s.providers.web = String(opt.web); if (opt.mobile) s.providers.mobile = String(opt.mobile); if (opt.app) s.app = String(opt.app) }
  save(s)
  if (cmd === 'init') console.log(`${existed ? 'updated' : 'created'} ${rel(file)} — web: ${s.providers.web}, mobile: ${s.providers.mobile}, release ${s.app}@${config.version || '0.0.0'}`)
  for (const w of generate(s, !!opt.force)) console.log('→ ' + w)
  if (cmd === 'init') console.log('Next: install the SDK and wire these settings in each app (references/monitoring.md), then: deploy.mjs gen (symbol / source map upload) and legal.mjs gen (privacy policy).')
  process.exit(0)
}

// ---------------------------------------------------------------- check
const s = load()
const issues = validate(s).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
const all = (d, names) => names.map((n) => read(path.join(d, n))).join('\n')
const gradle = (d) => all(d, ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'app/build.gradle.kts', 'app/build.gradle', 'composeApp/build.gradle.kts', 'gradle/libs.versions.toml'])
function iosText(d) {
  let t = all(d, ['Podfile', 'Package.swift', 'Package.resolved'])
  const walk = (x, depth) => { if (depth > 3 || !fs.existsSync(x)) return; for (const e of fs.readdirSync(x, { withFileTypes: true })) { if (/^(Pods|build|DerivedData|node_modules)$/.test(e.name)) continue; const p = path.join(x, e.name); if (e.name.endsWith('.pbxproj') || e.name === 'Package.resolved') t += read(p); else if (e.isDirectory()) walk(p, depth + 1) } }
  walk(d, 0); return t
}
/** [installed?, symbols uploaded?, hint] for a stack and provider. */
function sdkState(st, provider) {
  const d = st.dir; const pkg = read(path.join(d, 'package.json')); const pub = read(path.join(d, 'pubspec.yaml'))
  if (provider === 'sentry') {
    if (LANG[st.id] === 'ts') return [/"@sentry\//.test(pkg), null, `npm i @sentry/${{ nextjs: 'nextjs', 'react-vite': 'react', astro: 'astro', nuxt: 'nuxt', 'react-native': 'react-native' }[st.id]}`]
    if (st.id === 'flutter') return [/^\s*sentry_flutter:/m.test(pub), /sentry_dart_plugin:/.test(pub) ? true : 'add sentry_dart_plugin (dev) so the release uploads debug symbols', 'flutter pub add sentry_flutter']
    if (st.id === 'ios') { const t = iosText(d); return [/sentry-cocoa|\bSentry\b/.test(t), /sentry-cli|sentry-cocoa.*upload|debug-files upload/i.test(t) ? true : 'add a "Upload debug symbols to Sentry" build phase (sentry-cli debug-files upload)', 'add sentry-cocoa with Swift Package Manager'] }
    const g = gradle(d); return [/io\.sentry/.test(g), /io\.sentry\.android\.gradle|sentry-android-gradle/.test(g) ? true : 'apply the io.sentry.android.gradle plugin (uploads ProGuard mappings)', 'add io.sentry:sentry-android']
  }
  if (st.id === 'react-native') return [/"@react-native-firebase\/crashlytics"/.test(pkg), null, 'npm i @react-native-firebase/crashlytics']
  if (st.id === 'flutter') return [/^\s*firebase_crashlytics:/m.test(pub), null, 'flutter pub add firebase_crashlytics (and run flutterfire configure)']
  if (st.id === 'ios') { const t = iosText(d); return [/FirebaseCrashlytics/.test(t), /FirebaseCrashlytics\/run|upload-symbols/.test(t) ? true : 'add the Crashlytics "run" build phase so dSYMs are uploaded (Build Phases → Run Script)', 'add FirebaseCrashlytics with Swift Package Manager'] }
  const g = gradle(d); return [/firebase-crashlytics/.test(g), /com\.google\.firebase\.crashlytics|firebase\.crashlytics\b|libs\.plugins\.firebase\.crashlytics/.test(g) ? true : 'apply the com.google.firebase.crashlytics Gradle plugin (uploads mapping files)', 'add com.google.firebase:firebase-crashlytics']
}
if (!issues.length) {
  for (const f of outputs(s)) if (read(f.file) !== f.text) err(`${rel(f.file)} out of date — run: monitoring.mjs gen${new RegExp(`@${(config.version || '').replace(/\./g, '\\.')}`).test(read(f.file)) ? '' : ' (the version changed)'}`)
  for (const st of stacks) {
    const provider = providerFor(s, st); if (provider === 'none') continue
    if (st.id === 'kmp') { warn(`kmp: wire ${provider} per platform (androidMain + the iOS app) — references/monitoring.md`); continue }
    const [installed, symbols, hint] = sdkState(st, provider)
    if (!installed) warn(`${st.id}: ${provider} SDK not installed — ${hint}`)
    else if (typeof symbols === 'string') warn(`${st.id}: ${symbols}`)
    if (provider === 'sentry' && LANG[st.id] === 'ts' && st.kind === 'web') {
      const envs = ['.env.example', '.env.sample', '.env.local.example'].map((n) => read(path.join(st.dir, n))).join('\n')
      if (!envs.includes(DSN[st.id])) warn(`${st.id}: document ${DSN[st.id]} in .env.example (the DSN itself goes in the host's environment, not in git)`)
    }
  }
  // CI: source maps / symbols need the Sentry token in the deploy workflows
  const wfDir = path.join(root, '.github', 'workflows')
  const wfs = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((f) => /^dualcraft-.*\.ya?ml$/.test(f)).map((f) => read(path.join(wfDir, f))).join('\n') : ''
  const usesSentry = stacks.some((st) => providerFor(s, st) === 'sentry')
  if (wfs && usesSentry && !wfs.includes('SENTRY_AUTH_TOKEN')) warn('deploy workflows do not upload source maps / symbols to Sentry — run: deploy.mjs gen (then deploy.mjs secrets)')
  // privacy policy must name the processor
  const legalDir = path.join(root, 'docs', 'legal')
  const policy = fs.existsSync(legalDir) ? fs.readdirSync(legalDir).filter((f) => /privac/i.test(f)).map((f) => read(path.join(legalDir, f))).join('\n') : ''
  const names = [...new Set(stacks.map((st) => providerFor(s, st)).filter((p) => p !== 'none'))]
  for (const p of names) if (policy && !new RegExp(p === 'sentry' ? 'Sentry' : 'Crashlytics', 'i').test(policy)) warn(`the privacy policy does not mention ${p === 'sentry' ? 'Sentry' : 'Firebase Crashlytics'} — run: legal.mjs gen`)
  if (s.consent) warn('consent: start collecting only after the user agrees (Crashlytics: setCrashlyticsCollectionEnabled; Sentry: init after consent) — legal: dualcraft:legal')
  if (!stacks.length) warn('no stacks in config.json — nothing generated')
}
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Monitoring — web: ${s.providers.web} · mobile: ${s.providers.mobile} · release ${s.app}@${config.version || '0.0.0'}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `monitoring OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
