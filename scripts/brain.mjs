#!/usr/bin/env node
// DualCraft brain CLI — zero dependencies, Node 18+.
// Project data lives in <project>/.dualcraft/ :
//   config.json          project settings (name, version, stacks, languages)
//   brain/<ID>-slug.md   one note per file, YAML-ish frontmatter + markdown body
//   state.json           current work mode (local only, gitignored)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const TYPES = { task: 'T', bug: 'B', decision: 'D', note: 'N', idea: 'I' }
const PREFIX_TO_TYPE = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]))
const STATUSES = ['todo', 'doing', 'done', 'parked', 'dropped']
const MODES = ['bugfix', 'feature', 'refactor']
const FIELD_ORDER = ['id', 'type', 'title', 'status', 'priority', 'target', 'depends_on', 'related', 'branch', 'flag', 'spec', 'plan', 'tags', 'created', 'updated']

// ---------- helpers ----------
const today = () => new Date().toISOString().slice(0, 10)
const die = (msg, code = 1) => { console.error(`dualcraft: ${msg}`); process.exit(code) }
const unq = (s) => s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'note'

function findRoot(start = process.cwd()) {
  let d = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(d, '.dualcraft', 'config.json'))) return d
    const p = path.dirname(d)
    if (p === d) return null
    d = p
  }
}

function parseArgs(argv) {
  const pos = []; const opt = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s)
      if (v !== undefined) opt[k] = v
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]
      else opt[k] = true
    } else pos.push(a)
  }
  return { pos, opt }
}
const list = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean))

export function parseNote(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const k = kv[1]; const v = kv[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) data[k] = v.slice(1, -1).split(',').map((s) => unq(s.trim())).filter(Boolean)
    else data[k] = unq(v)
  }
  return { data, body: m[2] }
}

