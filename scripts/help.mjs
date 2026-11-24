#!/usr/bin/env node
// Lists DualCraft commands from catalog.json; a command counts as available
// when skills/<name>/SKILL.md exists in the plugin.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
const filter = process.argv[2]?.toLowerCase()
const available = (c) => fs.existsSync(path.join(root, 'skills', c.name, 'SKILL.md'))
// which installer pack provides each skill (so a missing one says how to add it)
const packOf = {}
try {
  const P = JSON.parse(fs.readFileSync(path.join(root, 'packs.json'), 'utf8'))
  for (const [id, p] of Object.entries(P.platforms || {})) for (const s of p.skills) packOf[s] = { id: id === 'web-platform' ? '<stack web>' : '<stack móvil>', name: p.name }
  for (const [id, p] of Object.entries(P.optional || {})) for (const e of p.skills) packOf[typeof e === 'string' ? e : e.skill] = { id, name: p.name }
} catch { /* no packs.json: full plugin */ }

const out = [`DualCraft v${plugin.version} — comandos`, '']
let nAvail = 0; let nSoon = 0
for (const [pack, label] of Object.entries(catalog.packs)) {
  const cmds = catalog.commands.filter((c) => c.pack === pack && (!filter || pack === filter || c.name.includes(filter)))
  if (!cmds.length) continue
  out.push(`## ${label} [${pack}]`)
  for (const c of cmds) {
    const ok = available(c)
    ok ? nAvail++ : nSoon++
    out.push(`  ${ok ? '✓' : '·'} /dualcraft:${c.name.padEnd(20)} ${c.es}${ok ? '' : packOf[c.name] ? `  (no instalado — pack ${packOf[c.name].name}: npx github:vmarquezperalta13/dualcraft add ${packOf[c.name].id})` : '  (no instalado)'}`)
  }
  out.push('')
}
out.push(`✓ instalados: ${nAvail}${nSoon ? `   · no instalados: ${nSoon} (gestiona packs con: npx github:vmarquezperalta13/dualcraft list)` : ''}`)
console.log(out.join('\n'))
