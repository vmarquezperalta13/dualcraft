#!/usr/bin/env node
// DualCraft ER tool — reads .dualcraft/db/schema.dbml (or --file) and
//   check   validate the schema (exit 1 on errors)
//   json    print the parsed model
//   html    write an interactive ER diagram to .dualcraft/out/er.html (--open to open it)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDbml } from './lib/dbml.mjs'
import { die, findRoot, outDir, parseArgs, openInBrowser, embedJson, posix } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)

if (cmd === 'help') {
  console.log(`DualCraft ER
  check [--file schema.dbml]           validate the schema
  json  [--file schema.dbml]           parsed model as JSON
  html  [--file schema.dbml] [--out file.html] [--open]   interactive ER diagram (PNG/SVG export inside)`)
  process.exit(0)
}

const root = findRoot()
const file = opt.file ? path.resolve(String(opt.file)) : root ? path.join(root, '.dualcraft', 'db', 'schema.dbml') : die('no DualCraft project here and no --file given.')
if (!fs.existsSync(file)) die(`schema not found: ${posix(file)} — create it with /dualcraft:schema`)
const model = parseDbml(fs.readFileSync(file, 'utf8'))

const report = () => {
  for (const e of model.errors) console.log('✗ ' + e)
  for (const w of model.warnings) console.log('⚠ ' + w)
}

if (cmd === 'check') {
  report()
  console.log(`${model.tables.length} tables · ${model.refs.length} relations · ${model.enums.length} enums${model.database ? ' · ' + model.database : ''}`)
  if (model.errors.length) process.exit(1)
  console.log('schema OK')
} else if (cmd === 'json') {
  console.log(JSON.stringify(model, null, 2))
} else if (cmd === 'html') {
  if (model.errors.length) { report(); die('fix the schema errors first.') }
  let config = {}; let layout = null; let out
  if (root) {
    const dir = path.join(root, '.dualcraft')
    config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
    const lf = path.join(dir, 'db', 'layout.json')
    if (fs.existsSync(lf)) { try { layout = JSON.parse(fs.readFileSync(lf, 'utf8')) } catch { console.log('⚠ layout.json is not valid JSON — ignored') } }
    out = opt.out ? path.resolve(String(opt.out)) : path.join(outDir(dir), 'er.html')
  } else out = opt.out ? path.resolve(String(opt.out)) : file.replace(/\.dbml$/, '') + '.er.html'
  const meta = { project: config.name || model.project.name || path.basename(file, '.dbml'), version: config.version || '', source: posix(path.relative(root || path.dirname(file), file)), generated: new Date().toISOString() }
  const tpl = fs.readFileSync(path.join(HERE, 'templates', 'er.html'), 'utf8')
  const html = tpl.replace('/*__DATA__*/', `const MODEL = ${embedJson(model)};\nconst LAYOUT = ${embedJson(layout)};\nconst META = ${embedJson(meta)};`)
    .replace(/__TITLE__/g, `ER · ${meta.project}`.replace(/[<&"]/g, ''))
  fs.writeFileSync(out, html)
  report()
  console.log(`ER diagram → ${posix(out)}`)
  if (opt.open) openInBrowser(out)
} else die(`unknown command "${cmd}". Try: help`)
