// Marketing videos (Remotion): derived app intro and release videos, compositions per format × locale, store rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeProject, write, read, exists, png } from './helpers.mjs'

export function videoProject() {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  const D = (...x) => path.join(p, '.dualcraft', ...x)
  write(D('store', 'screenshots.json'), JSON.stringify({ screens: [{ name: 'home', android: 'liga://home', caption: { es: 'Sigue a tu equipo en directo', en: 'Follow your team live' } }, { name: 'stats', android: 'liga://stats', caption: { es: 'Estadísticas de cada partido', en: 'Stats for every match' } }] }))
  for (const l of ['es', 'en']) for (const n of ['home', 'stats']) { const f = D('store', 'screenshots', 'raw', l, 'android', n + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, png(90, 195, n === 'home' ? [40, 90, 200] : [200, 80, 60])) }
  write(D('store', 'listing.json'), JSON.stringify({ es: { appstore: { name: 'Liga', subtitle: 'Tu liga en el bolsillo' } }, en: { appstore: { name: 'Liga', subtitle: 'Your league in your pocket' } } }))
  write(D('release', '1.2.0.json'), JSON.stringify({ es: { play: '• Antigua' } }))
  write(D('release', '1.3.0.json'), JSON.stringify({ es: { play: '• Favoritos\n• Modo oscuro\n• Notificaciones de gol' }, en: { play: '- Favourites\n- Dark mode' } }))
  return p
}

test('init derives the app intro (fitted to the App Store window) and the latest release video → Remotion project', () => {
  const p = videoProject()
  const r = run('video.mjs', ['init'], p)
  assert.equal(r.code, 0, r.err)
  const spec = JSON.parse(read(path.join(p, '.dualcraft/marketing/videos.json')))
  assert.deepEqual(spec.videos.map((v) => v.id), ['app-intro', 'release-1-3-0'])
  const intro = spec.videos[0]
  assert.deepEqual(intro.formats, ['app-store', 'vertical', 'play-promo'])
  assert.equal(intro.scenes.reduce((a, s) => a + s.seconds, 0), 16, 'two screens are stretched to reach 15 s')
  const data = read(path.join(p, 'marketing/video/src/data.ts'))
  assert.match(data, /"id": "app-intro-app-store-es"[\s\S]*"width": 886,\s*"height": 1920/)
  assert.match(data, /"text": "Liga",\s*"subtitle": "Tu liga en el bolsillo"/)
  assert.match(data, /"image": "screens\/en\/stats\.png",\s*"caption": "Stats for every match"/)
  assert.match(data, /"title": "Novedades de la 1\.3\.0",\s*"items": \[\s*"Favoritos",\s*"Modo oscuro",\s*"Notificaciones de gol"\s*\]/)
  assert.match(data, /"title": "What's new in 1\.3\.0",\s*"items": \[\s*"Favourites",\s*"Dark mode"\s*\]/)
  assert.match(data, /"badges": \[\s*"app-store",\s*"google-play"\s*\]/)
  assert.match(read(path.join(p, 'marketing/video/src/theme.ts')), /primary: "oklch\(0\.55 0\.15 250\)"/)
  assert.ok(exists(path.join(p, 'marketing/video/public/screens/es/home.png')))
  for (const f of ['package.json', 'src/index.ts', 'src/Root.tsx', 'src/components.tsx', 'remotion.config.ts', 'README.md']) assert.ok(exists(path.join(p, 'marketing/video', f)), f)
  assert.match(read(path.join(p, 'marketing/video/package.json')), /"remotion": "4\.0\.547"/)
  const c = run('video.mjs', ['check'], p)
  assert.equal(c.code, 0, c.out)
  assert.match(c.out, /npm install not run yet/); assert.match(c.out, /Remotion license/)
})

test('custom videos: texts from i18n and listing, store duration rules, missing screens and keys; derived ones stay in sync', () => {
  const p = videoProject()
  run('video.mjs', ['init'], p)
  const file = path.join(p, '.dualcraft/marketing/videos.json')
  const spec = JSON.parse(read(file))
  spec.videos.push({ id: 'teaser', formats: ['app-store', 'square'], scenes: [{ kind: 'title', seconds: 4, text: 'listing:appstore.subtitle' }, { kind: 'screen', seconds: 4, shot: 'profile', caption: 't:auth.login.title' }, { kind: 'cta', seconds: 3, text: 't:marketing.nope', badges: ['google-play'] }] })
  write(file, JSON.stringify(spec))
  assert.equal(run('video.mjs', ['gen'], p).code, 0)
  const data = read(path.join(p, 'marketing/video/src/data.ts'))
  assert.match(data, /"id": "teaser-square-es"[\s\S]*?"text": "Tu liga en el bolsillo"[\s\S]*?"image": null,\s*"caption": "Inicia sesión"/)
  const c = run('video.mjs', ['check'], p)
  assert.equal(c.code, 1)
  for (const re of [/teaser \(app-store\): 11 s — App Store app preview .* must last 15–30 s/, /i18n key "marketing\.nope" missing in es/, /no screenshot "profile" for es/]) assert.match(c.out, re)
  // a new release replaces the derived release video; the custom one is kept
  write(path.join(p, '.dualcraft/release/1.4.0.json'), JSON.stringify({ es: { play: '• Ligas privadas' } }))
  assert.match(run('video.mjs', ['check'], p).out, /derived videos out of date \(release-1-4-0, release-1-3-0\)/)
  run('video.mjs', ['gen'], p)
  assert.deepEqual(JSON.parse(read(file)).videos.map((v) => v.id), ['teaser', 'app-intro', 'release-1-4-0'])
  // validation
  write(file, JSON.stringify({ locales: ['es'], videos: [{ id: 'Bad', formats: ['cinema'], scenes: [{ kind: 'gif', seconds: 0 }] }] }))
  const v = run('video.mjs', ['gen'], p)
  assert.equal(v.code, 1)
  for (const re of [/id must be kebab-case/, /unknown format "cinema"/, /kind must be title, screen, bullets, cta/, /seconds must be 0–30/]) assert.match(v.out, re)
})
