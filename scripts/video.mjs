#!/usr/bin/env node
// DualCraft marketing videos with Remotion: one spec (.dualcraft/marketing/videos.json) → a Remotion project
// (marketing/video/) with every video × format × locale as a composition, styled with the DS tokens, texts from
// the shared i18n / store listing, screens from the store screenshots. Rendered locally.
//   init [--dir marketing/video]   spec with derived videos (app intro, release news) + the Remotion project
//   gen [--force]                  sync derived videos, write src/data.ts, src/theme.ts, src/Root.tsx, copy assets
//   check [--json]                 spec valid, store/social rules (durations), texts and screens found, files current
//   studio                         Remotion Studio (preview)
//   render [--video id] [--format f] [--locale l]   MP4s into marketing/video/out/<locale>/<format>/<video>.mp4
// Scene texts: literal · {"es": "…", "en": "…"} · "t:<i18n key>" · "listing:<store>.<field>" (store/listing.json).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks } from './lib/targets.mjs'
import * as V from './lib/video-gen.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check', 'studio', 'render'].includes(cmd)) {
  console.log('node video.mjs init [--dir marketing/video] | gen [--force] | check [--json] | studio | render [--video id] [--format f] [--locale l]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const specFile = path.join(dir, 'marketing', 'videos.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const stacks = projectStacks(root, config)
const ios = stacks.some((s) => ['ios', 'flutter', 'react-native', 'kmp'].includes(s.id))
const android = stacks.some((s) => ['android', 'flutter', 'react-native', 'kmp'].includes(s.id))

// ---------------------------------------------------------------- sources
const i18nDir = path.join(dir, 'i18n')
const i18nLocales = fs.existsSync(i18nDir) ? fs.readdirSync(i18nDir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.slice(0, -5)) : []
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') flat(v, p + k + '.', out); else out[p + k] = String(v) } return out }
const texts = Object.fromEntries(i18nLocales.map((l) => [l, flat(readJson(path.join(i18nDir, l + '.json')))]))
const listing = readJson(path.join(dir, 'store', 'listing.json')) || {}
const shots = readJson(path.join(dir, 'store', 'screenshots.json'))
const DICT = {
  es: { download: 'Descárgala gratis', news: 'Novedades de la {v}' }, en: { download: 'Download it free', news: "What's new in {v}" },
  fr: { download: 'Téléchargez-la gratuitement', news: 'Nouveautés de la {v}' }, de: { download: 'Jetzt kostenlos laden', news: 'Neu in {v}' },
  pt: { download: 'Descarregue grátis', news: 'Novidades da {v}' }, it: { download: 'Scaricala gratis', news: 'Novità della {v}' },
}
const dict = (l) => DICT[l.slice(0, 2)] || DICT.en
const semver = (v) => v.split(/[.-]/).map((x) => Number(x) || 0)
const latestRelease = () => {
  const d = path.join(dir, 'release'); if (!fs.existsSync(d)) return null
  const vs = fs.readdirSync(d).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort((a, b) => { const x = semver(a), y = semver(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
  const v = vs.at(-1); return v ? { version: v, notes: readJson(path.join(d, v + '.json')) || {} } : null
}

// ---------------------------------------------------------------- spec
function defaults() {
  const locs = i18nLocales.length ? i18nLocales : [config.lang || 'es']
  return { dir: opt.dir ? String(opt.dir) : 'marketing/video', locales: locs, derive: { intro: true, release: true }, videos: [] }
}
const perLocale = (spec, fn) => Object.fromEntries(spec.locales.map((l) => [l, fn(l)]))
function derived(spec) {
  const out = []; const d = spec.derive || {}
  const badges = [...(ios ? ['app-store'] : []), ...(android ? ['google-play'] : [])]
  const name = (l) => listing[l]?.appstore?.name || listing[l]?.play?.title || config.name || 'App'
  const tagline = (l) => listing[l]?.appstore?.subtitle || listing[l]?.play?.short || ''
  if (d.intro !== false && shots?.screens?.length) {
    const screens = shots.screens.slice(0, 6)
    // fits the store window (App Store previews 15–30 s): longer screens when there are few, then longer title/CTA
    const sc = Math.min(6, Math.max(3.5, (16 - 6) / screens.length))
    const edge = 3 + Math.max(0, (16 - 6 - sc * screens.length) / 2)
    out.push({ id: 'app-intro', origin: 'intro', formats: [...(ios ? ['app-store'] : []), 'vertical', ...(android ? ['play-promo'] : [])], scenes: [
      { kind: 'title', seconds: edge, text: perLocale(spec, name), subtitle: perLocale(spec, tagline) },
      ...screens.map((s) => ({ kind: 'screen', seconds: sc, shot: s.name, device: s.android || s.ios ? 'phone' : 'browser', caption: perLocale(spec, (l) => s.caption?.[l] || s.caption?.[Object.keys(s.caption || {})[0]] || s.name) })),
      { kind: 'cta', seconds: edge, text: perLocale(spec, (l) => dict(l).download), badges },
    ] })
  }
  const r = latestRelease()
  if (d.release !== false && r) {
    const items = (l) => { const n = r.notes[l] || r.notes[Object.keys(r.notes).find((k) => !k.startsWith('$'))] || {}; const t = typeof n.play === 'string' ? n.play : n.appstore?.notes || n.play?.notes || ''; return t.split(/\n+/).map((x) => x.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean).slice(0, 4) }
    out.push({ id: 'release-' + r.version.replace(/\./g, '-'), origin: 'release', formats: ['vertical', 'square'], scenes: [
      { kind: 'bullets', seconds: 6, title: perLocale(spec, (l) => dict(l).news.replace('{v}', r.version)), items: perLocale(spec, items) },
      { kind: 'cta', seconds: 3, text: perLocale(spec, (l) => dict(l).download), badges },
    ] })
  }
  return out
}
function sync(spec) {
  const fresh = derived(spec); const kept = spec.videos.filter((v) => !v.origin || v.locked)
  const ids = new Set(kept.map((v) => v.id))
  return { ...spec, videos: [...kept, ...fresh.filter((v) => !ids.has(v.id))] }
}
function validate(spec) {
  const errors = []; const seen = new Set()
  if (!Array.isArray(spec.locales) || !spec.locales.length) errors.push('locales: at least one')
  for (const v of spec.videos) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(v.id || '')) errors.push(`video "${v.id}": id must be kebab-case (letters, digits, -)`)
    if (seen.has(v.id)) errors.push(`video "${v.id}" declared twice`); seen.add(v.id)
    for (const f of v.formats || []) if (!V.FORMATS[f]) errors.push(`${v.id}: unknown format "${f}" (${Object.keys(V.FORMATS).join(', ')})`)
    if (!(v.formats || []).length) errors.push(`${v.id}: no formats`)
    ;(v.scenes || []).forEach((s, i) => {
      if (!V.SCENE_KINDS.includes(s.kind)) errors.push(`${v.id} scene ${i + 1}: kind must be ${V.SCENE_KINDS.join(', ')}`)
      if (!(typeof s.seconds === 'number' && s.seconds > 0 && s.seconds <= 30)) errors.push(`${v.id} scene ${i + 1}: seconds must be 0–30`)
    })
    if (!(v.scenes || []).length) errors.push(`${v.id}: no scenes`)
  }
  return errors
}

// ---------------------------------------------------------------- resolve per locale
const problems = new Set()
function text(value, l, where) {
  if (value == null || value === '') return ''
  if (typeof value === 'object' && !Array.isArray(value)) return text(value[l] ?? value[Object.keys(value)[0]], l, where)
  const s = String(value)
  if (s.startsWith('t:')) { const t = texts[l]?.[s.slice(2)]; if (t === undefined) problems.add(`${where}: i18n key "${s.slice(2)}" missing in ${l}`); return t ?? s.slice(2) }
  if (s.startsWith('listing:')) { const [store, field] = s.slice(8).split('.'); const t = listing[l]?.[store]?.[field]; if (!t) problems.add(`${where}: store/listing.json has no ${l}.${store}.${field}`); return t || '' }
  return s
}
const list = (value, l, where) => { const v = Array.isArray(value) ? value : value && typeof value === 'object' ? value[l] ?? value[Object.keys(value)[0]] : []; return (v || []).map((x) => text(x, l, where)).filter(Boolean) }
/** The raw screenshot for a screen name: locale first, then the default locale; ios → android → web. */
function shotFile(name, l, spec) {
  for (const loc of [l, spec.locales[0]]) for (const p of ['ios', 'android', 'web']) { const f = path.join(dir, 'store', 'screenshots', 'raw', loc, p, name + '.png'); if (fs.existsSync(f)) return f }
  return null
}
function compositions(spec) {
  const out = []; const assets = new Map()
  for (const v of spec.videos) for (const format of v.formats) for (const l of spec.locales) {
    const F = V.FORMATS[format]
    const scenes = v.scenes.map((s, i) => {
      const where = `${v.id} scene ${i + 1}`
      if (s.kind === 'title') return { kind: 'title', seconds: s.seconds, text: text(s.text, l, where), ...(s.subtitle ? { subtitle: text(s.subtitle, l, where) } : {}) }
      if (s.kind === 'screen') {
        const f = s.shot ? shotFile(s.shot, l, spec) : null
        if (s.shot && !f) problems.add(`${where}: no screenshot "${s.shot}" for ${l} (run /dualcraft:screenshots capture, or e2e store-screenshots flows)`)
        const image = f ? `screens/${l}/${s.shot}.png` : null
        if (f) assets.set(image, f)
        return { kind: 'screen', seconds: s.seconds, image, caption: text(s.caption, l, where), device: s.device === 'browser' ? 'browser' : 'phone' }
      }
      if (s.kind === 'bullets') { const items = list(s.items, l, where); if (!items.length) problems.add(`${where}: no items for ${l}`); return { kind: 'bullets', seconds: s.seconds, ...(s.title ? { title: text(s.title, l, where) } : {}), items } }
      return { kind: 'cta', seconds: s.seconds, text: text(s.text, l, where), ...(s.sub ? { sub: text(s.sub, l, where) } : {}), badges: (s.badges || []).filter((b) => ['app-store', 'google-play'].includes(b)) }
    })
    out.push({ id: `${v.id}-${format}-${l}`.toLowerCase(), video: v.id, format, locale: l, width: F.width, height: F.height, fps: V.FPS, scenes })
  }
  return { comps: out, assets }
}

// ---------------------------------------------------------------- theme from the DS tokens
function theme() {
  const t = readJson(path.join(dir, 'design', 'tokens.json'))
  const tokens = Object.fromEntries((t?.color?.tokens || []).map((x) => [x.name, typeof x.value === 'object' ? x.value.light ?? Object.values(x.value)[0] : x.value]))
  const pick = (...names) => names.map((n) => tokens[n]).find(Boolean)
  const fonts = (t?.type?.fonts || []).filter((f) => f.file && fs.existsSync(path.join(dir, 'design', f.file))).map((f) => ({ family: f.family, file: 'fonts/' + path.basename(f.file), weight: String(f.weight || 400), src: path.join(dir, 'design', f.file) }))
  return {
    primary: pick('primary', 'brand', 'accent') || '#2563eb', onPrimary: pick('on-primary', 'primary-foreground') || '#ffffff',
    surface: pick('surface', 'background') || '#ffffff', onSurface: pick('on-surface', 'foreground', 'on-background') || '#111827',
    muted: pick('muted', 'outline', 'surface-variant') || '#9ca3af',
    fontFamily: t?.type?.families?.sans || t?.type?.families?.body || Object.values(t?.type?.families || {})[0] || 'system-ui, sans-serif',
    fonts,
  }
}

// ---------------------------------------------------------------- generate
const projDir = (spec) => path.join(root, spec.dir || 'marketing/video')
function outputs(spec) {
  const th = theme(); const { comps, assets } = compositions(spec); const pd = projDir(spec)
  return {
    files: [
      { file: path.join(pd, 'src', 'data.ts'), text: stamp(V.dataTs(comps)) },
      { file: path.join(pd, 'src', 'theme.ts'), text: stamp(V.themeTs({ ...th, fonts: th.fonts.map(({ src, ...f }) => f) })) },
      { file: path.join(pd, 'src', 'Root.tsx'), text: stamp(V.rootTsx) },
    ],
    assets: [...assets, ...th.fonts.map((f) => [f.file, f.src])],
    comps,
  }
}
function generate(spec, force) {
  const errors = validate(spec)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix videos.json first.') }
  const pd = projDir(spec); const o = outputs(spec); const written = []
  for (const f of o.files) written.push(writeGuarded(f.file, f.text, { root, force }))
  for (const [dest, src] of o.assets) { const p = path.join(pd, 'public', dest); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(src, p) }
  if (o.assets.length) written.push(`${rel(path.join(pd, 'public'))}/ (${o.assets.length} screens and fonts)`)
  written.push(writeNew(path.join(pd, 'package.json'), V.packageJson((config.name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-'))), writeNew(path.join(pd, 'tsconfig.json'), V.tsconfig),
    writeNew(path.join(pd, 'remotion.config.ts'), V.remotionConfig), writeNew(path.join(pd, 'src', 'index.ts'), V.indexTs), writeNew(path.join(pd, 'src', 'components.tsx'), V.componentsTsx),
    writeNew(path.join(pd, 'README.md'), V.readme), writeNew(path.join(pd, '.gitignore'), 'node_modules/\nout/\npublic/screens/\n'))
  return { written: written.filter(Boolean), comps: o.comps }
}
const load = () => readJson(specFile) || die(`no ${rel(specFile)} — run: video.mjs init`)
const save = (spec) => { fs.mkdirSync(path.dirname(specFile), { recursive: true }); fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n') }
const seconds = (v) => v.scenes.reduce((a, s) => a + (s.seconds || 0), 0)

if (cmd === 'init' || cmd === 'gen') {
  const existed = fs.existsSync(specFile)
  const spec = sync(existed ? load() : defaults()); save(spec)
  console.log(`${existed ? 'updated' : 'created'} ${rel(specFile)} — ${spec.videos.length} video(s): ${spec.videos.map((v) => `${v.id} (${v.formats.join(', ')}; ${seconds(v)} s)`).join(' · ') || 'none yet'}`)
  const { written, comps } = generate(spec, !!opt.force)
  for (const w of written) console.log('→ ' + w)
  console.log(`${comps.length} composition(s) × ${spec.locales.join('/')}`)
  for (const p of problems) console.log('⚠ ' + p)
  if (!shots?.screens?.length) console.log('ℹ no store screenshots plan yet — the app intro video is derived from .dualcraft/store/screenshots.json (/dualcraft:screenshots)')
  if (cmd === 'init') console.log(`\nNext: cd ${rel(projDir(spec))} && npm install && npm run studio (preview), then video.mjs render. Remotion is free for individuals and companies of up to 3 people; larger companies need a company license (remotion.dev/license).`)
  process.exit(0)
}

if (cmd === 'studio' || cmd === 'render') {
  const spec = load(); const pd = projDir(spec)
  if (!fs.existsSync(path.join(pd, 'node_modules', 'remotion'))) die(`run npm install in ${rel(pd)} first`)
  // the project's own Remotion CLI (Windows: a .cmd shim, which needs a shell → one quoted command line)
  const bin = path.join(pd, 'node_modules', '.bin', process.platform === 'win32' ? 'remotion.cmd' : 'remotion')
  const npx = ([, ...args]) => (process.platform === 'win32' ? spawnSync([bin, ...args].map((a) => `"${a}"`).join(' '), { cwd: pd, stdio: 'inherit', shell: true }) : spawnSync(bin, args, { cwd: pd, stdio: 'inherit' }))
  if (cmd === 'studio') process.exit(npx(['remotion', 'studio', 'src/index.ts']).status ?? 1)
  const { comps } = compositions(spec)
  const pick = comps.filter((c) => (!opt.video || c.video === String(opt.video)) && (!opt.format || c.format === String(opt.format)) && (!opt.locale || c.locale === String(opt.locale)))
  if (!pick.length) die('no composition matches the filters')
  for (const c of pick) {
    const out = path.join('out', c.locale, c.format, `${c.video}.mp4`)
    console.log(`▶ ${c.id} → ${rel(path.join(pd, out))}`)
    const r = npx(['remotion', 'render', 'src/index.ts', c.id, out, '--codec=h264'])
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
  process.exit(0)
}

// ---------------------------------------------------------------- check
const spec = load()
const issues = validate(spec).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
if (!issues.length) {
  const fresh = sync(spec)
  const drift = [...fresh.videos.filter((v) => v.origin && JSON.stringify(v) !== JSON.stringify(spec.videos.find((x) => x.id === v.id))), ...spec.videos.filter((v) => v.origin && !v.locked && !fresh.videos.some((x) => x.id === v.id))]
  if (drift.length) err(`derived videos out of date (${drift.map((v) => v.id).join(', ')}) — run: video.mjs gen`)
  const o = outputs(spec)
  for (const f of o.files) if (read(f.file) !== f.text) err(`${rel(f.file)} out of date — run: video.mjs gen`)
  for (const v of spec.videos) for (const f of v.formats) {
    const F = V.FORMATS[f]; const s = seconds(v)
    if (s > F.maxSec || s < F.minSec) err(`${v.id} (${f}): ${s} s — ${F.label} must last ${F.minSec}–${F.maxSec} s`)
  }
  for (const p of problems) (/i18n key|listing/.test(p) ? err : warn)(p)
  if (!fs.existsSync(path.join(projDir(spec), 'node_modules', 'remotion'))) warn(`${rel(projDir(spec))}: npm install not run yet`)
}
warn('Remotion license: free for individuals and companies of up to 3 people; larger companies need a company license (remotion.dev/license). Replace the store badge pills with the official badges before publishing.')
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Videos — ${spec.videos.length} video(s) · ${spec.locales.join('/')} · ${rel(projDir(spec))}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `video OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
