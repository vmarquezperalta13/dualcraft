// Code graph: index of every stack (symbols, dependencies), search, callers, impact, contracts and task context.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read, exists } from './helpers.mjs'
import { symbolsOf, importsOf } from '../scripts/lib/graph-index.mjs'

const g = (p, ...a) => run('graph.mjs', a, p)
const j = (p, ...a) => JSON.parse(g(p, ...a, '--json').out)

test('symbols per language: kinds, containers, comments ignored', () => {
  const ts = symbolsOf("export function loadMatches() {}\nexport const MatchCard = ({ m }: P) => null\nexport class MatchService {\n  refresh(id: string): void {\n  }\n}\ninterface P { m: string }\n/* function hidden() {} */\nexport type Id = string\n", 'ts')
  assert.deepEqual(ts.map((s) => [s.name, s.kind, s.in]), [['loadMatches', 'function', undefined], ['MatchCard', 'component', undefined], ['MatchService', 'class', undefined], ['refresh', 'method', 'MatchService'], ['P', 'interface', undefined], ['Id', 'type', undefined]])
  const dart = symbolsOf("class LeagueService {\n  Future<void> export(String id) async {}\n}\nenum Mode { a }\nextension X on String {}\nWidget buildCard(BuildContext c) => Container();\n", 'dart')
  assert.deepEqual(dart.map((s) => [s.name, s.kind, s.in]), [['LeagueService', 'class', undefined], ['export', 'method', 'LeagueService'], ['Mode', 'enum', undefined], ['X', 'extension', undefined], ['buildCard', 'function', undefined]])
  const kt = symbolsOf('package a.b\ndata class Match(val id: String)\nobject Repo {\n    suspend fun load(): List<Match> = emptyList()\n}\n@Composable\nfun MatchesScreen() {}\n', 'kotlin')
  assert.deepEqual(kt.map((s) => [s.name, s.kind, s.in]), [['Match', 'class', undefined], ['Repo', 'object', undefined], ['load', 'function', 'Repo'], ['MatchesScreen', 'component', undefined]])
  const sw = symbolsOf('struct MatchListView: View {\n    func reload() {}\n}\nprotocol Store {}\nactor Cache {}\nextension Date {}\n', 'swift')
  assert.deepEqual(sw.map((s) => [s.name, s.kind, s.in]), [['MatchListView', 'struct', undefined], ['reload', 'function', 'MatchListView'], ['Store', 'protocol', undefined], ['Cache', 'actor', undefined], ['Date', 'extension', undefined]])
  assert.deepEqual(importsOf("import a from './a'\nimport type { B } from '@/b'\nexport * from '../c'\nconst d = await import('./d')\n", 'ts'), ['./a', '@/b', '../c', './d'])
  assert.deepEqual(importsOf("import 'package:app/x.dart';\nimport '../y.dart' as y;\npart 'z.g.dart';\n", 'dart'), ['package:app/x.dart', '../y.dart', 'z.g.dart'])
})

