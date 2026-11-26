#!/usr/bin/env node
// DualCraft feature flags and remote config: one catalog (.dualcraft/flags/flags.json) → a typed FeatureFlags accessor per
// stack (defaults built in, overrides for tests/QA, safe fallback on bad remote values), the Firebase Remote Config
// template or a Supabase flags table, and checks (expired flags to remove, flags no code reads, parked work's flags).
//   init [--provider firebase|supabase|local]   catalog (provider from the backend; flags of parked brain notes imported) + code
//   add <key> --type bool|string|int|double --default <v> [--values a,b] [--kind release|experiment|ops|config]
//       [--expires 1.4.0] [--task T-012] [--platforms web,mobile] [--description "…"]
//   remove <key> · gen [--force] · check [--json]
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, LANG, kotlinPackage, kotlinModule, iosAppDir } from './lib/targets.mjs'
import * as G from './lib/flags-gen.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
if (cmd === 'help' || !['init', 'add', 'remove', 'gen', 'check'].includes(cmd)) {
  console.log(`node flags.mjs init [--provider firebase|supabase|local] | add <key> --type bool|string|int|double --default <v> [--values a,b] [--kind release|experiment|ops|config] [--expires 1.4.0] [--task T-012] [--platforms web,mobile] [--description "…"] | remove <key> | gen [--force] | check [--json]`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'flags', 'flags.json')
const rel = (p) => posix(path.relative(root, p)) || '.'
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config)

const TYPES =['bool', 'string', 'int', 'double']
const KINDS = ['release', 'experiment', 'ops', 'config']
const PROVIDERS = ['firebase', 'supabase', 'local']
const KEY = /^[a-z][a-z0-9_]{1,39}$/
const semver = (v) => String(v).split(/[.-]/).map((x) => Number(x) || 0)
const cmpVer = (a, b) => { const x = semver(a), y = semver(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }

// ---------------------------------------------------------------- catalog
const load = () => readJson(file) || die(`no ${rel(file)} — run: flags.mjs init`)
const save = (c) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n') }
function coerce(type, v) {
  if (type === 'bool') { if (v === true || v === 'true') return true; if (v === false || v === 'false') return false; return null }
  if (type === 'int') { const n = Number(v); return Number.isInteger(n) ? n : null }
  if (type === 'double') { const n = Number(v); return Number.isFinite(n) ? n : null }
  return v == null ? null : String(v)
}
function validate(c) {
  const errors = []; const seen = new Set()
  if (!PROVIDERS.includes(c.provider)) errors.push(`provider must be ${PROVIDERS.join(', ')}`)
  for (const f of c.flags || []) {
    const w = `flag "${f.key}"`
    if (!KEY.test(f.key || '')) errors.push(`${w}: key must be snake_case, start with a letter, 2–40 chars`)
    if (seen.has(f.key)) errors.push(`${w}: declared twice`); seen.add(f.key)
    if (!TYPES.includes(f.type)) { errors.push(`${w}: type must be ${TYPES.join(', ')}`); continue }
    if (coerce(f.type, f.default) === null || coerce(f.type, f.default) !== f.default) errors.push(`${w}: default must be of type ${f.type}`)
    if (f.values) {
      if (f.type !== 'string' || !Array.isArray(f.values) || !f.values.length || f.values.some((x) => typeof x !== 'string')) errors.push(`${w}: values[] only for string flags (a non-empty list of strings)`)
      else if (!f.values.includes(f.default)) errors.push(`${w}: default "${f.default}" is not one of values`)
    }
    if (f.kind && !KINDS.includes(f.kind)) errors.push(`${w}: kind must be ${KINDS.join(', ')}`)
    if (f.expires && !/^\d+\.\d+\.\d+$/.test(f.expires)) errors.push(`${w}: expires must be a version like 1.4.0`)
    for (const p of f.platforms || []) if (!['web', 'mobile'].includes(p)) errors.push(`${w}: platforms must be web and/or mobile`)
  }
  return errors
}
/** Flags named by parked brain notes (status=parked, flag=<name>) — park's feature-flag strategy. */
function parkedFlags() {
  const d = path.join(dir, 'brain'); if (!fs.existsSync(d)) return []
  const out = []
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.md'))) {
    const t = read(path.join(d, f)); const fm = t.match(/^---\n([\s\S]*?)\n---/)?.[1] || ''
    const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (get('status') === 'parked' && get('flag')) out.push({ id: get('id') || f.replace(/\.md$/, ''), flag: get('flag'), target: get('target'), title: get('title') || '' })
  }
  return out
}

