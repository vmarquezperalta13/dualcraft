#!/usr/bin/env node
// DualCraft installer — npx github:vmarquezperalta13/dualcraft <command>
//   install            choose agents, stacks and optional packs (interactive, or with flags) and install them
//   add <id…>          add stacks or optional packs to the current installation
//   remove <id…>       remove stacks or optional packs
//   list               packs and stacks, marking what is installed
//   update             reinstall the same selection with this version of DualCraft
//   uninstall          remove DualCraft from every agent
//   doctor             check the installation
// Flags: --agents claude,gemini,codex · --stacks nextjs,flutter · --packs design,data,shared,security,release,convert | --all-packs
//        --yes (no questions) · --home <dir> (testing) · --no-claude-cli (only build the Claude plugin, print the commands)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKS = JSON.parse(fs.readFileSync(path.join(SRC, 'packs.json'), 'utf8'))
const VERSION = JSON.parse(fs.readFileSync(path.join(SRC, '.claude-plugin', 'plugin.json'), 'utf8')).version

// ---------- args ----------
const argv = process.argv.slice(2)
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'install'
const pos = []; const opt = {}
for (let i = cmd === argv[0] ? 1 : 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split(/=(.*)/s); if (v !== undefined) opt[k] = v; else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true } else pos.push(a)
}
const list = (v) => (v === undefined ? null : v === true || /^(none|ninguno|-)$/i.test(String(v)) ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean))

const HOME = path.resolve(String(opt.home || os.homedir()))
const DC = path.join(HOME, '.dualcraft')
const CURRENT = path.join(DC, 'current')
const STATE = path.join(DC, 'state.json')
const posix = (p) => p.replace(/\\/g, '/')
const say = (s = '') => console.log(s)
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return null } }
const writeState = (s) => { fs.mkdirSync(DC, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n') }

// ---------- agents ----------
function findClaude() {
  const cands = process.platform === 'win32'
    ? [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), 'claude']
    : [path.join(HOME, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', 'claude']
  for (const c of cands) {
    if (c !== 'claude' && !fs.existsSync(c)) continue
    const r = c.endsWith('.cmd') || c === 'claude' ? spawnSync(`"${c}" --version`, { encoding: 'utf8', shell: true }) : spawnSync(c, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) return c
  }
  return null
}
const onPath = (bin) => spawnSync(`${bin} --version`, { encoding: 'utf8', shell: true }).status === 0
function detectAgents() {
  return {
    claude: !!findClaude() || fs.existsSync(path.join(HOME, '.claude')),
    gemini: fs.existsSync(path.join(HOME, '.gemini')) || onPath('gemini'),
    codex: fs.existsSync(path.join(HOME, '.codex')) || onPath('codex'),
  }
}

// ---------- selection → skills ----------
const STACK_IDS = Object.keys(PACKS.stacks)
const OPT_IDS = Object.keys(PACKS.optional)
function resolveSkills(sel) {
  const kinds = new Set(sel.stacks.map((s) => PACKS.stacks[s]?.kind).filter(Boolean))
  const skills = new Set(PACKS.core.skills)
  if (kinds.has('web')) PACKS.platforms['web-platform'].skills.forEach((s) => skills.add(s))
  if (kinds.has('mobile')) PACKS.platforms['mobile-platform'].skills.forEach((s) => skills.add(s))
  for (const p of sel.packs) for (const e of PACKS.optional[p]?.skills || []) {
    const s = typeof e === 'string' ? { skill: e } : e
    if (!s.when || kinds.has(s.when)) skills.add(s.skill)
  }
  return [...skills].filter((s) => fs.existsSync(path.join(SRC, 'skills', s, 'SKILL.md')))
}
function validate(sel) {
  for (const s of sel.stacks) if (!PACKS.stacks[s]) fail(`stack desconocido "${s}" (opciones: ${STACK_IDS.join(', ')})`)
  for (const p of sel.packs) if (!PACKS.optional[p]) fail(`pack desconocido "${p}" (opciones: ${OPT_IDS.join(', ')})`)
  for (const a of sel.agents) if (!PACKS.agents[a]) fail(`agente desconocido "${a}" (opciones: claude, gemini, codex)`)
}

// ---------- interactive ----------
async function ask(rl, title, items, defaults, { min = 0 } = {}) {
  say(`\n${title}`)
  items.forEach((it, i) => say(`  ${String(i + 1).padStart(2)}. ${defaults.includes(it.id) ? '[x]' : '[ ]'} ${it.label}`))
  for (;;) {
    const a = (await rl.question(`  Números separados por comas (Enter = los marcados, "todos", "ninguno"): `)).trim().toLowerCase()
    let ids
    if (!a) ids = defaults
    else if (a === 'todos' || a === 'all') ids = items.map((i) => i.id)
    else if (a === 'ninguno' || a === 'none' || a === '0') ids = []
    else {
      const nums = a.split(/[\s,]+/).map(Number)
      if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > items.length)) { say('  Respuesta no válida, prueba otra vez.'); continue }
      ids = [...new Set(nums.map((n) => items[n - 1].id))]
    }
    if (ids.length < min) { say(`  Elige al menos ${min}.`); continue }
    return ids
  }
}
async function interactive(prev) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const det = detectAgents()
  say(`DualCraft ${VERSION} — instalador`)
  const agents = await ask(rl, '¿En qué agentes lo instalo?', Object.entries(PACKS.agents).map(([id, a]) => ({ id, label: `${a.name}${det[id] ? ' (detectado)' : ''} — ${a.how}` })), prev?.agents || Object.keys(det).filter((k) => det[k]), { min: 1 })
  const web = await ask(rl, 'Stacks WEB que usas:', STACK_IDS.filter((s) => PACKS.stacks[s].kind === 'web').map((id) => ({ id, label: PACKS.stacks[id].name })), (prev?.stacks || []).filter((s) => PACKS.stacks[s].kind === 'web'))
  const mob = await ask(rl, 'Stacks MÓVILES que usas:', STACK_IDS.filter((s) => PACKS.stacks[s].kind === 'mobile').map((id) => ({ id, label: PACKS.stacks[id].name })), (prev?.stacks || []).filter((s) => PACKS.stacks[s].kind === 'mobile'))
  const packs = await ask(rl, 'Packs opcionales:', OPT_IDS.map((id) => ({ id, label: `${PACKS.optional[id].name} — ${PACKS.optional[id].description}` })), prev?.packs || OPT_IDS)
  const sel = { agents, stacks: [...web, ...mob], packs }
  const skills = resolveSkills(sel)
  say(`\nResumen: ${skills.length} skills · agentes: ${agents.join(', ')} · stacks: ${sel.stacks.join(', ') || '— (ninguno: sin packs web/móvil)'} · packs: ${packs.join(', ') || '—'}`)
  const ok = (await rl.question('¿Instalar? (S/n): ')).trim().toLowerCase()
  rl.close()
  if (ok && !['s', 'si', 'sí', 'y', 'yes'].includes(ok)) { say('Cancelado.'); process.exit(0) }
  return sel
}
async function confirm(question) {
  if (opt.yes) return true
  if (!process.stdin.isTTY) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(`${question} (s/N): `)).trim().toLowerCase(); rl.close()
  return ['s', 'si', 'sí', 'y', 'yes'].includes(a)
}

