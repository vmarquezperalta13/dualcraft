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
const STATUSES = ['todo', 'doing', 'done', 'parked', 'dropped', 'superseded']
const MODES = ['bugfix', 'feature', 'refactor']
const AREAS = ['architecture', 'data', 'design', 'security', 'product', 'process', 'web', 'mobile', 'backend', 'infra', 'marketing', 'legal']
const FIELD_ORDER = ['id', 'type', 'title', 'status', 'area', 'superseded_by', 'priority', 'target', 'assignee', 'estimate', 'issue', 'depends_on', 'related', 'branch', 'flag', 'spec', 'plan', 'tags', 'created', 'updated']
// estimates: "3h", "2d" (8h), "1w" (40h), "30m" or story points "5pt"
export function estimateHours(e) {
  const m = String(e || '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|min|h|d|w|pt|pts|sp)?$/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.')); const u = (m[2] || 'h').toLowerCase()
  return u.startsWith('p') || u === 'sp' ? { points: n } : { hours: n * ({ m: 1 / 60, min: 1 / 60, h: 1, d: 8, w: 40 }[u]) }
}
const fmtHours = (h) => (h >= 8 ? `${+(h / 8).toFixed(1)}d` : `${+h.toFixed(1)}h`)
const isActiveDecision = (n) => n.type === 'decision' && n.status === 'done'

