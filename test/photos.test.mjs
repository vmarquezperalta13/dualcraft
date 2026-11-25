// Product photos: products from input/, presets, ad texts per locale with DS colours, store rules, stale renders.
// The image work itself (sharp + BiRefNet) runs in the project's own studio — here only the plan and the checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { run, makeProject, write, read, exists, png } from './helpers.mjs'

function photosProject() {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  run('photos.mjs', ['init'], p)
  fs.writeFileSync(path.join(p, 'marketing/photos/input/Zumo de naranja.jpg'), png(60, 90, [240, 140, 20]))
  return p
}
const jobsOf = (p) => JSON.parse(read(path.join(p, 'marketing/photos/.jobs.json'))).jobs

test('init writes the spec with the default presets and the studio project; gen adds one product per input photo', () => {
  const p = photosProject()
  const spec0 = JSON.parse(read(path.join(p, '.dualcraft/marketing/photos.json')))
  assert.deepEqual(spec0.presets.map((x) => x.id), ['store-white', 'cutout', 'brand-square', 'ad-feed', 'ad-story', 'ad-square'])
  assert.equal(spec0.model, 'onnx-community/BiRefNet_lite-ONNX')
  for (const f of ['studio.mjs', 'package.json', 'README.md', '.gitignore']) assert.ok(exists(path.join(p, 'marketing/photos', f)), f)
  assert.match(read(path.join(p, 'marketing/photos/studio.mjs')), /^\/\/ dualcraft:hash=/)
  assert.match(read(path.join(p, 'marketing/photos/package.json')), /"sharp": "0\.35\.5"[\s\S]*"@huggingface\/transformers": "4\.3\.2"/)
  assert.match(run('photos.mjs', ['check'], p).out, /new photos in input\/ without a product \(zumo-de-naranja\)/)
  const g = run('photos.mjs', ['gen'], p)
  assert.equal(g.code, 0, g.err)
  const spec = JSON.parse(read(path.join(p, '.dualcraft/marketing/photos.json')))
  assert.deepEqual(spec.products, [{ id: 'zumo-de-naranja', origin: 'input', source: 'marketing/photos/input/Zumo de naranja.jpg', name: 'Zumo de naranja', headline: 'Zumo de naranja', cta: { en: 'Discover it', es: 'Descúbrelo' } }])
  assert.match(g.out, /9 image\(s\) to render × en\/es/)
  // render needs the studio's dependencies
  const r = run('photos.mjs', ['render'], p)
  assert.equal(r.code, 1); assert.match(r.err, /run npm install in marketing\/photos first/)
})