// ---------- files ----------
const SHARED = ['scripts', 'references', 'stacks', 'catalog.json', 'packs.json', 'CHANGELOG.md']
function copyShared(dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const item of SHARED) { const from = path.join(SRC, item); if (!fs.existsSync(from)) continue; fs.rmSync(path.join(dest, item), { recursive: true, force: true }); fs.cpSync(from, path.join(dest, item), { recursive: true }) }
}
const agentName = (s) => (s.includes('dualcraft') ? s : `dualcraft-${s}`)
function transformSkill(text, allSkills) {
  let t = text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, posix(CURRENT))
  t = t.replace(/^name:\s*(\S+)\s*$/m, (_, n) => `name: ${agentName(n)}`)
  for (const s of [...allSkills].sort((a, b) => b.length - a.length)) t = t.split(`dualcraft:${s}`).join(agentName(s))
  return t
}
function contextBlock(agent) {
  const brain = `node "${posix(CURRENT)}/scripts/brain.mjs"`
  return [
    '<!-- dualcraft:start -->',
    `## DualCraft ${VERSION}`,
    'Web + mobile development workflow. Skills are installed as `dualcraft-*` (and `using-dualcraft`).',
    'When the current folder or a parent contains `.dualcraft/config.json`:',
    `1. At the start of the conversation run \`${brain} summary\` and follow it (project context, decisions in force, work mode).`,
    `2. Before acting on each request run \`${brain} relevant "<the request in a few words>"\` and respect the decisions it returns; if the request contradicts one, say so before acting.`,
    '3. Use the `using-dualcraft` skill to route the work to the right `dualcraft-*` skill.',
    `Commands: \`node "${posix(CURRENT)}/scripts/help.mjs"\`. Where a skill mentions Claude Code tools (AskUserQuestion, Artifact, ToolSearch), use your own equivalent: ask in chat, write files, or skip that step and tell the user.`,
    agent === 'codex' ? 'Talk to the user in the project\'s language (`lang` in .dualcraft/config.json).' : '',
    '<!-- dualcraft:end -->',
  ].filter(Boolean).join('\n')
}
function writeBlock(file, block) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const re = /<!-- dualcraft:start -->[\s\S]*?<!-- dualcraft:end -->\n?/
  const next = block ? (re.test(cur) ? cur.replace(re, block + '\n') : cur.replace(/\s*$/, cur ? '\n\n' : '') + block + '\n') : cur.replace(re, '').replace(/\n{3,}$/, '\n')
  if (!next.trim()) { fs.rmSync(file, { force: true }); return }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, next)
}

