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

const out = [`DualCraft v${plugin.version} — comandos`, '']
let nAvail = 0; let nSoon = 0
for (const [pack, label] of Object.entries(catalog.packs)) {
  const cmds = catalog.commands.filter((c) => c.pack === pack && (!filter || pack === filter || c.name.includes(filter)))
  if (!cmds.length) continue
  out.push(`## ${label} [${pack}]`)
  for (const c of cmds) {
    const ok = available(c)
    ok ? nAvail++ : nSoon++
    out.push(`  ${ok ? '✓' : '·'} /dualcraft:${c.name.padEnd(20)} ${c.es}${ok ? '' : `  (fase ${c.phase})`}`)
  }
  out.push('')
}
out.push(`✓ disponible: ${nAvail}   · próximamente: ${nSoon}`)
console.log(out.join('\n'))
