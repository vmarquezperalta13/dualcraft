#!/usr/bin/env node
// Markdown summary of `claude plugin eval --json` result files (schemaVersion 1) for the GitHub job summary.
//   node scripts/dev/eval-summary.mjs triggers.json [behavior.json]
import fs from 'node:fs'

const out = ['## Skill evals', '']
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { out.push(`- \`${f}\`: not produced (step skipped or failed before writing it)`, ''); continue }
  let r
  try { r = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { out.push(`- \`${f}\`: not valid JSON`, ''); continue }
  const a = r.aggregates || {}
  const cases = r.cases || []
  const failed = cases.filter((c) => (c.aggregates?.score ?? 0) < 1)
  out.push(`### ${f.replace(/\.json$/, '')}`, '',
    `**${a.casesPassed ?? cases.length - failed.length}/${a.casesTotal ?? cases.length} cases passed** · score ${a.overallScore != null ? Math.round(a.overallScore * 100) + ' %' : '—'} · cost ≈ $${(r.costUsd ?? 0).toFixed(2)} · ${Math.round(r.durationSeconds ?? 0)} s${r.partial ? ` · ⚠️ partial (${r.partialReason})` : ''}${r.claudeVersion ? ` · Claude Code ${r.claudeVersion}` : ''}`, '')
  if (failed.length) {
    out.push('| Case | Score | Why |', '|---|---|---|')
    for (const c of failed) {
      const run = (c.arms?.with || [])[0] || {}
      const why = run.error || (run.graders || []).filter((g) => !g.passed).map((g) => g.name || g.type).join(', ') || '—'
      out.push(`| ${c.name} | ${Math.round((c.aggregates?.score ?? 0) * 100)} % | ${String(why).replace(/\|/g, '/').slice(0, 120)} |`)
    }
    out.push('', 'A trigger case failing means Claude did not choose that skill for a natural request: sharpen the skill\'s `description` (scripts/dev/descriptions.json) and rerun that case.', '')
  }
}
console.log(out.join('\n'))
