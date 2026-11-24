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
  if (!deps.next) return null
  const has = (n) => !!deps[n]
  const major = (n) => { const m = String(deps[n] || '').match(/(\d+)/); return m ? +m[1] : null }
  const srcDir = exists(dir, 'src') ? 'src/' : ''
  const router = exists(dir, srcDir + 'app') ? (exists(dir, srcDir + 'pages') ? 'app + pages' : 'app') : exists(dir, srcDir + 'pages') ? 'pages' : '?'
  const pm = exists(dir, 'pnpm-lock.yaml') ? 'pnpm' : exists(dir, 'yarn.lock') ? 'yarn' : exists(dir, 'bun.lockb') || exists(dir, 'bun.lock') ? 'bun' : 'npm'
  const pick = (map) => Object.entries(map).filter(([k]) => has(k)).map(([, v]) => v)
  return {
    path: rel(dir), next: deps.next, nextMajor: major('next'), react: deps.react || null, router, srcDir: !!srcDir, packageManager: pm,
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
    path: rel(dir), name: (text.match(/^name:\s*(\S+)/m) || [])[1], version, sdk,
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

const webDirs = config.paths?.web ? [path.join(base, config.paths.web)] : candidates('package.json')
const mobDirs = config.paths?.mobile ? [path.join(base, config.paths.mobile)] : candidates('pubspec.yaml')
const result = {
  root: posix(base),
  web: webDirs.map(detectWeb).find(Boolean) || null,
  mobile: mobDirs.map(detectMobile).find(Boolean) || null,
  firebase: { json: exists(base, 'firebase.json'), rules: exists(base, 'firestore.rules'), functions: exists(base, 'functions', 'package.json') },
}

if (opt.json) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }
const line = (k, v) => { if (v && (!Array.isArray(v) || v.length)) console.log(`  ${k.padEnd(12)} ${Array.isArray(v) ? v.join(', ') : v}`) }
console.log(`Project: ${result.root}`)
if (result.web) {
  const w = result.web
  console.log(`\nWeb (Next.js ${w.next}) — ${w.path}`)
  line('router', `${w.router} router${w.srcDir ? ' (src/)' : ''}`); line('pkg manager', w.packageManager); line('typescript', w.typescript ? 'yes' : 'no')
  line('styling', w.styling); line('state', w.state); line('data', w.data); line('auth', w.auth); line('tests', w.tests.length ? w.tests : 'none ⚠'); line('lint', w.lint)
  line('i18n', w.i18n.length ? [...w.i18n, ...w.i18nFiles] : 'none'); line('analytics', w.analytics.length ? w.analytics : 'none')
  line('seo', `sitemap ${w.seo.sitemap ? '✓' : '✗'} · robots ${w.seo.robots ? '✓' : '✗'}`); line('scripts', Object.keys(w.scripts))
} else console.log('\nWeb: no Next.js project found')
if (result.mobile) {
  const m = result.mobile
  console.log(`\nMobile (Flutter, ${m.name} ${m.version || ''}) — ${m.path}`)
  line('platforms', m.platforms); line('state', m.state.length ? m.state : 'setState only?'); line('routing', m.routing.length ? m.routing : 'Navigator')
  line('codegen', m.codegen); line('firebase', m.firebase); line('tests', m.tests); line('i18n', m.i18n.length ? [...m.i18n, m.i18nFiles].filter(Boolean) : 'none')
  line('analytics', m.analytics.length ? m.analytics : 'none'); line('crash', m.crash.length ? m.crash : 'none ⚠'); line('payments', m.payments); line('lint', m.lint)
  line('entrypoints', m.entrypoints); line('flavors', m.flavors); line('lib/', m.libDirs)
} else console.log('\nMobile: no Flutter project found')
const f = result.firebase
if (f.json || f.rules || f.functions) console.log(`\nFirebase: firebase.json ${f.json ? '✓' : '✗'} · firestore.rules ${f.rules ? '✓' : '✗'} · functions ${f.functions ? '✓' : '✗'}`)
if (result.web?.ci?.length || result.mobile?.ci?.length) console.log(`CI workflows: ${(result.web?.ci || result.mobile?.ci).join(', ')}`)
