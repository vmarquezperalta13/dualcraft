// Scripts without other coverage: ER diagram, stacks registry, store screenshots (check; frame when Chrome exists).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeProject, write, read, exists, png, pngSize, ROOT } from './helpers.mjs'

test('er: check, json and the interactive html from the project schema', () => {
  const p = makeProject()
  const c = run('er.mjs', ['check'], p)
  assert.equal(c.code, 0, c.out + c.err)
  const model = JSON.parse(run('er.mjs', ['json'], p).out)
  assert.ok(model.tables.length > 2, 'tables parsed')
  assert.ok(model.refs.length > 0, 'relations parsed')
  const h = run('er.mjs', ['html'], p)
  assert.equal(h.code, 0, h.err)
  const html = read(path.join(p, '.dualcraft', 'out', 'er.html'))
  assert.match(html, /<svg|<canvas|<script/); assert.ok(html.includes(model.tables[0].name))
  // a broken schema fails the check
  write(path.join(p, '.dualcraft', 'db', 'schema.dbml'), 'Table a {\n  id int [pk]\n  b_id int [ref: > missing.id]\n}\n')
  assert.equal(run('er.mjs', ['check'], p).code, 1)
})

test('stacks: list, show, scaffold command and the project stacks', () => {
  const l = run('stacks.mjs', ['list'])
  assert.equal(l.code, 0)
  for (const id of ['nextjs', 'react-vite', 'astro', 'nuxt', 'flutter', 'react-native', 'kmp', 'android', 'ios']) assert.match(l.out, new RegExp(`\\b${id}\\b`))
  assert.match(l.out, /Backends:/)
  assert.doesNotMatch(run('stacks.mjs', ['list', '--kind', 'mobile']).out, /nextjs/)
  const reg = JSON.parse(read(path.join(ROOT, 'stacks', 'registry.json')))
  for (const s of reg.stacks) assert.ok(exists(path.join(ROOT, 'stacks', s.id + '.md')), `stacks/${s.id}.md`)
  const sh = run('stacks.mjs', ['show', 'flutter'])
  assert.match(sh.out, /"id": "flutter"/); assert.match(sh.out, /stacks\/flutter\.md/)
  const sc = run('stacks.mjs', ['scaffold', 'flutter', '--dir', 'app', '--org', 'com.acme'])
  assert.match(sc.out, /flutter create/); assert.match(sc.out, /com\.acme/); assert.match(sc.out, /config set stacks\.mobile=flutter paths\.mobile=app/)
  assert.equal(run('stacks.mjs', ['show', 'cobol']).code, 1)
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  const pr = run('stacks.mjs', ['project'], p)
  assert.match(pr.out, /web: nextjs \(Next\.js\) → site/); assert.match(pr.out, /mobile: flutter \(Flutter\) → app/)
})

function shotsProject() {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  write(path.join(p, '.dualcraft', 'store', 'screenshots.json'), JSON.stringify({ package: 'com.test.app', screens: [{ name: 'home', android: 'app://home', caption: { es: 'Tu liga en directo', en: 'Your league live' } }, { name: 'stats', android: 'app://stats', caption: { es: 'Estadísticas', en: 'Stats' } }], frame: { background: 'token:primary', text: 'token:on-primary' } }))
  return p
}

test('screenshots check: counts and exact pixel sizes per store', () => {
  const p = shotsProject()
  assert.match(run('screenshots.mjs', ['check'], p).err, /no framed screenshots yet/)
  const dir = path.join(p, '.dualcraft', 'store', 'screenshots', 'framed')
  for (const n of ['01-home', '02-stats']) { write(path.join(dir, 'es', 'play-phone', n + '.png'), ''); fs.writeFileSync(path.join(dir, 'es', 'play-phone', n + '.png'), png(1080, 1920, [10, 20, 30])) }
  fs.mkdirSync(path.join(dir, 'es', 'ios-6.9'), { recursive: true }); fs.writeFileSync(path.join(dir, 'es', 'ios-6.9', '01-home.png'), png(100, 200, [0, 0, 0]))
  const c = run('screenshots.mjs', ['check'], p)
  assert.equal(c.code, 1)
  assert.match(c.out, /✓ es\/play-phone \(Google Play\): 2 image\(s\)/)
  assert.match(c.out, /✗ es\/ios-6\.9 \(App Store\): 1 image\(s\) — wrong size: 01-home\.png \(expected 1320×2868\)/)
  fs.rmSync(path.join(dir, 'es', 'ios-6.9'), { recursive: true })
  fs.rmSync(path.join(dir, 'es', 'play-phone', '02-stats.png'))
  assert.match(run('screenshots.mjs', ['check'], p).out, /1 image\(s\) — needs 2–8/)
})

const chrome = [process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find((f) => fs.existsSync(f))

test('screenshots frame: exact store size per locale with the caption (needs Chrome or Edge)', { skip: !chrome && 'no Chrome/Edge on this machine' }, () => {
  const p = shotsProject()
  for (const l of ['es', 'en']) for (const n of ['home', 'stats']) { const f = path.join(p, '.dualcraft', 'store', 'screenshots', 'raw', l, 'android', n + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, png(270, 585, [40, 90, 200])) }
  const r = run('screenshots.mjs', ['frame', '--locale', 'all', '--platform', 'android', '--size', 'play-phone'], p)
  assert.equal(r.code, 0, r.out + r.err)
  for (const l of ['es', 'en']) for (const n of ['01-home', '02-stats']) assert.deepEqual(pngSize(path.join(p, '.dualcraft', 'store', 'screenshots', 'framed', l, 'play-phone', n + '.png')), [1080, 1920])
  assert.equal(run('screenshots.mjs', ['check'], p).code, 0)
})