// ---------- per agent ----------
function claudeRun(claude, args) {
  const needsShell = claude === 'claude' || claude.endsWith('.cmd')
  const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  const r = needsShell ? spawnSync([q(claude), ...args.map(q)].join(' '), { encoding: 'utf8', shell: true }) : spawnSync(claude, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}
async function installClaude(skills, sel) {
  const market = path.join(DC, 'claude-marketplace'); const plugin = path.join(market, 'dualcraft')
  fs.rmSync(market, { recursive: true, force: true })
  copyShared(plugin)
  fs.cpSync(path.join(SRC, 'hooks'), path.join(plugin, 'hooks'), { recursive: true })
  for (const s of skills) fs.cpSync(path.join(SRC, 'skills', s), path.join(plugin, 'skills', s), { recursive: true })
  const pj = JSON.parse(fs.readFileSync(path.join(SRC, '.claude-plugin', 'plugin.json'), 'utf8'))
  pj.description = `${pj.description} Installed packs: core${sel.stacks.length ? ', ' + sel.stacks.join(', ') : ''}${sel.packs.length ? ', ' + sel.packs.join(', ') : ''}.`
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify(pj, null, 2) + '\n')
  fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'dualcraft-local', owner: { name: 'dualcraft' }, metadata: { description: 'DualCraft built by the installer with the packs you chose.' }, plugins: [{ name: 'dualcraft', source: './dualcraft', description: 'DualCraft (selected packs)' }] }, null, 2) + '\n')
  const cmds = [['plugin', 'marketplace', 'add', market], ['plugin', 'uninstall', 'dualcraft@dualcraft-local'], ['plugin', 'install', 'dualcraft@dualcraft-local', '--scope', 'user']]
  const claude = opt['claude-cli'] === false || opt['no-claude-cli'] ? null : findClaude()
  if (!claude) { say(`  Claude Code: plugin creado en ${posix(market)}. Ejecuta:\n    claude plugin marketplace add "${posix(market)}"\n    claude plugin install dualcraft@dualcraft-local --scope user`); return }
  const listed = claudeRun(claude, ['plugin', 'list']).out
  if (/dualcraft@dualcraft\b(?!-local)/.test(listed)) {
    if (await confirm('  Ya tienes instalado "dualcraft@dualcraft" (todas las skills). ¿Lo sustituyo por la versión con tus packs?')) claudeRun(claude, ['plugin', 'uninstall', 'dualcraft@dualcraft'])
    else say('  (se mantienen las dos versiones; puedes quitar la completa con: claude plugin uninstall dualcraft@dualcraft)')
  }
  const add = claudeRun(claude, cmds[0]); if (!add.ok && !/already/i.test(add.out)) claudeRun(claude, ['plugin', 'marketplace', 'update', 'dualcraft-local'])
  claudeRun(claude, cmds[1])
  const inst = claudeRun(claude, cmds[2])
  say(inst.ok ? '  Claude Code: plugin "dualcraft@dualcraft-local" instalado (comandos /dualcraft:*, hooks activos). Abre un chat nuevo para usarlo.' : `  Claude Code: no se pudo instalar automáticamente:\n${inst.out}\n  Prueba: claude plugin install dualcraft@dualcraft-local --scope user`)
}
function installSkillsAgent(agent, skills, prevSkills = []) {
  const base = path.join(HOME, agent === 'gemini' ? '.gemini' : '.codex')
  const dir = path.join(base, 'skills')
  fs.mkdirSync(dir, { recursive: true })
  for (const s of prevSkills) if (!skills.includes(s)) fs.rmSync(path.join(dir, agentName(s)), { recursive: true, force: true })
  const all = fs.readdirSync(path.join(SRC, 'skills'))
  for (const s of skills) {
    const target = path.join(dir, agentName(s)); fs.rmSync(target, { recursive: true, force: true }); fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'SKILL.md'), transformSkill(fs.readFileSync(path.join(SRC, 'skills', s, 'SKILL.md'), 'utf8'), all))
  }
  writeBlock(path.join(base, agent === 'gemini' ? 'GEMINI.md' : 'AGENTS.md'), contextBlock(agent))
  say(`  ${PACKS.agents[agent].name}: ${skills.length} skills en ${posix(dir)} + instrucciones en ${agent === 'gemini' ? 'GEMINI.md' : 'AGENTS.md'}`)
}
function removeAgent(agent, skills) {
  if (agent === 'claude') {
    const claude = findClaude()
    if (claude && !opt['no-claude-cli']) { claudeRun(claude, ['plugin', 'uninstall', 'dualcraft@dualcraft-local']); claudeRun(claude, ['plugin', 'marketplace', 'remove', 'dualcraft-local']) }
    fs.rmSync(path.join(DC, 'claude-marketplace'), { recursive: true, force: true })
    say('  Claude Code: plugin local eliminado.')
    return
  }
  const base = path.join(HOME, agent === 'gemini' ? '.gemini' : '.codex')
  for (const s of skills) fs.rmSync(path.join(base, 'skills', agentName(s)), { recursive: true, force: true })
  writeBlock(path.join(base, agent === 'gemini' ? 'GEMINI.md' : 'AGENTS.md'), null)
  say(`  ${PACKS.agents[agent].name}: skills e instrucciones eliminadas.`)
}