// ---------- helpers ----------
// DUALCRAFT_TODAY=YYYY-MM-DD fixes the date (reproducible output: generated eval scaffolds, tests)
const today = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.DUALCRAFT_TODAY || '') ? process.env.DUALCRAFT_TODAY : new Date().toISOString().slice(0, 10))
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
const line = (n) => `${n.id} [${n.type}/${n.status}${n.target ? ' → ' + n.target : ''}] ${n.title}${n.assignee ? ' @' + n.assignee : ''}${n.estimate ? ' ~' + n.estimate : ''}${n.issue ? ' ' + n.issue : ''}${n.depends_on.length ? '  (depends on ' + n.depends_on.join(', ') + ')' : ''}`

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
    if (n.status === 'superseded' && n.type !== 'decision') errors.push(`${n.id}: only decisions can be superseded (use dropped)`)
    if (n.type === 'decision' && ['todo', 'doing', 'parked'].includes(n.status)) errors.push(`${n.id}: a decision is in force (done), superseded or dropped — not ${n.status}`)
    if (n.area && !AREAS.includes(n.area)) errors.push(`${n.id}: unknown area "${n.area}" (${AREAS.join(', ')})`)
  }
  for (const n of notes) for (const d of n.depends_on) if (!ids.has(d)) errors.push(`${n.id}: depends on missing ${d}`)
  for (const n of notes.filter((x) => x.status === 'superseded')) {
    const by = ids.get(n.superseded_by)
    if (!n.superseded_by) errors.push(`${n.id}: superseded without superseded_by`)
    else if (!by) errors.push(`${n.id}: superseded_by missing ${n.superseded_by}`)
    else if (by.type !== 'decision' || by.status !== 'done') errors.push(`${n.id}: superseded_by ${by.id} is not a decision in force`)
  }
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
    if (opt.area && !AREAS.includes(opt.area)) die(`area must be one of: ${AREAS.join(', ')}`)
    if (type === 'decision' && !opt.area) console.error(`dualcraft: tip — give decisions an --area (${AREAS.join(', ')}) so they're grouped and found`)
    const data = {
      id, type, title, status,
      area: opt.area || '',
      priority: opt.priority || (type === 'task' || type === 'bug' ? 'medium' : ''),
      target: opt.target || '',
      depends_on: list(opt.depends),
      related: list(opt.related),
      tags: list(opt.tags),
      created: today(), updated: today(),
    }
    const template = type === 'decision'
      ? '\n## Context\n\n## Decision\n\n## Alternatives considered\n\n## Consequences\n\n## Log\n- ' + today() + ': created\n'
      : '\n## Context\n\n## Details\n\n## Log\n- ' + today() + ': created\n'
    const body = opt.body ? String(opt.body).replace(/\\n/g, '\n') + '\n' : template
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
    if (opt.assignee) notes = notes.filter((n) => (opt.assignee === 'none' ? !n.assignee : n.assignee === opt.assignee))
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
      let h = 0; let pts = 0; let left = 0; let unest = 0
      for (const n of g) { const e = estimateHours(n.estimate); if (!e) { if (n.status !== 'done') unest++; continue } if (e.points) pts += e.points; else { h += e.hours; if (n.status !== 'done') left += e.hours } }
      const est = h || pts ? `  · est. ${h ? fmtHours(h) + (left !== h ? ` (${fmtHours(left)} left)` : '') : ''}${h && pts ? ' + ' : ''}${pts ? pts + ' pt' : ''}${unest ? ` · ${unest} unestimated` : ''}` : ''
      const who = {}; for (const n of g) if (n.assignee && n.status !== 'done') who[n.assignee] = (who[n.assignee] || 0) + 1
      console.log(`\n## ${k}  (${done}/${g.length} done)${est}${Object.keys(who).length ? '  · ' + Object.entries(who).map(([a, c]) => `@${a} ${c}`).join(' ') : ''}`)
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
      if (n.superseded_by && !n.related.includes(n.superseded_by)) edges.push({ from: n.id, to: n.superseded_by, kind: 'related' })
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

  decisions(pos, opt) {
    const { brain } = ctx()
    const all = loadNotes(brain).filter((n) => n.type === 'decision')
    let list = opt.all ? all : all.filter(isActiveDecision)
    if (opt.area) list = list.filter((n) => (n.area || 'general') === opt.area)
    if (!list.length) return console.log(opt.area ? `(no decisions in area ${opt.area})` : '(no decisions in force)')
    const groups = {}
    for (const n of list) (groups[n.area || 'general'] ||= []).push(n)
    for (const [area, arr] of Object.entries(groups).sort()) {
      console.log(`## ${area} (${arr.length})`)
      for (const n of arr) console.log(`- ${n.id} ${n.title}${n.status === 'superseded' ? `  [superseded by ${n.superseded_by}]` : n.status === 'dropped' ? '  [dropped]' : ''}`)
    }
  },

  supersede(pos, opt) {
    const { brain } = ctx()
    const [oldId, newId] = pos
    const notes = loadNotes(brain)
    const o = notes.find((n) => n.id === oldId) || die(`note ${oldId} not found`)
    const nw = notes.find((n) => n.id === newId) || die(`note ${newId} not found — create the new decision first`)
    if (o.type !== 'decision' || nw.type !== 'decision') die('both notes must be decisions')
    if (!isActiveDecision(nw)) die(`${newId} is not in force`)
    const upd = (note, fn, log) => {
      const { data, body } = parseNote(fs.readFileSync(note.file, 'utf8'))
      fn(data); data.updated = today()
      const b = /## Log/.test(body) ? body.replace(/\s*$/, '') + `\n- ${today()}: ${log}\n` : body.replace(/\s*$/, '') + `\n\n## Log\n- ${today()}: ${log}\n`
      fs.writeFileSync(note.file, serialize(data, b))
    }
    upd(o, (d) => { d.status = 'superseded'; d.superseded_by = newId }, `superseded by ${newId}${opt.why ? ' — ' + opt.why : ''}`)
    upd(nw, (d) => { const r = [].concat(d.related || []); if (!r.includes(oldId)) r.push(oldId); d.related = r; if (!d.area && o.area) d.area = o.area }, `supersedes ${oldId}`)
    console.log(`${oldId} superseded by ${newId}`)
  },

  relevant(pos, opt) {
    // Decisions (and notes) related to a text. --hook: read the UserPromptSubmit JSON from stdin, print context or nothing.
    let text = pos.join(' ')
    if (opt.hook) {
      if (!findRoot()) return
      try { const j = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); text = String(j.prompt || j.user_prompt || '') } catch { return }
    }
    const { brain } = ctx()
    const STOP = new Set('the and for with that this from into have what when where which would could should about there their them they then than your yours para por con que los las del una uno unos unas como pero mas más este esta esto estos estas ese esa eso esos esas aqui aquí hay ser son esta está están estar tiene tienen hacer haz hazlo quiero quieres puedes puede poder todo toda todos todas cada cosa cosas algo nada muy bien mal sobre entre hasta desde donde cuando porque cual cuál qué cómo tambien también solo sólo ahora luego antes despues después nuevo nueva nuevos nuevas añade añadir cambia cambiar mira revisa vamos sigue seguimos'.split(' '))
    const tok = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))
    const q = [...new Set(tok(text))]
    if (!q.length) return opt.hook ? undefined : console.log('(nothing to match)')
    const match = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5))
    const score = (words, w) => q.reduce((s, x) => s + (words.some((y) => match(x, y)) ? w : 0), 0)
    const notes = loadNotes(brain).filter((n) => isActiveDecision(n) || (n.type === 'note' && n.status === 'done'))
    const ranked = notes.map((n) => {
      const s = score(tok(n.title), 3) + score(tok([...(n.tags || []), n.area || ''].join(' ')), 2) + score(tok(n.body), 1)
      return { n, s: n.type === 'note' ? s * 0.7 : s }
    }).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, Number(opt.limit) || 5)
    if (!ranked.length) return opt.hook ? undefined : console.log('(no related decisions or notes)')
    const excerpt = (n) => {
      const sec = n.body.match(/## (?:Decision|Decisión)\s*\n([\s\S]*?)(?:\n## |$)/)
      return (sec ? sec[1] : n.body.replace(/^## .*$/gm, '')).replace(/\s+/g, ' ').trim().slice(0, 220)
    }
    const out = []
    out.push(opt.hook ? '## DualCraft — decisions and notes related to this request' : '## Related decisions and notes')
    if (opt.hook) out.push('Respect the decisions. If the request contradicts one, say so to the user before acting and offer to supersede it (dualcraft:decisions).')
    for (const { n } of ranked) out.push(`- ${n.id} ${n.type === 'decision' ? `[decision${n.area ? '/' + n.area : ''}]` : '[note]'} ${n.title}${excerpt(n) ? ' — ' + excerpt(n) : ''}`)
    console.log(out.join('\n'))
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
    const decisions = notes.filter(isActiveDecision)
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
    if (decisions.length) {
      out.push(`\n## Decisions in force (${decisions.length}) — respect them; if a request contradicts one, say so before acting`)
      const groups = {}
      for (const n of decisions) (groups[n.area || 'general'] ||= []).push(n)
      let shown = 0
      for (const [area, arr] of Object.entries(groups).sort()) {
        if (shown >= 40) break
        const items = arr.slice(0, 40 - shown); shown += items.length
        out.push(`- ${area}: ${items.map((n) => `${n.id} ${n.title}`).join(' · ')}`)
      }
      if (decisions.length > shown) out.push(`- … ${decisions.length - shown} more: run "decisions"`)
      out.push('Full text: "show <ID>"; decisions related to each request are added automatically.')
    }
    sec('Ideas', ideas, 5)
    if (errors.length) out.push(`\n⚠ Brain has ${errors.length} problem(s): ${errors.slice(0, 3).join(' | ')} — run "check".`)
    out.push('\nUse the DualCraft skills (dualcraft:*) for this project. Capture out-of-scope tasks, ideas and decisions in the brain instead of doing or forgetting them.')
    console.log(out.join('\n'))
  },

  help() {
    console.log(`DualCraft brain CLI
  init --name N --version V [--web nextjs] [--mobile flutter] [--lang es] [--commit-lang en]
  new <task|bug|decision|note|idea> <title> [--area architecture|data|design|security|product|…] [--target 1.3.0] [--depends T-001,D-002] [--related I-004] [--priority high|medium|low] [--tags a,b] [--status s] [--body "text"]
  set <ID> key=value ... [--log "message"]      e.g. set T-004 status=done
  list [--type t] [--status s] [--target v] [--tag x] [--assignee login|none] [--open]
  (fields for set: assignee=<github login> estimate=<3h|2d|1w|5pt> issue=#12)
  show <ID>
  roadmap                                        tasks/bugs/ideas grouped by target version
  graph                                          JSON nodes + edges (for the visual map)
  check                                          validate ids, statuses, dependencies, cycles
  mode [bugfix|feature|refactor|clear] [--task T-001,T-002] [--scope web|mobile|both]
  config [get key] | set key=value ... | unset key   e.g. config set design.system=https://claude.ai/artifact/…
  decisions [--area a] [--all]                   decisions in force grouped by area (--all: also superseded/dropped)
  supersede <OLD> <NEW> [--why "…"]              mark OLD decision as replaced by NEW (history kept)
  relevant "<text>" [--limit 5]                  decisions/notes related to a text (--hook: UserPromptSubmit)
  summary                                        project context for the session`)
  },
}

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const fn = commands[cmd]
if (!fn) die(`unknown command "${cmd}". Try: help`)
fn(pos, opt)
