// Parsers, colors and the brain CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseDbml } from '../scripts/lib/dbml.mjs'
import { parseColor, toHex, contrast } from '../scripts/lib/color.mjs'
import { ROOT, run, makeProject, read, write } from './helpers.mjs'

test('dbml: hockey example parses with every table, ref and enum', () => {
  const m = parseDbml(read(path.join(ROOT, 'examples', 'hockey.dbml')))
  assert.deepEqual(m.errors, [])
  assert.equal(m.tables.length, 10)
  assert.equal(m.refs.length, 25)
  assert.equal(m.enums.length, 1)
  assert.equal(m.database, 'postgresql')
})

test('dbml: braces inside a quoted table note do not break the header', () => {
  const m = parseDbml("Table s [note: 'path: users/{userId}/sessions'] {\n  id string [pk]\n}\n")
  assert.deepEqual(m.errors, [])
  assert.equal(m.tables[0].note, 'path: users/{userId}/sessions')
})

test('dbml: errors carry line numbers; FK type mismatch is a warning', () => {
  const bad = parseDbml('Table a {\n id int [pk]\n x int [ref: > b.id]\n}\nfoo bar\n')
  assert.ok(bad.errors.some((e) => /line 5/.test(e)))
  assert.ok(bad.errors.some((e) => /unknown table "b"/.test(e)))
  const mism = parseDbml('Table u {\n id int [pk]\n}\nTable c {\n id uuid [pk]\n u_id uuid [ref: > u.id]\n}\n')
  assert.ok(mism.warnings.some((w) => /different types/.test(w)))
})

test('color: hex, rgb, hsl, oklch parse; contrast ratio', () => {
  assert.equal(toHex(parseColor('#fff')), '#ffffff')
  assert.equal(toHex(parseColor('rgb(250 250 250)')), '#fafafa')
  assert.equal(toHex(parseColor('hsl(0 70% 50%)')), '#d92626')
  assert.ok(parseColor('oklch(0.55 0.15 250)'))
  assert.equal(parseColor('red'), null)
  assert.ok(Math.abs(contrast(parseColor('#000'), parseColor('#fff')) - 21) < 0.01)
})

test('brain: init, notes, dependencies, check, roadmap estimates', () => {
  const dir = makeProject()
  assert.equal(run('brain.mjs', ['new', 'decision', 'Usar Provider', '--area', 'architecture'], dir).code, 0)
  run('brain.mjs', ['new', 'task', 'Login con Google', '--target', '1.3.0', '--depends', 'D-001'], dir)
  run('brain.mjs', ['new', 'task', 'Ranking', '--target', '1.3.0', '--depends', 'T-001'], dir)
  run('brain.mjs', ['set', 'T-001', 'estimate=2d', 'assignee=ana'], dir)
  run('brain.mjs', ['set', 'T-002', 'estimate=4h'], dir)
  assert.equal(run('brain.mjs', ['check'], dir).code, 0)
  const rm = run('brain.mjs', ['roadmap'], dir).out
  assert.match(rm, /## 1\.3\.0 {2}\(0\/2 done\) {2}· est\. 2\.5d/)
  assert.match(rm, /@ana 1/)
  assert.match(run('brain.mjs', ['list', '--assignee', 'ana'], dir).out, /T-001/)
  run('brain.mjs', ['new', 'task', 'Huérfana', '--depends', 'Z-9'], dir)
  const chk = run('brain.mjs', ['check'], dir)
  assert.equal(chk.code, 1); assert.match(chk.out, /depends on missing Z-9/)
})

test('brain: decisions — summary lists all in force, supersede hides the old one, relevant finds by topic', () => {
  const dir = makeProject()
  run('brain.mjs', ['new', 'decision', 'Usar Riverpod para el estado', '--area', 'architecture'], dir)
  run('brain.mjs', ['new', 'decision', 'Usar Provider para el estado de la app', '--area', 'architecture', '--body', '## Decision\nTodo el estado con Provider.'], dir)
  run('brain.mjs', ['new', 'decision', 'Los precios se calculan en Cloud Functions', '--area', 'security', '--tags', 'pagos,precios'], dir)
  assert.equal(run('brain.mjs', ['supersede', 'D-001', 'D-002', '--why', 'cambio'], dir).code, 0)
  const sum = run('brain.mjs', ['summary'], dir).out
  assert.match(sum, /Decisions in force \(2\)/)
  assert.doesNotMatch(sum, /Riverpod/)
  const rel = run('brain.mjs', ['relevant', '--hook'], dir, { input: JSON.stringify({ prompt: 'que el cliente mande el precio total al pagar' }) }).out
  assert.match(rel, /D-003/)
  assert.equal(run('brain.mjs', ['relevant', '--hook'], dir, { input: JSON.stringify({ prompt: 'sí, adelante' }) }).out.trim(), '')
  assert.equal(run('brain.mjs', ['check'], dir).code, 0)
})

test('brain: hooks are silent outside a DualCraft project', () => {
  const dir = fs.mkdtempSync(path.join(path.dirname(makeProject()), 'empty-'))
  assert.equal(run('brain.mjs', ['summary', '--hook'], dir).out, '')
  assert.equal(run('brain.mjs', ['relevant', '--hook'], dir, { input: '{"prompt":"precio"}' }).out, '')
})

test('brain: config get/set nested keys', () => {
  const dir = makeProject()
  run('brain.mjs', ['config', 'set', 'design.system=https://x', 'backend.environments.dev.project=app-dev'], dir)
  assert.equal(run('brain.mjs', ['config', 'get', 'backend.environments.dev.project'], dir).out.trim(), 'app-dev')
  write(path.join(dir, 'x'), '')
})