function serialize(data, body) {
  const keys = [...FIELD_ORDER.filter((k) => k in data), ...Object.keys(data).filter((k) => !FIELD_ORDER.includes(k))]
  const fmt = (v) => {
    if (Array.isArray(v)) return `[${v.join(', ')}]`
    const s = String(v ?? '')
    return /[:#\[\]{}"]|^\s|\s$/.test(s) ? JSON.stringify(s) : s
  }
  const lines = keys.filter((k) => data[k] !== '' && data[k] !== undefined && !(Array.isArray(data[k]) && !data[k].length && !['depends_on'].includes(k)))
    .map((k) => `${k}: ${fmt(data[k])}`)
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? body : '\n' + body}`
}

function ctx() {
  const root = findRoot()
  if (!root) die('no DualCraft project here (no .dualcraft/config.json). Run /dualcraft:start to set it up.')
  const dir = path.join(root, '.dualcraft')
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
  return { root, dir, brain: path.join(dir, 'brain'), config }
}

function loadNotes(brainDir) {
  if (!fs.existsSync(brainDir)) return []
  return fs.readdirSync(brainDir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const file = path.join(brainDir, f)
    const { data, body } = parseNote(fs.readFileSync(file, 'utf8'))
    data.depends_on = [].concat(data.depends_on || [])
    data.related = [].concat(data.related || [])
    data.tags = [].concat(data.tags || [])
    return { ...data, file, body }
  })
}

function readState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) } catch { return {} }
}

const cmpVer = (a, b) => {
  const pa = String(a || '').split(/[.+-]/).map(Number); const pb = String(b || '').split(/[.+-]/).map(Number)
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d }
  return 0
}
const line = (n) => `${n.id} [${n.type}/${n.status}${n.target ? ' → ' + n.target : ''}] ${n.title}${n.depends_on.length ? '  (depends on ' + n.depends_on.join(', ') + ')' : ''}`

// ---------- validation ----------
function check(notes) {
  const errors = []; const ids = new Map()
  for (const n of notes) {
    if (!n.id) { errors.push(`${path.basename(n.file)}: missing id`); continue }
    if (ids.has(n.id)) errors.push(`${n.id}: duplicated id`)
    ids.set(n.id, n)
    if (!(n.type in TYPES)) errors.push(`${n.id}: unknown type "${n.type}"`)
    if (!STATUSES.includes(n.status)) errors.push(`${n.id}: unknown status "${n.status}"`)
    if (n.status === 'parked' && !n.target) errors.push(`${n.id}: parked without target version`)
  }
  for (const n of notes) for (const d of n.depends_on) if (!ids.has(d)) errors.push(`${n.id}: depends on missing ${d}`)
  // cycle detection
  const seen = new Set(); const stack = new Set()
  const visit = (id, trail) => {
    if (stack.has(id)) { errors.push(`dependency cycle: ${[...trail, id].join(' → ')}`); return }
    if (seen.has(id) || !ids.has(id)) return
    seen.add(id); stack.add(id)
    for (const d of ids.get(id).depends_on) visit(d, [...trail, id])
    stack.delete(id)
  }
  for (const id of ids.keys()) visit(id, [])
  return errors
}

// ---------- commands ----------
const commands = {
  init(pos, opt) {
    const root = process.cwd()
    const dir = path.join(root, '.dualcraft')
    if (fs.existsSync(path.join(dir, 'config.json'))) die('already initialised here.')
    fs.mkdirSync(path.join(dir, 'brain'), { recursive: true })
    const config = {
      name: opt.name || path.basename(root),
      version: opt.version || '0.1.0',
      stacks: { web: opt.web || null, mobile: opt.mobile || null },
      paths: { web: opt['web-path'] || null, mobile: opt['mobile-path'] || null },
      lang: opt.lang || 'es',
      commitLang: opt['commit-lang'] || 'en',
      createdAt: today(),
    }
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
    fs.writeFileSync(path.join(dir, '.gitignore'), 'state.json\nout/\n')
    console.log(`DualCraft initialised in ${dir.replace(/\\/g, '/')}`)
    console.log(JSON.stringify(config, null, 2))
  },

  new(pos, opt) {
    const { brain, config } = ctx()
    const [type, ...words] = pos
    if (!(type in TYPES)) die(`type must be one of: ${Object.keys(TYPES).join(', ')}`)
    const title = words.join(' ').trim() || die('a title is required')
    const notes = loadNotes(brain)
    const prefix = TYPES[type]
    const max = notes.filter((n) => n.id?.startsWith(prefix + '-')).map((n) => parseInt(n.id.slice(2), 10)).reduce((a, b) => Math.max(a, b), 0)
    const id = `${prefix}-${String(max + 1).padStart(3, '0')}`
    const status = opt.status || (type === 'decision' || type === 'note' ? 'done' : 'todo')
    if (!STATUSES.includes(status)) die(`status must be one of: ${STATUSES.join(', ')}`)
    const data = {
      id, type, title, status,
      priority: opt.priority || (type === 'task' || type === 'bug' ? 'medium' : ''),
      target: opt.target || '',
      depends_on: list(opt.depends),
      related: list(opt.related),
      tags: list(opt.tags),
      created: today(), updated: today(),
    }
    const body = opt.body ? String(opt.body).replace(/\\n/g, '\n') + '\n' : '\n## Context\n\n## Details\n\n## Log\n- ' + today() + ': created\n'
    fs.mkdirSync(brain, { recursive: true })
    const file = path.join(brain, `${id}-${slugify(title)}.md`)
    fs.writeFileSync(file, serialize(data, body))
    console.log(`${id} created → ${path.relative(process.cwd(), file).replace(/\\/g, '/')}`)
    void config
  },

  set(pos, opt) {
    const { brain } = ctx()
    const [id, ...pairs] = pos
    const note = loadNotes(brain).find((n) => n.id === id) || die(`note ${id} not found`)
    const { data, body } = parseNote(fs.readFileSync(note.file, 'utf8'))
    const changes = []
    for (const p of pairs) {
      const [k, v] = p.split(/=(.*)/s)
      if (v === undefined) die(`expected key=value, got "${p}"`)
      if (k === 'status' && !STATUSES.includes(v)) die(`status must be one of: ${STATUSES.join(', ')}`)
      if (k === 'id' || k === 'type') die(`${k} cannot be changed`)
      data[k] = ['depends_on', 'related', 'tags'].includes(k) ? list(v) : v
      changes.push(`${k}=${v}`)
    }
    if (opt.log) changes.push(String(opt.log))
    data.updated = today()
    const newBody = /## Log/.test(body)
      ? body.replace(/\s*$/, '') + `\n- ${today()}: ${changes.join('; ')}\n`
      : body.replace(/\s*$/, '') + `\n\n## Log\n- ${today()}: ${changes.join('; ')}\n`
    fs.writeFileSync(note.file, serialize(data, newBody))
    console.log(`${id} updated: ${changes.join('; ')}`)
  },

  list(pos, opt) {
    const { brain } = ctx()
    let notes = loadNotes(brain)
    if (opt.type) notes = notes.filter((n) => list(opt.type).includes(n.type))
    if (opt.status) notes = notes.filter((n) => list(opt.status).includes(n.status))
    if (opt.target) notes = notes.filter((n) => n.target === opt.target)
    if (opt.tag) notes = notes.filter((n) => n.tags.includes(opt.tag))
    if (opt.open) notes = notes.filter((n) => !['done', 'dropped'].includes(n.status))
    if (!notes.length) return console.log('(no notes match)')
    for (const n of notes) console.log(line(n))
  },

  show(pos) {
    const { brain } = ctx()
    const n = loadNotes(brain).find((x) => x.id === pos[0]) || die(`note ${pos[0]} not found`)
    console.log(fs.readFileSync(n.file, 'utf8'))
  },

  roadmap() {
    const { brain, config } = ctx()
    const notes = loadNotes(brain).filter((n) => ['task', 'bug', 'idea'].includes(n.type) && n.status !== 'dropped')
    const groups = {}
    for (const n of notes) (groups[n.target || 'unscheduled'] ||= []).push(n)
    const keys = Object.keys(groups).sort((a, b) => (a === 'unscheduled') - (b === 'unscheduled') || cmpVer(a, b))
    console.log(`Roadmap — ${config.name} (current ${config.version})`)
    for (const k of keys) {
      const g = groups[k]; const done = g.filter((n) => n.status === 'done').length
      console.log(`\n## ${k}  (${done}/${g.length} done)`)
      for (const n of g) console.log('  ' + line(n))
    }
  },

  graph() {
    const { brain, config } = ctx()
    const notes = loadNotes(brain)
    const nodes = notes.map(({ file, body, ...n }) => ({ ...n, file: path.basename(file), body: body.trim().slice(0, 6000) }))
    const edges = []
    for (const n of notes) {
      for (const d of n.depends_on) edges.push({ from: n.id, to: d, kind: 'depends_on' })
      for (const r of n.related) edges.push({ from: n.id, to: r, kind: 'related' })
    }
    console.log(JSON.stringify({ project: config.name, version: config.version, generated: new Date().toISOString(), nodes, edges }, null, 2))
  },

  check() {
    const { brain } = ctx()
    const errors = check(loadNotes(brain))
    if (!errors.length) return console.log('brain OK')
    for (const e of errors) console.log('✗ ' + e)
    process.exit(1)
  },

  mode(pos, opt) {
    const { dir } = ctx()
    const file = path.join(dir, 'state.json')
    if (!pos[0]) { const s = readState(dir); return console.log(s.mode ? JSON.stringify(s, null, 2) : 'no mode chosen') }
    if (pos[0] === 'clear') { fs.rmSync(file, { force: true }); return console.log('mode cleared') }
    if (!MODES.includes(pos[0])) die(`mode must be one of: ${MODES.join(', ')}`)
    const s = { mode: pos[0], tasks: list(opt.task), scope: opt.scope || null, since: new Date().toISOString() }
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
    console.log(`mode: ${s.mode}${s.tasks.length ? ' · tasks ' + s.tasks.join(', ') : ''}`)
  },

  config(pos) {
    const { dir, config } = ctx()
    const [action, ...pairs] = pos
    const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    if (!action || action === 'get') {
      const v = pairs[0] ? get(config, pairs[0]) : config
      return console.log(v === undefined ? '(not set)' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
    }
    if (action !== 'set' && action !== 'unset') die('usage: config [get key] | set key=value ... | unset key')
    for (const p of pairs) {
      const [key, raw] = action === 'set' ? p.split(/=(.*)/s) : [p, undefined]
      if (action === 'set' && raw === undefined) die(`expected key=value, got "${p}"`)
      if (['name', 'createdAt'].includes(key)) die(`${key} cannot be changed here`)
      const ks = key.split('.'); let o = config
      for (const k of ks.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {})
      if (action === 'unset') delete o[ks.at(-1)]
      else o[ks.at(-1)] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : raw
      console.log(action === 'set' ? `${key} = ${raw}` : `${key} removed`)
    }
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  },

  summary(pos, opt) {
    const root = findRoot()
    if (!root) {
      if (opt.hook) return // silent outside DualCraft projects
      die('no DualCraft project here.')
    }
    const { dir, brain, config } = ctx()
    const notes = loadNotes(brain)
    const st = readState(dir)
    const open = (n) => !['done', 'dropped', 'parked'].includes(n.status)
    const doing = notes.filter((n) => n.status === 'doing')
    const bugs = notes.filter((n) => n.type === 'bug' && open(n) && n.status !== 'doing')
    const next = notes.filter((n) => n.type === 'task' && n.status === 'todo')
      .sort((a, b) => cmpVer(a.target || '999', b.target || '999') || ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1))
    const parked = notes.filter((n) => n.status === 'parked').sort((a, b) => cmpVer(a.target, b.target))
    const decisions = notes.filter((n) => n.type === 'decision' && n.status !== 'dropped').sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    const ideas = notes.filter((n) => n.type === 'idea' && open(n))
    const errors = check(notes)
    const stacks = Object.entries(config.stacks || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')

    const out = []
    out.push(`# DualCraft — project context (${config.name})`)
    out.push(`Version ${config.version}${stacks ? ' · ' + stacks : ''} · talk to the user in "${config.lang}", commit messages in "${config.commitLang}".`)
    out.push(`Brain CLI: node "${SELF}" <command>   (brain notes: .dualcraft/brain/)`)
    if (config.design?.system) out.push(`Design System (source of truth for colors, type, spacing): ${config.design.system}${config.design.screens ? ' · screens canvas: ' + config.design.screens : ''}`)
    out.push(st.mode ? `Current work mode: ${st.mode}${st.tasks?.length ? ' on ' + st.tasks.join(', ') : ''} (since ${String(st.since).slice(0, 10)}).`
      : 'Work mode: NOT CHOSEN — before starting any work, use the dualcraft:start skill to ask the user the work mode.')
    const sec = (title, arr, max = 8) => { if (arr.length) { out.push(`\n## ${title} (${arr.length})`); arr.slice(0, max).forEach((n) => out.push('- ' + line(n))); if (arr.length > max) out.push(`- … ${arr.length - max} more`) } }
    sec('In progress', doing)
    sec('Open bugs', bugs)
    sec('Next tasks', next)
    sec('Parked (done, waiting for a later version)', parked)
    sec('Recent decisions — respect them', decisions, 6)
    sec('Ideas', ideas, 5)
    if (errors.length) out.push(`\n⚠ Brain has ${errors.length} problem(s): ${errors.slice(0, 3).join(' | ')} — run "check".`)
    out.push('\nUse the DualCraft skills (dualcraft:*) for this project. Capture out-of-scope tasks, ideas and decisions in the brain instead of doing or forgetting them.')
    console.log(out.join('\n'))
  },

  help() {
    console.log(`DualCraft brain CLI
  init --name N --version V [--web nextjs] [--mobile flutter] [--lang es] [--commit-lang en]
  new <task|bug|decision|note|idea> <title> [--target 1.3.0] [--depends T-001,D-002] [--related I-004] [--priority high|medium|low] [--tags a,b] [--status s] [--body "text"]
  set <ID> key=value ... [--log "message"]      e.g. set T-004 status=done
  list [--type t] [--status s] [--target v] [--tag x] [--open]
  show <ID>
  roadmap                                        tasks/bugs/ideas grouped by target version
  graph                                          JSON nodes + edges (for the visual map)
  check                                          validate ids, statuses, dependencies, cycles
  mode [bugfix|feature|refactor|clear] [--task T-001,T-002] [--scope web|mobile|both]
  config [get key] | set key=value ... | unset key   e.g. config set design.system=https://claude.ai/artifact/…
  summary                                        project context for the session`)
  },
}

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const fn = commands[cmd]
if (!fn) die(`unknown command "${cmd}". Try: help`)
fn(pos, opt)
