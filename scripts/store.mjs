#!/usr/bin/env node
// DualCraft store upload with fastlane: what DualCraft already writes (store listing per language, release notes,
// framed screenshots) exported to fastlane's layout, so the release workflow uploads it to Google Play (supply) and
// App Store Connect (deliver) — no copying texts into the consoles. Submitting for review stays a manual decision.
//   init [--support-url …] [--privacy-url …] [--marketing-url …]   .dualcraft/store/store.json (app ids, urls, locales) + export
//   export [--version X]   fastlane/metadata (Play: android/<locale>, App Store: <locale>) and fastlane/screenshots
//   check [--json]         export current, required texts and urls per store and language, screenshots, notes for the version
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { projectStacks, kotlinPackage } from './lib/targets.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'export', 'check'].includes(cmd)) {
  console.log('node store.mjs init [--support-url URL] [--privacy-url URL] [--marketing-url URL] | export [--version X] | check [--json]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'store', 'store.json')
const FL = path.join(root, 'fastlane')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config).filter((s) => s.kind === 'mobile')
const hasAndroid = stacks.some((s) => ['flutter', 'android', 'kmp', 'react-native'].includes(s.id))
const hasIos = stacks.some((s) => ['flutter', 'ios', 'kmp', 'react-native'].includes(s.id))

