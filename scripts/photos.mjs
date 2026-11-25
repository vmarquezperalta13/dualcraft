#!/usr/bin/env node
// DualCraft product photos — free and local. One spec (.dualcraft/marketing/photos.json): your real product photos
// (marketing/photos/input/) → background removed with BiRefNet (MIT, runs on the CPU, no paid API) → packshots on pure
// white for the stores, transparent cutouts, brand backgrounds and ads with headline + call to action per language,
// in the Design System colours and fonts. The work runs in marketing/photos/ (its own sharp + transformers.js).
//   init [--dir marketing/photos]   spec with one product per input photo and the default presets + the studio project
//   gen                             sync products with input/, rewrite studio.mjs and copy the DS fonts
//   check [--json]                  spec valid, sources found, store rules (white, ≥ 85 % fill), renders current
//   render [--product id] [--preset p] [--locale l] [--dry-run]   images into marketing/photos/out/<locale|all>/<preset>/<product>.<ext>
// Texts: literal · {"es": "…", "en": "…"} · "t:<i18n key>" · "listing:<store>.<field>" (store/listing.json).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { parseColor, toHex } from './lib/color.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'gen', 'check', 'render'].includes(cmd)) {
  console.log('node photos.mjs init [--dir marketing/photos] | gen | check [--json] | render [--product id] [--preset p] [--locale l] [--dry-run]')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const specFile = path.join(dir, 'marketing', 'photos.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

const MODEL = 'onnx-community/BiRefNet_lite-ONNX'
const DEPS = { sharp: '0.35.5', '@huggingface/transformers': '4.3.2' }
const IMAGE = /\.(jpe?g|png|webp|avif|tiff?)$/i
const BACKGROUNDS = ['white', 'transparent', 'brand', 'surface']
const SHADOWS = ['contact', 'drop', 'none']
const FORMATS = ['jpg', 'png', 'webp']

// ---------------------------------------------------------------- sources
const i18nDir = path.join(dir, 'i18n')
const i18nLocales = fs.existsSync(i18nDir) ? fs.readdirSync(i18nDir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.slice(0, -5)) : []
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') flat(v, p + k + '.', out); else out[p + k] = String(v) } return out }
const texts = Object.fromEntries(i18nLocales.map((l) => [l, flat(readJson(path.join(i18nDir, l + '.json')))]))
const listing = readJson(path.join(dir, 'store', 'listing.json')) || {}
const DICT = { es: 'Descúbrelo', en: 'Discover it', fr: 'Découvrez-le', de: 'Jetzt entdecken', pt: 'Descubra', it: 'Scoprilo' }
const cta = (l) => DICT[l.slice(0, 2)] || DICT.en

// ---------------------------------------------------------------- spec
/** Default presets: store packshot (Amazon/Shopify main image rules), cutout, brand square and three ad layouts. */
const PRESETS = [
  { id: 'store-white', kind: 'packshot', width: 2000, height: 2000, format: 'jpg', background: 'white', shadow: 'contact', fill: 0.85 },
  { id: 'cutout', kind: 'packshot', width: 2000, height: 2000, format: 'png', background: 'transparent', shadow: 'none', fill: 0.95 },
  { id: 'brand-square', kind: 'packshot', width: 1080, height: 1080, format: 'jpg', background: 'brand', shadow: 'drop', fill: 0.72 },
  { id: 'ad-feed', kind: 'ad', width: 1080, height: 1350, format: 'jpg', background: 'surface', shadow: 'contact', fill: 0.9 },
  { id: 'ad-story', kind: 'ad', width: 1080, height: 1920, format: 'jpg', background: 'surface', shadow: 'contact', fill: 0.9 },
  { id: 'ad-square', kind: 'ad', width: 1080, height: 1080, format: 'jpg', background: 'brand', shadow: 'drop', fill: 0.88 },
]
const kebab = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product'
function defaults() {
  return { dir: opt.dir ? String(opt.dir) : 'marketing/photos', locales: i18nLocales.length ? i18nLocales : [config.lang || 'es'], model: MODEL, presets: PRESETS, products: [], generate: null }
}
const inputDir = (spec) => path.join(root, spec.dir || 'marketing/photos', 'input')
/** One product per photo in input/ (origin "input"); products you add by hand, or with "locked", are kept as they are. */
function sync(spec) {
  const d = inputDir(spec)
  const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => IMAGE.test(f)).sort() : []
  const kept = spec.products.filter((p) => p.origin !== 'input' || p.locked || files.includes(path.basename(p.source || '')))
  const known = new Set(kept.map((p) => path.basename(p.source || '')))
  const ids = new Set(kept.map((p) => p.id))
  const added = files.filter((f) => !known.has(f)).map((f) => {
    let id = kebab(f.replace(IMAGE, '')); while (ids.has(id)) id += '-2'; ids.add(id)
    const name = f.replace(IMAGE, '').replace(/[_-]+/g, ' ').trim()
    return { id, origin: 'input', source: posix(path.join(spec.dir || 'marketing/photos', 'input', f)), name, headline: name, cta: Object.fromEntries(spec.locales.map((l) => [l, cta(l)])) }
  })
  return { ...spec, products: [...kept, ...added] }
}
function validate(spec) {
  const errors = []; const seen = new Set(); const pseen = new Set()
  if (!Array.isArray(spec.locales) || !spec.locales.length) errors.push('locales: at least one')
  for (const p of spec.presets || []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || '')) errors.push(`preset "${p.id}": id must be kebab-case`)
    if (pseen.has(p.id)) errors.push(`preset "${p.id}" declared twice`); pseen.add(p.id)
    if (!['packshot', 'ad'].includes(p.kind)) errors.push(`preset ${p.id}: kind must be packshot or ad`)
    if (!(Number.isInteger(p.width) && Number.isInteger(p.height) && p.width >= 200 && p.height >= 200 && p.width <= 6000 && p.height <= 6000)) errors.push(`preset ${p.id}: width and height must be whole pixels, 200–6000`)
    if (!FORMATS.includes(p.format)) errors.push(`preset ${p.id}: format must be ${FORMATS.join(', ')}`)
    if (!(BACKGROUNDS.includes(p.background) || /^#[0-9a-f]{6}$/i.test(p.background || '') || p.background?.image)) errors.push(`preset ${p.id}: background must be ${BACKGROUNDS.join(', ')}, a #rrggbb colour or {"image": "path"}`)
    if (p.background === 'transparent' && p.format === 'jpg') errors.push(`preset ${p.id}: a transparent background needs png or webp`)
    if (!SHADOWS.includes(p.shadow || 'none')) errors.push(`preset ${p.id}: shadow must be ${SHADOWS.join(', ')}`)
    if (!(typeof p.fill === 'number' && p.fill > 0.2 && p.fill <= 1)) errors.push(`preset ${p.id}: fill must be 0.2–1 (share of the frame the product fills)`)
  }
  if (!(spec.presets || []).length) errors.push('no presets')
  for (const p of spec.products || []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || '')) errors.push(`product "${p.id}": id must be kebab-case`)
    if (seen.has(p.id)) errors.push(`product "${p.id}" declared twice`); seen.add(p.id)
    if (!p.source || !IMAGE.test(p.source)) errors.push(`product ${p.id}: source must be a jpg, png, webp, avif or tiff photo`)
    for (const id of p.presets || []) if (!pseen.has(id)) errors.push(`product ${p.id}: unknown preset "${id}"`)
  }
  if (spec.generate != null) errors.push('generate: image generation (ComfyUI in local, or a paid provider) is not available yet — leave it null')
  return errors
}

