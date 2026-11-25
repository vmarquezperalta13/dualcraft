// The `claude plugin eval` suite: generated and current, one trigger case per skill, valid case files and graders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT } from './helpers.mjs'

const EVALS = path.join(ROOT, 'evals')
const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'disallowed_tools', 'append_system_prompt', 'env'])
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline'])
const front = (s) => Object.fromEntries((s.match(/^---\n([\s\S]*?)\n---/)?.[1] || '').split('\n').filter((l) => /^\w/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))

test('evals/ is generated and up to date', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev', 'gen-evals.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('one trigger case per skill; every case has a prompt, known frontmatter keys and deterministic graders', () => {
  const skills = fs.readdirSync(path.join(ROOT, 'skills')).filter((s) => s !== 'using-dualcraft')
  assert.deepEqual(fs.readdirSync(path.join(EVALS, 'triggers')).sort(), skills.sort())
  const cases = [...fs.readdirSync(path.join(EVALS, 'triggers')).map((c) => path.join(EVALS, 'triggers', c)), ...fs.readdirSync(path.join(EVALS, 'behavior')).map((c) => path.join(EVALS, 'behavior', c))]
  for (const c of cases) {
    const p = fs.readFileSync(path.join(c, 'prompt.md'), 'utf8')
    for (const k of Object.keys(front(p))) assert.ok(PROMPT_KEYS.has(k), `${c}: unknown prompt.md key ${k}`)
    assert.ok(p.replace(/^---[\s\S]*?---\n/, '').trim().length > 10, `${c}: empty prompt`)
    const graders = fs.readdirSync(path.join(c, 'graders'))
    assert.ok(graders.length, `${c}: no grader`)
    for (const g of graders) {
      const t = front(fs.readFileSync(path.join(c, 'graders', g), 'utf8')).type
      assert.ok(GRADER_TYPES.has(t), `${c}/${g}: type ${t}`); assert.notEqual(t, 'llm', `${c}/${g}: keep the suite free of judge calls`)
    }
  }
  const auth = fs.readFileSync(path.join(EVALS, 'triggers', 'auth', 'graders', 'skill-loaded.md'), 'utf8')
  assert.match(auth, /^type: tool_used\ntool: Skill\ninput_match: '"skill"\\s\*:\\s\*"\(\?:\[\\w-\]\+:\)\?auth"'$/m)
  for (const b of fs.readdirSync(path.join(EVALS, 'behavior'))) {
    assert.match(fs.readFileSync(path.join(EVALS, 'behavior', b, 'case.yaml'), 'utf8'), /scaffold_script: scaffold\.sh/)
    assert.match(fs.readFileSync(path.join(EVALS, 'behavior', b, 'scaffold.sh'), 'utf8'), /cat > '\.dualcraft\/config\.json' <<'DUALCRAFT_EOF'/)
  }
})

test('eval-summary turns a result document into a table of failing cases', () => {
  const f = path.join(ROOT, 'test', 'fixtures', 'eval-result.json')
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev', 'eval-summary.mjs'), f, 'missing.json'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\*\*1\/2 cases passed\*\* · score 50 % · cost ≈ \$0\.42/)
  assert.match(r.stdout, /\| perf \| 0 % \| skill-loaded \|/)
  assert.match(r.stdout, /`missing\.json`: not produced/)
})