function project() {
  const p = makeProject({ web: 'nextjs', mobile: 'flutter', paths: { web: 'site', mobile: 'app' } })
  write(path.join(p, 'site/tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }))
  write(path.join(p, 'site/src/lib/matches.ts'), "export function loadMatches() { return [] }\n")
  write(path.join(p, 'site/src/app/matches/page.tsx'), "import { loadMatches } from '@/lib/matches'\nexport default function MatchesPage() { return loadMatches() }\n")
  write(path.join(p, 'site/src/app/stats/page.tsx'), "import Page from '../matches/page'\nexport default function StatsPage() { return Page() }\n")
  write(path.join(p, 'app/pubspec.yaml'), 'name: liga\n')
  write(path.join(p, 'app/lib/data/match_repository.dart'), "class MatchRepository {\n  Future<void> load() async {}\n}\n")
  write(path.join(p, 'app/lib/ui/matches_screen.dart'), "import 'package:liga/data/match_repository.dart';\nclass MatchesScreen { final repo = MatchRepository(); void track() { AnalyticsEvents.signUp(method: 'x'); } }\n")
  write(path.join(p, 'app/lib/ui/home.dart'), "// MatchRepository is mentioned here only in a comment\nclass Home {}\n")
  return p
}

test('init indexes every stack (not committed); search; callers linked vs textual; impact through imports', () => {
  const p = project()
  const r = g(p, 'init')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /nextjs +3 files/); assert.match(r.out, /flutter +3 files/)
  assert.match(read(path.join(p, '.dualcraft/.gitignore')), /^graph\/$/m)
  const idx = JSON.parse(read(path.join(p, '.dualcraft/graph/index.json')))
  assert.deepEqual(idx.files['site/src/app/matches/page.tsx'].deps, ['site/src/lib/matches.ts'], '@/ alias resolved')
  assert.deepEqual(idx.files['app/lib/ui/matches_screen.dart'].deps, ['app/lib/data/match_repository.dart'], 'package: import resolved')
  assert.deepEqual(j(p, 'search', 'match').results.map((s) => s.name).slice(0, 3).sort(), ['MatchRepository', 'MatchesPage', 'MatchesScreen'].sort())
  assert.deepEqual(j(p, 'search', 'match', '--kind', 'class', '--stack', 'flutter').results.map((s) => s.name).sort(), ['MatchRepository', 'MatchesScreen'])
  const c = j(p, 'callers', 'MatchRepository')
  assert.equal(c.definitions[0].file, 'app/lib/data/match_repository.dart'); assert.equal(c.mode, 'approximate')
  assert.deepEqual(c.references.map((x) => [x.file, x.confidence]), [['app/lib/ui/matches_screen.dart', 'linked']], 'imports and comments are not uses')
  const i = j(p, 'impact', 'site/src/lib/matches.ts')
  assert.deepEqual(i.affected.map((a) => [a.file, a.depth]), [['site/src/app/matches/page.tsx', 1], ['site/src/app/stats/page.tsx', 2]])
  assert.deepEqual(j(p, 'impact', 'loadMatches', '--depth', '1').affected.map((a) => a.file), ['site/src/app/matches/page.tsx'])
  // queries refresh a stale index by themselves
  write(path.join(p, 'site/src/lib/teams.ts'), 'export function loadTeams() {}\n')
  assert.equal(j(p, 'search', 'loadTeams').results.length, 1)
  fs.rmSync(path.join(p, 'site/src/lib/teams.ts'))
  assert.equal(j(p, 'search', 'loadTeams').results.length, 0)
  assert.match(g(p, 'status').out, /up to date/)
})

test('contracts across web and mobile; context bridges the user\'s language to the code through texts', () => {
  const p = project()
  write(path.join(p, '.dualcraft/analytics/events.json'), JSON.stringify({ events: [{ name: 'sign_up', params: {} }, { name: 'match_viewed', params: {} }] }))
  write(path.join(p, '.dualcraft/i18n/es.json'), JSON.stringify({ matches: { title: 'Partidos' }, league: { export: 'Exportar liga' } }))
  const rows = j(p, 'contracts', 'events').contracts
  assert.deepEqual(rows.map((r) => [r.name, r.web.length, r.mobile.length]), [['sign_up', 0, 1], ['match_viewed', 0, 0]])
  assert.match(g(p, 'contracts', 'events').out, /sign_up {3}⚠ only on mobile[\s\S]*match_viewed {3}⚠ not used/)
  // "partidos" (Spanish) reaches the "matches" files of both platforms through the i18n key matches.title
  const ctx = j(p, 'context', 'la lista de partidos')
  assert.deepEqual(ctx.terms, ['lista', 'partido'])
  const files = ctx.files.map((f) => f.file)
  for (const f of ['site/src/app/matches/page.tsx', 'site/src/lib/matches.ts', 'app/lib/ui/matches_screen.dart']) assert.ok(files.includes(f), f)
  // a hand-made text map in the code works as a bridge too
  write(path.join(p, 'app/lib/texts.dart'), "const t = {\n  'export_league_title': {'es': 'Exportar liga', 'en': 'Export League'},\n};\n")
  write(path.join(p, 'app/lib/league/export_service.dart'), 'class LeagueExportService {}\n')
  const ctx2 = j(p, 'context', 'exportar liga').files.map((f) => f.file)
  assert.ok(ctx2.includes('app/lib/league/export_service.dart'), ctx2.join(', '))
  assert.match(g(p, 'context', 'de la').err, /meaningful words/)
})

test('callers --precise uses the project\'s TypeScript compiler when installed, else says so', () => {
  const p = project()
  const r = g(p, 'callers', 'loadMatches', '--precise')
  assert.match(r.out, /no TypeScript stack has the typescript package installed/)
  assert.match(r.out, /site\/src\/app\/matches\/page\.tsx:2 \[linked\]/)
})
