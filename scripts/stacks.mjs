#!/usr/bin/env node
// DualCraft stacks: what's supported and how to create each one.
//   list [--kind web|mobile]           supported stacks (and backends)
//   show <id>                          path of the stack's reference file + registry entry
//   scaffold <id> --dir <path> [--org com.example]   the command (or steps) to create a project of that stack
//   project                            stacks configured in the current DualCraft project
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRoot, parseArgs, die, posix } from './lib/project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'stacks', 'registry.json'), 'utf8'))
const [cmd = 'list', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const byId = (id) => reg.stacks.find((s) => s.id === id) || die(`unknown stack "${id}" — run: stacks.mjs list`)

if (cmd === 'list') {
  for (const kind of ['web', 'mobile']) {
    if (opt.kind && opt.kind !== kind) continue
    console.log(`${kind === 'web' ? 'Web' : 'Mobile'}:`)
    for (const s of reg.stacks.filter((x) => x.kind === kind)) console.log(`  ${s.id.padEnd(14)} ${s.name} — ${s.language}`)
  }
  if (!opt.kind) { console.log('Backends:'); for (const b of reg.backends) console.log(`  ${b.id.padEnd(16)} ${b.name} — CLI: ${b.cli} (${b.install})`) }
} else if (cmd === 'show') {
  const s = byId(pos[0])
  console.log(JSON.stringify(s, null, 2))
  console.log(`Reference: ${posix(path.join(ROOT, 'stacks', s.id + '.md'))}`)
} else if (cmd === 'scaffold') {
  const s = byId(pos[0])
  const dir = String(opt.dir || (s.kind === 'web' ? 'web' : 'mobile'))
  const cmdline = s.scaffold.replace(/\{dir\}/g, dir).replace(/\{org\}/g, String(opt.org || 'com.example'))
  const cli = /^(npx|npm|flutter)\b/.test(cmdline)
  console.log(cli ? `Run (asks for confirmation first — creates ${dir}/ and downloads packages):\n  ${cmdline}` : `No CLI generator — manual steps:\n  ${cmdline}`)
  console.log(`Then: node "${posix(path.join(ROOT, 'scripts', 'brain.mjs'))}" config set stacks.${s.kind}=${s.id} paths.${s.kind}=${dir}`)
} else if (cmd === 'project') {
  const root = findRoot() || die('no DualCraft project here')
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.dualcraft', 'config.json'), 'utf8'))
  for (const kind of ['web', 'mobile']) {
    const ids = [].concat(cfg.stacks?.[kind] || []).flatMap((x) => String(x).split(',')).filter((x) => x && x !== 'null')
    console.log(`${kind}: ${ids.length ? ids.map((id) => `${id} (${reg.stacks.find((s) => s.id === id)?.name || '?'}) → ${cfg.paths?.[id] || cfg.paths?.[kind] || '.'}`).join(' · ') : '—'}`)
  }
  console.log(`backend: ${cfg.backend?.provider || '—'}`)
} else die('usage: stacks.mjs list [--kind web|mobile] | show <id> | scaffold <id> --dir <path> [--org …] | project')
