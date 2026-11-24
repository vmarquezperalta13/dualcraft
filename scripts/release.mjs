#!/usr/bin/env node
// DualCraft release helper.
//   suggest                 next version from Conventional Commits since the last tag (or config.version)
//   check [--version X]     release readiness checklist (exit 1 if blockers)
//   bump <patch|minor|major|X.Y.Z> [--dry]   update config, pubspec (build+1), package.json, CHANGELOG
//   notes [--version X]     raw material for release notes: CHANGELOG section + brain items of the version
//   store-check             validate .dualcraft/store/listing.json and .dualcraft/release/<version>.json against store limits
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die, posix } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
if (cmd === 'help' || !['suggest', 'check', 'bump', 'notes', 'store-check'].includes(cmd)) {
  console.log('node release.mjs suggest | check [--version X] | bump <patch|minor|major|X.Y.Z> [--dry] | notes [--version X] | store-check'); process.exit(cmd === 'help' ? 0 : 1)
}
const { root, dir, config } = project()
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
const node = (script, ...a) => { try { return { ok: true, out: execFileSync(process.execPath, [path.join(HERE, script), ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') } } }
const parseV = (v) => (String(v).match(/^(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number)
const bumpV = (v, kind) => { const [a, b, c] = parseV(v); return kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}` }
const cmpV = (x, y) => { const a = parseV(x); const b = parseV(y); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0 }
const stackDir = (k) => path.join(root, config.paths?.[k] || '')
const pubspec = () => path.join(stackDir('mobile'), 'pubspec.yaml')
const pkgJson = () => path.join(stackDir('web'), 'package.json')
const changelog = path.join(root, 'CHANGELOG.md')

function commitsSinceTag() {
  const tag = git('describe', '--tags', '--abbrev=0')
  const log = git('log', ...(tag ? [`${tag}..HEAD`] : []), '--format=%s%n%b%n--END--')
  return { tag, commits: (log || '').split('--END--').map((s) => s.trim()).filter(Boolean) }
}
function suggestKind(commits) {
  if (commits.some((c) => /^[a-z]+(\([^)]*\))?!:|BREAKING CHANGE/m.test(c))) return 'major'
  if (commits.some((c) => /^feat(\([^)]*\))?:/.test(c))) return 'minor'
  if (commits.some((c) => /^(fix|perf)(\([^)]*\))?:/.test(c))) return 'patch'
  return null
}
const nextVersion = () => { const { commits } = commitsSinceTag(); const k = suggestKind(commits); return { kind: k, version: k ? bumpV(config.version, k) : config.version } }

// ---------- suggest ----------
if (cmd === 'suggest') {
  const { tag, commits } = commitsSinceTag()
  const k = suggestKind(commits)
  const types = {}; for (const c of commits) { const t = (c.match(/^(\w+)/) || [])[1] || 'other'; types[t] = (types[t] || 0) + 1 }
  console.log(`Current version: ${config.version}${tag ? ` · last tag ${tag}` : ' · no tags yet'} · ${commits.length} commit(s) since`)
  console.log(`By type: ${Object.entries(types).map(([t, n]) => `${t} ${n}`).join(' · ') || '—'}`)
  console.log(k ? `Suggested: ${k} → ${bumpV(config.version, k)}` : 'No user-visible changes (feat/fix/perf/breaking) — no release needed.')
  process.exit(0)
}

// ---------- notes ----------
function changelogSection(version) {
  if (!fs.existsSync(changelog)) return null
  const s = fs.readFileSync(changelog, 'utf8')
  const head = version ? new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*$`, 'm') : /^## \[Unreleased\][^\n]*$/m
  const m = s.match(head); if (!m) return null
  const start = m.index + m[0].length; const next = s.slice(start).search(/^## \[/m)
  return s.slice(start, next < 0 ? undefined : start + next).trim()
}
const brainGraph = () => JSON.parse(node('brain.mjs', 'graph').out || '{"nodes":[]}')
if (cmd === 'notes') {
  const v = opt.version || nextVersion().version
  const sec = changelogSection(opt.version ? v : null) ?? changelogSection(v)
  const items = brainGraph().nodes.filter((n) => n.target === v && ['task', 'bug'].includes(n.type) && n.status === 'done')
  console.log(`# Material for release notes — ${config.name} ${v}\n`)
  console.log('## CHANGELOG\n' + (sec || '(no section found — is [Unreleased] filled?)') + '\n')
  console.log('## Brain items done for this version')
  items.forEach((n) => console.log(`- ${n.id} [${n.type}] ${n.title}${n.tags?.length ? ' (' + n.tags.join(', ') + ')' : ''}`))
  if (!items.length) console.log('(none)')
  console.log('\nLimits: Google Play release notes ≤ 500 chars per language · App Store "What\'s New" ≤ 4000.')
  process.exit(0)
}

// ---------- store-check ----------
const LIMITS = {
  play: { title: 30, short: 80, full: 4000, notes: 500 },
  appstore: { name: 30, subtitle: 30, promo: 170, keywords: 100, description: 4000, notes: 4000 },
  web: { title: 60, description: 160 },
}
if (cmd === 'store-check') {
  const problems = []; let checked = 0
  const len = (s) => [...String(s)].length
  const checkObj = (obj, where, release) => {
    for (const [locale, stores] of Object.entries(obj || {})) {
      if (locale.startsWith('$')) continue
      for (const [store, fields] of Object.entries(stores || {})) {
        const lim = LIMITS[store]; if (!lim) { problems.push(`${where} ${locale}: unknown store "${store}" (play, appstore, web)`); continue }
        const entries = typeof fields === 'string' ? [['notes', fields]] : Object.entries(fields)
        for (const [field, value] of entries) {
          const max = lim[field]; checked++
          if (!max) { problems.push(`${where} ${locale}.${store}: unknown field "${field}"`); continue }
          const n = field === 'keywords' ? Buffer.byteLength(String(value)) : len(value)
          if (n > max) problems.push(`${where} ${locale}.${store}.${field}: ${n}/${max}${field === 'keywords' ? ' bytes' : ' chars'}`)
          if (field === 'keywords' && /,\s/.test(value)) problems.push(`${where} ${locale}.appstore.keywords: no spaces after commas (wastes characters)`)
          if (!String(value).trim()) problems.push(`${where} ${locale}.${store}.${field}: empty`)
        }
      }
    }
  }
  const listing = path.join(dir, 'store', 'listing.json')
  if (fs.existsSync(listing)) checkObj(JSON.parse(fs.readFileSync(listing, 'utf8')), 'listing.json', false)
  const relDir = path.join(dir, 'release')
  if (fs.existsSync(relDir)) for (const f of fs.readdirSync(relDir).filter((x) => x.endsWith('.json'))) checkObj(JSON.parse(fs.readFileSync(path.join(relDir, f), 'utf8')), `release/${f}`, true)
  if (!checked) { console.log('Nothing to check: no .dualcraft/store/listing.json nor .dualcraft/release/<version>.json'); process.exit(0) }
  problems.forEach((p) => console.log('✗ ' + p))
  console.log(problems.length ? `${problems.length} problem(s) in ${checked} text(s)` : `${checked} store text(s) within limits`)
  process.exit(problems.length ? 1 : 0)
}

// ---------- check ----------
if (cmd === 'check') {
  const v = opt.version || nextVersion().version
  const rows = []; const add = (level, area, msg) => rows.push({ level, area, msg })
  const nodes = brainGraph().nodes
  const forV = nodes.filter((n) => n.target === v)
  const open = forV.filter((n) => ['task', 'bug'].includes(n.type) && ['todo', 'doing'].includes(n.status))
  open.forEach((n) => add('block', 'brain', `${n.id} ${n.title} is ${n.status} (target ${v}) — finish, or move it: set ${n.id} target=<later>`))
  forV.filter((n) => n.status === 'parked').forEach((n) => add('warn', 'brain', `${n.id} ${n.title} is parked for ${v} — resume it (dualcraft:park) or move its target`))
  nodes.filter((n) => n.status === 'parked' && n.target && cmpV(n.target, v) < 0).forEach((n) => add('warn', 'brain', `${n.id} parked for ${n.target} (older than ${v}) — forgotten?`))
  nodes.filter((n) => n.type === 'bug' && (n.tags || []).includes('security') && !['done', 'dropped'].includes(n.status)).forEach((n) => add(n.priority === 'high' ? 'block' : 'warn', 'security', `${n.id} ${n.title} (${n.priority || 'medium'}) still open`))
  if (!forV.length) add('info', 'brain', `no brain items target ${v}`)

  const hasSrc = (p) => fs.existsSync(path.join(dir, p))
  if (hasSrc('i18n')) { const r = node('i18n.mjs', 'check'); if (!r.ok) add('block', 'i18n', 'texts incomplete: ' + r.out.split('\n').filter((l) => l.startsWith('✗')).slice(0, 3).join(' | ')) }
  if (hasSrc('analytics/events.json')) {
    const r = node('analytics.mjs', 'check'); if (!r.ok) add('block', 'analytics', 'tracking plan invalid — run analytics.mjs check')
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'analytics', 'events.json'), 'utf8'))
    const newEvents = (plan.events || []).filter((e) => e.since === v).map((e) => e.name)
    if (newEvents.length) { const cov = node('analytics.mjs', 'coverage').out; for (const name of newEvents) { const line = cov.split('\n').find((l) => l.startsWith(name + ' ')); if (line && /✗/.test(line)) add('warn', 'analytics', `event ${name} (new in ${v}) not tracked on some platform`) } }
  }
  if (hasSrc('design/tokens.json')) { const r = node('tokens.mjs', 'check'); if (!r.ok) add('warn', 'design', 'tokens have errors'); else if (/✗ contrast/.test(r.out)) add('warn', 'design', 'some text/background pairs fail WCAG contrast') }
  if (hasSrc('db/schema.dbml')) { const r = node('er.mjs', 'check'); if (!r.ok) add('block', 'schema', 'schema has errors') }
  const docsFile = path.join(root, config.docs?.functional || 'docs/FUNCTIONAL.md')
  if (fs.existsSync(docsFile)) { const doc = fs.readFileSync(docsFile, 'utf8'); forV.filter((n) => ['task', 'bug'].includes(n.type) && n.status === 'done' && !(n.tags || []).includes('internal') && !doc.includes(n.id)).forEach((n) => add('warn', 'docs', `${n.id} ${n.title} not reflected in the functional document`)) }
  else add('info', 'docs', 'no functional document yet')

  const sec = changelogSection(null)
  if (!fs.existsSync(changelog)) add('warn', 'changelog', 'no CHANGELOG.md')
  else if (!sec || !/^\s*-\s+/m.test(sec)) add('warn', 'changelog', '[Unreleased] section is empty')

  const versions = { config: config.version }
  if (config.stacks?.mobile && fs.existsSync(pubspec())) versions.pubspec = (fs.readFileSync(pubspec(), 'utf8').match(/^version:\s*(\S+)/m) || [])[1]
  if (config.stacks?.web && fs.existsSync(pkgJson())) versions.web = JSON.parse(fs.readFileSync(pkgJson(), 'utf8')).version
  const base = Object.values(versions).filter(Boolean).map((x) => x.split('+')[0])
  if (new Set(base).size > 1) add('warn', 'version', `versions differ: ${Object.entries(versions).map(([k, x]) => `${k} ${x}`).join(' · ')} — bump aligns them`)

  if (git('rev-parse', '--is-inside-work-tree') === 'true') {
    const dirty = git('status', '--porcelain'); if (dirty) add('warn', 'git', `${dirty.split('\n').length} uncommitted change(s)`)
    if (git('tag', '-l', `v${v}`)) add('block', 'git', `tag v${v} already exists`)
  }
  const storeR = node('release.mjs', 'store-check'); if (!storeR.ok) add('warn', 'store', 'store texts exceed limits — run store-check')

  const icon = { block: '✗', warn: '⚠', info: 'ℹ' }
  console.log(`Release check — ${config.name} ${v} (current ${config.version})`)
  for (const lvl of ['block', 'warn', 'info']) rows.filter((r) => r.level === lvl).forEach((r) => console.log(`${icon[lvl]} [${r.area}] ${r.msg}`))
  const blocks = rows.filter((r) => r.level === 'block').length
  console.log(blocks ? `\n${blocks} blocker(s) — not ready.` : `\nNo blockers${rows.some((r) => r.level === 'warn') ? ' (review the warnings)' : ''} — ready to release ${v}.`)
  process.exit(blocks ? 1 : 0)
}

// ---------- bump ----------
if (cmd === 'bump') {
  const arg = pos[0] || nextVersion().kind
  if (!arg) die('nothing to release (no feat/fix/perf/breaking commits since the last tag). Pass patch|minor|major|X.Y.Z to force.')
  const v = /^\d+\.\d+\.\d+$/.test(arg) ? arg : ['patch', 'minor', 'major'].includes(arg) ? bumpV(config.version, arg) : die('use patch|minor|major or X.Y.Z')
  if (cmpV(v, config.version) <= 0) die(`${v} is not greater than the current ${config.version}`)
  const changes = []; const date = new Date().toISOString().slice(0, 10)
  const write = (f, s) => { if (!opt.dry) fs.writeFileSync(f, s) }
  // config
  const cfgFile = path.join(dir, 'config.json'); const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); cfg.version = v
  write(cfgFile, JSON.stringify(cfg, null, 2) + '\n'); changes.push(`.dualcraft/config.json ${config.version} → ${v}`)
  // pubspec: X.Y.Z+N (build number always increases)
  if (config.stacks?.mobile && fs.existsSync(pubspec())) {
    const s = fs.readFileSync(pubspec(), 'utf8'); const m = s.match(/^version:\s*([\d.]+)(?:\+(\d+))?/m)
    if (m) { const build = (+(m[2] || 0)) + 1; write(pubspec(), s.replace(m[0], `version: ${v}+${build}`)); changes.push(`${posix(path.relative(root, pubspec()))} ${m[1]}${m[2] ? '+' + m[2] : ''} → ${v}+${build}`) }
  }
  // package.json
  if (config.stacks?.web && fs.existsSync(pkgJson())) {
    const s = fs.readFileSync(pkgJson(), 'utf8'); const m = s.match(/"version"\s*:\s*"([^"]*)"/)
    if (m) { write(pkgJson(), s.replace(m[0], `"version": "${v}"`)); changes.push(`${posix(path.relative(root, pkgJson()))} ${m[1]} → ${v}`) }
  }
  // CHANGELOG: [Unreleased] → [v] - date, new empty Unreleased on top
  if (fs.existsSync(changelog)) {
    const s = fs.readFileSync(changelog, 'utf8')
    if (/^## \[Unreleased\]/m.test(s)) { write(changelog, s.replace(/^## \[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n## [${v}] - ${date}`)); changes.push(`CHANGELOG.md [Unreleased] → [${v}] - ${date}`) }
    else changes.push('CHANGELOG.md has no [Unreleased] section — add the release entry by hand')
  }
  console.log(`${opt.dry ? '(dry run) ' : ''}Release ${v}:`)
  changes.forEach((c) => console.log('  ' + c))
  console.log(`Next: commit "chore(release): v${v}", tag v${v} (ask before pushing).`)
}