async function apply(sel, prev) {
  validate(sel)
  const skills = resolveSkills(sel)
  say(`\nInstalando DualCraft ${VERSION} (${skills.length} skills)…`)
  copyShared(CURRENT)
  for (const a of prev?.agents || []) if (!sel.agents.includes(a)) removeAgent(a, prev.skills || [])
  for (const a of sel.agents) {
    if (a === 'claude') await installClaude(skills, sel)
    else installSkillsAgent(a, skills, prev?.agents?.includes(a) ? prev.skills : [])
  }
  writeState({ version: VERSION, installedAt: prev?.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), home: posix(CURRENT), ...sel, skills })
  const desc = skills.reduce((n, s) => n + ((fs.readFileSync(path.join(SRC, 'skills', s, 'SKILL.md'), 'utf8').match(/^description:\s*(?:>-?\s*\n\s+)?(.*)$/m) || [])[1] || '').length, 0)
  say(`\nListo. Coste fijo aproximado por sesión: ~${Math.round(desc / 4.2).toLocaleString('es-ES')} tokens de descripciones de skills (con todo instalado: ~2.600).`)
  say('Siguiente paso: en un proyecto, /dualcraft:start (Claude) o pide "empezar con DualCraft" (Gemini/Codex).')
}

// ---------- commands ----------
const prev = readState()
const fromFlags = (base) => ({
  agents: list(opt.agents) || base?.agents || Object.entries(detectAgents()).filter(([, v]) => v).map(([k]) => k),
  stacks: list(opt.stacks) ?? base?.stacks ?? [],
  packs: opt['all-packs'] ? OPT_IDS : list(opt.packs) ?? base?.packs ?? OPT_IDS,
})

