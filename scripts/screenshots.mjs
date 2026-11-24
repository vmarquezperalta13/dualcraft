#!/usr/bin/env node
// DualCraft store screenshots.
// Plan: .dualcraft/store/screenshots.json
//   { "package": "com.app.id",
//     "screens": [ { "name": "home", "android": "app://home", "ios": "app://home", "web": "http://localhost:3000/",
//                    "caption": { "es": "Consulta el aforo en directo", "en": "Live capacity" } } ],
//     "frame": { "background": "token:primary", "text": "token:on-primary", "font": "Inter" } }
//   capture --platform android|ios|web [--locale es] [--device serial] [--wait 3]
//       → .dualcraft/store/screenshots/raw/<locale>/<platform>/<name>.png
//   frame [--locale es|all] [--platform android|ios|web] [--size play-phone|ios-6.9|ios-6.5|ipad-13|all]
//       → .dualcraft/store/screenshots/framed/<locale>/<size>/<NN>-<name>.png (exact store size, caption + device)
//   check  → counts and pixel sizes against Google Play / App Store rules
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { parseColor, toHex } from './lib/color.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['capture', 'frame', 'check'].includes(cmd)) { console.log('node screenshots.mjs capture --platform android|ios|web [--locale es] | frame [--locale es|all] [--size play-phone|ios-6.9|ios-6.5|ipad-13|all] | check'); process.exit(cmd === 'help' ? 0 : 1) }

const { root, dir, config } = project()
const planFile = path.join(dir, 'store', 'screenshots.json')
const base = path.join(dir, 'store', 'screenshots')
const SIZES = { 'play-phone': [1080, 1920], 'ios-6.9': [1320, 2868], 'ios-6.5': [1284, 2778], 'ipad-13': [2064, 2752] }
const rel = (p) => posix(path.relative(root, p))
const pngSize = (f) => { const b = fs.readFileSync(f); return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null }

if (cmd === 'check') {
  const framed = path.join(base, 'framed')
  if (!fs.existsSync(framed)) die('no framed screenshots yet — run "frame" first')
  let problems = 0
  for (const locale of fs.readdirSync(framed)) for (const size of fs.readdirSync(path.join(framed, locale))) {
    const files = fs.readdirSync(path.join(framed, locale, size)).filter((f) => f.endsWith('.png'))
    const [w, h] = SIZES[size] || []
    const store = size.startsWith('play') ? 'Google Play' : 'App Store'
    const [min, max] = store === 'Google Play' ? [2, 8] : [1, 10]
    const bad = files.filter((f) => { const s = pngSize(path.join(framed, locale, size, f)); return !s || s[0] !== w || s[1] !== h })
    const countOk = files.length >= min && files.length <= max
    console.log(`${countOk && !bad.length ? '✓' : '✗'} ${locale}/${size} (${store}): ${files.length} image(s)${countOk ? '' : ` — needs ${min}–${max}`}${bad.length ? ` — wrong size: ${bad.join(', ')} (expected ${w}×${h})` : ''}`)
    if (!countOk || bad.length) problems++
  }
  process.exit(problems ? 1 : 0)
}

if (!fs.existsSync(planFile)) die('no .dualcraft/store/screenshots.json — create the plan with /dualcraft:screenshots')
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
const screens = plan.screens || []
if (!screens.length) die('screenshots.json has no screens')
const locales = (l) => (l === 'all' || !l ? [...new Set(screens.flatMap((s) => Object.keys(s.caption || {})))].filter(Boolean) : [String(l)])

