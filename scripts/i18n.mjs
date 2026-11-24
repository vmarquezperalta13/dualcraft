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
import crypto from 'node:crypto'
import { projectStacks, kotlinModule, iosAppDir } from './lib/targets.mjs'

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
const NOTE = (l) => `GENERATED by DualCraft from .dualcraft/i18n/${l}.json — do not edit by hand`
const keysFor = (kind) => keys.filter((x) => scopeOf(x) === 'shared' || scopeOf(x) === kind)
const msgOf = (l, k) => flat[l][k] ?? flat[def][k]

// ICU helpers: whole-message plural → { arg, branches: [[selector, text]] }; balanced-brace scanning
function wholePlural(msg) {
  const m = msg.trim().match(/^\{\s*(\w+)\s*,\s*plural\s*,([\s\S]*)\}$/)
  if (!m) return null
  const branches = []; const s = m[2]; let i = 0
  while (i < s.length) {
    const sel = s.slice(i).match(/^\s*(=\d+|zero|one|two|few|many|other)\s*\{/)
    if (!sel) { if (s.slice(i).trim()) return null; break }
    let j = i + sel[0].length; let depth = 1; const start = j
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++ }
    if (depth) return null
    branches.push([sel[1], s.slice(start, j - 1)]); i = j
  }
  return branches.length ? { arg: m[1], branches } : null
}
const hasComplexIcu = (msg) => /\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(msg)

