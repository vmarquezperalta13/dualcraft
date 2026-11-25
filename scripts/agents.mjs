#!/usr/bin/env node
// Lists DualCraft's specialist agents (packs.json → specialists): which are installed and what each does.
//   node agents.mjs [--json]
// Installed = agents/<id>.md in the plugin (Claude Code), else the installer's state (Gemini / Codex installs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = process.argv.includes('--json')
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const specialists = readJson(path.join(root, 'packs.json'))?.specialists || {}
const state = readJson(path.join(root, '..', 'state.json'))
const inPlugin = fs.existsSync(path.join(root, 'agents'))
const installed = (id) => (inPlugin ? fs.existsSync(path.join(root, 'agents', id + '.md')) : !!state?.specialists?.includes(id))
const rows = Object.entries(specialists).map(([id, a]) => ({ id, installed: installed(id), requires: a.requires, es: a.es }))

if (json) { console.log(JSON.stringify({ agents: rows }, null, 2)); process.exit(0) }
const out = ['Agentes especialistas de DualCraft', '']
for (const r of rows) out.push(`  ${r.installed ? '✓' : '·'} ${r.id.padEnd(10)} ${r.es}${r.installed ? '' : `  (no instalado: se instala con la skill ${r.requires})`}`)
const n = rows.filter((r) => r.installed).length
out.push('', `✓ instalados: ${n} de ${rows.length}`, '',
  'Usar uno:  /dualcraft:agents <agente> <tarea>   ·   o pídeselo a Claude ("usa el agente de seguridad")   ·   o @dualcraft:<agente>',
  'Añadir los que faltan: npx github:vmarquezperalta13/dualcraft add <pack>   (security → security, designer → design, marketing y release → release)')
console.log(out.join('\n'))