if (cmd === 'install') {
  const interactiveMode = !opt.yes && process.stdin.isTTY && !opt.agents && !opt.stacks && !opt.packs
  const sel = interactiveMode ? await interactive(prev) : fromFlags(prev)
  if (!sel.agents.length) fail('ningún agente seleccionado ni detectado: usa --agents claude,gemini,codex')
  await apply(sel, prev)
} else if (cmd === 'add' || cmd === 'remove') {
  if (!prev) fail('DualCraft no está instalado: ejecuta primero "install"')
  if (!pos.length) fail(`indica qué ${cmd === 'add' ? 'añadir' : 'quitar'}: stacks (${STACK_IDS.join(', ')}) o packs (${OPT_IDS.join(', ')})`)
  const sel = { agents: prev.agents, stacks: [...prev.stacks], packs: [...prev.packs] }
  for (const id of pos) {
    const key = PACKS.stacks[id] ? 'stacks' : PACKS.optional[id] ? 'packs' : fail(`"${id}" no es un stack ni un pack`)
    sel[key] = cmd === 'add' ? [...new Set([...sel[key], id])] : sel[key].filter((x) => x !== id)
  }
  await apply(sel, prev)
} else if (cmd === 'update') {
  if (!prev) fail('DualCraft no está instalado: ejecuta "install"')
  say(`Actualizando de ${prev.version} a ${VERSION} con la misma selección…`)
  await apply({ agents: prev.agents, stacks: prev.stacks, packs: prev.packs }, prev)
} else if (cmd === 'list') {
  const has = (k, id) => prev?.[k]?.includes(id)
  say(`DualCraft ${VERSION}${prev ? ` — instalado ${prev.version} en: ${prev.agents.join(', ')}` : ' — no instalado'}\n`)
  say(`  ✓ core — ${PACKS.core.description}`)
  say('\nStacks:'); for (const id of STACK_IDS) say(`  ${has('stacks', id) ? '✓' : '·'} ${id.padEnd(13)} ${PACKS.stacks[id].name}`)
  say('\nPacks opcionales:'); for (const id of OPT_IDS) say(`  ${has('packs', id) ? '✓' : '·'} ${id.padEnd(9)} ${PACKS.optional[id].name} — ${PACKS.optional[id].description}`)
  say('\nAñadir: npx github:vmarquezperalta13/dualcraft add <id…>   ·   quitar: … remove <id…>')
} else if (cmd === 'uninstall') {
  if (!prev) fail('DualCraft no está instalado')
  if (!(await confirm('¿Quitar DualCraft de todos los agentes? (los proyectos y su carpeta .dualcraft no se tocan)'))) { say('Cancelado.'); process.exit(0) }
  for (const a of prev.agents) removeAgent(a, prev.skills || [])
  fs.rmSync(DC, { recursive: true, force: true })
  say('DualCraft desinstalado.')
} else if (cmd === 'doctor') {
  const det = detectAgents()
  say(`DualCraft ${VERSION} · Node ${process.version}${Number(process.versions.node.split('.')[0]) < 18 ? '  ✗ necesita Node 18+' : ''}`)
  say(`Agentes detectados: ${Object.entries(det).map(([k, v]) => `${k} ${v ? '✓' : '·'}`).join(' · ')}`)
  if (!prev) { say('No instalado.'); process.exit(0) }
  say(`Instalado: ${prev.version} · ${prev.skills.length} skills · stacks: ${prev.stacks.join(', ') || '—'} · packs: ${prev.packs.join(', ') || '—'}`)
  say(`${fs.existsSync(path.join(CURRENT, 'scripts', 'brain.mjs')) ? '✓' : '✗'} scripts en ${posix(CURRENT)}`)
  for (const a of prev.agents) {
    if (a === 'claude') { const c = findClaude(); const l = c ? claudeRun(c, ['plugin', 'list']).out : ''; say(`${/dualcraft@dualcraft-local/.test(l) ? '✓' : '✗'} Claude Code plugin dualcraft@dualcraft-local${c ? '' : ' (CLI de Claude no encontrado)'}`) }
    else { const base = path.join(HOME, a === 'gemini' ? '.gemini' : '.codex'); const missing = prev.skills.filter((s) => !fs.existsSync(path.join(base, 'skills', agentName(s), 'SKILL.md'))); const block = (fs.existsSync(path.join(base, a === 'gemini' ? 'GEMINI.md' : 'AGENTS.md')) ? fs.readFileSync(path.join(base, a === 'gemini' ? 'GEMINI.md' : 'AGENTS.md'), 'utf8') : '').includes('dualcraft:start'); say(`${missing.length || !block ? '✗' : '✓'} ${PACKS.agents[a].name}: ${prev.skills.length - missing.length}/${prev.skills.length} skills · instrucciones ${block ? '✓' : '✗'}`) }
  }
  if (prev.version !== VERSION) say(`ℹ Hay otra versión (${VERSION}): npx github:vmarquezperalta13/dualcraft update`)
} else fail(`comando desconocido "${cmd}" — install | add | remove | list | update | uninstall | doctor`)