// ---------------------------------------------------------------- outputs per stack
function out(stack) {
  const { id, dir: d } = stack
  const custom = config.flags?.out?.[id]; if (custom) return { file: path.join(root, custom), pkg: config.design?.kotlinPackage }
  const src = fs.existsSync(path.join(d, 'src')) ? 'src' : ''
  if (['nextjs', 'react-vite', 'astro', 'react-native'].includes(id)) return { file: path.join(d, id === 'nextjs' ? src : 'src', 'lib', 'feature-flags.ts') }
  if (id === 'nuxt') return { file: path.join(d, fs.existsSync(path.join(d, 'app')) ? 'app' : '', 'utils', 'feature-flags.ts') }
  if (id === 'flutter') return { file: path.join(d, 'lib', 'generated', 'feature_flags.dart') }
  if (id === 'ios') return { file: path.join(iosAppDir(d, config), 'Core', 'Flags', 'FeatureFlags.swift') }
  const pkg = kotlinPackage(d, config, id); const mod = kotlinModule(d, id)
  const base = id === 'kmp' ? path.join(d, mod, 'src', 'commonMain', 'kotlin') : path.join(d, mod, 'src', 'main', 'java')
  return { file: path.join(base, ...pkg.split('.'), 'flags', 'FeatureFlags.kt'), pkg: pkg + '.flags' }
}
function outputs(c) {
  const files = []
  for (const s of stacks) {
    const fl = c.flags.filter((f) => !f.platforms || f.platforms.includes(s.kind))
    const o = out(s); const lang = LANG[s.id]
    const code = lang === 'ts' ? G.tsFlags(fl) : lang === 'dart' ? G.dartFlags(fl) : lang === 'kotlin' ? G.kotlinFlags(fl, o.pkg) : G.swiftFlags(fl)
    files.push({ file: o.file, text: stamp(code), stack: s })
  }
  if (c.provider === 'firebase') files.push({ file: path.join(dir, 'flags', 'remoteconfig.template.json'), text: G.remoteConfigTemplate(c.flags), raw: true })
  if (c.provider === 'supabase') files.push({ file: path.join(dir, 'flags', 'supabase-feature-flags.sql'), text: G.supabaseSql(c.flags), raw: true })
  return files
}
function generate(c, force) {
  const errors = validate(c)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix flags.json first.') }
  const written = []
  for (const f of outputs(c)) {
    if (f.raw) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); written.push(rel(f.file)) }
    else written.push(writeGuarded(f.file, f.text, { root, force }))
  }
  return written
}

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const existed = fs.existsSync(file)
  const c = existed ? load() : { provider: opt.provider ? String(opt.provider) : ['firebase', 'supabase'].includes(config.backend?.provider) ? config.backend.provider : 'local', flags: [] }
  if (opt.provider) c.provider = String(opt.provider)
  for (const p of parkedFlags()) if (!c.flags.some((f) => f.key === p.flag) && KEY.test(p.flag)) c.flags.push({ key: p.flag, type: 'bool', default: false, kind: 'release', description: `Parked: ${p.title}`.trim(), task: p.id, ...(p.target ? { expires: p.target } : {}) })
  save(c)
  console.log(`${existed ? 'updated' : 'created'} ${rel(file)} — provider ${c.provider}, ${c.flags.length} flag(s)${c.flags.length ? ': ' + c.flags.map((f) => f.key).join(', ') : ''}`)
  for (const w of generate(c, !!opt.force)) console.log('→ ' + w)
  if (!stacks.length) console.log('ℹ no stacks in config.json yet — only the catalog was written')
  console.log(`Next: plug the provider in once per app (adapter: see /dualcraft:flags), then read flags.<name> where the feature starts.${c.provider === 'firebase' ? ' Publish the template with: firebase deploy --only remoteconfig (firebase.json → "remoteconfig": {"template": ".dualcraft/flags/remoteconfig.template.json"}).' : c.provider === 'supabase' ? ' Add .dualcraft/flags/supabase-feature-flags.sql as a migration (/dualcraft:database).' : ''}`)
  process.exit(0)
}

