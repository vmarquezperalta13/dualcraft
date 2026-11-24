#!/usr/bin/env node
// DualCraft visual brain: writes .dualcraft/out/map.html (Map + Roadmap views).
//   node map.mjs [--view map|road] [--out file.html] [--open]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, outDir, parseArgs, openInBrowser, embedJson, posix } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { opt } = parseArgs(process.argv.slice(2))
if (opt.help) { console.log('node map.mjs [--view map|road] [--out file.html] [--open]'); process.exit(0) }

const { root, dir } = project()
const data = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'brain.mjs'), 'graph'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const view = opt.view === 'road' || opt.view === 'roadmap' ? 'road' : 'map'
const out = opt.out ? path.resolve(String(opt.out)) : path.join(outDir(dir), view === 'road' ? 'roadmap.html' : 'map.html')
const tpl = fs.readFileSync(path.join(HERE, 'templates', 'map.html'), 'utf8')
const html = tpl.replace('/*__DATA__*/', `const DATA = ${embedJson(data)};\nconst INITIAL_VIEW = ${embedJson(view)};`)
  .replace(/__TITLE__/g, `Brain · ${data.project}`.replace(/[<&"]/g, ''))
fs.writeFileSync(out, html)
const open = data.nodes.filter((n) => !['done', 'dropped'].includes(n.status)).length
console.log(`${view === 'road' ? 'Roadmap' : 'Brain map'} → ${posix(out)}  (${data.nodes.length} notes, ${open} open, ${data.edges.length} links)`)
if (opt.open) openInBrowser(out)
