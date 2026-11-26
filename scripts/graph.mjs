#!/usr/bin/env node
// DualCraft code graph: a fast index of every stack (symbols + file dependencies) to answer, without reading the whole
// codebase: where is X, who uses it, what does a change affect, which files matter for a task — across web and mobile,
// tied together by DualCraft's contracts (API functions, analytics events, flags, links, i18n keys) and the brain.
//   init | update            build or refresh .dualcraft/graph/index.json (only changed files are read; not committed)
//   status                   files, symbols and dependencies per stack, how fresh the index is
//   search <term> [--kind class|function|component|…] [--stack id] [--limit 20]
//   callers <symbol> [--precise] [--limit 40]   where it is used (precise: TypeScript compiler of the project)
//   impact <file|symbol> [--depth 3]            files that depend on it, directly and transitively, per stack
//   context "<task>" [--limit 12]               files, symbols, contracts and brain notes that matter for a task
//   contracts [api|events|flags|links|i18n] [name]   where each shared contract is used on web and mobile
// Add --json to any query for machine-readable output.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { projectStacks } from './lib/targets.mjs'
import * as X from './lib/graph-index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const CMDS = ['init', 'update', 'status', 'search', 'callers', 'impact', 'context', 'contracts']
if (cmd === 'help' || !CMDS.includes(cmd)) {
  console.log('node graph.mjs init|update | status | search <term> [--kind k] [--stack s] | callers <symbol> [--precise] | impact <file|symbol> [--depth 3] | context "<task>" | contracts [api|events|flags|links|i18n] [name]   (--json)')
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const stacks = projectStacks(root, config)
const file = path.join(dir, 'graph', 'index.json')
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const out = (data, text) => { if (opt.json) console.log(JSON.stringify(data, null, 2)); else console.log(text) }
const limit = Number(opt.limit) || 0
const camel = (k) => k.split(/[._-]/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('')
const pascal = (k) => { const c = camel(k); return c[0].toUpperCase() + c.slice(1) }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------- index
function refresh() {
  if (!stacks.length) die('no stacks in .dualcraft/config.json — nothing to index')
  const prev = readJson(file)
  const idx = X.buildIndex(root, stacks, prev?.version === 1 ? prev : null)
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(idx))
  const gi = path.join(dir, '.gitignore'); const g = read(gi)
  if (!/^graph\/$/m.test(g)) fs.writeFileSync(gi, g.replace(/\s*$/, g ? '\n' : '') + 'graph/\n')
  return idx
}
/** The index, refreshed when sources changed since it was built (cheap: size + mtime per file). */
function index() {
  const idx = readJson(file)
  if (!idx) return refresh()
  for (const s of stacks) for (const f of X.listFiles(s.dir)) { const rel = posix(path.relative(root, f)); const x = idx.files[rel]; if (!x) return refresh(); const st = fs.statSync(f); if (st.size !== x.size || Math.round(st.mtimeMs) !== x.mtime) return refresh() }
  for (const rel of Object.keys(idx.files)) if (!fs.existsSync(path.join(root, rel))) return refresh()
  return idx
}
const lines = (rel) => read(path.join(root, rel)).split(/\r?\n/)
const defsOf = (idx, name) => Object.entries(idx.files).flatMap(([f, x]) => x.symbols.filter((s) => s.name === name).map((s) => ({ file: f, ...s, stack: x.stack, lang: x.lang })))
const fmtSym = (s) => `${s.name}${s.in ? ` (in ${s.in})` : ''} · ${s.kind} · ${s.file}:${s.line}`

// ---------------------------------------------------------------- init / status / search
if (cmd === 'init' || cmd === 'update') {
  const idx = refresh(); const per = {}
  for (const x of Object.values(idx.files)) { const p = (per[x.stack] ||= { files: 0, symbols: 0, deps: 0 }); p.files++; p.symbols += x.symbols.length; p.deps += (x.deps || []).length }
  out({ files: Object.keys(idx.files).length, read: idx.read, stacks: per }, `${path.relative(root, file).split(path.sep).join('/')} — ${Object.keys(idx.files).length} file(s) (${idx.read} read)\n` + Object.entries(per).map(([s, p]) => `  ${s.padEnd(13)} ${p.files} files · ${p.symbols} symbols · ${p.deps} dependencies`).join('\n'))
  process.exit(0)
}
if (cmd === 'status') {
  const idx = readJson(file)
  if (!idx) { out({ indexed: false }, 'Not indexed yet — run: graph.mjs init'); process.exit(0) }
  let stale = 0; for (const s of stacks) for (const f of X.listFiles(s.dir)) { const x = idx.files[posix(path.relative(root, f))]; const st = fs.statSync(f); if (!x || st.size !== x.size || Math.round(st.mtimeMs) !== x.mtime) stale++ }
  out({ built: idx.built, files: Object.keys(idx.files).length, stale }, `Index of ${idx.built.slice(0, 16).replace('T', ' ')} · ${Object.keys(idx.files).length} files · ${stale ? `${stale} changed since (queries refresh it)` : 'up to date'}`)
  process.exit(0)
}
if (cmd === 'search') {
  const term = (pos[0] || die('usage: graph.mjs search <term>')).toLowerCase(); const idx = index()
  const all = Object.entries(idx.files).flatMap(([f, x]) => x.symbols.map((s) => ({ ...s, file: f, stack: x.stack, generated: !!x.generated })))
  const hits = all.filter((s) => s.name.toLowerCase().includes(term) && (!opt.kind || s.kind === opt.kind) && (!opt.stack || s.stack === opt.stack))
    .map((s) => ({ ...s, score: (s.name.toLowerCase() === term ? 3 : s.name.toLowerCase().startsWith(term) ? 2 : 1) + (s.in ? 0 : 0.5) - (s.generated ? 0.25 : 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit || 30)
  out({ term, results: hits }, hits.length ? hits.map((s) => `  ${fmtSym(s)}${s.generated ? ' · generated' : ''}`).join('\n') : `No symbol matches "${pos[0]}"`)
  process.exit(0)
}

// ---------------------------------------------------------------- callers
/** "Class.member" or "member" → { name, container }. */
const parseName = (q) => { const i = q.lastIndexOf('.'); return i > 0 ? { name: q.slice(i + 1), container: q.slice(0, i) } : { name: q, container: null } }
/** Exact references through each TypeScript stack's own compiler (from its node_modules, nothing downloaded): the
 *  declarations are found by the compiler too, so methods and members work whatever the formatting. null when no
 *  TypeScript stack has the compiler installed. */
function preciseTs(name, container) {
  let any = false; const res = []; const decls = []
  for (const st of stacks.filter((s) => ['nextjs', 'react-vite', 'astro', 'nuxt', 'react-native'].includes(s.id))) {
    let ts; try { ts = createRequire(path.join(st.dir, 'package.json'))('typescript') } catch { continue }
    any = true
    const cfgPath = ts.findConfigFile(st.dir, ts.sys.fileExists, 'tsconfig.json')
    const parsed = cfgPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, path.dirname(cfgPath)) : { fileNames: X.listFiles(st.dir).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f)), options: { allowJs: true, jsx: ts.JsxEmit.Preserve } }
    const host = { getScriptFileNames: () => parsed.fileNames, getScriptVersion: () => '1', getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined), getCurrentDirectory: () => st.dir, getCompilationSettings: () => parsed.options, getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o), fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories }
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
    const items = ls.getNavigateToItems(name, 200, undefined, true).filter((it) => it.name === name && !/node_modules/.test(it.fileName) && (!container || it.containerName === container))
    const seen = new Set()
    for (const it of items) {
      const sf = ls.getProgram().getSourceFile(it.fileName); if (!sf) continue
      decls.push({ name, in: it.containerName || undefined, kind: it.kind, file: posix(path.relative(root, it.fileName)), line: sf.getLineAndCharacterOfPosition(it.textSpan.start).line + 1, stack: st.id })
      for (const r of ls.findReferences(it.fileName, it.textSpan.start) || []) for (const ref of r.references) {
        if (ref.isDefinition || /node_modules/.test(ref.fileName)) continue
        const rsf = ls.getProgram().getSourceFile(ref.fileName); if (!rsf) continue
        const { line } = rsf.getLineAndCharacterOfPosition(ref.textSpan.start); const key = ref.fileName + ':' + line; if (seen.has(key)) continue; seen.add(key)
        res.push({ file: posix(path.relative(root, ref.fileName)), line: line + 1, text: rsf.text.split(/\r?\n/)[line].trim().slice(0, 140), stack: st.id, confidence: 'exact', of: it.containerName ? `${it.containerName}.${name}` : name })
      }
    }
  }
  return any ? { refs: res, decls } : null
}
function textualRefs(idx, name, defs) {
  const re = new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`); const res = []
  const defLines = new Set(defs.map((d) => d.file + ':' + d.line))
  const defFiles = new Set(defs.map((d) => d.file)); const rev = X.dependents(idx)
  const near = new Set(defs.flatMap((d) => rev[d.file] || []))
  for (const [f, x] of Object.entries(idx.files)) {
    lines(f).forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, ''); if (!re.test(code) || defLines.has(f + ':' + (i + 1))) return
      if (/^\s*(import|export\s+\{|export\s+\*|package|part)\b/.test(code)) return
      // a declaration of the name (method, function, fun, func) is not a use of it
      if (new RegExp(`(?:function|fun|func|def)\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?${esc(name)}\\b|(?:^|[{;]|\\b(?:public|private|protected|static|async|override|final)\\s)\\s*${esc(name)}\\s*\\([^)]*\\)\\s*(?::\\s*[^{=]+)?\\{`).test(code)) return
      res.push({ file: f, line: i + 1, text: l.trim().slice(0, 140), stack: x.stack, confidence: defFiles.has(f) || near.has(f) ? 'linked' : 'textual' })
    })
  }
  return res.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'linked' ? -1 : 1))
}
if (cmd === 'callers') {
  const q = pos[0] || die('usage: graph.mjs callers <symbol|Type.member> [--precise]'); const idx = index()
  const { name, container } = parseName(q)
  let defs = defsOf(idx, name).filter((d) => !container || d.in === container)
  let refs; let mode = 'approximate'
  const precise = opt.precise ? preciseTs(name, container) : null
  if (precise) {
    mode = 'exact for TypeScript'
    refs = precise.refs; if (precise.decls.length) defs = [...precise.decls, ...defs.filter((d) => idx.files[d.file]?.lang !== 'ts')]
    // the other languages keep the approximate search
    const tsFiles = new Set(Object.entries(idx.files).filter(([, x]) => x.lang === 'ts').map(([f]) => f))
    for (const r of textualRefs(idx, name, defs)) if (!tsFiles.has(r.file)) refs.push(r)
  } else refs = textualRefs(idx, name, defs)
  const shown = refs.slice(0, limit || 40)
  const text = [defs.length ? `Defined: ${defs.map(fmtSym).join(' · ')}` : `No definition of "${q}" found (external, a member the fast index missed — try --precise for TypeScript — or only used)`,
    `${refs.length} reference(s) — ${mode}${mode !== 'exact for TypeScript' || refs.some((r) => r.confidence !== 'exact') ? ' · "linked" = in a file that depends on the definition, "textual" = same name elsewhere: confirm by opening it' : ''}`,
    ...shown.map((r) => `  ${r.file}:${r.line} [${r.confidence}${r.of && r.of !== name ? ' ' + r.of : ''}] ${r.text}`), refs.length > shown.length ? `  … ${refs.length - shown.length} more (--limit)` : '',
    opt.precise && !precise ? '  (--precise: no TypeScript stack has the typescript package installed — npm install in the web app)' : ''].filter(Boolean).join('\n')
  out({ symbol: q, definitions: defs, mode, references: refs }, text)
  process.exit(0)
}

// ---------------------------------------------------------------- impact
if (cmd === 'impact') {
  const target = pos[0] || die('usage: graph.mjs impact <file|symbol>'); const idx = index()
  const asFile = posix(path.relative(root, path.resolve(target)))
  const starts = idx.files[asFile] ? [asFile] : idx.files[posix(target)] ? [posix(target)] : [...new Set(defsOf(idx, target).map((d) => d.file))]
  if (!starts.length) die(`"${target}" is neither an indexed file nor a symbol — graph.mjs search ${target}`)
  const rev = X.dependents(idx); const depth = Number(opt.depth) || 3
  const seen = new Map(starts.map((f) => [f, 0])); let frontier = [...starts]
  for (let d = 1; d <= depth && frontier.length; d++) { const next = []; for (const f of frontier) for (const g of rev[f] || []) if (!seen.has(g)) { seen.set(g, d); next.push(g) } frontier = next }
  const affected = [...seen].filter(([, d]) => d > 0).map(([f, d]) => ({ file: f, depth: d, stack: idx.files[f].stack }))
  const byStack = {}; for (const a of affected) (byStack[a.stack] ||= []).push(a)
  const approx = starts.some((f) => ['swift', 'kotlin'].includes(idx.files[f].lang))
  out({ target, from: starts, affected }, [`${target} → ${affected.length} dependent file(s) within ${depth} level(s)${approx ? ' (Swift/Kotlin: from type names used, approximate)' : ' (from imports)'}`,
    ...Object.entries(byStack).flatMap(([s, list]) => [`  ${s}:`, ...list.sort((a, b) => a.depth - b.depth).slice(0, limit || 40).map((a) => `    ${'·'.repeat(a.depth)} ${a.file}`)]),
    affected.length ? '' : '  nothing depends on it (an entry point, or used through a contract: graph.mjs contracts)'].join('\n'))
  process.exit(0)
}

// ---------------------------------------------------------------- contracts (DualCraft's shared names)
/** [{ kind, name, patterns: [RegExp], source }] from the DualCraft specs of the project. */
function contracts() {
  const C = []
  const api = readJson(path.join(dir, 'backend', 'api.json'))
  for (const f of api?.functions || []) C.push({ kind: 'api', name: f.name, source: 'backend/api.json', re: [new RegExp(`\\.${esc(f.name)}\\s*\\(`), new RegExp(`['"]${esc(f.name)}['"]`)] })
  const ev = readJson(path.join(dir, 'analytics', 'events.json'))
  for (const e of ev?.events || []) C.push({ kind: 'events', name: e.name, source: 'analytics/events.json', re: [new RegExp(`[Aa]nalyticsEvents\\.${esc(camel(e.name))}\\s*\\(`), new RegExp(`['"]${esc(e.name)}['"]`)] })
  const fl = readJson(path.join(dir, 'flags', 'flags.json'))
  for (const f of fl?.flags || []) C.push({ kind: 'flags', name: f.key, source: 'flags/flags.json', re: [new RegExp(`(?:flags|FeatureFlags)\\.${esc(camel(f.key))}\\b`), new RegExp(`['"]${esc(f.key)}['"]`)] })
  const ln = readJson(path.join(dir, 'links', 'links.json'))
  for (const r of ln?.routes || []) C.push({ kind: 'links', name: r.name, source: 'links/links.json', re: [new RegExp(`links\\.${esc(r.name)}\\s*\\(`), new RegExp(`\\b${esc(pascal(r.name))}Route\\b`), new RegExp(`AppRoute\\.${esc(pascal(r.name))}\\b`), new RegExp(`AppRoute\\.${esc(r.name)}\\b|\\.${esc(r.name)}\\(`)] })
  const i18nDir = path.join(dir, 'i18n'); const loc = config.lang || 'es'
  const flat = (o, p = '', acc = {}) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') flat(v, p + k + '.', acc); else acc[p + k] = String(v) } return acc }
  const texts = flat(readJson(path.join(i18nDir, loc + '.json')))
  for (const [k, v] of Object.entries(texts)) { const outKey = /^(web|mobile)\./.test(k) ? k.slice(k.indexOf('.') + 1) : k; C.push({ kind: 'i18n', name: k, text: v, source: `i18n/${loc}.json`, re: [new RegExp(`['"\`]${esc(outKey)}['"\`]`), new RegExp(`\\.${esc(camel(outKey))}\\b`), new RegExp(`\\b${esc(outKey.replace(/\./g, '_'))}\\b`)] }) }
  return C
}
function usages(idx, c) {
  const res = []
  for (const [f, x] of Object.entries(idx.files)) { if (x.generated) continue; lines(f).forEach((l, i) => { if (c.re.some((r) => r.test(l))) res.push({ file: f, line: i + 1, stack: x.stack, kind: x.kind }) }) }
  return res
}

if (cmd === 'contracts') {
  const idx = index(); const kind = pos[0]; const name = pos[1]
  if (kind && !['api', 'events', 'flags', 'links', 'i18n'].includes(kind)) die('kinds: api, events, flags, links, i18n')
  const list = contracts().filter((c) => (!kind || c.kind === kind) && (!name || c.name === name) && (kind === 'i18n' || c.kind !== 'i18n' || name))
  const rows = list.map((c) => { const u = usages(idx, c); return { ...c, re: undefined, web: u.filter((x) => x.kind === 'web'), mobile: u.filter((x) => x.kind === 'mobile') } })
  const hasWeb = stacks.some((s) => s.kind === 'web'); const hasMobile = stacks.some((s) => s.kind === 'mobile')
  const text = rows.length ? rows.map((r) => {
    const gap = hasWeb && hasMobile && (!r.web.length) !== (!r.mobile.length) ? `   ⚠ only on ${r.web.length ? 'web' : 'mobile'}` : !r.web.length && !r.mobile.length ? '   ⚠ not used' : ''
    return [`${r.kind} ${r.name}${r.text ? ` "${r.text.slice(0, 40)}"` : ''}${gap}`, ...[...r.web, ...r.mobile].slice(0, name ? 50 : 4).map((u) => `    ${u.stack.padEnd(12)} ${u.file}:${u.line}`), !name && r.web.length + r.mobile.length > 4 ? `    … ${r.web.length + r.mobile.length - 4} more (graph.mjs contracts ${r.kind} ${r.name})` : ''].filter(Boolean).join('\n')
  }).join('\n') : 'No DualCraft contracts in this project yet (backend, analytics, flags, links, i18n).'
  out({ contracts: rows }, text + (kind === 'i18n' || name ? '' : '\n(i18n keys: graph.mjs contracts i18n <key>)'))
  process.exit(0)
}

// ---------------------------------------------------------------- context for a task
if (cmd === 'context') {
  const task = pos.join(' ') || die('usage: graph.mjs context "<task in a few words>"'); const idx = index()
  const STOP = new Set('a al algo con de del el en es esto la las lo los mas me mi para pero por que se si sin su sus un una uno y o the a an and or of to in on for with is it this that from by be as at add fix make change quiero hacer anadir añadir arreglar cambiar crear nueva nuevo pantalla screen page'.split(' '))
  const norm = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(es|s)$/, '')
  const terms = [...new Set(X.wordsOf(task).filter((w) => w.length > 2 && !STOP.has(w)).map(norm))]
  if (!terms.length) die('say the task with a few meaningful words (e.g. "favoritos en la ficha del partido")')
  // texts in the user's language lead to code through the i18n keys that hold them
  const C = contracts(); const bridged = new Set()
  for (const c of C) { const hay = norm(X.wordsOf(c.kind === 'i18n' ? c.text + ' ' + c.name : c.name).map(norm).join(' ')); if (terms.some((t) => hay.includes(t))) bridged.add(c) }
  // the code is usually named in English while the task is in the user's language: the i18n keys whose text matches
  // ("Partidos" → matches.title) lend their words ("match") as extra, lower-weight terms
  const GENERIC = new Set('title subtitle label button text error errors message count empty description placeholder hint action cta web mobile shared common screen page dialog confirm cancel ok yes no'.split(' '))
  const fits = (word, t) => word.startsWith(t) || (word.length >= 4 && t.startsWith(word)) // "export" ⇄ "exportar"
  const hits = (text) => { const ws = X.wordsOf(text).map(norm); return terms.some((t) => ws.some((w) => fits(w, t))) }
  const derivedWords = new Set([...bridged].filter((c) => c.kind === 'i18n').flatMap((c) => X.wordsOf(c.name)))
  const scores = new Map(); const why = new Map()
  const bump = (f, n, reason) => { scores.set(f, (scores.get(f) || 0) + n); if (!why.has(f)) why.set(f, new Set()); why.get(f).add(reason) }
  // texts in the code itself (hand-made text maps: 'export_league_title': {'es': 'Exportar liga', 'en': 'Export League'}):
  // the literals that match most of the task lend the words of their own key and English version
  const matchCount = (text) => { const ws = X.wordsOf(text).map(norm); return terms.filter((t) => ws.some((w) => fits(w, t))).length }
  const literalHits = []
  for (const [f, x] of Object.entries(idx.files)) {
    if (x.generated) continue
    const L = lines(f)
    L.forEach((l, i) => {
      for (const m of l.matchAll(/(['"])((?:(?!\1).){3,80})\1/g)) {
        if (!/\s|[áéíóúñ]/i.test(m[2]) && !/^[A-ZÁÉÍÓÚÑ]/.test(m[2])) continue // user-facing text, not identifiers
        const n = matchCount(m[2]); if (!n) continue
        literalHits.push({ f, n, text: m[2] })
        let key = null; for (let j = i; j >= Math.max(0, i - 2) && !key; j--) key = L[j].match(/['"]([A-Za-z][\w.-]{2,60})['"]\s*:\s*\{/)?.[1] || null
        let en = null; for (let j = i; j <= Math.min(L.length - 1, i + 2) && !en; j++) en = L[j].match(/['"]en['"]\s*:\s*['"]([^'"]{2,80})['"]/)?.[1] || null
        literalHits.at(-1).lend = [...(key ? X.wordsOf(key) : []), ...(en ? X.wordsOf(en) : [])]
      }
    })
  }
  const best = Math.max(0, ...literalHits.map((h) => h.n))
  for (const h of literalHits) { bump(h.f, h.n === terms.length ? 3 : 1, `text "${h.text.slice(0, 30)}"`); if (h.n === best) h.lend.forEach((w) => derivedWords.add(w)) }
  // the app's own translation files: Flutter .arb, web message JSON (messages/, locales/, lang/, l10n/, i18n/)
  const transl = []; const walkT = (d, depth) => { if (depth > 6 || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(node_modules|build|\.dart_tool|\.next|dist|\.git)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walkT(p, depth + 1); else if (/\.arb$/.test(e.name) || (/\.json$/.test(e.name) && /[\\/](messages|locales|lang|l10n|i18n)[\\/]/i.test(p))) transl.push(p) } }
  for (const s of stacks) walkT(s.dir, 0)
  const flatT = (o, p = '', acc = {}) => { for (const [k, v] of Object.entries(o || {})) { if (k.startsWith('@')) continue; if (v && typeof v === 'object') flatT(v, p + k + '.', acc); else acc[p + k] = String(v) } return acc }
  for (const t of transl) for (const [k, v] of Object.entries(flatT(readJson(t)))) if (hits(v)) X.wordsOf(k).forEach((w) => derivedWords.add(w))
  // derived words that appear in more than a fifth of the files (game, app, data…) do not tell files apart
  const fileWords = Object.entries(idx.files).filter(([, x]) => !x.generated).map(([f, x]) => new Set([...X.wordsOf(f), ...x.symbols.flatMap((s) => X.wordsOf(s.name))].map(norm)))
  const common = (t) => fileWords.filter((ws) => [...ws].some((w) => fits(w, t))).length > Math.max(8, fileWords.length * 0.2)
  const derived = [...new Set([...derivedWords].filter((w) => !GENERIC.has(w) && !STOP.has(w)).map(norm))].filter((t) => t.length > 2 && !terms.includes(t) && !common(t))
  for (const [f, x] of Object.entries(idx.files)) {
    if (x.generated) continue
    const pw = X.wordsOf(f).map(norm)
    for (const [list, w] of [[terms, 1], [derived, 0.7]]) {
      for (const t of list) if (pw.some((p) => fits(p, t))) bump(f, 3 * w, `path: ${t}`)
      for (const s of x.symbols) { const sw = X.wordsOf(s.name).map(norm); for (const t of list) if (sw.some((p) => fits(p, t))) bump(f, (s.in ? 1 : 2) * w, `${s.name}`) }
    }
  }
  for (const c of bridged) for (const u of usages(idx, c)) bump(u.file, c.kind === 'i18n' ? 2 : 3, `${c.kind} ${c.name}`)
  const ranked = [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit || 12).map(([f, sc]) => ({ file: f, stack: idx.files[f].stack, score: sc, why: [...why.get(f)].slice(0, 4) }))
  const brain = spawnSync(process.execPath, [path.join(HERE, 'brain.mjs'), 'relevant', task, '--limit', '5'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || ''
  const byStack = {}; for (const r of ranked) (byStack[r.stack] ||= []).push(r)
  out({ task, terms, files: ranked, contracts: [...bridged].map((c) => ({ kind: c.kind, name: c.name })), brain }, [
    `Context for "${task}" (terms: ${terms.join(', ')})`,
    ...Object.entries(byStack).flatMap(([s, list]) => [`  ${s}:`, ...list.map((r) => `    ${r.file} — ${r.why.join(', ')}`)]),
    ranked.length ? '' : '  no file matches — try other words, or graph.mjs search <name>',
    bridged.size ? `Contracts: ${[...bridged].slice(0, 8).map((c) => `${c.kind} ${c.name}`).join(' · ')}${bridged.size > 8 ? ' …' : ''}` : '',
    brain ? `Brain:\n${brain.split('\n').map((l) => '  ' + l).join('\n')}` : '',
    'Heuristic ranking: open the top files to confirm; graph.mjs impact <file> before changing a shared one.'].filter(Boolean).join('\n'))
  process.exit(0)
}
