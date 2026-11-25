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

test('agents: valid frontmatter, generated from their source, skills they name exist, report-only ones cannot edit', () => {
  assert.equal(run('scripts/dev/agents-src.mjs', ['--check']).code, 0, 'agents/ out of date — run node scripts/dev/agents-src.mjs')
  const P = JSON.parse(read(path.join(ROOT, 'packs.json')))
  const ids = fs.readdirSync(path.join(ROOT, 'agents')).map((f) => f.replace(/\.md$/, ''))
  assert.deepEqual(ids.sort(), Object.keys(P.specialists).sort())
  for (const id of ids) {
    const t = read(path.join(ROOT, 'agents', id + '.md')).replace(/\r\n/g, '\n')
    const m = t.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(m, id)
    assert.match(m[1], new RegExp(`^name: ${id}$`, 'm'))
    const desc = JSON.parse(m[1].match(/^description: (.*)$/m)[1])
    assert.ok(desc.length >= 80 && desc.length <= 500, `${id}: description length ${desc.length}`); assert.match(desc, /Use (for|to|before)\b/, id)
    assert.match(m[1], /^tools: Read, Grep, Glob, Bash, Skill/m); assert.match(m[1], /^model: inherit$/m)
    assert.doesNotMatch(m[1], /^(hooks|mcpServers|permissionMode):/m, `${id}: ignored for plugin agents`)
    assert.ok(SKILLS.includes(P.specialists[id].requires), `${id}: requires ${P.specialists[id].requires}`)
    for (const [, s] of t.matchAll(/dualcraft:([a-z0-9-]+)/g)) assert.ok(SKILLS.includes(s), `${id}: unknown skill dualcraft:${s}`)
    assert.match(t, /Never commit, push, tag, publish, deploy/)
  }
  for (const id of ['security', 'reviewer']) assert.match(read(path.join(ROOT, 'agents', id + '.md')), /^disallowedTools: Edit, Write, NotebookEdit$/m, `${id} only reports`)
})

test('help: lists installed commands and how to add missing ones', () => {
  assert.match(run('help.mjs').out, /✓ instalados: \d+/)
})

test('installer: minimal and full installs, add/remove, transformed skills, uninstall', () => {
  const home = tmpDir('dualcraft-home-')
  fs.mkdirSync(path.join(home, '.gemini'))
  const inst = (...a) => run('bin/dualcraft.mjs', [...a, '--home', home, '--yes', '--no-claude-cli'])
  fs.mkdirSync(path.join(home, '.codex'))
  const min = inst('install', '--agents', 'claude,gemini,codex', '--stacks', 'flutter', '--packs', 'none')
  assert.equal(min.code, 0, min.err)
  const plugin = path.join(home, '.dualcraft', 'claude-marketplace', 'dualcraft')
  const installed = fs.readdirSync(path.join(plugin, 'skills'))
  assert.ok(installed.includes('mobile-build') && !installed.includes('web-build') && !installed.includes('tokens'))
  assert.ok(exists(path.join(plugin, 'hooks', 'hooks.json')) && exists(path.join(plugin, 'scripts', 'brain.mjs')))
  const g = read(path.join(home, '.gemini', 'skills', 'dualcraft-start', 'SKILL.md'))
  assert.match(g, /^name: dualcraft-start$/m); assert.doesNotMatch(g, /CLAUDE_PLUGIN_ROOT|dualcraft:[a-z]/)
  assert.match(read(path.join(home, '.gemini', 'GEMINI.md')), /<!-- dualcraft:start -->[\s\S]*brain\.mjs" summary/)
  // specialist agents: only those whose skill is installed (core: reviewer, qa, architect, debugger)
  assert.deepEqual(fs.readdirSync(path.join(plugin, 'agents')).sort(), ['architect.md', 'debugger.md', 'qa.md', 'reviewer.md'])
  const ga = read(path.join(home, '.gemini', 'agents', 'dualcraft-reviewer.md'))
  assert.match(ga, /^---\nname: dualcraft-reviewer\ndescription: "Code reviewer/); assert.doesNotMatch(ga, /dualcraft:[a-z]|^tools:|Skill tool/m); assert.match(ga, /dualcraft-review\b/)
  const ct = read(path.join(home, '.codex', 'agents', 'dualcraft-debugger.toml'))
  assert.match(ct, /^name = "dualcraft-debugger"\ndescription = "Debugging specialist[^\n]*"\ndeveloper_instructions = '''\n/); assert.match(ct, /'''\n$/); assert.doesNotMatch(ct, /dualcraft:[a-z]/)
  assert.ok(!exists(path.join(home, '.gemini', 'agents', 'dualcraft-security.md')))
  assert.match(inst('list').out, /Agentes especialistas[\s\S]*· security[\s\S]*✓ reviewer/)
  assert.equal(inst('add', 'nextjs', 'design').code, 0)
  assert.ok(exists(path.join(plugin, 'skills', 'web-build')) && exists(path.join(home, '.gemini', 'skills', 'dualcraft-tokens')))
  assert.ok(exists(path.join(plugin, 'agents', 'designer.md')) && exists(path.join(home, '.codex', 'agents', 'dualcraft-designer.toml')))
  assert.equal(inst('remove', 'design').code, 0)
  assert.ok(!exists(path.join(home, '.gemini', 'skills', 'dualcraft-tokens')) && !exists(path.join(home, '.gemini', 'agents', 'dualcraft-designer.md')))
  assert.match(inst('list').out, /✓ nextjs/)
  assert.equal(inst('uninstall').code, 0)
  assert.ok(!exists(path.join(home, '.dualcraft')) && !exists(path.join(home, '.gemini', 'GEMINI.md')) && !exists(path.join(home, '.codex', 'agents', 'dualcraft-debugger.toml')))
})