// ---- Android / Compose resources XML ----
const xmlEscape = (s) => s.replace(/\\/g, '\\\\').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/^([@?])/, '\\$1')
function androidFormat(text, order, types) {
  return xmlEscape(text).replace(/\{(\w+)\}/g, (all, n) => { const i = order.indexOf(n); return i < 0 ? all : `%${i + 1}$${types[n] === 'num' ? 'd' : 's'}` })
}
function genAndroidXml(l, kind) {
  const L = ['<resources>']
  for (const k of keysFor(kind)) {
    const name = outKey(k).replace(/[.\-]/g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    const msg = msgOf(l, k); const types = ph[k]
    const pl = wholePlural(msg)
    if (pl) {
      const order = [pl.arg, ...Object.keys(types).filter((n) => n !== pl.arg)]
      L.push(`    <plurals name="${name}">`)
      for (const [sel, text] of pl.branches) {
        const q = sel === '=0' ? 'zero' : sel === '=1' ? 'one' : sel.startsWith('=') ? null : sel
        if (!q) { warnings.push(`${l}: "${k}" branch ${sel} has no Android plural category — dropped`); continue }
        if (sel === '=0') warnings.push(`${l}: "${k}" =0 → Android "zero" (only used by languages with a zero category; others show "other")`)
        L.push(`        <item quantity="${q}">${androidFormat(text.replace(/#/g, `{${pl.arg}}`), order, { ...types, [pl.arg]: 'num' })}</item>`)
      }
      L.push('    </plurals>')
    } else {
      if (hasComplexIcu(msg)) warnings.push(`${l}: "${k}" uses ICU select/nested plural — Android gets it as plain text; split it into simpler keys`)
      L.push(`    <string name="${name}">${androidFormat(msg, Object.keys(types), types)}</string>`)
    }
  }
  L.push('</resources>', '')
  return L.join('\n')
}
const androidQualifier = (l) => { const [lang, region] = l.split(/[-_]/); return region ? `${lang}-r${region.toUpperCase()}` : lang }

// ---- iOS String Catalog (.xcstrings) ----
function appleFormat(text, order, types) {
  const multi = order.length > 1
  return text.replace(/\{(\w+)\}/g, (all, n) => { const i = order.indexOf(n); if (i < 0) return all; const f = types[n] === 'num' ? 'lld' : '@'; return multi ? `%${i + 1}$${f}` : `%${f}` })
}
function genXcstrings(kind) {
  const strings = {}
  for (const k of keysFor(kind)) {
    const key = outKey(k); const types = ph[k]; const loc = {}
    for (const l of locales) {
      const msg = msgOf(l, k); const pl = wholePlural(msg)
      if (pl) {
        const order = [pl.arg, ...Object.keys(types).filter((n) => n !== pl.arg)]; const plural = {}
        for (const [sel, text] of pl.branches) {
          const q = sel === '=0' ? 'zero' : sel === '=1' ? 'one' : sel.startsWith('=') ? null : sel
          if (!q || plural[q]) continue
          plural[q] = { stringUnit: { state: 'translated', value: appleFormat(text.replace(/#/g, `{${pl.arg}}`), order, { ...types, [pl.arg]: 'num' }) } }
        }
        loc[l] = { variations: { plural } }
      } else loc[l] = { stringUnit: { state: 'translated', value: appleFormat(msg, Object.keys(types), types) } }
    }
    strings[key] = { comment: k, extractionState: 'manual', localizations: loc }
  }
  return JSON.stringify({ sourceLanguage: def, strings, version: '1.0' }, null, 2) + '\n'
}

// ---- vue-i18n (Nuxt): placeholders stay {name}; whole plurals → "zero | one | other"; literal @ $ | escaped ----
function vueMessage(msg, k, l) {
  const esc = (t) => t.replace(/[@$|]/g, (c) => `{'${c}'}`)
  const pl = wholePlural(msg)
  if (!pl) { if (hasComplexIcu(msg)) warnings.push(`${l}: "${k}" uses ICU select/nested plural — vue-i18n gets it as text; split it`); return esc(msg) }
  const get = (...sels) => { for (const s of sels) { const b = pl.branches.find(([x]) => x === s); if (b) return esc(b[1].replace(/#/g, `{${pl.arg}}`)) } return null }
  const zero = get('=0', 'zero'); const one = get('=1', 'one'); const other = get('other')
  return zero != null ? [zero, one ?? other, other].join(' | ') : [one ?? other, other].join(' | ')
}

// ---- hashes for formats that can't carry a stamp (xcstrings) ----
const hashFile = path.join(srcDir, '.generated.json')
const hashes = (() => { try { return JSON.parse(fs.readFileSync(hashFile, 'utf8')) } catch { return {} } })()
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
function writeSidecar(file, content) {
  const rel = posix(path.relative(root, file))
  if (fs.existsSync(file) && !opt.force) {
    const cur = fs.readFileSync(file, 'utf8')
    if (!hashes[rel]) die(`${rel} exists and was not generated by DualCraft — use --force to replace it.`)
    if (sha(cur) !== hashes[rel]) die(`${rel} was edited by hand after generation (Xcode?). Move those edits to .dualcraft/i18n, or rerun with --force.`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content)
  hashes[rel] = sha(content); fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2) + '\n')
  return rel
}

const xmlStamp = (body) => `<!-- dualcraft:hash=${sha(body)} -->\n${body}`
const webDir = (s, dflt) => (opt['out-web'] ? path.resolve(String(opt['out-web'])) : path.join(s.dir, dflt))
for (const s of projectStacks(root, config)) {
  if (s.id === 'flutter') {
    const mob = s.dir
    const l10n = fs.existsSync(path.join(mob, 'l10n.yaml')) ? fs.readFileSync(path.join(mob, 'l10n.yaml'), 'utf8') : ''
    const arbDir = opt['out-mobile'] ? path.resolve(String(opt['out-mobile'])) : path.join(mob, (l10n.match(/arb-dir:\s*(\S+)/) || [])[1] || 'lib/l10n')
    const tmpl = (l10n.match(/template-arb-file:\s*(\S+)/) || [])[1] || `app_${def}.arb`
    const prefix = tmpl.replace(/_[^_]+\.arb$/, '')
    for (const l of locales) {
      const arb = { '@@locale': l.replace('-', '_') }
      for (const k of keysFor('mobile')) {
        const ak = camel(outKey(k)); arb[ak] = msgOf(l, k)
        if (l === def) { const p = ph[k]; arb['@' + ak] = { description: k, ...(Object.keys(p).length ? { placeholders: Object.fromEntries(Object.entries(p).map(([n, t]) => [n, { type: t }])) } : {}) } }
      }
      out.push(writeGuarded(path.join(arbDir, `${prefix}_${l.replace('-', '_')}.arb`), jsonStamp(arb, NOTE(l)), { root, force: !!opt.force }))
    }
    if (!l10n) console.log(`ℹ Flutter: add l10n.yaml (arb-dir: ${posix(path.relative(mob, arbDir))}, template-arb-file: ${prefix}_${def}.arb, output-localization-file: app_localizations.dart) and "generate: true" under flutter: in pubspec.yaml, then run flutter gen-l10n.`)
  } else if (['nextjs', 'react-vite', 'astro', 'react-native'].includes(s.id)) {
    const dflt = s.id === 'nextjs' ? (['messages', 'src/messages', 'locales'].find((d) => fs.existsSync(path.join(s.dir, d))) || 'messages') : s.id === 'astro' ? 'src/i18n' : 'src/locales'
    const d = s.kind === 'web' ? webDir(s, dflt) : path.join(s.dir, dflt)
    for (const l of locales) out.push(writeGuarded(path.join(d, `${l}.json`), jsonStamp(nest(keysFor(s.kind).map((k) => [outKey(k), msgOf(l, k)])), NOTE(l)), { root, force: !!opt.force }))
  } else if (s.id === 'nuxt') {
    const d = webDir(s, 'i18n/locales')
    for (const l of locales) out.push(writeGuarded(path.join(d, `${l}.json`), jsonStamp(nest(keysFor('web').map((k) => [outKey(k), vueMessage(msgOf(l, k), k, l)])), NOTE(l)), { root, force: !!opt.force }))
  } else if (s.id === 'android' || s.id === 'kmp') {
    const res = s.id === 'android' ? path.join(s.dir, 'app', 'src', 'main', 'res') : path.join(s.dir, kotlinModule(s.dir, 'kmp'), 'src', 'commonMain', 'composeResources')
    for (const l of locales) out.push(writeGuarded(path.join(res, l === def ? 'values' : `values-${androidQualifier(l)}`, 'ds_strings.xml'), xmlStamp(genAndroidXml(l, 'mobile')), { root, force: !!opt.force }))
  } else if (s.id === 'ios') {
    out.push(writeSidecar(path.join(iosAppDir(s.dir, config), 'Resources', 'DualCraft.xcstrings'), genXcstrings('mobile')))
  }
}
out.forEach((f) => console.log('→ ' + f))
if (warnings.length) console.log(`⚠ ${warnings.length} warning(s):\n  ${[...new Set(warnings)].slice(0, 8).join('\n  ')}`)