if (cmd === 'add' || cmd === 'remove') {
  const c = load(); const key = pos[0] || die(`usage: flags.mjs ${cmd} <key> …`)
  if (cmd === 'remove') {
    if (!c.flags.some((f) => f.key === key)) die(`no flag "${key}"`)
    c.flags = c.flags.filter((f) => f.key !== key)
  } else {
    if (c.flags.some((f) => f.key === key)) die(`flag "${key}" already exists — edit it in ${rel(file)}`)
    const type = String(opt.type || 'bool')
    const values = opt.values ? String(opt.values).split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const def = opt.default !== undefined ? coerce(type, opt.default === true ? 'true' : opt.default) : type === 'bool' ? false : type === 'string' ? values?.[0] ?? '' : 0
    c.flags.push({ key, type, default: def, ...(values ? { values } : {}), kind: String(opt.kind || (type === 'bool' ? 'release' : 'config')), ...(opt.description ? { description: String(opt.description) } : {}), ...(opt.expires ? { expires: String(opt.expires) } : {}), ...(opt.task ? { task: String(opt.task) } : {}), ...(opt.platforms ? { platforms: String(opt.platforms).split(',') } : {}) })
  }
  const errors = validate(c); if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('not saved.') }
  save(c)
  console.log(`${cmd === 'add' ? 'added' : 'removed'} "${key}"${cmd === 'remove' ? ' — now delete the code that reads it on every platform (check lists any left)' : ''}`)
  for (const w of generate(c, !!opt.force)) console.log('→ ' + w)
  process.exit(0)
}

if (cmd === 'gen') { const c = load(); for (const w of generate(c, !!opt.force)) console.log('→ ' + w); process.exit(0) }

// ---------------------------------------------------------------- check
const c = load()
const issues = validate(c).map((m) => ({ level: 'error', m }))
const err = (m) => issues.push({ level: 'error', m }); const warn = (m) => issues.push({ level: 'warn', m })
if (!issues.length) {
  for (const f of outputs(c)) if (read(f.file) !== f.text) err(`${rel(f.file)} out of date — run: flags.mjs gen`)
  for (const f of c.flags) {
    if (['release', 'experiment'].includes(f.kind || 'release') && f.type === 'bool' && !f.expires) warn(`${f.key}: temporary ${f.kind || 'release'} flag without "expires" — set the version it should be removed in`)
    if (f.expires && config.version && cmpVer(config.version, f.expires) >= 0) err(`${f.key}: expired (remove in ${f.expires}, app is ${config.version}) — make the feature permanent and delete the flag (flags.mjs remove ${f.key})`)
    if (!f.description) warn(`${f.key}: no description (what turns on, who decides)`)
  }
  // usage: where each flag is read, per stack (accessor name in code that is not the generated file)
  const gen = new Set(outputs(c).map((f) => path.resolve(f.file)))
  const SKIP = /^(node_modules|build|dist|\.next|\.nuxt|\.output|\.dart_tool|Pods|DerivedData|\.gradle|generated|\.git)$/
  const EXT = /\.(ts|tsx|js|jsx|vue|astro|dart|kt|kts|swift)$/
  const used = new Set()
  const walk = (d, depth = 0) => { if (depth > 12 || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (EXT.test(e.name) && !gen.has(path.resolve(p))) { const t = read(p); for (const f of c.flags) if (t.includes('.' + G.camel(f.key)) || t.includes(`'${f.key}'`) || t.includes(`"${f.key}"`)) used.add(f.key) } } }
  for (const s of stacks) walk(s.dir)
  if (stacks.length) for (const f of c.flags) if (!used.has(f.key)) warn(`${f.key}: not read anywhere in the app code yet`)
  for (const p of parkedFlags()) if (!c.flags.some((f) => f.key === p.flag)) err(`${p.id} is parked behind flag "${p.flag}", which is not in the catalog — run: flags.mjs init (imports it) or flags.mjs add ${p.flag}`)
  if (!stacks.length) warn('no stacks in config.json — no code generated')
}
if (opt.json) { console.log(JSON.stringify({ issues }, null, 2)); process.exit(issues.some((i) => i.level === 'error') ? 1 : 0) }
console.log(`Flags — ${c.flags.length} flag(s) · provider ${c.provider} · ${stacks.map((s) => s.id).join(', ') || 'no stacks'}`)
for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
const n = issues.filter((i) => i.level === 'error').length
console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `flags OK — ${issues.length} warning(s)`)
process.exit(n ? 1 : 0)
