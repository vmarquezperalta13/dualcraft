#!/usr/bin/env node
// Maintainer tool: writes scripts/dev/descriptions.json into each skill's frontmatter (YAML-safe).
//   node scripts/dev/apply-descriptions.mjs [--check]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'descriptions.json'), 'utf8'))
const check = process.argv.includes('--check')
const unsafe = (d) => /: |\s#|^[\s"'>|&*!%@`[{,?-]/.test(d)
let before = 0; let after = 0; const missing = []
for (const s of fs.readdirSync(path.join(ROOT, 'skills'))) {
  const f = path.join(ROOT, 'skills', s, 'SKILL.md')
  let t = fs.readFileSync(f, 'utf8')
  const m = t.match(/^description:[ \t]*(?:>-?[ \t]*\r?\n[ \t]+)?(.*)$/m)
  before += m[1].length
  const d = map[s]
  if (!d) { missing.push(s); after += m[1].length; continue }
  after += d.length
  if (!check) { t = t.replace(m[0], unsafe(d) ? `description: >-\n  ${d}` : `description: ${d}`); fs.writeFileSync(f, t) }
}
const tok = (c) => Math.round(c / 4.2)
console.log(`descriptions: ${tok(before)} → ${tok(after)} tokens (${Math.round((1 - after / before) * 100)}% less)${missing.length ? ' · no new text for: ' + missing.join(', ') : ''}`)
