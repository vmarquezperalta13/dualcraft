#!/usr/bin/env node
// DualCraft visual brain: writes .dualcraft/out/map.html (Map + Roadmap views).
//   node map.mjs [--view map|road] [--out file.html] [--open]
//   node map.mjs --share [--view road|map] [--no-details]   → .dualcraft/out/share/<view>.html, ready to publish as a page
//     --no-details: for people outside the team — no note bodies, file names, branches or flags; decisions and notes hidden
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, outDir, parseArgs, openInBrowser, embedJson, posix } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { opt } = parseArgs(process.argv.slice(2))
if (opt.help) { console.log('node map.mjs [--view map|road] [--out file.html] [--open] | --share [--view road|map] [--no-details]'); process.exit(0) }

const { root, dir } = project()
const data = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'brain.mjs'), 'graph'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/); if (m) data.repo = m[1]
} catch { /* no remote */ }
const view = opt.view === 'map' || (!opt.share && opt.view !== 'road' && opt.view !== 'roadmap') ? 'map' : 'road'
const share = !!opt.share
const external = share && (opt['no-details'] || opt.details === false)

if (external) {
  // only the plan: what's being built, its state and version — no internal notes
  const keep = new Set(data.nodes.filter((n) => ['task', 'bug', 'idea'].includes(n.type) && n.status !== 'dropped').map((n) => n.id))
  data.nodes = data.nodes.filter((n) => keep.has(n.id)).map((n) => ({ id: n.id, type: n.type, title: n.title, status: n.status, target: n.target, priority: n.priority, estimate: n.estimate, depends_on: n.depends_on.filter((d) => keep.has(d)), related: [], tags: [], body: '' }))
  data.edges = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && e.kind === 'depends_on')
  delete data.repo
}
data.snapshot = new Date().toISOString().slice(0, 10)

const tpl = fs.readFileSync(path.join(HERE, 'templates', 'map.html'), 'utf8')
let html = tpl.replace('/*__DATA__*/', `const DATA = ${embedJson(data)};\nconst INITIAL_VIEW = ${embedJson(view)};`)
  .replace(/__TITLE__/g, `${view === 'road' ? 'Roadmap' : 'Brain'} ${data.project}`.replace(/[<&"]/g, ''))
let out
if (share) {
  // published pages get their own <!doctype>/<html>/<head>/<body> skeleton: keep the title, styles and content only
  html = html.replace(/<!doctype html>\s*/i, '').replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '').replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
  const sdir = path.join(outDir(dir), 'share'); fs.mkdirSync(sdir, { recursive: true })
  out = opt.out ? path.resolve(String(opt.out)) : path.join(sdir, `${view === 'road' ? 'roadmap' : 'map'}${external ? '-public' : ''}.html`)
} else out = opt.out ? path.resolve(String(opt.out)) : path.join(outDir(dir), view === 'road' ? 'roadmap.html' : 'map.html')
fs.writeFileSync(out, html)
const open = data.nodes.filter((n) => !['done', 'dropped', 'superseded'].includes(n.status)).length
console.log(`${view === 'road' ? 'Roadmap' : 'Brain map'}${share ? (external ? ' (shareable, without internal details)' : ' (shareable, full)') : ''} → ${posix(out)}  (${data.nodes.length} notes, ${open} open, ${data.edges.length} links)`)
if (opt.open && !share) openInBrowser(out)
