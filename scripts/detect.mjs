#!/usr/bin/env node
// DualCraft project detector — what the web and mobile stacks really use.
//   node detect.mjs [--json] [--path dir]
// Looks in config.paths.web / config.paths.mobile when inside a DualCraft project, else scans
// the given/current folder and its direct subfolders for package.json (Next.js) and pubspec.yaml (Flutter).
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, parseArgs, posix } from './lib/project.mjs'

const { opt } = parseArgs(process.argv.slice(2))
const base = path.resolve(String(opt.path || findRoot() || process.cwd()))
const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(base, '.dualcraft', 'config.json'), 'utf8')) } catch { return {} } })()
const exists = (...p) => fs.existsSync(path.join(...p))
const read = (...p) => { try { return fs.readFileSync(path.join(...p), 'utf8') } catch { return '' } }
const rel = (p) => posix(path.relative(base, p)) || '.'
const IGNORE = new Set(['node_modules', '.git', 'build', '.dart_tool', '.next', 'ios', 'android', 'dist', '.dualcraft'])

function candidates(file) {
  const out = []
  if (exists(base, file)) out.push(base)
  for (const d of fs.readdirSync(base, { withFileTypes: true })) if (d.isDirectory() && !IGNORE.has(d.name) && !d.name.startsWith('.') && exists(base, d.name, file)) out.push(path.join(base, d.name))
  return out
}

