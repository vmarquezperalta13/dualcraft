#!/usr/bin/env node
// DualCraft functional document helper.
//   init     create docs/FUNCTIONAL.md from the template (in the project's language)
//   status   traceability: done tasks/bugs not referenced in the document, sections, ids
//   path     print the document path
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help') { console.log('node docs.mjs init | status | path   (doc location: config.docs.functional or docs/FUNCTIONAL.md)'); process.exit(0) }

const { root, config } = project()
const rel = config.docs?.functional || 'docs/FUNCTIONAL.md'
const file = path.join(root, rel)

if (cmd === 'path') { console.log(posix(rel)); process.exit(0) }

if (cmd === 'init') {
  if (fs.existsSync(file) && !opt.force) die(`${posix(rel)} already exists.`)
  const lang = config.lang === 'en' ? 'en' : 'es'
  const tpl = fs.readFileSync(path.join(HERE, 'templates', `functional.${lang}.md`), 'utf8')
  const stacks = Object.entries(config.stacks || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, tpl.replace(/\{\{name\}\}/g, config.name).replace(/\{\{version\}\}/g, config.version).replace(/\{\{stacks\}\}/g, stacks).replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10)))
  console.log(`created ${posix(rel)}`)
  process.exit(0)
}

if (cmd === 'status') {
  if (!fs.existsSync(file)) die(`${posix(rel)} does not exist yet — run: docs.mjs init`)
  const doc = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const graph = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'brain.mjs'), 'graph'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const referenced = new Set(doc.match(/\b[TBDNI]-\d{3,}\b/g) || [])
  const relevant = graph.nodes.filter((n) => (n.type === 'task' || n.type === 'bug') && n.status === 'done' && !(n.tags || []).includes('internal'))
  const missing = relevant.filter((n) => !referenced.has(n.id))
  const unknown = [...referenced].filter((id) => !graph.nodes.some((n) => n.id === id))
  const sections = (doc.match(/^#{2,3} .+$/gm) || []).map((s) => s.trim())
  const todos = (doc.match(/TODO|\{\{|_Pendiente_|_TBD_/g) || []).length
  console.log(`Functional document: ${posix(rel)}  (${doc.split('\n').length} lines, ${sections.length} sections)`)
  console.log(`Done tasks/bugs: ${relevant.length} · documented (referenced by id): ${relevant.length - missing.length}`)
  if (missing.length) { console.log('\nNot yet reflected in the document:'); for (const n of missing) console.log(`- ${n.id} [${n.type}] ${n.title}${n.target ? ' (' + n.target + ')' : ''}${(n.tags || []).length ? '  tags: ' + n.tags.join(',') : ''}`) }
  if (unknown.length) console.log(`\nIds in the document that are not in the brain: ${unknown.join(', ')}`)
  if (todos) console.log(`\nPlaceholders left in the document: ${todos}`)
  console.log('\n(Tasks with no functional impact can be tagged "internal" to skip them.)')
  process.exit(0)
}
die(`unknown command "${cmd}". Try: help`)