test('render plan: packshots once, ads per locale with wrapped headline, DS colours and layout by aspect', () => {
  const p = photosProject(); run('photos.mjs', ['gen'], p)
  const file = path.join(p, '.dualcraft/marketing/photos.json'); const spec = JSON.parse(read(file))
  spec.products[0].headline = { es: 'El zumo más fresco, exprimido cada mañana para ti', en: 't:auth.login.title' }
  write(file, JSON.stringify(spec))
  const d = run('photos.mjs', ['render', '--dry-run'], p)
  assert.equal(d.code, 0, d.err)
  const jobs = jobsOf(p)
  assert.deepEqual(jobs.map((j) => j.out).slice(0, 4), ['out/all/store-white/zumo-de-naranja.jpg', 'out/all/cutout/zumo-de-naranja.png', 'out/all/brand-square/zumo-de-naranja.jpg', 'out/en/ad-feed/zumo-de-naranja.jpg'])
  const white = jobs[0]
  assert.deepEqual(white.background, { type: 'color', color: '#ffffff' }); assert.equal(white.fill, 0.85); assert.equal(white.source, 'input/Zumo de naranja.jpg')
  const brand = jobs[2]
  assert.equal(brand.background.type, 'spot'); assert.match(brand.background.from, /^#[0-9a-f]{6}$/)
  const feedEs = jobs.find((j) => j.preset === 'ad-feed' && j.locale === 'es')
  assert.deepEqual(feedEs.texts[0].lines, ['El zumo más fresco,', 'exprimido cada mañana', 'para ti'])
  assert.equal(feedEs.texts[0].color, '#2b2118', 'headline in on-surface')
  assert.equal(feedEs.texts[1].lines[0], 'Descúbrelo'); assert.match(feedEs.texts[1].pill.color, /^#[0-9a-f]{6}$/)
  assert.match(feedEs.texts[0].font, /^"Inter", Segoe UI/)
  const story = jobs.find((j) => j.preset === 'ad-story' && j.locale === 'en')
  assert.equal(story.texts[0].lines[0], 'Sign in'); assert.ok(story.texts[0].y >= 0.14, 'story text below the top safe zone')
  assert.ok(story.texts[1].y + 0.05 <= 0.8, 'story CTA above the bottom safe zone')
  // filters
  run('photos.mjs', ['render', '--dry-run', '--preset', 'ad-feed', '--locale', 'es'], p)
  assert.deepEqual(jobsOf(p).map((j) => j.out), ['out/es/ad-feed/zumo-de-naranja.jpg'])
})

test('check: renders missing or stale, store rule (≥ 85 % fill), headline overflow, missing photo; validation', () => {
  const p = photosProject(); run('photos.mjs', ['gen'], p)
  let c = run('photos.mjs', ['check'], p)
  assert.equal(c.code, 0, c.out)
  assert.match(c.out, /9 image\(s\) not rendered yet/); assert.match(c.out, /npm install not run yet/); assert.match(c.out, /photos of your own products/)
  // fake the studio's sidecar for the store packshot: right recipe and source, product too small
  run('photos.mjs', ['render', '--dry-run', '--preset', 'store-white'], p)
  const job = jobsOf(p)[0]
  const srcHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(p, 'marketing/photos/input/Zumo de naranja.jpg'))).digest('hex').slice(0, 16)
  const side = path.join(p, 'marketing/photos/out/all/store-white/zumo-de-naranja.json')
  write(side, JSON.stringify({ recipe: job.recipe, sourceHash: srcHash, coverage: 0.7 }))
  c = run('photos.mjs', ['check'], p)
  assert.equal(c.code, 1); assert.match(c.out, /product fills 70 % of the frame — marketplaces \(Amazon main image\) ask for ≥ 85 %/); assert.match(c.out, /8 image\(s\) not rendered yet/)
  write(side, JSON.stringify({ recipe: job.recipe, sourceHash: srcHash, coverage: 0.85 }))
  assert.equal(run('photos.mjs', ['check'], p).code, 0)
  // a new photo version makes the render stale
  fs.writeFileSync(path.join(p, 'marketing/photos/input/Zumo de naranja.jpg'), png(60, 90, [250, 120, 10]))
  assert.match(run('photos.mjs', ['check'], p).out, /renders older than their photo or settings \(zumo-de-naranja\/store-white\)/)
  // headline too long, photo removed by hand from a locked product
  const file = path.join(p, '.dualcraft/marketing/photos.json'); const spec = JSON.parse(read(file))
  spec.products[0].headline = 'Uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete'
  spec.products.push({ id: 'botella', source: 'marketing/photos/raw/botella.png', name: 'Botella' })
  write(file, JSON.stringify(spec))
  c = run('photos.mjs', ['check'], p)
  assert.equal(c.code, 1); assert.match(c.out, /headline longer than 3 lines/); assert.match(c.out, /botella: photo not found/)
  // validation
  write(file, JSON.stringify({ locales: ['es'], presets: [{ id: 'Bad', kind: 'poster', width: 50, height: 99999, format: 'gif', background: 'transparent', shadow: 'neon', fill: 2 }, { id: 'clear', kind: 'packshot', width: 500, height: 500, format: 'jpg', background: 'transparent', fill: 0.9 }], products: [{ id: 'x', source: 'a.pdf', presets: ['nope'] }], generate: { provider: 'fal' } }))
  const v = run('photos.mjs', ['gen'], p)
  assert.equal(v.code, 1)
  for (const re of [/id must be kebab-case/, /kind must be packshot or ad/, /whole pixels, 200–6000/, /format must be jpg, png, webp/, /shadow must be contact, drop, none/, /fill must be 0\.2–1/, /clear: a transparent background needs png or webp/, /source must be a jpg/, /unknown preset "nope"/, /image generation .* not available yet/]) assert.match(v.out, re)
})