// DualCraft language → store locale codes (Play and App Store differ: Italian is "it-IT" on Play, "it" on the App Store)
const PLAY = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR', ca: 'ca', nl: 'nl-NL', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN' }
const APPLE = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it', pt: 'pt-PT', 'pt-BR': 'pt-BR', ca: 'ca', nl: 'nl-NL', ja: 'ja', ko: 'ko', zh: 'zh-Hans' }
const semver = (v) => v.split(/[.-]/).map((x) => Number(x) || 0)
const cmpV = (a, b) => { const x = semver(a), y = semver(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }

// ---------------------------------------------------------------- config
function iosBundleId() {
  const walk = (d, depth) => { if (depth > 4 || !fs.existsSync(d)) return null; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(Pods|build|DerivedData|node_modules|\.git)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.name.endsWith('.pbxproj')) { const id = [...read(p).matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([\w.-]+)"?;/g)].map((m) => m[1]).find((x) => !/(UI)?Tests?$|Extension$|Widget/.test(x)); if (id) return id } else if (e.isDirectory()) { const r = walk(p, depth + 1); if (r) return r } } return null }
  for (const s of stacks) { const r = walk(s.dir, 0); if (r) return r }
  return null
}
function androidPackage() {
  for (const s of stacks) {
    if (s.id === 'flutter') { const m = (read(path.join(s.dir, 'android/app/build.gradle.kts')) + read(path.join(s.dir, 'android/app/build.gradle'))).match(/applicationId\s*=?\s*["']([\w.]+)["']/); if (m) return m[1] }
    if (['android', 'kmp'].includes(s.id)) return kotlinPackage(s.dir, config, s.id)
  }
  return null
}
const load = () => readJson(file) || die(`no ${rel(file)} — run: store.mjs init`)
const listing = () => readJson(path.join(dir, 'store', 'listing.json')) || {}
const languages = (s) => s.languages || Object.keys(listing()).filter((k) => !k.startsWith('$'))
function latestNotes(version) {
  const d = path.join(dir, 'release'); if (!fs.existsSync(d)) return null
  const vs = fs.readdirSync(d).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort(cmpV)
  const v = version || vs.at(-1); if (!v) return null
  const notes = readJson(path.join(d, v + '.json')); return notes ? { version: v, notes } : null
}
const noteText = (n, store) => { if (!n) return ''; const x = n[store]; return typeof x === 'string' ? x : x?.notes || '' }

// ---------------------------------------------------------------- export layout
/** { 'fastlane/…': text | { copy: src } } for everything fastlane uploads. */
function layout(s, version) {
  const out = {}; const L = listing(); const N = latestNotes(version)
  const shots = path.join(dir, 'store', 'screenshots', 'framed')
  const pngs = (locale, size) => { const d = path.join(shots, locale, size); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(d, f)) : [] }
  for (const lang of languages(s)) {
    const l = L[lang] || {}; const n = N?.notes?.[lang]
    if (hasAndroid) {
      const pl = s.locales?.play?.[lang] || PLAY[lang] || lang; const base = `fastlane/metadata/android/${pl}`
      if (l.play?.title) out[`${base}/title.txt`] = l.play.title
      if (l.play?.short) out[`${base}/short_description.txt`] = l.play.short
      if (l.play?.full) out[`${base}/full_description.txt`] = l.play.full
      if (noteText(n, 'play')) out[`${base}/changelogs/default.txt`] = noteText(n, 'play')
      if (s.upload?.screenshots !== false) pngs(lang, 'play-phone').forEach((f, i) => { out[`${base}/images/phoneScreenshots/${String(i + 1).padStart(2, '0')}_${path.basename(f).replace(/^\d+-/, '')}`] = { copy: f } })
    }
    if (hasIos) {
      const al = s.locales?.appstore?.[lang] || APPLE[lang] || lang; const base = `fastlane/metadata/${al}`
      const a = l.appstore || {}
      for (const [k, f] of [['name', 'name'], ['subtitle', 'subtitle'], ['description', 'description'], ['keywords', 'keywords'], ['promo', 'promotional_text']]) if (a[k]) out[`${base}/${f}.txt`] = a[k]
      if (noteText(n, 'appstore')) out[`${base}/release_notes.txt`] = noteText(n, 'appstore')
      for (const [k, f] of [['support', 'support_url'], ['marketing', 'marketing_url'], ['privacy', 'privacy_url']]) { const u = s.urls?.[k]; const v = typeof u === 'object' ? u?.[lang] ?? Object.values(u || {})[0] : u; if (v) out[`${base}/${f}.txt`] = v }
      if (s.upload?.screenshots !== false) for (const size of ['ios-6.9', 'ios-6.5', 'ipad-13']) pngs(lang, size).forEach((f, i) => { out[`fastlane/screenshots/${al}/${size}_${String(i + 1).padStart(2, '0')}_${path.basename(f).replace(/^\d+-/, '')}`] = { copy: f } })
    }
  }
  if (hasIos && s.copyright) out['fastlane/metadata/copyright.txt'] = s.copyright.replace('{year}', String(new Date().getFullYear()))
  out['fastlane/README.md'] = `# Store metadata (generated by DualCraft)\n\nDo not edit these files: change .dualcraft/store/listing.json, .dualcraft/release/<version>.json or the framed\nscreenshots, then run \`store.mjs export\`. The release workflow uploads them with fastlane (supply for Google Play,\ndeliver for App Store Connect); it never submits for review.\n`
  return { out, notes: N }
}
const same = (target, v) => (typeof v === 'string' ? read(target) === v + (v.endsWith('\n') ? '' : '\n') : fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(v.copy)))
function existingFiles() { const all = []; const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(posix(path.relative(root, p))) } }; walk(FL); return all.filter((f) => /^fastlane\/(metadata|screenshots|README\.md)/.test(f)) }
function doExport(s, version) {
  const { out, notes } = layout(s, version); let written = 0
  for (const [f, v] of Object.entries(out)) { const t = path.join(root, f); if (same(t, v)) continue; fs.mkdirSync(path.dirname(t), { recursive: true }); if (typeof v === 'string') fs.writeFileSync(t, v + (v.endsWith('\n') ? '' : '\n')); else fs.copyFileSync(v.copy, t); written++ }
  const stale = existingFiles().filter((f) => !out[f]); for (const f of stale) fs.rmSync(path.join(root, f))
  return { written, removed: stale.length, total: Object.keys(out).length, notes }
}

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const existed = fs.existsSync(file)
  const s = existed ? load() : { languages: undefined, android: undefined, ios: undefined, urls: {}, upload: { metadata: true, screenshots: true, notes: true }, copyright: `{year} ${config.name || ''}`.trim() }
  if (hasAndroid) s.android = { package: s.android?.package || androidPackage() || '' }
  if (hasIos) s.ios = { bundleId: s.ios?.bundleId || iosBundleId() || '' }
  for (const [k, o] of [['support', 'support-url'], ['privacy', 'privacy-url'], ['marketing', 'marketing-url']]) if (opt[o]) s.urls[k] = String(opt[o])
  if (!s.languages) delete s.languages
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
  console.log(`${existed ? 'updated' : 'created'} ${rel(file)} — ${[hasAndroid && `Play ${s.android.package || '(application id missing)'}`, hasIos && `App Store ${s.ios.bundleId || '(bundle id missing)'}`].filter(Boolean).join(' · ') || 'no mobile stack'} · languages ${languages(s).join(', ') || '(none in listing.json yet)'}`)
  const r = doExport(s); console.log(`→ fastlane/: ${r.total} file(s) (${r.written} written${r.removed ? `, ${r.removed} removed` : ''})${r.notes ? ` · notes of ${r.notes.version}` : ''}`)
  console.log('Next: store.mjs check, commit fastlane/, then deploy.mjs gen — the tag release uploads listing, notes and screenshots (never submits for review).')
  process.exit(0)
}
if (cmd === 'export') {
  const s = load(); const r = doExport(s, opt.version ? String(opt.version) : undefined)
  console.log(`fastlane/: ${r.total} file(s) — ${r.written} written${r.removed ? `, ${r.removed} removed` : ''}${r.notes ? ` · release notes of ${r.notes.version}` : ' · no release notes yet'}`)
  process.exit(0)
}

// ---------------------------------------------------------------- check
const s = load()
const issues = []; const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
const { out, notes } = layout(s)
const drift = Object.entries(out).filter(([f, v]) => !same(path.join(root, f), v)).map(([f]) => f)
const extra = existingFiles().filter((f) => !out[f])
if (drift.length || extra.length) err(`fastlane/ out of date (${[...drift, ...extra].slice(0, 3).join(', ')}${drift.length + extra.length > 3 ? '…' : ''}) — run: store.mjs export`)
const langs = languages(s)
if (!langs.length) err('no languages: write .dualcraft/store/listing.json first (dualcraft:release / dualcraft:marketing)')
for (const lang of langs) {
  if (!s.locales?.play?.[lang] && hasAndroid && !PLAY[lang]) warn(`${lang}: no Google Play locale code known — set locales.play.${lang} in store.json`)
  if (!s.locales?.appstore?.[lang] && hasIos && !APPLE[lang]) warn(`${lang}: no App Store locale code known — set locales.appstore.${lang} in store.json`)
  const l = listing()[lang] || {}
  if (hasAndroid) for (const k of ['title', 'short', 'full']) if (!l.play?.[k]) err(`${lang}: listing.json play.${k} missing (Google Play requires it)`)
  if (hasIos) for (const k of ['name', 'description', 'keywords']) if (!l.appstore?.[k]) err(`${lang}: listing.json appstore.${k} missing (App Store requires it)`)
  const pc = Object.keys(out).filter((f) => f.includes(`/${s.locales?.play?.[lang] || PLAY[lang] || lang}/images/phoneScreenshots/`)).length
  if (hasAndroid && s.upload?.screenshots !== false && (pc < 2 || pc > 8)) warn(`${lang}: ${pc} Play phone screenshot(s) — Google Play needs 2–8 (dualcraft:screenshots frame --size play-phone)`)
  const ic = Object.keys(out).filter((f) => f.startsWith(`fastlane/screenshots/${s.locales?.appstore?.[lang] || APPLE[lang] || lang}/ios-6.9`)).length
  if (hasIos && s.upload?.screenshots !== false && !ic) warn(`${lang}: no 6.9" iPhone screenshots — the App Store requires them (dualcraft:screenshots frame --size ios-6.9)`)
}
if (hasIos) { if (!s.urls?.support) err('urls.support missing — the App Store requires a support URL (store.mjs init --support-url …)'); if (!s.urls?.privacy) err('urls.privacy missing — the App Store requires a privacy policy URL (dualcraft:legal)') }
if (hasAndroid && !s.android?.package) err('android.package missing in store.json')
if (hasIos && !s.ios?.bundleId) err('ios.bundleId missing in store.json')
if (!notes) warn('no .dualcraft/release/<version>.json — the upload goes without "What\'s new" (dualcraft:release notes)')
else if (config.version && notes.version !== config.version) warn(`release notes are for ${notes.version}, the app is ${config.version} — write .dualcraft/release/${config.version}.json`)
const wf = read(path.join(root, '.github', 'workflows', 'dualcraft-release-mobile.yml'))
if (wf && !/fastlane (supply|deliver)/.test(wf)) warn('the release workflow does not upload with fastlane yet — run: deploy.mjs gen')
if (!stacks.length) warn('no mobile stack — nothing to upload')
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Store upload — ${langs.join(', ') || 'no languages'} · ${Object.keys(out).length} file(s) in fastlane/`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `store OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
