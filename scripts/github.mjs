#!/usr/bin/env node
// DualCraft ⇄ GitHub Issues sync (REST API, zero dependencies).
//   status                      linked / unlinked notes and differences with GitHub
//   push [IDs…] [--all] [--dry] create issues for open tasks/bugs without one (or the given IDs),
//                               close issues of notes that are done/dropped, sync assignee and milestone (= target version)
//   pull [--import] [--dry]     bring state and assignee back from GitHub (closed issue → note done);
//                               --import creates notes for open issues that aren't linked yet
// Options: --repo owner/name (default: git remote origin) · --api URL (tests) · --ideas (also push ideas)
// Token: GH_TOKEN / GITHUB_TOKEN, else `gh auth token`, else the git credential helper for github.com.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { project, parseArgs, die } from './lib/project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
if (cmd === 'help' || !['status', 'push', 'pull'].includes(cmd)) { console.log('node github.mjs status | push [IDs…] [--all] [--dry] [--ideas] | pull [--import] [--dry]   [--repo owner/name]'); process.exit(cmd === 'help' ? 0 : 1) }

const { root } = project()
const API = String(opt.api || 'https://api.github.com').replace(/\/$/, '')
const DRY = !!opt.dry

// ---------- repo & token ----------
function repoSlug() {
  if (opt.repo) return String(opt.repo)
  let url = ''
  try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { die('no git remote "origin" — pass --repo owner/name') }
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : die(`origin is not a GitHub repo (${url}) — pass --repo owner/name`)
}
function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (opt.api) return 'test-token'
  const gh = spawnSync('gh auth token', { encoding: 'utf8', shell: true })
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim()
  const cred = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const pw = (cred.stdout || '').match(/^password=(.+)$/m)
  return pw ? pw[1].trim() : die('no GitHub token: set GH_TOKEN, install the GitHub CLI (gh auth login) or push once with git over https')
}
const REPO = repoSlug(); const TOKEN = DRY && !opt.api ? null : token()
async function gh(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dualcraft', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) die(`GitHub ${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

// ---------- brain ----------
const brain = (...a) => execFileSync(process.execPath, [path.join(HERE, 'brain.mjs'), ...a], { cwd: root, encoding: 'utf8' })
const notes = () => JSON.parse(brain('graph')).nodes
const issueNo = (n) => { const m = String(n.issue || '').match(/(\d+)\s*$/); return m ? +m[1] : null }
const OPEN = (n) => !['done', 'dropped', 'superseded'].includes(n.status)
const bodyFor = (n) => {
  const body = String(n.body || '').replace(/\n## Log[\s\S]*$/, '').trim()
  const meta = [`DualCraft ${n.id}`, n.type, n.target ? `target ${n.target}` : '', n.estimate ? `estimate ${n.estimate}` : '', n.depends_on?.length ? `depends on ${n.depends_on.join(', ')}` : ''].filter(Boolean).join(' · ')
  return `<!-- dualcraft:${n.id} -->\n${body || '_(no description)_'}\n\n---\n${meta}`
}
const labelsFor = (n) => [...new Set(['dualcraft', `type:${n.type}`, ...(n.priority ? [`priority:${n.priority}`] : []), ...(n.tags || [])])]

const milestones = new Map()
async function milestone(target) {
  if (!target) return undefined
  if (!milestones.size) for (const m of await gh('GET', `/repos/${REPO}/milestones?state=all&per_page=100`) || []) milestones.set(m.title, m.number)
  const title = `v${target}`
  if (!milestones.has(title)) { if (DRY) return `(new ${title})`; const m = await gh('POST', `/repos/${REPO}/milestones`, { title, description: `DualCraft target version ${target}` }); milestones.set(title, m.number) }
  return milestones.get(title)
}

async function main() {
const all = notes()
const kinds = new Set(['task', 'bug', ...(opt.ideas ? ['idea'] : [])])
if (cmd === 'status') {
  const linked = all.filter((n) => issueNo(n)); const unlinked = all.filter((n) => kinds.has(n.type) && OPEN(n) && !issueNo(n))
  console.log(`Repo ${REPO} · ${linked.length} notes linked to issues · ${unlinked.length} open tasks/bugs without issue`)
  for (const n of unlinked.slice(0, 15)) console.log(`  · ${n.id} ${n.title}`)
  if (linked.length && TOKEN) {
    for (const n of linked) {
      const i = await gh('GET', `/repos/${REPO}/issues/${issueNo(n)}`)
      const diffs = []
      if (i.state === 'closed' && OPEN(n)) diffs.push('closed on GitHub, open in brain')
      if (i.state === 'open' && !OPEN(n)) diffs.push(`${n.status} in brain, open on GitHub`)
      const who = i.assignee?.login || null; if ((n.assignee || null) !== who) diffs.push(`assignee brain=${n.assignee || '—'} github=${who || '—'}`)
      if (diffs.length) console.log(`  ≠ ${n.id} #${i.number}: ${diffs.join('; ')}`)
    }
  }
  return
}

if (cmd === 'push') {
  // open notes (to create/sync) + linked notes that are finished (to close their issue)
  const wanted = pos.length ? all.filter((n) => pos.includes(n.id)) : all.filter((n) => kinds.has(n.type) && (opt.all || OPEN(n) || issueNo(n)))
  let created = 0; let closed = 0; let updated = 0
  for (const n of wanted) {
    const num = issueNo(n)
    if (!num) {
      if (!OPEN(n) && !pos.includes(n.id)) continue
      const payload = { title: `[${n.id}] ${n.title}`, body: bodyFor(n), labels: labelsFor(n), ...(n.assignee ? { assignees: [n.assignee] } : {}) }
      const ms = await milestone(n.target); if (typeof ms === 'number') payload.milestone = ms
      if (DRY) { console.log(`+ would create issue "${payload.title}"${n.target ? ` (milestone v${n.target})` : ''}${n.assignee ? ` @${n.assignee}` : ''}`); continue }
      const i = await gh('POST', `/repos/${REPO}/issues`, payload)
      brain('set', n.id, `issue=#${i.number}`, '--log', `GitHub issue #${i.number} ${i.html_url || ''}`.trim())
      console.log(`+ ${n.id} → #${i.number}`); created++
    } else {
      const i = DRY && !opt.api ? null : await gh('GET', `/repos/${REPO}/issues/${num}`)
      if (!i) { console.log(`~ ${n.id} #${num}: would sync state/assignee/milestone`); continue }
      const patch = {}
      if (!OPEN(n) && i.state === 'open') patch.state = 'closed'
      if (n.assignee && i.assignee?.login !== n.assignee) patch.assignees = [n.assignee]
      const ms = await milestone(n.target); if (typeof ms === 'number' && i.milestone?.number !== ms) patch.milestone = ms
      if (!Object.keys(patch).length) continue
      if (DRY) { console.log(`~ ${n.id} #${num}: would update ${Object.keys(patch).join(', ')}`); continue }
      if (patch.state === 'closed') await gh('POST', `/repos/${REPO}/issues/${num}/comments`, { body: `Closed from DualCraft: ${n.id} is ${n.status}.` })
      await gh('PATCH', `/repos/${REPO}/issues/${num}`, patch)
      console.log(`~ ${n.id} #${num}: ${Object.keys(patch).join(', ')}`); patch.state ? closed++ : updated++
    }
  }
  console.log(DRY ? '(dry run — nothing sent)' : `${created} created · ${closed} closed · ${updated} updated`)
  return
}

if (cmd === 'pull') {
  let changed = 0
  for (const n of all.filter((x) => issueNo(x))) {
    const i = await gh('GET', `/repos/${REPO}/issues/${issueNo(n)}`)
    const sets = []
    if (i.state === 'closed' && OPEN(n)) sets.push('status=done')
    const who = i.assignee?.login || ''
    if (who && who !== n.assignee) sets.push(`assignee=${who}`)
    if (!sets.length) continue
    if (i.state === 'open' && !OPEN(n)) console.log(`! ${n.id} is ${n.status} but #${i.number} is open — close it with "push" or reopen the note`)
    if (DRY) { console.log(`~ ${n.id}: would set ${sets.join(' ')}`); continue }
    brain('set', n.id, ...sets, '--log', `synced from GitHub #${i.number}`); console.log(`~ ${n.id}: ${sets.join(' ')}`); changed++
  }
  if (opt.import) {
    const linked = new Set(all.map(issueNo).filter(Boolean))
    for (let page = 1; page < 20; page++) {
      const issues = await gh('GET', `/repos/${REPO}/issues?state=open&per_page=100&page=${page}`)
      if (!issues?.length) break
      for (const i of issues) {
        if (i.pull_request || linked.has(i.number) || /<!-- dualcraft:[TBDNI]-\d+ -->/.test(i.body || '')) continue
        const type = (i.labels || []).some((l) => /bug/i.test(l.name || l)) ? 'bug' : 'task'
        const target = (i.milestone?.title || '').replace(/^v/, '')
        if (DRY) { console.log(`+ would import #${i.number} "${i.title}" as ${type}`); continue }
        const out = brain('new', type, i.title, ...(target ? ['--target', target] : []), '--body', `## Context\nImported from GitHub #${i.number}\n\n${String(i.body || '').slice(0, 2000)}`)
        const id = (out.match(/^([TB]-\d+)/) || [])[1]
        if (id) { brain('set', id, `issue=#${i.number}`, ...(i.assignee?.login ? [`assignee=${i.assignee.login}`] : [])); console.log(`+ #${i.number} → ${id}`); changed++ }
      }
    }
  }
  console.log(DRY ? '(dry run — nothing changed)' : `${changed} note(s) updated from GitHub`)
}
}
await main()