// ---------- capture ----------
const sleep = (s) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${Math.round(s * 1000)})`])
function chromePath() {
  const c = process.platform === 'win32'
    ? [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return c.find((p) => p && fs.existsSync(p)) || die('Chrome/Edge not found (needed to render)')
}
function chromeShot(url, out, w, h) {
  const prof = path.join(dir, 'out', '.chrome-profile'); fs.mkdirSync(prof, { recursive: true })
  const r = spawnSync(chromePath(), ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`, '--virtual-time-budget=6000', `--user-data-dir=${prof}`, `--screenshot=${out}`, url], { encoding: 'utf8' })
  if (!fs.existsSync(out)) die(`could not render ${url}: ${(r.stderr || '').slice(0, 300)}`)
}
if (cmd === 'capture') {
  const platform = String(opt.platform || die('--platform android|ios|web'))
  const locale = String(opt.locale || config.i18n?.default || config.lang || 'es')
  const outDir = path.join(base, 'raw', locale, platform); fs.mkdirSync(outDir, { recursive: true })
  const wait = Number(opt.wait || 3)
  const adb = (...a) => spawnSync('adb', [...(opt.device ? ['-s', String(opt.device)] : []), ...a], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (platform === 'android') {
    if (adb('get-state').status !== 0) die('no Android device/emulator connected (adb devices) — start one with /dualcraft:mobile-device')
    if (plan.package) { const r = adb('shell', 'cmd', 'locale', 'set-app-locales', plan.package, '--locales', locale); if (r.status !== 0) console.log(`ℹ could not set the app locale (needs Android 13+); the app shows the device language`) }
    adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'); adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'enter')
    adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '0941')
  }
  if (platform === 'ios' && process.platform !== 'darwin') die('iOS screenshots need macOS (xcrun simctl)')
  if (platform === 'ios') { spawnSync('xcrun', ['simctl', 'status_bar', 'booted', 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100']) }
  for (const s of screens) {
    const target = s[platform]
    if (!target) { console.log(`· ${s.name}: no ${platform} link — skipped`); continue }
    const out = path.join(outDir, `${s.name}.png`)
    if (platform === 'android') {
      if (adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', target, ...(plan.package ? [plan.package] : [])).status !== 0) { console.log(`✗ ${s.name}: deep link failed`); continue }
      sleep(wait); fs.writeFileSync(out, adb('exec-out', 'screencap', '-p').stdout)
    } else if (platform === 'ios') {
      spawnSync('xcrun', ['simctl', 'openurl', 'booted', target]); sleep(wait); spawnSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', out])
    } else chromeShot(target, out, Number(opt.width || 390), Number(opt.height || 844))
    const sz = fs.existsSync(out) ? pngSize(out) : null
    console.log(sz ? `✓ ${s.name} → ${rel(out)} (${sz[0]}×${sz[1]})` : `✗ ${s.name}: no image`)
  }
  if (platform === 'android') adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit')
  process.exit(0)
}

// ---------- frame ----------
function tokenColor(v, fallback) {
  if (!v) return fallback
  if (!String(v).startsWith('token:')) return v
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'design', 'tokens.json'), 'utf8'))
    const first = t.color?.themes?.[0]?.id || 'light'
    const find = (name, depth = 0) => { const tok = (t.color?.tokens || []).find((x) => x.name === name); if (!tok || depth > 5) return null; const raw = typeof tok.value === 'object' ? tok.value[first] ?? Object.values(tok.value)[0] : tok.value; const a = String(raw).match(/^\{(.+)\}$/); return a ? find(a[1], depth + 1) : raw }
    const c = parseColor(find(String(v).slice(6)) || '')
    return c ? toHex(c) : fallback
  } catch { return fallback }
}
if (cmd === 'frame') {
  const bg = tokenColor(plan.frame?.background, '#1f5fbf'); const fg = tokenColor(plan.frame?.text, '#ffffff')
  const font = plan.frame?.font || 'Inter'
  const sizes = opt.size === 'all' || !opt.size ? Object.keys(SIZES) : [String(opt.size)]
  for (const s of sizes) if (!SIZES[s]) die(`unknown size "${s}" (${Object.keys(SIZES).join(', ')})`)
  let count = 0
  for (const locale of locales(opt.locale)) for (const size of sizes) {
    const platform = opt.platform ? String(opt.platform) : size.startsWith('play') ? 'android' : 'ios'
    const rawDir = [platform, 'android', 'ios', 'web'].map((p) => path.join(base, 'raw', locale, p)).find((d) => fs.existsSync(d))
    if (!rawDir) { console.log(`· ${locale}/${size}: no raw screenshots (capture first)`); continue }
    const outDir = path.join(base, 'framed', locale, size); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true })
    const [W, H] = SIZES[size]
    screens.forEach((s, i) => {
      const raw = path.join(rawDir, `${s.name}.png`)
      if (!fs.existsSync(raw)) return
      const [rw, rh] = pngSize(raw) || [1080, 2340]
      const caption = s.caption?.[locale] || s.caption?.[Object.keys(s.caption || {})[0]] || ''
      const pad = Math.round(W * 0.07); const capH = Math.round(H * 0.2)
      const devH = H - capH - pad; const devW = Math.min(W - pad * 2, Math.round(devH * rw / rh))
      const realH = Math.round(devW * rh / rw); const radius = Math.round(devW * 0.08); const bezel = Math.round(devW * 0.025)
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${bg};font-family:"${font}",system-ui,-apple-system,"Segoe UI",sans-serif}
        .cap{position:absolute;top:${Math.round(pad * 0.9)}px;left:${pad}px;right:${pad}px;height:${capH - pad}px;display:flex;align-items:center;justify-content:center;text-align:center;color:${fg};font-weight:700;font-size:${Math.round(W * 0.062)}px;line-height:1.15;text-wrap:balance}
        .dev{position:absolute;left:${Math.round((W - devW) / 2) - bezel}px;top:${capH}px;width:${devW}px;height:${realH}px;padding:${bezel}px;background:#111;border-radius:${radius + bezel}px;box-shadow:0 ${Math.round(W * 0.02)}px ${Math.round(W * 0.05)}px rgba(0,0,0,.35)}
        .dev img{display:block;width:${devW}px;height:${realH}px;border-radius:${radius}px}
      </style></head><body><div class="cap">${caption.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div><div class="dev"><img src="file:///${posix(raw)}"></div></body></html>`
      const tmp = path.join(outDir, `_${s.name}.html`); fs.writeFileSync(tmp, html)
      const out = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${s.name}.png`)
      chromeShot(`file:///${posix(tmp)}`, out, W, H); fs.rmSync(tmp)
      count++
    })
    console.log(`✓ ${locale}/${size} → ${rel(outDir)}`)
  }
  console.log(`${count} image(s) framed — run "check" to validate counts and sizes`)
}
