// Test helpers: temporary DualCraft projects and script runners.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SCRIPTS = path.join(ROOT, 'scripts')
export const FIXTURES = path.join(ROOT, 'test', 'fixtures')

/** Runs a DualCraft script: run('brain.mjs', ['summary'], cwd) → { code, out, err } */
export function run(script, args = [], cwd = ROOT, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(script.includes('/') ? ROOT : SCRIPTS, script), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...opts.env }, input: opts.input })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

export function tmpDir(prefix = 'dualcraft-test-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

export function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
export const read = (file) => fs.readFileSync(file, 'utf8')
export const exists = (file) => fs.existsSync(file)

/** A project with .dualcraft config + the fixture sources (tokens, i18n, analytics, schema). */
export function makeProject({ web = null, mobile = null, paths = {}, schema = 'hockey', extra = {} } = {}) {
  const dir = tmpDir()
  const cfg = { name: 'TestApp', version: '1.2.0', stacks: { web, mobile }, paths: { web: null, mobile: null, ...paths }, lang: 'es', commitLang: 'en', createdAt: '2026-01-01', ...extra }
  write(path.join(dir, '.dualcraft', 'config.json'), JSON.stringify(cfg, null, 2))
  write(path.join(dir, '.dualcraft', '.gitignore'), 'state.json\nout/\n')
  fs.mkdirSync(path.join(dir, '.dualcraft', 'brain'), { recursive: true })
  fs.cpSync(path.join(FIXTURES, 'project', '.dualcraft'), path.join(dir, '.dualcraft'), { recursive: true })
  const dbml = schema === 'hockey' ? path.join(ROOT, 'examples', 'hockey.dbml') : path.join(FIXTURES, 'firestore.dbml')
  write(path.join(dir, '.dualcraft', 'db', 'schema.dbml'), read(dbml))
  return dir
}

/** Minimal source trees for every stack (enough for detect/convert/generators). */
export function scaffoldStacks(dir) {
  write(path.join(dir, 'web', 'package.json'), JSON.stringify({ dependencies: { astro: '5.1.0', '@astrojs/sitemap': '3' } }))
  write(path.join(dir, 'web', 'src', 'pages', 'index.astro'), "---\nconst t = (k) => k\n---\n<h1>{t('auth.login.title')}</h1>\n")
  write(path.join(dir, 'web', 'src', 'pages', 'matches', '[id].astro'), "---\nconst r = await fetch('https://api.example.com/m')\n---\n<div/>\n")
  write(path.join(dir, 'web', 'src', 'pages', 'api', 'reserve.ts'), 'export async function POST() { const k = import.meta.env.SUPABASE_SERVICE_ROLE_KEY; return new Response("ok") }\n')
  write(path.join(dir, 'rn', 'package.json'), JSON.stringify({ dependencies: { 'react-native': '0.76.0', expo: '52.0.0', 'expo-router': '4', 'expo-camera': '16', '@supabase/supabase-js': '2' } }))
  write(path.join(dir, 'rn', 'app', '_layout.tsx'), 'export default function L(){return null}\n')
  write(path.join(dir, 'rn', 'app', '(tabs)', 'index.tsx'), "export default function Home(){ supabase.from('matches').select(); return null }\n")
  write(path.join(dir, 'rn', 'app', 'matches', '[id].tsx'), "export default function M(){ analyticsEvents.matchViewed({match_id:'x'}); return null }\n")
  write(path.join(dir, 'kmp', 'settings.gradle.kts'), 'rootProject.name="k"\n')
  write(path.join(dir, 'kmp', 'composeApp', 'build.gradle.kts'), 'plugins { alias(libs.plugins.kotlinMultiplatform) }\nandroid { namespace = "com.test.app" }\n')
  write(path.join(dir, 'kmp', 'gradle', 'libs.versions.toml'), '[libraries]\nkoin-core = "x"\nbilling = { module = "com.android.billingclient:billing-ktx" }\n')
  write(path.join(dir, 'kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', 'ui', 'matches', 'MatchesScreen.kt'), 'package com.test.app.ui.matches\n@Composable\nfun MatchesScreen() { db.collection("matches"); AnalyticsEvents.signUp(SignUpMethod.GOOGLE) }\n@Composable\nfun MatchDetailScreen(id: String) { }\n')
  write(path.join(dir, 'kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', 'ui', 'Nav.kt'), 'fun nav() { composable("matches") { MatchesScreen() }\n composable("matches/{id}") { MatchDetailScreen("x") } }\n')
  write(path.join(dir, 'droid', 'settings.gradle.kts'), 'rootProject.name="d"\n')
  write(path.join(dir, 'droid', 'app', 'build.gradle.kts'), 'plugins { id("com.android.application") }\nandroid { namespace = "com.test.droid" }\n')
  write(path.join(dir, 'droid', 'app', 'src', 'main', 'java', 'com', 'test', 'droid', 'ui', 'home', 'HomeScreen.kt'), 'package com.test.droid.ui.home\n@Composable\nfun HomeScreen() { }\n')
  fs.mkdirSync(path.join(dir, 'iosapp', 'Demo.xcodeproj'), { recursive: true })
  write(path.join(dir, 'iosapp', 'Demo', 'DemoApp.swift'), 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { Text("x") } } }\n')
  write(path.join(dir, 'iosapp', 'Demo', 'Features', 'Matches', 'MatchListView.swift'), 'import SwiftUI\nimport StoreKit\nstruct MatchListView: View { var body: some View { Text("") } }\nstruct RowView: View { var body: some View { Text("") } }\n')
  return { web: 'astro', mobile: 'react-native,kmp,android,ios', paths: { web: 'web', 'react-native': 'rn', kmp: 'kmp', android: 'droid', ios: 'iosapp' } }
}

/** Multi-stack project ready for generators. */
export function makeMultiProject(schema = 'firestore') {
  const dir = makeProject({ schema })
  const s = scaffoldStacks(dir)
  const cfgFile = path.join(dir, '.dualcraft', 'config.json')
  const cfg = JSON.parse(read(cfgFile)); cfg.stacks = { web: s.web, mobile: s.mobile }; cfg.paths = s.paths
  write(cfgFile, JSON.stringify(cfg, null, 2))
  return dir
}

/** PNG width/height from the IHDR chunk. */
export const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)] }
