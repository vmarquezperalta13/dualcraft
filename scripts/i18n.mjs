#!/usr/bin/env node
// DualCraft shared texts: .dualcraft/i18n/<locale>.json is the single source of UI strings for web and mobile.
//   check            same keys and placeholders in every locale, valid ICU braces, key collisions
//   gen              Flutter gen-l10n ARB files + next-intl message files (only for the project's stacks)
//   scan             hard-coded user-facing strings in Dart / TSX code (candidates to move here)
// Source format: nested JSON, leaves are ICU messages ("Hola {name}", "{count, plural, one {# día} other {# días}}").
// Top-level sections "web" and "mobile" are platform-only; everything else goes to both.
// Options: --out-web dir · --out-mobile dir · --force · --limit N (scan)
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { jsonStamp, writeGuarded } from './lib/guard.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['check', 'gen', 'scan'].includes(cmd)) { console.log('node i18n.mjs check | gen [--force] | scan [--limit 60]'); process.exit(cmd === 'help' ? 0 : 1) }

const { root, dir, config } = project()
const srcDir = path.join(dir, 'i18n')
const stackDir = (k) => path.join(root, config.paths?.[k] || '')

// ---------- scan (no source needed) ----------
if (cmd === 'scan') {
  const limit = +(opt.limit || 60)
  const hits = []
  const walk = (d, exts, skip) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.test(e.name)) walk(p, exts, skip) } else if (exts.test(e.name) && !/\.(g|freezed|gr|test|spec|stories)\.|generated|_test\.dart$/.test(e.name)) scanFile(p)
    }
  }
  const letters = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/
  function scanFile(p) {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
    const isDart = p.endsWith('.dart')
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*|import |export .* from|@)/.test(l) || /print\(|debugPrint\(|log\(|console\.|throw |Exception\(|assert\(|RegExp\(|\.(get|post|put|delete)\(|collection\(|doc\(|key:|Key\(/.test(l)) return
      const found = []
      if (isDart) {
        for (const m of l.matchAll(/\b(Text|SnackBar|Tooltip|tooltip:|label:|labelText:|hintText:|helperText:|errorText:|title:|semanticLabel:|semanticsLabel:)\s*\(?\s*(['"])((?:(?!\2).)*)\2/g)) if (letters.test(m[3]) && !/^\$\{?[\w.]+\}?$/.test(m[3])) found.push(m[3])
      } else {
        for (const m of l.matchAll(/>\s*([^<>{}`]*[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}[^<>{}`]*?)\s*</g)) if (!/^[\w.-]+$/.test(m[1].trim()) || /\s/.test(m[1].trim()) || m[1].trim().length > 3) found.push(m[1].trim())
        for (const m of l.matchAll(/\b(placeholder|aria-label|alt|title|label)=(["'])((?:(?!\2).)+)\2/g)) if (letters.test(m[3])) found.push(m[3])
      }
      for (const f of found) hits.push(`${posix(path.relative(root, p))}:${i + 1}  "${f.slice(0, 70)}"`)
    })
  }
  if (config.stacks?.mobile) walk(path.join(stackDir('mobile'), 'lib'), /\.dart$/, /^(generated|l10n|\.)/)
  if (config.stacks?.web) for (const d of ['src', 'app', 'components', 'pages']) walk(path.join(stackDir('web'), d), /\.(tsx|jsx)$/, /^(node_modules|generated|\.)/)
  console.log(hits.length ? `${hits.length} hard-coded string candidate(s)${hits.length > limit ? ` (showing ${limit})` : ''}:` : 'No hard-coded user-facing strings found.')
  hits.slice(0, limit).forEach((h) => console.log('  ' + h))
  process.exit(0)
}

// ---------- load source ----------
if (!fs.existsSync(srcDir)) die('no .dualcraft/i18n/ yet — create <locale>.json files with /dualcraft:i18n')
const locales = fs.readdirSync(srcDir).filter((f) => /^[a-z]{2,3}([_-][A-Za-z]{2,4})?\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort()
if (!locales.length) die('no <locale>.json files in .dualcraft/i18n/')
const def = config.i18n?.default || (locales.includes(config.lang) ? config.lang : locales[0])
const errors = []; const warnings = []
const data = {}
for (const l of locales) { try { data[l] = JSON.parse(fs.readFileSync(path.join(srcDir, l + '.json'), 'utf8')) } catch (e) { errors.push(`${l}.json: invalid JSON — ${e.message}`) } }
if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); process.exit(1) }

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) continue
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) errors.push(`key "${prefix}${k}": use letters, digits and _ only`)
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out)
    else if (typeof v === 'string') out[prefix + k] = v
    else errors.push(`key "${prefix}${k}": value must be a string or an object`)
  }
  return out
}
const flat = Object.fromEntries(locales.map((l) => [l, flatten(data[l])]))

/** ICU placeholders: {name} → String, {n, plural, …} → num, {x, select, …} → String, {d, date, …} → DateTime, {n, number} → num */
function placeholders(msg, key, locale) {
  const out = {}; let depth = 0; let start = -1; let quoted = false
  for (let i = 0; i < msg.length; i++) {
    const c = msg[i]
    if (c === "'") { if (msg[i + 1] === "'") { i++; continue } if (msg[i + 1] === '{' || msg[i + 1] === '}' || quoted) { quoted = !quoted; continue } }
    if (quoted) continue
    if (c === '{') { if (depth === 0) start = i; depth++ } else if (c === '}') {
      depth--
      if (depth < 0) { errors.push(`${locale}: "${key}" has an unmatched "}"`); return out }
      if (depth === 0) {
        const inner = msg.slice(start + 1, i); const [name, kind] = inner.split(',').map((s) => s.trim())
        if (/^[A-Za-z_]\w*$/.test(name)) out[name] = kind === 'plural' || kind === 'number' ? 'num' : kind === 'date' || kind === 'time' ? 'DateTime' : 'String'
        // nested messages inside plural/select branches may hold more placeholders
        if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') for (const b of inner.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) Object.assign(out, placeholders(b[1], key, locale))
      }
    }
  }
  if (depth > 0) errors.push(`${locale}: "${key}" has an unclosed "{"`)
  return out
}

// ---------- check ----------
const keys = Object.keys(flat[def])
const camel = (k) => k.split(/[._]/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('')
const scopeOf = (k) => (k.startsWith('web.') ? 'web' : k.startsWith('mobile.') ? 'mobile' : 'shared')
const outKey = (k) => (scopeOf(k) === 'shared' ? k : k.slice(k.indexOf('.') + 1))
const ph = {}
for (const k of keys) ph[k] = placeholders(flat[def][k], k, def)
for (const l of locales) {
  if (l === def) continue
  for (const k of keys) {
    if (!(k in flat[l])) { errors.push(`${l}: missing "${k}"`); continue }
    const a = Object.keys(ph[k]).sort().join(','); const b = Object.keys(placeholders(flat[l][k], k, l)).sort().join(',')
    if (a !== b) errors.push(`${l}: "${k}" placeholders {${b}} differ from ${def} {${a}}`)
  }
  for (const k of Object.keys(flat[l])) if (!(k in flat[def])) warnings.push(`${l}: extra key "${k}" (not in ${def})`)
}
for (const l of locales) for (const [k, v] of Object.entries(flat[l])) if (!v.trim()) warnings.push(`${l}: "${k}" is empty`)
for (const platform of ['web', 'mobile']) {
  const seen = new Map()
  for (const k of keys.filter((x) => scopeOf(x) === 'shared' || scopeOf(x) === platform)) {
    const ok = platform === 'mobile' ? camel(outKey(k)) : outKey(k)
    if (seen.has(ok)) errors.push(`${platform}: "${k}" and "${seen.get(ok)}" both become "${ok}"`)
    seen.set(ok, k)
  }
}

function report() {
  errors.forEach((e) => console.log('✗ ' + e)); warnings.forEach((w) => console.log('⚠ ' + w))
  const by = { shared: 0, web: 0, mobile: 0 }; keys.forEach((k) => by[scopeOf(k)]++)
  console.log(`Locales: ${locales.join(', ')} (default ${def}) · ${keys.length} keys — shared ${by.shared}, web-only ${by.web}, mobile-only ${by.mobile}`)
}
if (cmd === 'check') { report(); process.exit(errors.length ? 1 : 0) }
if (errors.length) { report(); die('fix the i18n errors first.') }

// ---------- gen ----------
const nest = (pairs) => { const o = {}; for (const [k, v] of pairs) { const parts = k.split('.'); let c = o; parts.slice(0, -1).forEach((p) => (c = c[p] ||= {})); c[parts.at(-1)] = v } return o }
const out = []
if (config.stacks?.mobile === 'flutter') {
  const mob = stackDir('mobile')
  const l10n = fs.existsSync(path.join(mob, 'l10n.yaml')) ? fs.readFileSync(path.join(mob, 'l10n.yaml'), 'utf8') : ''
  const arbDir = opt['out-mobile'] ? path.resolve(String(opt['out-mobile'])) : path.join(mob, (l10n.match(/arb-dir:\s*(\S+)/) || [])[1] || 'lib/l10n')
  const tmpl = (l10n.match(/template-arb-file:\s*(\S+)/) || [])[1] || `app_${def}.arb`
  const prefix = tmpl.replace(/_[^_]+\.arb$/, '')
  for (const l of locales) {
    const arb = { '@@locale': l.replace('-', '_') }
    for (const k of keys.filter((x) => scopeOf(x) !== 'web')) {
      const ak = camel(outKey(k)); arb[ak] = flat[l][k] ?? flat[def][k]
      if (l === def) { const p = ph[k]; arb['@' + ak] = { description: k, ...(Object.keys(p).length ? { placeholders: Object.fromEntries(Object.entries(p).map(([n, t]) => [n, { type: t }])) } : {}) } }
    }
    out.push(writeGuarded(path.join(arbDir, `${prefix}_${l.replace('-', '_')}.arb`), jsonStamp(arb, `GENERATED by DualCraft from .dualcraft/i18n/${l}.json — do not edit by hand`), { root, force: !!opt.force }))
  }
  if (!l10n) console.log(`ℹ Flutter: add l10n.yaml (arb-dir: ${posix(path.relative(mob, arbDir))}, template-arb-file: ${prefix}_${def}.arb, output-localization-file: app_localizations.dart) and "generate: true" under flutter: in pubspec.yaml, then run flutter gen-l10n.`)
}
if (config.stacks?.web) {
  const web = stackDir('web')
  const msgDir = opt['out-web'] ? path.resolve(String(opt['out-web'])) : path.join(web, ['messages', 'src/messages', 'locales'].find((d) => fs.existsSync(path.join(web, d))) || 'messages')
  for (const l of locales) {
    const obj = nest(keys.filter((x) => scopeOf(x) !== 'mobile').map((k) => [outKey(k), flat[l][k] ?? flat[def][k]]))
    out.push(writeGuarded(path.join(msgDir, `${l}.json`), jsonStamp(obj, `GENERATED by DualCraft from .dualcraft/i18n/${l}.json — do not edit by hand`), { root, force: !!opt.force }))
  }
}
out.forEach((f) => console.log('→ ' + f))
if (warnings.length) console.log(`⚠ ${warnings.length} warning(s) — run "check" for details.`)