// ---------------------------------------------------------------- texts
const problems = new Set()
function text(value, l, where) {
  if (value == null || value === '') return ''
  if (typeof value === 'object' && !Array.isArray(value)) return text(value[l] ?? value[Object.keys(value)[0]], l, where)
  const s = String(value)
  if (s.startsWith('t:')) { const t = texts[l]?.[s.slice(2)]; if (t === undefined) problems.add(`${where}: i18n key "${s.slice(2)}" missing in ${l}`); return t ?? s.slice(2) }
  if (s.startsWith('listing:')) { const [store, field] = s.slice(8).split('.'); const t = listing[l]?.[store]?.[field]; if (!t) problems.add(`${where}: store/listing.json has no ${l}.${store}.${field}`); return t || '' }
  return s
}
/** Greedy word wrap by an average glyph width (0.55 em): good enough for headlines, flagged when it needs > maxLines. */
function wrap(s, size, width = 0.84, maxLines = 3) {
  const per = Math.max(4, Math.floor(width / (size * 0.55)))
  const lines = []; let cur = ''
  for (const w of s.split(/\s+/).filter(Boolean)) { if (cur && (cur + ' ' + w).length > per) { lines.push(cur); cur = w } else cur = cur ? cur + ' ' + w : w }
  if (cur) lines.push(cur)
  return { lines: lines.slice(0, maxLines), overflow: lines.length > maxLines }
}

