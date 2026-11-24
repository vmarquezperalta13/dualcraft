// Plugin consistency (skills, packs, catalog, registry) and the installer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, run, tmpDir, read, exists } from './helpers.mjs'

const SKILLS = fs.readdirSync(path.join(ROOT, 'skills'))
const fm = (s) => { const t = read(path.join(ROOT, 'skills', s, 'SKILL.md')); const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/); return { raw: m?.[1] || '', body: t.slice(m ? m[0].length : 0) } }
const descOf = (raw) => (raw.match(/^description:[ \t]*(?:>-?[ \t]*\r?\n[ \t]+)?(.*)$/m) || [])[1]

test('skills: frontmatter is YAML-safe, name matches folder, description present and short', () => {
  for (const s of SKILLS) {
    const { raw } = fm(s)
    assert.match(raw, new RegExp(`^name: ${s}$`, 'm'), `${s}: name`)
    const line = (raw.match(/^description:(.*)$/m) || [])[1]
    assert.ok(line !== undefined, `${s}: description`)
    if (!/^\s*>-?\s*$/.test(line)) assert.doesNotMatch(line.trim(), /: |\s#|^["'>|&*!%@`[{,?-]/, `${s}: description must be quoted or folded`)
    const d = descOf(raw)
    assert.ok(d && d.length >= 60 && d.length <= 420, `${s}: description length ${d?.length}`)
    assert.match(d, /Use (for|when|before|at|in)\b/, `${s}: description says when to use it`)
  }
})

test('skills: every dualcraft:<name> reference points to an existing skill', () => {
  const files = [...SKILLS.map((s) => path.join(ROOT, 'skills', s, 'SKILL.md')), ...fs.readdirSync(path.join(ROOT, 'references')).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, 'references', f)), ...fs.readdirSync(path.join(ROOT, 'stacks')).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, 'stacks', f))]
  for (const f of files) for (const m of read(f).matchAll(/dualcraft:([a-z][a-z0-9-]*)/g)) {
    if (['start', 'end'].includes(m[1]) && /<!-- dualcraft:/.test(read(f))) continue
    assert.ok(SKILLS.includes(m[1]), `${path.relative(ROOT, f)} → dualcraft:${m[1]} does not exist`)
  }
})

test('packs, catalog and descriptions.json cover every skill exactly', () => {
  const P = JSON.parse(read(path.join(ROOT, 'packs.json')))
  const inPacks = [...P.core.skills, ...Object.values(P.platforms).flatMap((p) => p.skills), ...Object.values(P.optional).flatMap((p) => p.skills.map((e) => (typeof e === 'string' ? e : e.skill)))]
  assert.deepEqual([...new Set(inPacks)].sort(), [...SKILLS].sort())
  assert.equal(inPacks.length, new Set(inPacks).size, 'a skill is in two packs')
  const catalog = JSON.parse(read(path.join(ROOT, 'catalog.json'))).commands.map((c) => c.name)
  assert.deepEqual(SKILLS.filter((s) => s !== 'using-dualcraft' && !catalog.includes(s)), [])
  const desc = JSON.parse(read(path.join(ROOT, 'scripts', 'dev', 'descriptions.json')))
  for (const s of SKILLS) assert.equal(descOf(fm(s).raw), desc[s], `${s}: SKILL.md description differs from descriptions.json (run apply-descriptions)`)
})

test('stack registry: every stack has a sheet, a pack and a generator target', () => {
  const R = JSON.parse(read(path.join(ROOT, 'stacks', 'registry.json')))
  const P = JSON.parse(read(path.join(ROOT, 'packs.json')))
  for (const s of R.stacks) {
    assert.ok(exists(path.join(ROOT, 'stacks', `${s.id}.md`)), `${s.id}.md`)
    assert.ok(P.stacks[s.id], `pack for ${s.id}`)
    assert.equal(P.stacks[s.id].kind, s.kind)
  }
})

test('hooks: SessionStart and UserPromptSubmit point to existing scripts', () => {
  const h = JSON.parse(read(path.join(ROOT, 'hooks', 'hooks.json'))).hooks
  for (const ev of ['SessionStart', 'UserPromptSubmit']) {
    const cmd = h[ev][0].hooks[0].command
    const script = cmd.match(/scripts\/(\w+\.mjs)/)[1]
    assert.ok(exists(path.join(ROOT, 'scripts', script)), `${ev} → ${script}`)
  }
})

test('help: lists installed commands and how to add missing ones', () => {
  assert.match(run('help.mjs').out, /✓ instalados: \d+/)
})

test('installer: minimal and full installs, add/remove, transformed skills, uninstall', () => {
  const home = tmpDir('dualcraft-home-')
  fs.mkdirSync(path.join(home, '.gemini'))
  const inst = (...a) => run('bin/dualcraft.mjs', [...a, '--home', home, '--yes', '--no-claude-cli'])
  const min = inst('install', '--agents', 'claude,gemini', '--stacks', 'flutter', '--packs', 'none')
  assert.equal(min.code, 0, min.err)
  const plugin = path.join(home, '.dualcraft', 'claude-marketplace', 'dualcraft')
  const installed = fs.readdirSync(path.join(plugin, 'skills'))
  assert.ok(installed.includes('mobile-build') && !installed.includes('web-build') && !installed.includes('tokens'))
  assert.ok(exists(path.join(plugin, 'hooks', 'hooks.json')) && exists(path.join(plugin, 'scripts', 'brain.mjs')))
  const g = read(path.join(home, '.gemini', 'skills', 'dualcraft-start', 'SKILL.md'))
  assert.match(g, /^name: dualcraft-start$/m); assert.doesNotMatch(g, /CLAUDE_PLUGIN_ROOT|dualcraft:[a-z]/)
  assert.match(read(path.join(home, '.gemini', 'GEMINI.md')), /<!-- dualcraft:start -->[\s\S]*brain\.mjs" summary/)
  assert.equal(inst('add', 'nextjs', 'design').code, 0)
  assert.ok(exists(path.join(plugin, 'skills', 'web-build')) && exists(path.join(home, '.gemini', 'skills', 'dualcraft-tokens')))
  assert.equal(inst('remove', 'design').code, 0)
  assert.ok(!exists(path.join(home, '.gemini', 'skills', 'dualcraft-tokens')))
  assert.match(inst('list').out, /✓ nextjs/)
  assert.equal(inst('uninstall').code, 0)
  assert.ok(!exists(path.join(home, '.dualcraft')) && !exists(path.join(home, '.gemini', 'GEMINI.md')))
})
