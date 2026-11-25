// DualCraft product photo studio — copied into the project (marketing/photos/studio.mjs) and run there with its own
// dependencies (sharp, @huggingface/transformers). Free and local: background removal with BiRefNet (MIT, ONNX, CPU),
// then packshots on white / brand backgrounds, shadows and ad layouts with text. No paid API, no network after the
// first model download. Reads a jobs file written by DualCraft (photos.mjs render): node studio.mjs <jobs.json>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const jobsFile = process.argv[2]
if (!jobsFile) { console.error('usage: node studio.mjs <jobs.json>'); process.exit(1) }
const J = JSON.parse(fs.readFileSync(jobsFile, 'utf8'))
const here = path.dirname(path.resolve(jobsFile))
const abs = (p) => path.resolve(here, p)

// fonts: a fontconfig file with the Design System fonts + the system ones, set before sharp loads librsvg
if (J.fonts?.length) {
  const conf = path.join(here, '.fonts.conf')
  const sys = process.platform === 'win32' ? ['C:/Windows/Fonts'] : process.platform === 'darwin' ? ['/System/Library/Fonts', '/Library/Fonts', '~/Library/Fonts'] : ['/usr/share/fonts', '/usr/local/share/fonts', '~/.fonts']
  const dirs = [...new Set(J.fonts.map((f) => path.dirname(abs(f.file)).replace(/\\/g, '/')))]
  fs.writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n${[...dirs, ...sys].map((d) => `  <dir>${d}</dir>`).join('\n')}\n  <cachedir>${path.join(here, '.fontcache').replace(/\\/g, '/')}</cachedir>\n</fontconfig>\n`)
  process.env.FONTCONFIG_FILE = conf
}
const { default: sharp } = await import('sharp')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- cutout
let segmenter = null
async function removeBackground(src) {
  if (!segmenter) {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = abs(J.cacheDir || '.models')
    console.log(`  loading ${J.model} (first time: downloads ~220 MB into ${path.relative(process.cwd(), env.cacheDir) || '.'})`)
    segmenter = await pipeline('background-removal', J.model, { dtype: 'fp32' })
  }
  const r = await segmenter(src); const img = Array.isArray(r) ? r[0] : r
  return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: img.channels } })
}
/** Cutout of a source: the cached one if it is newer than the source, the source itself if it already has
 *  transparency, else BiRefNet. Soft haze below `J.alphaFloor` is cleared; the result is trimmed to the product. */
async function cutout(job) {
  const src = abs(job.source); const dest = abs(job.cutout)
  if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) return dest
  const meta = await sharp(src).metadata()
  let img
  if (meta.hasAlpha && (await sharp(src).extractChannel('alpha').stats()).channels[0].min < 250) { console.log(`  ${job.product}: already transparent, no background removal`); img = sharp(src).ensureAlpha() }
  else { const t = Date.now(); console.log(`  ${job.product}: removing the background…`); img = await removeBackground(src); console.log(`  ${job.product}: cut out in ${((Date.now() - t) / 1000).toFixed(1)} s`) }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const floor = J.alphaFloor ?? 10
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4 + 3
    if (data[i] < floor) data[i] = 0
    else { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) throw new Error(`${job.product}: nothing left after removing the background — use a photo with the product clearly in front`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await sharp(data, { raw: info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toFile(dest)
  return dest
}

// ---------------------------------------------------------------- compose
function backgroundSvg(bg, W, H) {
  if (bg.type === 'gradient') {
    const a = ((bg.angle ?? 180) - 90) * Math.PI / 180; const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}"><stop offset="0" stop-color="${esc(bg.from)}"/><stop offset="1" stop-color="${esc(bg.to)}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
  }
  if (bg.type === 'spot') // studio light: a soft radial highlight on the brand colour
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.5" cy="0.42" r="0.75"><stop offset="0" stop-color="${esc(bg.from)}"/><stop offset="1" stop-color="${esc(bg.to)}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
  return null
}
function textSvg(texts, W, H) {
  const parts = []
  for (const t of texts) {
    const size = Math.round(t.size * W); const lh = Math.round(size * (t.lineHeight || 1.15))
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle'
    const x = Math.round(t.x * W); let y = Math.round(t.y * H) + size
    if (t.pill) { // call-to-action button behind one line of text
      const w = Math.round(t.pill.width * W); const h = Math.round(size * 2.1)
      const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
      parts.push(`<rect x="${left}" y="${Math.round(t.y * H)}" width="${w}" height="${h}" rx="${h / 2}" fill="${esc(t.pill.color)}"/>`)
      y = Math.round(t.y * H + h / 2 + size * 0.36)
    }
    const lines = t.lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${esc(l)}</tspan>`).join('')
    parts.push(`<text font-family="${esc(t.font)}" font-size="${size}" font-weight="${t.weight || 700}" fill="${esc(t.color)}" text-anchor="${anchor}">${lines}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`
}
async function render(job) {
  const W = job.width, H = job.height
  const cut = await cutout(job)
  const m = await sharp(cut).metadata()
  // product box: fraction of the canvas; the product is scaled to `fill` of it, keeping its proportions
  const box = job.box || { x: 0, y: 0, w: 1, h: 1 }
  const bw = box.w * W * job.fill, bh = box.h * H * job.fill
  const scale = Math.min(bw / m.width, bh / m.height)
  const pw = Math.max(1, Math.round(m.width * scale)), ph = Math.max(1, Math.round(m.height * scale))
  const left = Math.round(box.x * W + (box.w * W - pw) / 2)
  const top = Math.round(box.y * H + (box.h * H - ph) / 2 + (job.shadow === 'contact' ? -ph * 0.02 : 0))
  const product = await sharp(cut).resize(pw, ph).png().toBuffer()
  const layers = []
  const bgSvg = backgroundSvg(job.background, W, H)
  if (bgSvg) layers.push({ input: Buffer.from(bgSvg), left: 0, top: 0 })
  if (job.background.type === 'image') layers.push({ input: await sharp(abs(job.background.file)).resize(W, H, { fit: 'cover' }).toBuffer(), left: 0, top: 0 })
  if (job.shadow === 'contact') { // soft ellipse under the base, like a product resting on a surface
    const sw = Math.round(pw * 0.9), sh = Math.max(8, Math.round(ph * 0.07)), pad = Math.round(sh * 1.5)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw + pad * 2}" height="${sh + pad * 2}"><ellipse cx="${sw / 2 + pad}" cy="${sh / 2 + pad}" rx="${sw / 2}" ry="${sh / 2}" fill="#000" fill-opacity="${job.shadowOpacity ?? 0.28}"/></svg>`
    const blur = await sharp(Buffer.from(svg)).blur(Math.max(1, sh * 0.35)).png().toBuffer()
    layers.push({ input: blur, left: Math.round(left + (pw - sw) / 2 - pad), top: Math.round(top + ph - sh / 2 - pad) })
  } else if (job.shadow === 'drop') { // the product's own silhouette, blurred and offset down
    const pad = Math.round(Math.max(pw, ph) * 0.06)
    const sil = await sharp(product).extractChannel('alpha').linear(job.shadowOpacity ?? 0.3, 0).toBuffer()
    const black = await sharp({ create: { width: pw, height: ph, channels: 3, background: '#000' } }).joinChannel(sil).png().toBuffer()
    const blur = await sharp(black).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(pad / 2.5).png().toBuffer()
    layers.push({ input: blur, left: left - pad, top: top - pad + Math.round(ph * 0.03) })
  }
  layers.push({ input: product, left, top })
  if (job.texts?.length) layers.push({ input: Buffer.from(textSvg(job.texts, W, H)), left: 0, top: 0 })
  const transparent = job.background.type === 'transparent'
  const base = transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : job.background.type === 'color' ? job.background.color : '#ffffff'
  let img = sharp({ create: { width: W, height: H, channels: 4, background: base } }).composite(layers)
  const out = abs(job.out); fs.mkdirSync(path.dirname(out), { recursive: true })
  if (job.format === 'jpg') img = sharp(await img.flatten({ background: base === 'transparent' ? '#ffffff' : base }).png().toBuffer()).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
  else if (job.format === 'webp') img = sharp(await img.png().toBuffer()).webp({ quality: 90 })
  else img = sharp(await img.png().toBuffer()).png()
  await img.withMetadata({ density: 72 }).toFile(out)
  // recipe sidecar: what was made, from which source (hash) — re-render or audit any image later
  const sidecar = { product: job.product, preset: job.preset, locale: job.locale, size: `${W}x${H}`, source: job.source, sourceHash: sha(fs.readFileSync(abs(job.source))), recipe: job.recipe, coverage: +(Math.max(pw / W, ph / H)).toFixed(3), engine: 'dualcraft-photo-studio/1', model: J.model }
  fs.writeFileSync(out.replace(/\.[a-z]+$/, '.json'), JSON.stringify(sidecar, null, 2) + '\n')
}

let n = 0
for (const job of J.jobs) {
  try { await render(job); n++; console.log(`✓ ${job.out}`) }
  catch (e) { console.error(`✗ ${job.out}: ${e.message}`); process.exitCode = 1 }
}
console.log(`${n}/${J.jobs.length} image(s)`)