// ---------- web ----------
function detectWeb(dir) {
  let pkg
  try { pkg = JSON.parse(read(dir, 'package.json')) } catch { return null }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (!deps.next) return detectWebOther(dir, pkg, deps)
  const has = (n) => !!deps[n]
  const major = (n) => { const m = String(deps[n] || '').match(/(\d+)/); return m ? +m[1] : null }
  const srcDir = exists(dir, 'src') ? 'src/' : ''
  const router = exists(dir, srcDir + 'app') ? (exists(dir, srcDir + 'pages') ? 'app + pages' : 'app') : exists(dir, srcDir + 'pages') ? 'pages' : '?'
  const pm = exists(dir, 'pnpm-lock.yaml') ? 'pnpm' : exists(dir, 'yarn.lock') ? 'yarn' : exists(dir, 'bun.lockb') || exists(dir, 'bun.lock') ? 'bun' : 'npm'
  const pick = (map) => Object.entries(map).filter(([k]) => has(k)).map(([, v]) => v)
  return {
    stack: 'nextjs', name: 'Next.js', path: rel(dir), next: deps.next, nextMajor: major('next'), react: deps.react || null, router, srcDir: !!srcDir, packageManager: pm,
    typescript: has('typescript') || exists(dir, 'tsconfig.json'),
    styling: [...pick({ tailwindcss: `tailwind ${major('tailwindcss') ?? ''}`.trim(), 'styled-components': 'styled-components', '@emotion/react': 'emotion', sass: 'sass', '@mui/material': 'mui', '@chakra-ui/react': 'chakra' }), ...(exists(dir, 'components.json') ? ['shadcn/ui'] : [])],
    tests: pick({ vitest: 'vitest', jest: 'jest', '@testing-library/react': 'testing-library', '@playwright/test': 'playwright', cypress: 'cypress', msw: 'msw' }),
    lint: pick({ eslint: 'eslint', '@biomejs/biome': 'biome', prettier: 'prettier' }),
    data: pick({ firebase: 'firebase (client)', 'firebase-admin': 'firebase-admin', '@tanstack/react-query': 'react-query', swr: 'swr', prisma: 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle', '@supabase/supabase-js': 'supabase', zod: 'zod' }),
    state: pick({ zustand: 'zustand', jotai: 'jotai', '@reduxjs/toolkit': 'redux toolkit', redux: 'redux' }),
    auth: pick({ 'next-auth': 'next-auth', '@auth/core': 'auth.js', '@clerk/nextjs': 'clerk' }),
    i18n: [...pick({ 'next-intl': 'next-intl', 'next-i18next': 'next-i18next', 'react-i18next': 'react-i18next', i18next: 'i18next' })],
    i18nFiles: ['messages', 'locales', 'public/locales', srcDir + 'messages'].filter((d) => exists(dir, d)),
    analytics: pick({ '@vercel/analytics': 'vercel analytics', 'posthog-js': 'posthog', '@next/third-parties': 'next third-parties (GA/GTM)', 'react-ga4': 'ga4', mixpanel: 'mixpanel', 'mixpanel-browser': 'mixpanel', firebase: 'firebase analytics (if used)' }),
    seo: { sitemap: exists(dir, srcDir + 'app/sitemap.ts') || exists(dir, srcDir + 'app/sitemap.js') || exists(dir, 'public/sitemap.xml'), robots: exists(dir, srcDir + 'app/robots.ts') || exists(dir, 'public/robots.txt') },
    scripts: pkg.scripts || {},
    ci: exists(base, '.github', 'workflows') ? fs.readdirSync(path.join(base, '.github', 'workflows')) : [],
  }
}

// ---------- mobile ----------
function pubDeps(text) {
  const deps = {}; let section = null
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^(\w[\w_]*):\s*(.*)$/)
    if (top) { section = ['dependencies', 'dev_dependencies'].includes(top[1]) ? top[1] : null; continue }
    const dep = section && line.match(/^ {2}([a-z0-9_]+):\s*(.*)$/)
    if (dep) deps[dep[1]] = dep[2].trim() || '(complex)'
  }
  return deps
}
function detectMobile(dir) {
  const text = read(dir, 'pubspec.yaml')
  if (!/^\s+flutter:\s*$/m.test(text) && !/sdk:\s*flutter/.test(text)) return null
  const deps = pubDeps(text); const has = (n) => n in deps
  const pick = (map) => Object.entries(map).filter(([k]) => has(k)).map(([, v]) => v)
  const version = (text.match(/^version:\s*(\S+)/m) || [])[1] || null
  const sdk = (text.match(/^\s+sdk:\s*["']?([^"'\n]+)/m) || [])[1] || null
  const mains = exists(dir, 'lib') ? fs.readdirSync(path.join(dir, 'lib')).filter((f) => /^main(_\w+)?\.dart$/.test(f)) : []
  const gradle = read(dir, 'android/app/build.gradle') + read(dir, 'android/app/build.gradle.kts')
  const flavors = [...new Set([...gradle.matchAll(/(?:create\(["']|^\s+)(\w+)\s*(?:["']\))?\s*\{[^}]*dimension/gm)].map((m) => m[1]))]
  const libDirs = exists(dir, 'lib') ? fs.readdirSync(path.join(dir, 'lib'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
  return {
    stack: 'flutter', path: rel(dir), name: (text.match(/^name:\s*(\S+)/m) || [])[1], version, sdk,
    state: pick({ flutter_riverpod: 'riverpod', hooks_riverpod: 'riverpod (hooks)', riverpod_annotation: 'riverpod generator', flutter_bloc: 'bloc', provider: 'provider', get: 'getx', mobx: 'mobx', signals: 'signals' }),
    routing: pick({ go_router: 'go_router', auto_route: 'auto_route', beamer: 'beamer' }),
    codegen: pick({ build_runner: 'build_runner', freezed: 'freezed', json_serializable: 'json_serializable', riverpod_generator: 'riverpod_generator' }),
    firebase: Object.keys(deps).filter((d) => d.startsWith('firebase_') || d === 'cloud_firestore' || d === 'cloud_functions'),
    tests: ['flutter_test', ...pick({ mocktail: 'mocktail', mockito: 'mockito', fake_cloud_firestore: 'fake_cloud_firestore', firebase_auth_mocks: 'firebase_auth_mocks', golden_toolkit: 'golden_toolkit', alchemist: 'alchemist', patrol: 'patrol', integration_test: 'integration_test' })],
    i18n: [...pick({ flutter_localizations: 'flutter_localizations', intl: 'intl', easy_localization: 'easy_localization', slang: 'slang' }), ...(exists(dir, 'l10n.yaml') ? ['gen-l10n (l10n.yaml)'] : [])],
    i18nFiles: (read(dir, 'l10n.yaml').match(/arb-dir:\s*(\S+)/) || [])[1] || (exists(dir, 'lib/l10n') ? 'lib/l10n' : null),
    analytics: pick({ firebase_analytics: 'firebase_analytics', posthog_flutter: 'posthog', mixpanel_flutter: 'mixpanel', amplitude_flutter: 'amplitude' }),
    crash: pick({ firebase_crashlytics: 'crashlytics', sentry_flutter: 'sentry' }),
    payments: pick({ in_app_purchase: 'in_app_purchase', purchases_flutter: 'revenuecat' }),
    lint: pick({ flutter_lints: 'flutter_lints', very_good_analysis: 'very_good_analysis', lints: 'lints' }),
    entrypoints: mains, flavors, libDirs,
    platforms: ['android', 'ios', 'web', 'macos', 'windows', 'linux'].filter((p) => exists(dir, p)),
    ci: exists(base, '.github', 'workflows') ? fs.readdirSync(path.join(base, '.github', 'workflows')) : [],
  }
}

// ---------- other web stacks ----------
function jsCommon(dir, pkg, deps) {
  const has = (n) => !!deps[n]
  const pick = (map) => Object.entries(map).filter(([k]) => has(k)).map(([, v]) => v)
  return {
    path: rel(dir), packageManager: exists(dir, 'pnpm-lock.yaml') ? 'pnpm' : exists(dir, 'yarn.lock') ? 'yarn' : exists(dir, 'bun.lockb') || exists(dir, 'bun.lock') ? 'bun' : 'npm',
    typescript: has('typescript') || exists(dir, 'tsconfig.json'),
    styling: pick({ tailwindcss: 'tailwind', '@tailwindcss/vite': 'tailwind 4', '@nuxtjs/tailwindcss': 'tailwind (nuxt)', nativewind: 'nativewind', 'styled-components': 'styled-components', sass: 'sass' }),
    tests: pick({ vitest: 'vitest', jest: 'jest', 'jest-expo': 'jest-expo', '@testing-library/react': 'testing-library', '@testing-library/react-native': 'rn testing-library', '@nuxt/test-utils': 'nuxt test-utils', '@playwright/test': 'playwright', cypress: 'cypress', detox: 'detox' }),
    data: pick({ firebase: 'firebase (JS)', '@react-native-firebase/app': 'react-native-firebase', '@supabase/supabase-js': 'supabase', '@prisma/client': 'prisma', '@tanstack/react-query': 'react-query', 'drizzle-orm': 'drizzle' }),
    state: pick({ zustand: 'zustand', jotai: 'jotai', '@reduxjs/toolkit': 'redux toolkit', pinia: 'pinia', '@pinia/nuxt': 'pinia' }),
    i18n: pick({ 'react-i18next': 'react-i18next', i18next: 'i18next', 'react-intl': 'react-intl', '@nuxtjs/i18n': '@nuxtjs/i18n', 'vue-i18n': 'vue-i18n', 'astro-i18next': 'astro-i18next', 'expo-localization': 'expo-localization' }),
    analytics: pick({ 'posthog-js': 'posthog', 'posthog-react-native': 'posthog', '@react-native-firebase/analytics': 'firebase analytics', '@vercel/analytics': 'vercel analytics' }),
    scripts: pkg.scripts || {},
  }
}
function detectWebOther(dir, pkg, deps) {
  if (deps['react-native'] || deps.expo) return null
  if (deps.astro) return { stack: 'astro', name: 'Astro', version: deps.astro, ...jsCommon(dir, pkg, deps), integrations: Object.keys(deps).filter((d) => d.startsWith('@astrojs/')) }
  if (deps.nuxt) return { stack: 'nuxt', name: 'Nuxt', version: deps.nuxt, ...jsCommon(dir, pkg, deps), modules: Object.keys(deps).filter((d) => d.startsWith('@nuxtjs/') || d.startsWith('@nuxt/') || d.startsWith('@pinia/')) }
  if (deps.vite && deps.react) return { stack: 'react-vite', name: 'React + Vite', version: deps.react, ...jsCommon(dir, pkg, deps), router: deps['react-router'] || deps['react-router-dom'] || deps['@tanstack/react-router'] ? 'yes' : 'none' }
  return null
}

// ---------- other mobile stacks ----------
function detectReactNative(dir) {
  let pkg; try { pkg = JSON.parse(read(dir, 'package.json')) } catch { return null }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (!deps['react-native']) return null
  return { stack: 'react-native', name: deps.expo ? 'React Native (Expo)' : 'React Native', version: deps['react-native'], expo: deps.expo || null, router: deps['expo-router'] ? 'expo-router' : deps['@react-navigation/native'] ? 'react-navigation' : 'none', ...jsCommon(dir, pkg, deps), nativeDirs: ['android', 'ios'].filter((p) => exists(dir, p)) }
}
function detectGradle(dir) {
  const build = read(dir, 'build.gradle.kts') + read(dir, 'build.gradle')
  const settings = read(dir, 'settings.gradle.kts') + read(dir, 'settings.gradle')
  if (!build && !settings) return null
  if (exists(dir, 'pubspec.yaml')) return null
  const mods = ['composeApp', 'shared', 'app'].filter((m) => exists(dir, m))
  const modBuild = mods.map((m) => read(dir, m, 'build.gradle.kts') + read(dir, m, 'build.gradle')).join(' ')
  const catalog = read(dir, 'gradle', 'libs.versions.toml')
  const isKmp = /kotlin\("multiplatform"\)|kotlinMultiplatform|kotlin-multiplatform/.test(build + modBuild + catalog) || mods.some((m) => exists(dir, m, 'src', 'commonMain'))
  const libs = (re) => re.test(catalog + modBuild)
  const common = { path: rel(dir), modules: mods, versionCatalog: !!catalog, compose: /compose/i.test(modBuild + catalog), di: libs(/koin/) ? 'koin' : libs(/hilt/) ? 'hilt' : null, http: libs(/ktor/) ? 'ktor' : libs(/retrofit/) ? 'retrofit' : null, db: libs(/sqldelight/) ? 'sqldelight' : libs(/room/) ? 'room' : null, firebase: libs(/gitlive/) ? 'gitlive firebase-kotlin-sdk' : libs(/firebase/) ? 'firebase android' : null, supabase: libs(/supabase/) }
  if (isKmp) return { stack: 'kmp', name: 'Kotlin Multiplatform', ...common, iosApp: exists(dir, 'iosApp') }
  if (/com\.android\.application|android\.application/.test(modBuild + build + catalog)) return { stack: 'android', name: 'Android nativo', ...common }
  return null
}
function detectIos(dir) {
  if (exists(dir, 'pubspec.yaml') || exists(dir, 'package.json') || exists(dir, 'settings.gradle.kts')) return null
  let entries = []; try { entries = fs.readdirSync(dir) } catch { return null }
  const proj = entries.find((e) => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))
  if (!proj && !entries.includes('project.yml') && !entries.includes('Package.swift')) return null
  return { stack: 'ios', name: 'iOS nativo', path: rel(dir), project: proj || (entries.includes('project.yml') ? 'project.yml (XcodeGen)' : 'Package.swift'), spm: entries.includes('Package.swift') || entries.some((e) => e.endsWith('.xcworkspace')) }
}
// platform folders generated inside a Flutter / React Native project are not projects of their own
const hostsPlatforms = (dir) => exists(dir, 'pubspec.yaml') || /"react-native"/.test(read(dir, 'package.json'))
const PLATFORM_DIRS = new Set(['ios', 'macos', 'android', 'windows', 'linux', 'web'])
const allDirs = () => {
  const out = [base]
  try { for (const d of fs.readdirSync(base, { withFileTypes: true })) if (d.isDirectory() && !IGNORE.has(d.name) && !d.name.startsWith('.') && !(PLATFORM_DIRS.has(d.name) && hostsPlatforms(base))) out.push(path.join(base, d.name)) } catch {}
  return out
}

const webDirs = config.paths?.web ? [path.join(base, config.paths.web)] : candidates('package.json')
const mobDirs = config.paths?.mobile ? [path.join(base, config.paths.mobile)] : candidates('pubspec.yaml')
const result = {
  root: posix(base),
  web: webDirs.map(detectWeb).find(Boolean) || null,
  mobileAll: [...mobDirs.map(detectMobile), ...allDirs().flatMap((d) => [detectReactNative(d), detectGradle(d), detectIos(d)])].filter(Boolean).filter((m, i, a) => a.findIndex((x) => x.stack === m.stack && x.path === m.path) === i),
  backend: { supabase: exists(base, 'supabase', 'config.toml'), prisma: allDirs().some((d) => exists(d, 'prisma', 'schema.prisma')) },
  firebase: { json: exists(base, 'firebase.json'), rules: exists(base, 'firestore.rules'), functions: exists(base, 'functions', 'package.json') },
}

result.mobile = result.mobileAll[0] || null
if (opt.json) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }
const line = (k, v) => { if (v && (!Array.isArray(v) || v.length)) console.log(`  ${k.padEnd(12)} ${Array.isArray(v) ? v.join(', ') : v}`) }
console.log(`Project: ${result.root}`)
if (result.web) {
  const w = result.web
  if (w.stack !== 'nextjs') { console.log(`\nWeb (${w.name} ${w.version || ''}) — ${w.path}`); for (const k of ['packageManager', 'typescript', 'styling', 'state', 'data', 'tests', 'i18n', 'analytics', 'router', 'integrations', 'modules']) if (w[k] !== undefined) line(k, w[k] === true ? 'yes' : w[k] === false ? 'no' : w[k]); line('scripts', Object.keys(w.scripts || {})) } else {
  console.log(`\nWeb (Next.js ${w.next}) — ${w.path}`)
  line('router', `${w.router} router${w.srcDir ? ' (src/)' : ''}`); line('pkg manager', w.packageManager); line('typescript', w.typescript ? 'yes' : 'no')
  line('styling', w.styling); line('state', w.state); line('data', w.data); line('auth', w.auth); line('tests', w.tests.length ? w.tests : 'none ⚠'); line('lint', w.lint)
  line('i18n', w.i18n.length ? [...w.i18n, ...w.i18nFiles] : 'none'); line('analytics', w.analytics.length ? w.analytics : 'none')
  line('seo', `sitemap ${w.seo.sitemap ? '✓' : '✗'} · robots ${w.seo.robots ? '✓' : '✗'}`); line('scripts', Object.keys(w.scripts))
  }
} else console.log('\nWeb: no web project found (Next.js, React+Vite, Astro, Nuxt)')
for (const m of result.mobileAll.filter((x) => x.stack !== 'flutter')) {
  console.log(`\nMobile (${m.name}${m.version ? ' ' + m.version : ''}) — ${m.path}`)
  for (const [k, v] of Object.entries(m)) if (!['stack', 'name', 'path', 'version', 'scripts'].includes(k) && v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length)) line(k, v === true ? 'yes' : v)
}
const flutter = result.mobileAll.find((x) => x.stack === 'flutter')
if (flutter) {
  const m = flutter
  console.log(`\nMobile (Flutter, ${m.name} ${m.version || ''}) — ${m.path}`)
  line('platforms', m.platforms); line('state', m.state.length ? m.state : 'setState only?'); line('routing', m.routing.length ? m.routing : 'Navigator')
  line('codegen', m.codegen); line('firebase', m.firebase); line('tests', m.tests); line('i18n', m.i18n.length ? [...m.i18n, m.i18nFiles].filter(Boolean) : 'none')
  line('analytics', m.analytics.length ? m.analytics : 'none'); line('crash', m.crash.length ? m.crash : 'none ⚠'); line('payments', m.payments); line('lint', m.lint)
  line('entrypoints', m.entrypoints); line('flavors', m.flavors); line('lib/', m.libDirs)
}
if (!result.mobileAll.length) console.log('\nMobile: no mobile project found (Flutter, React Native, KMP, Android, iOS)')
const f = result.firebase
if (result.backend.supabase) console.log('Supabase: supabase/config.toml ✓')
if (result.backend.prisma) console.log('Prisma: prisma/schema.prisma ✓')
if (f.json || f.rules || f.functions) console.log(`\nFirebase: firebase.json ${f.json ? '✓' : '✗'} · firestore.rules ${f.rules ? '✓' : '✗'} · functions ${f.functions ? '✓' : '✗'}`)
if (result.web?.ci?.length || result.mobile?.ci?.length) console.log(`CI workflows: ${(result.web?.ci || result.mobile?.ci).join(', ')}`)