// ---------------------------------------------------------------- theme from the DS tokens
const mix = (a, b, t) => toHex({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t), a: 1 })
function theme(spec) {
  const t = readJson(path.join(dir, 'design', 'tokens.json'))
  const tokens = Object.fromEntries((t?.color?.tokens || []).map((x) => [x.name, typeof x.value === 'object' ? x.value.light ?? Object.values(x.value)[0] : x.value]))
  const hex = (v, fb) => { try { const c = v && parseColor(v); return c ? toHex({ ...c, a: 1 }) : fb } catch { return fb } }
  const pick = (fb, ...names) => hex(names.map((n) => tokens[n]).find((v) => v && !String(v).startsWith('{')), fb)
  // TrueType/OpenType files only: the SVG text renderer (librsvg + fontconfig) does not read woff/woff2
  const fonts = (t?.type?.fonts || []).filter((f) => f.file && /\.(ttf|otf)$/i.test(f.file) && fs.existsSync(path.join(dir, 'design', f.file)))
    .map((f) => ({ family: f.family, file: 'fonts/' + path.basename(f.file), src: path.join(dir, 'design', f.file) }))
  const webOnly = (t?.type?.fonts || []).filter((f) => f.file && /\.woff2?$/i.test(f.file)).map((f) => f.family)
  if (webOnly.length && !fonts.length) problems.add(`design fonts ${webOnly.join(', ')} are woff/woff2 only — add a .ttf or .otf to the tokens for the photo texts (system font used meanwhile)`)
  const family = (t?.type?.families?.display || t?.type?.families?.sans || Object.values(t?.type?.families || {})[0] || '').split(',').map((x) => x.trim()).filter((x) => x && !/^(system-ui|-apple-system|ui-[a-z-]+|sans-serif|serif|monospace)$/.test(x)).join(', ')
  const primary = parseColor(pick('#2563eb', 'primary', 'brand', 'accent'))
  return {
    primary: toHex({ ...primary, a: 1 }), onPrimary: pick('#ffffff', 'on-primary', 'primary-foreground'),
    surface: pick('#ffffff', 'surface', 'background'), onSurface: pick('#111827', 'on-surface', 'foreground', 'on-background'),
    spotFrom: mix(primary, { r: 255, g: 255, b: 255 }, 0.18), spotTo: mix(primary, { r: 0, g: 0, b: 0 }, 0.4),
    font: [family, 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'].filter(Boolean).join(', '),
    fonts,
  }
}

// ---------------------------------------------------------------- jobs
/** Ad layout by aspect ratio: headline on top, product in the middle, call to action below. Stories keep Instagram/
 *  TikTok's top 14 % and bottom 20 % free of text (profile bar, reply box). */
function adLayout(w, h) {
  const r = h / w
  if (r > 1.6) return { headline: { y: 0.15, size: 0.074 }, box: { x: 0.08, y: 0.31, w: 0.84, h: 0.38 }, cta: { y: 0.72, size: 0.044, pill: 0.6 } }
  if (r > 1.1) return { headline: { y: 0.06, size: 0.072 }, box: { x: 0.1, y: 0.24, w: 0.8, h: 0.54 }, cta: { y: 0.83, size: 0.042, pill: 0.56 } }
  return { headline: { y: 0.055, size: 0.064 }, box: { x: 0.12, y: 0.24, w: 0.76, h: 0.52 }, cta: { y: 0.82, size: 0.04, pill: 0.52 } }
}
const photosDir = (spec) => path.join(root, spec.dir || 'marketing/photos')
function background(p, th, relPd) {
  if (p.background === 'white') return { type: 'color', color: '#ffffff' }
  if (p.background === 'transparent') return { type: 'transparent' }
  if (p.background === 'brand') return { type: 'spot', from: th.spotFrom, to: th.spotTo }
  if (p.background === 'surface') return { type: 'gradient', from: th.surface, to: mix(parseColor(th.surface), parseColor(th.primary), 0.12), angle: 180 }
  if (p.background?.image) return { type: 'image', file: relPd(p.background.image) }
  return { type: 'color', color: p.background }
}
function jobs(spec) {
  const th = theme(spec); const pd = photosDir(spec); const out = []
  const relPd = (p) => posix(path.relative(pd, path.join(root, p)))
  for (const prod of spec.products) {
    const presets = spec.presets.filter((p) => !prod.presets || prod.presets.includes(p.id))
    for (const p of presets) for (const l of p.kind === 'ad' ? spec.locales : ['all']) {
      const where = `${prod.id} / ${p.id}`
      const job = { product: prod.id, preset: p.id, locale: l, source: relPd(prod.source), cutout: `cutouts/${prod.id}.png`, out: `out/${l}/${p.id}/${prod.id}.${p.format}`, width: p.width, height: p.height, format: p.format, background: background(p, th, relPd), shadow: p.shadow || 'none', fill: p.fill }
      if (p.kind === 'ad') {
        const L = adLayout(p.width, p.height); const dark = p.background === 'brand'
        const head = wrap(text(prod.headline ?? prod.name, l, where), L.headline.size)
        if (head.overflow) problems.add(`${where} (${l}): headline longer than 3 lines — shorten it`)
        const c = text(prod.cta ?? cta(l), l, where)
        job.box = L.box
        job.texts = [
          { lines: head.lines, x: 0.5, y: L.headline.y, size: L.headline.size, color: dark ? th.onPrimary : th.onSurface, font: th.font, weight: 800 },
          ...(c ? [{ lines: [c], x: 0.5, y: L.cta.y, size: L.cta.size, color: dark ? th.primary : th.onPrimary, font: th.font, weight: 700, pill: { width: L.cta.pill, color: dark ? th.onPrimary : th.primary } }] : []),
        ]
      }
      job.recipe = sha(JSON.stringify({ ...job, recipe: undefined }))
      out.push(job)
    }
  }
  return { jobs: out, th }
}

// ---------------------------------------------------------------- generate
const runnerText = () => stamp(read(path.join(HERE, 'lib', 'photo-studio.mjs')))
const packageJson = (name) => JSON.stringify({ name: name + '-photos', private: true, type: 'module', description: 'Product photos generated by DualCraft (photos.mjs render)', dependencies: DEPS }, null, 2) + '\n'
const README = `# Product photos (DualCraft)

Put your real product photos in \`input/\` (any background; a plain wall or table and soft light give the cleanest
cutouts). DualCraft removes the background locally with BiRefNet (MIT) and composes every preset in
\`.dualcraft/marketing/photos.json\`: packshots on pure white for the stores, transparent cutouts, brand backgrounds
and ads with headline and call to action per language.

- \`node <dualcraft>/scripts/photos.mjs render\` → \`out/<locale|all>/<preset>/<product>.<ext>\` (+ a \`.json\` recipe each)
- A bad cutout? Fix \`cutouts/<product>.png\` in any editor (it is reused while it is newer than the photo).
- Free and offline after the first run (the model, ~220 MB, is cached in \`.models/\`). Runs on the CPU.
- \`studio.mjs\` is generated — do not edit it.
`
function generate(spec) {
  const errors = validate(spec)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix photos.json first.') }
  const pd = photosDir(spec); const written = []
  written.push(writeGuarded(path.join(pd, 'studio.mjs'), runnerText(), { root, force: true }))
  const { th } = jobs(spec)
  for (const f of th.fonts) { const p = path.join(pd, f.file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(f.src, p) }
  if (th.fonts.length) written.push(`${rel(path.join(pd, 'fonts'))}/ (${th.fonts.length} font(s))`)
  fs.mkdirSync(inputDir(spec), { recursive: true })
  written.push(writeNew(path.join(pd, 'package.json'), packageJson(kebab(config.name || 'app'))), writeNew(path.join(pd, 'README.md'), README),
    writeNew(path.join(pd, '.gitignore'), 'node_modules/\n.models/\n.fontcache/\n.fonts.conf\n.jobs.json\nout/\n'))
  return written.filter(Boolean)
}
const load = () => readJson(specFile) || die(`no ${rel(specFile)} — run: photos.mjs init`)
const save = (spec) => { fs.mkdirSync(path.dirname(specFile), { recursive: true }); fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n') }

if (cmd === 'init' || cmd === 'gen') {
  const existed = fs.existsSync(specFile)
  const spec = sync(existed ? load() : defaults()); save(spec)
  console.log(`${existed ? 'updated' : 'created'} ${rel(specFile)} — ${spec.products.length} product(s): ${spec.products.map((p) => p.id).join(', ') || `none yet (put photos in ${rel(inputDir(spec))}/)`} · presets: ${spec.presets.map((p) => p.id).join(', ')}`)
  for (const w of generate(spec)) console.log('→ ' + w)
  const n = jobs(spec).jobs.length
  console.log(`${n} image(s) to render × ${spec.locales.join('/')}`)
  for (const p of problems) console.log('⚠ ' + p)
  if (cmd === 'init') console.log(`\nNext: cd ${rel(photosDir(spec))} && npm install, put your product photos in input/, then photos.mjs gen and photos.mjs render. Free and local: background removal (BiRefNet, MIT) runs on the CPU, ~10–20 s per photo; the model (~220 MB) downloads once.`)
  process.exit(0)
}

if (cmd === 'render') {
  const spec = load(); const pd = photosDir(spec)
  const errors = validate(spec); if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix photos.json first.') }
  const { jobs: all, th } = jobs(spec)
  const pick = all.filter((j) => (!opt.product || j.product === String(opt.product)) && (!opt.preset || j.preset === String(opt.preset)) && (!opt.locale || j.locale === String(opt.locale) || j.locale === 'all'))
  if (!pick.length) die('no image matches the filters')
  for (const j of pick) if (!fs.existsSync(path.join(pd, j.source))) die(`${j.product}: photo not found (${rel(path.join(pd, j.source))})`)
  fs.mkdirSync(pd, { recursive: true })
  fs.writeFileSync(path.join(pd, '.jobs.json'), JSON.stringify({ model: spec.model || MODEL, cacheDir: '.models', fonts: th.fonts.map(({ src, ...f }) => f), jobs: pick }, null, 2))
  if (opt['dry-run']) { console.log(`${pick.length} image(s) planned in ${rel(path.join(pd, '.jobs.json'))}: ${pick.map((j) => j.out).join(', ')}`); process.exit(0) }
  if (!fs.existsSync(path.join(pd, 'node_modules', 'sharp')) || !fs.existsSync(path.join(pd, 'node_modules', '@huggingface', 'transformers'))) die(`run npm install in ${rel(pd)} first`)
  if (read(path.join(pd, 'studio.mjs')) !== runnerText()) die(`${rel(path.join(pd, 'studio.mjs'))} out of date — run: photos.mjs gen`)
  console.log(`▶ ${pick.length} image(s) in ${rel(pd)}/out — CPU only, the first cutout downloads the model once`)
  const r = spawnSync(process.execPath, ['studio.mjs', '.jobs.json'], { cwd: pd, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

// ---------------------------------------------------------------- check
const spec = load()
const issues = validate(spec).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
if (!issues.length) {
  const pd = photosDir(spec)
  const fresh = sync(spec)
  const added = fresh.products.filter((p) => !spec.products.some((x) => x.id === p.id)).map((p) => p.id)
  if (added.length) err(`new photos in input/ without a product (${added.join(', ')}) — run: photos.mjs gen`)
  const gone = spec.products.filter((p) => !fresh.products.some((x) => x.id === p.id)).map((p) => p.id)
  if (gone.length) err(`products whose photo left input/ (${gone.join(', ')}) — run: photos.mjs gen`)
  if (read(path.join(pd, 'studio.mjs')) !== runnerText()) err(`${rel(path.join(pd, 'studio.mjs'))} out of date — run: photos.mjs gen`)
  if (!spec.products.length) warn(`no products yet — put your photos in ${rel(inputDir(spec))}/ and run photos.mjs gen`)
  const { jobs: all } = jobs(spec)
  const missingSrc = new Set(); let missing = 0; const stale = new Set()
  for (const j of all) {
    const src = path.join(pd, j.source)
    if (!fs.existsSync(src)) { missingSrc.add(j.product); continue }
    const side = readJson(path.join(pd, j.out.replace(/\.[a-z]+$/, '.json')))
    if (!side) { missing++; continue }
    if (side.recipe !== j.recipe || side.sourceHash !== sha(fs.readFileSync(src))) stale.add(`${j.product}/${j.preset}`)
    // Amazon main image: pure white background, product filling ≥ 85 % of the frame
    if (j.preset === 'store-white' && side.coverage < 0.85) err(`${j.out}: product fills ${Math.round(side.coverage * 100)} % of the frame — marketplaces (Amazon main image) ask for ≥ 85 %`)
  }
  for (const id of missingSrc) err(`${id}: photo not found (${spec.products.find((p) => p.id === id).source})`)
  if (stale.size) warn(`renders older than their photo or settings (${[...stale].join(', ')}) — run: photos.mjs render`)
  if (missing) warn(`${missing} image(s) not rendered yet — run: photos.mjs render`)
  for (const p of problems) (/i18n key|listing|headline/.test(p) ? err : warn)(p)
  if (!fs.existsSync(path.join(pd, 'node_modules', 'sharp'))) warn(`${rel(pd)}: npm install not run yet`)
}
warn('Use photos of your own products (or with the rights to them). Store main images: pure white, no text, logos or watermarks; check each marketplace\'s rules before uploading.')
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Photos — ${spec.products.length} product(s) · ${spec.presets.length} preset(s) · ${spec.locales.join('/')} · ${rel(photosDir(spec))}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `photos OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
