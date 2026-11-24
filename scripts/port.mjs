#!/usr/bin/env node
// DualCraft port helper: deep language-level conversion (Dart ⇄ Kotlin ⇄ Swift ⇄ TypeScript; Flutter ⇄ Compose ⇄
// SwiftUI ⇄ React Native). The agent writes the target code; this script gives it the equivalences and checks the result.
//   idioms --from <stack|lang|ui> --to <stack|lang|ui> [--topic <t>|all] [--write]  side-by-side idioms + pitfalls
//   deps   --from <stack> --to <stack> [--write]        source dependencies → target libraries (+ install lines)
//   files  <feature> [--from s --to s] [--seed a,b] [--force]   source files of a feature → planned target files
//   parity <feature> [--report]                         every type, member, enum case and test exists in the target
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, die, posix, project } from './lib/project.mjs'
import { projectStacks, kotlinPackage, kotlinModule, iosAppDir } from './lib/targets.mjs'
import { SRC_EXT, isGenerated, isTestFile, strip, analyze, testsOf, compare, SUFFIX, normMember } from './lib/port-analyze.mjs'
import { STACK_LANG, STACK_UI, STACK_ECO, LANG_EXT, UI_EXT, LANG_TOPICS, UI_TOPICS, ALIASES, PITFALLS, UI_PITFALLS, PACKAGES, TOOLING } from './lib/port-data.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const CMDS = ['idioms', 'deps', 'files', 'parity']
const STACKS = Object.keys(STACK_LANG)
if (cmd === 'help' || !CMDS.includes(cmd)) {
  console.log('node port.mjs idioms --from <stack|lang> --to <stack|lang> [--topic <t>|all] [--write] | deps --from <stack> --to <stack> [--write] | files <feature> [--from s --to s] [--seed a,b] [--force] | parity <feature> [--report]')
  console.log(`  stacks: ${STACKS.join(' ')} · languages: dart kotlin swift ts · UI: flutter compose swiftui react-native`)
  console.log(`  topics: ${[...LANG_TOPICS, ...UI_TOPICS].join(' ')}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const REF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'references', 'port')
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const uniq = (a) => [...new Set(a)]
const FENCE = { dart: 'dart', kotlin: 'kotlin', swift: 'swift', ts: 'ts', flutter: 'dart', compose: 'kotlin', swiftui: 'swift', 'react-native': 'tsx' }
let P = null
const proj = () => (P ||= project())

/** A side of the conversion: a stack id, a language or a UI framework. */
function side(v, flag) {
  if (!v || v === true) {
    const st = statusFile() && JSON.parse(read(statusFile()))
    if (st?.[flag]) return side(st[flag], flag)
    die(`--${flag} <stack|lang> is required (stacks: ${STACKS.join(' ')})`)
  }
  v = String(v)
  if (STACK_LANG[v]) return { id: v, stack: v, lang: STACK_LANG[v], ui: STACK_UI[v] || null, eco: STACK_ECO[v] }
  if (LANG_EXT[v]) return { id: v, lang: v, ui: null }
  const ui = Object.entries({ flutter: 'dart', compose: 'kotlin', swiftui: 'swift', 'react-native': 'ts' }).find(([k]) => k === v)
  if (ui) return { id: v, lang: ui[1], ui: v }
  die(`unknown stack/language "${v}"`)
}
function statusFile() { try { const f = path.join(proj().dir, 'convert', 'status.json'); return fs.existsSync(f) ? f : null } catch { return null } }

// ---------- idioms ----------
function sections(file) {
  const out = []; let cur = null
  for (const l of read(file).split(/\r?\n/)) {
    const m = l.match(/^\s*\/\/\s*@idiom\s+([\w-]+)\s+—\s+(.*)$/)
    if (m) { cur = { id: m[1], title: m[2].trim(), body: [] }; out.push(cur); continue }
    if (cur) cur.body.push(l)
  }
  for (const s of out) { while (s.body.length && !s.body.at(-1).trim()) s.body.pop(); s.code = s.body.join('\n') }
  return out
}
const topicFile = (kind, who, topic) => path.join(REF, kind, who, `${topic}.${kind === 'lang' ? LANG_EXT[who] : UI_EXT[who]}`)
function pairPitfalls(a, b, topic) { return a === b ? [] : PITFALLS.filter((p) => p.langs.includes(a) && p.langs.includes(b) && (!topic || p.topic === topic)).map((p) => p.text) }
function renderTopic(kind, from, to, topic) {
  const A = sections(topicFile(kind, from, topic)); const B = sections(topicFile(kind, to, topic))
  const lines = [`## ${topic} (${from} → ${to})`, '']
  for (const s of A) {
    const t = B.find((x) => x.id === s.id) || B.find((x) => x.id === ALIASES[s.id])
    lines.push(`### ${s.id} — ${s.title}`, '', '```' + FENCE[from], s.code, '```', '')
    if (t) lines.push('```' + FENCE[to], t.code, '```', '')
    else lines.push(`_(no ${to} section — adapt with the closest idiom above)_`, '')
  }
  for (const t of B.filter((x) => !A.some((s) => s.id === x.id || ALIASES[s.id] === x.id))) lines.push(`### ${t.id} — ${t.title} (${to} only)`, '', '```' + FENCE[to], t.code, '```', '')
  const pit = kind === 'lang' ? pairPitfalls(from, to, topic) : []
  if (pit.length) lines.push('**Pitfalls**', '', ...pit.map((p) => `- ${p}`), '')
  if (kind === 'ui' && topic === 'state' && UI_PITFALLS[to]) lines.push(`**${to} pitfalls**`, '', ...UI_PITFALLS[to].map((p) => `- ${p}`), '')
  return lines.join('\n')
}
if (cmd === 'idioms') {
  const a = side(opt.from, 'from'); const b = side(opt.to, 'to')
  const topics = [...(a.lang !== b.lang ? LANG_TOPICS.map((t) => ['lang', t]) : []), ...(a.ui && b.ui && a.ui !== b.ui ? UI_TOPICS.map((t) => ['ui', t]) : [])]
  const head = [`# Port ${a.id} → ${b.id} (${a.lang}${a.ui ? '/' + a.ui : ''} → ${b.lang}${b.ui ? '/' + b.ui : ''})`, '']
  if (a.lang === b.lang) head.push(`Same language (${a.lang}): only libraries and platform APIs change — use \`port.mjs deps\`.`, '')
  if ((a.ui || b.ui) && !(a.ui && b.ui)) head.push('Web UI ⇄ mobile UI is not a language port: adapt screens with references/platform-mapping.md (dualcraft:convert).', '')
  const topic = opt.topic && opt.topic !== true ? String(opt.topic) : null
  if (topic && topic !== 'all' && !topics.some(([, t]) => t === topic)) die(`topic "${topic}" not available for ${a.id} → ${b.id} (available: ${topics.map(([, t]) => t).join(', ') || 'none'})`)
  const chosen = topic === 'all' || opt.write ? topics : topics.filter(([, t]) => t === topic)
  if (!chosen.length) {
    console.log(head.join('\n'))
    for (const [kind, t] of topics) {
      const A = sections(topicFile(kind, kind === 'lang' ? a.lang : a.ui, t))
      console.log(`  ${t.padEnd(12)} ${A.map((s) => s.id).join(', ')}`)
    }
    const pit = pairPitfalls(a.lang, b.lang)
    if (pit.length) console.log(`\nPitfalls ${a.lang} → ${b.lang} (${pit.length}): shown with each topic.`)
    if (topics.length) console.log(`\nShow one: port.mjs idioms --from ${a.id} --to ${b.id} --topic <topic> · all: --topic all · cheat sheet in the project: --write`)
    process.exit(0)
  }
  const out = [...head, ...chosen.map(([kind, t]) => renderTopic(kind, kind === 'lang' ? a.lang : a.ui, kind === 'lang' ? b.lang : b.ui, t))].join('\n')
  if (opt.write) {
    const f = path.join(proj().dir, 'convert', `port-${a.id}-${b.id}.md`)
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, out + '\n')
    console.log(`Cheat sheet ${a.id} → ${b.id} (${chosen.length} topics) → ${posix(path.relative(proj().root, f))}`)
  } else console.log(out)
  process.exit(0)
}

// ---------- shared: stack dirs ----------
function stackDir(s, which) {
  const { root, config } = proj()
  if (which === 'target' && opt.target) return path.join(root, String(opt.target))
  if (which === 'source' && opt.source) return path.join(root, String(opt.source))
  const st = statusFile() && JSON.parse(read(statusFile()))
  if (which === 'target' && st?.to === s.stack && st.target) return path.join(root, st.target)
  const found = projectStacks(root, config).find((x) => x.id === s.stack)
  if (found) return found.dir
  return which === 'target' ? null : die(`${s.stack} is not a stack of this project — pass --${which} <dir>`)
}
function walk(d, test, out = []) {
  if (!d || !fs.existsSync(d)) return out
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !/^(node_modules|build|dist|Pods|DerivedData|\.dart_tool|\.next|\.expo|\.gradle|ios|android|macos|windows|linux|web)$/.test(e.name) || d.endsWith('src')) walk(p, test, out) } else if (test(p)) out.push(p)
  }
  return out
}

// ---------- deps ----------
const IOS_FRAMEWORKS = { StoreKit: 'iap', CoreLocation: 'location', MapKit: 'maps', AVFoundation: 'camera', VisionKit: 'camera', PhotosUI: 'image-picker', LocalAuthentication: 'biometrics', UserNotifications: 'local-notifications', WebKit: 'webview', SwiftData: 'database', CoreData: 'database', Charts: 'charts', Network: 'connectivity', AuthenticationServices: 'firebase-auth', AVKit: 'media', Security: 'secure-storage', Observation: 'state', SafariServices: 'open-url' }
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
function manifestDeps(s, dir) {
  const deps = []
  const add = (name, dev = false, extra = {}) => { if (!deps.some((d) => d.name === name)) deps.push({ name, dev, ...extra }) }
  if (s.eco === 'pub') {
    let sec = null
    for (const l of read(path.join(dir, 'pubspec.yaml')).split(/\r?\n/)) {
      const top = l.match(/^(\w+):\s*$/); if (top) { sec = top[1]; continue }
      if (/^\S/.test(l)) { sec = null; continue }
      const m = l.match(/^ {2}([a-z_][\w]*):/); if (m && (sec === 'dependencies' || sec === 'dev_dependencies')) add(m[1], sec === 'dev_dependencies')
    }
  } else if (s.eco === 'rn' || s.eco === 'web') {
    const pj = JSON.parse(read(path.join(dir, 'package.json')) || '{}')
    for (const n of Object.keys(pj.dependencies || {})) add(n)
    for (const n of Object.keys(pj.devDependencies || {})) add(n, true)
  } else if (s.eco === 'android' || s.eco === 'kmp') {
    const toml = read(path.join(dir, 'gradle', 'libs.versions.toml'))
    const libs = toml.split(/^\[/m).find((x) => x.startsWith('libraries]')) || ''
    const alias = {}
    for (const m of libs.matchAll(/^([\w-]+)\s*=\s*\{([^}]*)\}/gm)) {
      const mod = m[2].match(/module\s*=\s*"([^"]+)"/)?.[1] || ((g, n) => g && n && `${g}:${n}`)(m[2].match(/group\s*=\s*"([^"]+)"/)?.[1], m[2].match(/name\s*=\s*"([^"]+)"/)?.[1])
      if (mod) alias[m[1].replace(/[-_]/g, '.')] = mod
    }
    for (const f of walk(dir, (p) => /build\.gradle(\.kts)?$/.test(p))) {
      const g = read(f)
      for (const m of g.matchAll(/(\w*(?:[Ii]mplementation|api|ksp|kapt|compileOnly))\s*\(?\s*["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/g)) add(m[2], /test/i.test(m[1]))
      for (const m of g.matchAll(/(\w*(?:[Ii]mplementation|api|ksp|kapt|compileOnly))\s*\(?\s*(?:platform\()?libs\.([\w.]+)/g)) if (alias[m[2]]) add(alias[m[2]], /test/i.test(m[1]))
    }
    if (!deps.length) for (const v of Object.values(alias)) add(v)
  } else if (s.eco === 'ios') {
    const texts = [read(path.join(dir, 'Package.swift')), ...walk(dir, (p) => p.endsWith('project.pbxproj') || p.endsWith('Package.swift')).map(read)].join('\n')
    for (const m of texts.matchAll(/(?:url:\s*|repositoryURL = )"([^"]+)"/g)) add(m[1].replace(/\.git$/, '').split('/').pop(), false, { url: m[1] })
    for (const m of texts.matchAll(/(?:\.product\(\s*name:\s*"|productName = )(\w+)/g)) add(m[1])
    for (const m of read(path.join(dir, 'Podfile')).matchAll(/^\s*pod\s+'([^']+)'/gm)) add(m[1].replace('/', ''))
    for (const f of walk(dir, (p) => p.endsWith('.swift'))) for (const m of read(f).matchAll(/^import\s+(\w+)/gm)) if (IOS_FRAMEWORKS[m[1]]) add(`import ${m[1]}`, false, { framework: IOS_FRAMEWORKS[m[1]] })
  }
  return deps
}
function entryMatches(entry, dep, eco) {
  if (/^(builtin:|expect\/actual)/.test(entry)) return false
  if (eco === 'android' || eco === 'kmp') return entry.includes(':') ? dep.name === entry : dep.name.startsWith(entry + ':') || dep.name.split(':')[0].startsWith(entry)
  if (eco === 'ios') { const key = entry.includes('#') ? entry.split('#')[1] : entry.split('/').pop(); return norm(key) === norm(dep.name) }
  return entry === dep.name
}
const isTooling = (dep, eco) => (TOOLING[eco] || []).some((t) => dep.name === t || dep.name.startsWith(t + ':') || dep.name.startsWith(t + '.'))
function mapDeps(a, b, deps) {
  return deps.map((d) => {
    const concepts = d.framework ? PACKAGES.filter((c) => c.id === d.framework) : PACKAGES.filter((c) => (c[a.eco] || []).some((e) => entryMatches(e, d, a.eco)))
    if (!concepts.length) return { source: d.name, dev: d.dev, status: isTooling(d, a.eco) ? 'tooling' : 'unknown', concepts: [], options: [] }
    const options = uniq(concepts.flatMap((c) => c[b.eco] || []))
    return { source: d.name, dev: d.dev, status: options.length ? 'mapped' : 'none', concepts: concepts.map((c) => c.id), options, notes: concepts.map((c) => c.note).filter(Boolean) }
  })
}
function installLines(b, rows) {
  const picks = uniq(rows.filter((r) => r.status === 'mapped').map((r) => r.choice || r.options[0]).filter((o) => o && !/^(builtin:|expect\/actual)/.test(o)))
  if (!picks.length) return []
  if (b.eco === 'pub') return [`flutter pub add ${picks.join(' ')}`]
  if (b.eco === 'rn') return [`npx expo install ${picks.join(' ')}`]
  if (b.eco === 'web') return [`npm i ${picks.join(' ')}`]
  if (b.eco === 'ios') return ['Xcode → Package Dependencies (or Package.swift):', ...uniq(picks.map((p) => p.split('#')[0])).map((u) => `  .package(url: "${u}", from: "<latest>")${picks.filter((p) => p.startsWith(u + '#')).length ? '  // products: ' + picks.filter((p) => p.startsWith(u + '#')).map((p) => p.split('#')[1]).join(', ') : ''}`)]
  return [`gradle/libs.versions.toml [libraries]${b.eco === 'kmp' ? ' (then add to commonMain.dependencies)' : ''} — use the latest stable versions:`, ...picks.map((p) => p.includes(':') ? `  ${p.split(':')[1]} = { module = "${p}", version = "<latest>" }` : `  ${p}  (group — see the library docs for its modules/plugin)`)]
}
if (cmd === 'deps') {
  const a = side(opt.from, 'from'); const b = side(opt.to, 'to')
  if (!a.stack || !b.stack) die('deps needs stack ids (e.g. --from flutter --to android)')
  const dir = stackDir(a, 'source')
  const deps = manifestDeps(a, dir)
  if (!deps.length) die(`no dependencies found for ${a.stack} in ${posix(path.relative(proj().root, dir)) || '.'}`)
  const rows = mapDeps(a, b, deps)
  const file = path.join(proj().dir, 'convert', 'deps.json')
  const prev = fs.existsSync(file) ? JSON.parse(read(file)) : null
  if (prev && prev.from === a.stack && prev.to === b.stack) for (const r of rows) { const p = prev.deps.find((x) => x.source === r.source); if (p?.choice) r.choice = p.choice }
  console.log(`Dependencies ${a.stack} → ${b.stack}: ${rows.filter((r) => r.status === 'mapped').length} mapped, ${rows.filter((r) => r.status === 'unknown').length} to research, ${rows.filter((r) => r.status === 'tooling').length} tooling\n`)
  for (const r of rows.filter((x) => x.status !== 'tooling')) {
    const mark = r.status === 'mapped' ? '✓' : r.status === 'none' ? '–' : '?'
    const what = r.status === 'unknown' ? 'no known equivalent: research it, or write it on the platform API' : r.status === 'none' ? `${r.concepts.join(',')}: nothing on ${b.stack} (skip or decide with the user)` : `${r.concepts.join(',').padEnd(18)} → ${(r.choice ? [r.choice, ...r.options.filter((o) => o !== r.choice)] : r.options).join(' | ')}`
    console.log(`  ${mark} ${(r.source + (r.dev ? ' (dev)' : '')).padEnd(34)} ${what}`)
  }
  const tooling = rows.filter((r) => r.status === 'tooling')
  if (tooling.length) console.log(`\n  · tooling, no runtime equivalent: ${tooling.map((r) => r.source).join(', ')}`)
  const notes = uniq(rows.flatMap((r) => r.notes || []))
  if (notes.length) console.log('\nNotes:\n' + notes.map((n) => `  - ${n}`).join('\n'))
  const inst = installLines(b, rows)
  if (inst.length) console.log('\nInstall (first option of each; confirm the choices with the user first):\n' + inst.join('\n'))
  if (opt.write) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ from: a.stack, to: b.stack, generated: new Date().toISOString(), deps: rows.map((r) => ({ ...r, choice: r.choice || (r.status === 'mapped' ? r.options[0] : null) })) }, null, 2) + '\n')
    console.log(`\n→ ${posix(path.relative(proj().root, file))} (edit "choice" per dependency to record a decision)`)
  }
  process.exit(0)
}

// ---------- files ----------
const pascal = (s) => s.replace(/(^|[_\-\s.])(\w)/g, (_, __, c) => c.toUpperCase())
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]/g, '_').toLowerCase()
const kebab = (s) => snake(s).replace(/_/g, '-')
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1) }
function classify(f, text, lang, isSeed) {
  if (isTestFile(f)) return 'test'
  if (isGenerated(f, text)) return 'generated'
  const s = strip(text, lang)
  const STATE = { dart: /extends\s+(Auto(Dispose)?(Family)?)?(Async)?(Notifier|StateNotifier|ChangeNotifier|Cubit|Bloc)\b|@riverpod\b|\bValueNotifier\b/, kotlin: /:\s*ViewModel\(\)|:\s*ScreenModel\b/, swift: /@Observable\b|:\s*ObservableObject\b/, ts: /\bcreate(?:Slice|Store)?\s*[<(]|defineStore\(|^export\s+function\s+use[A-Z]/m }
  const WIDGET = { dart: /extends\s+(Stateless|Stateful|Consumer|ConsumerStateful|Hook|HookConsumer)Widget\b/, kotlin: /@Composable/, swift: /:\s*(?:\w+,\s*)*View\b/, ts: /<\w[\s\S]*?>|React\.FC/ }
  if (isSeed || /(screen|page)$/i.test(path.basename(f).replace(/\.\w+$/, '')) && WIDGET[lang].test(s)) return 'screen'
  if (STATE[lang].test(s)) return 'state'
  if (WIDGET[lang].test(s) && (lang !== 'ts' || /\.(tsx|jsx)$/.test(f))) return 'widget'
  if (/(Repository|Repo|Service|Api|Client|DataSource|Gateway)\b/.test(path.basename(f).replace(/\.\w+$/, '').replace(/[_-](\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()))) return 'repository'
  const MODEL = { dart: /fromJson|@freezed|@JsonSerializable|@immutable/, kotlin: /data\s+class|@Serializable/, swift: /struct\s+\w+\s*:[^{]*\b(Codable|Decodable|Equatable|Hashable)\b/, ts: /^\s*export\s+(interface|type)\s/m }
  if (MODEL[lang].test(s) && !(lang === 'ts' && /^\s*export\s+(async\s+)?function/m.test(s))) return 'model'
  return 'util'
}
function plannedName(kind, main, toUi, toLang) {
  const base = main.replace(/^_+/, '').replace(/^use(?=[A-Z])/, '').replace(SUFFIX, '') || main
  if (kind === 'screen') return toUi === 'swiftui' ? `${base}View` : `${base}Screen`
  if (kind === 'state') return toUi === 'flutter' ? `${base}Notifier` : toUi === 'react-native' || toLang === 'ts' ? `use${base}Store` : `${base}ViewModel`
  if (kind === 'test') return toLang === 'swift' ? `${main}Tests` : toLang === 'kotlin' ? `${main}Test` : main
  return main.replace(/Widget$/, '') || main
}
function targetPath(kind, name, feature, b, tdir, route) {
  const { config } = proj()
  const F = pascal(feature)
  if (b.lang === 'kotlin') {
    const pkg = kotlinPackage(tdir || '', config, b.stack).replace(/\./g, '/')
    const mod = b.stack === 'kmp' && tdir && fs.existsSync(path.join(tdir, 'shared')) && ['model', 'repository', 'state', 'util'].includes(kind) ? 'shared' : kotlinModule(tdir || '', b.stack)
    const src = b.stack === 'kmp' ? (kind === 'test' ? 'commonTest/kotlin' : 'commonMain/kotlin') : (kind === 'test' ? 'test/java' : 'main/java')
    const sub = { model: 'data/model', repository: 'data', state: `ui/${feature}`, screen: `ui/${feature}`, widget: `ui/${feature}`, util: 'util', test: feature }[kind]
    return `${mod}/src/${src}/${pkg}/${sub}/${name}.kt`
  }
  if (b.lang === 'swift') {
    const app = tdir ? posix(path.relative(tdir, iosAppDir(tdir, config))) || 'App' : 'App'
    if (kind === 'test') return `${path.basename(app)}Tests/${name}.swift`
    const sub = { model: 'Core/Models', repository: 'Core/Data', util: 'Core/Utils' }[kind] || `Features/${F}`
    return `${app}/${sub}/${name}.swift`
  }
  if (b.lang === 'dart') {
    if (kind === 'test') return `test/features/${snake(feature)}/${snake(name)}_test.dart`
    if (kind === 'util') return `lib/core/utils/${snake(name)}.dart`
    return `lib/features/${snake(feature)}/${{ screen: 'presentation', widget: 'presentation/widgets', state: 'application', repository: 'data', model: 'domain' }[kind]}/${snake(name)}.dart`
  }
  const tsx = ['screen', 'widget'].includes(kind)
  if (kind === 'test') return `__tests__/${kebab(feature)}/${name}.test.${tsx ? 'tsx' : 'ts'}`
  if (kind === 'screen' && b.stack === 'react-native') return `app/${route ? route.replace(/^\//, '').replace(/:(\w+)/g, '[$1]') || 'index' : `${kebab(feature)}/${kebab(name.replace(/Screen$/, ''))}`}.tsx`
  if (kind === 'screen') return `src/features/${kebab(feature)}/${name}.tsx  (+ the route file — stacks/${b.stack}.md)`
  if (kind === 'util') return `src/lib/${camel(name)}.ts`
  return `src/features/${kebab(feature)}/${{ widget: 'components/', state: '', repository: 'api/', model: 'model/' }[kind]}${tsx ? name : camel(name)}.${tsx ? 'tsx' : 'ts'}`
}
function resolveImports(f, text, lang, srcDir, pkgName) {
  const out = []
  if (lang === 'dart') {
    for (const m of text.matchAll(/^\s*(?:import|export|part)\s+'([^']+)'/gm)) {
      const u = m[1]
      if (u.startsWith('dart:')) continue
      if (u.startsWith('package:')) { if (pkgName && u.startsWith(`package:${pkgName}/`)) out.push(path.join(srcDir, 'lib', u.slice(`package:${pkgName}/`.length))) } else out.push(path.resolve(path.dirname(f), u))
    }
  } else if (lang === 'ts') {
    for (const m of text.matchAll(/(?:from|import\()\s*['"]((?:\.{1,2}|@|~)\/[^'"]+)['"]/g)) {
      const u = m[1]
      const bases = u.startsWith('.') ? [path.resolve(path.dirname(f), u)] : [path.join(srcDir, 'src', u.slice(2)), path.join(srcDir, u.slice(2))]
      for (const base of bases) { const hit = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((e) => base + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile()); if (hit) { out.push(hit); break } }
    }
  }
  return out.filter((p) => fs.existsSync(p))
}
const filesDir = () => path.join(proj().dir, 'convert', 'files')
if (cmd === 'files') {
  const feature = pos[0] || die('usage: port.mjs files <feature> [--from s --to s] [--seed a,b]')
  const a = side(opt.from, 'from'); const b = side(opt.to, 'to')
  if (!a.stack || !b.stack) die('files needs stack ids (--from flutter --to android)')
  const { root } = proj()
  const srcDir = stackDir(a, 'source'); const tdir = stackDir(b, 'target')
  const invFile = path.join(proj().dir, 'convert', 'inventory.json')
  const inv = fs.existsSync(invFile) ? JSON.parse(read(invFile)) : null
  const routeOf = {}
  for (const s of inv?.screens || []) routeOf[path.join(root, s.file)] = s.route
  let seeds = opt.seed && opt.seed !== true ? String(opt.seed).split(',').map((x) => path.resolve(root, x.trim())) : (inv?.screens || []).filter((s) => s.feature === feature).map((s) => path.join(root, s.file))
  const all = walk(srcDir, (p) => SRC_EXT[a.lang].test(p))
  const featRe = new RegExp(`[\\\\/](${feature}|${snake(feature)}|${kebab(feature)}|${pascal(feature)})[\\\\/]`, 'i')
  seeds = uniq([...seeds, ...all.filter((f) => featRe.test(path.relative(srcDir, f)) && !isTestFile(f))])
  if (!seeds.length) die(`no source files for feature "${feature}" — run convert.mjs inventory, or pass --seed file1,file2`)
  const text = Object.fromEntries(all.map((f) => [f, read(f)]))
  const pkgName = a.lang === 'dart' ? read(path.join(srcDir, 'pubspec.yaml')).match(/^name:\s*(\w+)/m)?.[1] : null
  const declIndex = {}
  if (a.lang === 'kotlin' || a.lang === 'swift') for (const f of all) { if (isTestFile(f)) continue; const an = analyze(text[f], a.lang); for (const n of [...Object.keys(an.types), ...an.top]) if (/^[A-Z]/.test(n)) (declIndex[n] ||= []).push(f) }
  const refsOf = (f) => (a.lang === 'dart' || a.lang === 'ts' ? resolveImports(f, text[f] || read(f), a.lang, srcDir, pkgName) : uniq([...strip(text[f] || '', a.lang).matchAll(/\b[A-Z]\w+\b/g)].flatMap((m) => declIndex[m[0]] || [])))
  const inc = new Map(seeds.map((f) => [f, 0]))
  const queue = [...seeds]
  while (queue.length) { const f = queue.shift(); const dpt = inc.get(f); if (dpt >= 4 || isGenerated(f, text[f] || '')) continue; for (const r of refsOf(f)) if (!inc.has(r) && r.startsWith(srcDir) && SRC_EXT[a.lang].test(r) && !isTestFile(r)) { inc.set(r, dpt + 1); queue.push(r) } }
  // tests that exercise the included code
  const declared = new Set([...inc.keys()].flatMap((f) => { const an = analyze(text[f] || read(f), a.lang); return [...Object.keys(an.types), ...an.top] }).filter((n) => n.length > 3))
  for (const f of all.filter(isTestFile)) { const s = text[f]; if ([...inc.keys()].some((x) => s.includes(path.basename(x))) || [...declared].some((n) => new RegExp(`\\b${n}\\b`).test(s))) inc.set(f, 9) }
  const outFile = path.join(filesDir(), `${feature}.json`)
  const prev = fs.existsSync(outFile) && !opt.force ? JSON.parse(read(outFile)) : null
  const others = fs.existsSync(filesDir()) ? fs.readdirSync(filesDir()).filter((x) => x !== `${feature}.json` && x.endsWith('.json')).flatMap((x) => JSON.parse(read(path.join(filesDir(), x))).files.map((e) => ({ ...e, feature: x.replace(/\.json$/, '') }))) : []
  const files = []
  for (const [f, dpt] of [...inc.entries()].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))) {
    const t = text[f] || read(f)
    const source = posix(path.relative(root, f))
    const kind = classify(f, t, a.lang, seeds.includes(f) && routeOf[f] !== undefined)
    const an = analyze(t, a.lang)
    const stem = path.basename(f).replace(/\.\w+$/, '').replace(/[._-]?(test|spec|Tests?)$/i, '')
    const names = [...Object.keys(an.types), ...an.top]
    const main = kind === 'test' ? pascal(stem)
      : names.find((n) => normMember(n) === normMember(stem)) || (kind === 'state' && names.find((n) => SUFFIX.test(n) && !/(State|Model)$/.test(n))) || names[0] || pascal(stem)
    const testedKind = /(Notifier|Cubit|Bloc|Controller|ViewModel|Store)$/.test(main) ? 'state' : /(Screen|Page)$/.test(main) ? 'screen' : 'util'
    const name = kind === 'test' ? plannedName('test', plannedName(testedKind, main, b.ui, b.lang).replace(/^use(?=[A-Z])/, ''), b.ui, b.lang) : plannedName(kind, main, b.ui, b.lang)
    const prevE = prev?.files.find((e) => e.source === source)
    const other = others.find((e) => e.source === source)
    const e = prevE || {
      source, kind, symbols: [...Object.keys(an.types), ...an.top],
      target: kind === 'generated' ? '(regenerate with the DualCraft generator for the target stack)' : posix(targetPath(kind, name, feature, b, tdir, routeOf[f])),
      status: kind === 'generated' ? 'generated' : 'todo',
      ...(main !== name && kind !== 'test' ? { rename: { [main]: name } } : {}),
      ...(dpt > 0 && !featRe.test(source) && kind !== 'test' ? { shared: true } : {}),
      ...(other ? { note: `also in feature "${other.feature}" (${other.status})` } : {}),
    }
    if (kind === 'test') e.tests = testsOf(t, a.lang).length
    files.push(e)
  }
  fs.mkdirSync(filesDir(), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify({ feature, from: a.stack, to: b.stack, target: tdir ? posix(path.relative(root, tdir)) || '.' : null, generated: new Date().toISOString(), files }, null, 2) + '\n')
  console.log(`Port plan "${feature}" ${a.stack} → ${b.stack}: ${files.length} files → ${posix(path.relative(root, outFile))}${tdir ? '' : '\n⚠ target project not found: paths are relative to the future target root (pass --target <dir>)'}`)
  for (const e of files) console.log(`  ${e.status === 'generated' ? '·' : e.status === 'ported' ? '✓' : '○'} ${e.kind.padEnd(10)} ${e.source}\n      → ${e.target}${e.rename ? '  (' + Object.entries(e.rename).map(([x, y]) => `${x} → ${y}`).join(', ') + ')' : ''}${e.shared ? '  [shared]' : ''}${e.note ? '  — ' + e.note : ''}`)
  console.log('\nAdjust targets/renames in the JSON to follow the target\'s architecture map; then port each file and run: port.mjs parity ' + feature)
  process.exit(0)
}

// ---------- parity ----------
if (cmd === 'parity') {
  const feature = pos[0] || die('usage: port.mjs parity <feature>')
  const file = path.join(filesDir(), `${feature}.json`)
  const plan = fs.existsSync(file) ? JSON.parse(read(file)) : die(`no port plan for "${feature}" — run: port.mjs files ${feature}`)
  const { root } = proj()
  const a = side(plan.from, 'from'); const b = side(plan.to, 'to')
  const tdir = plan.target ? path.join(root, plan.target) : stackDir(b, 'target')
  let ok = 0, total = 0
  for (const e of plan.files) {
    if (e.status === 'generated' || e.status === 'skip') continue
    total++
    const tf = tdir ? path.join(tdir, e.target.split('  ')[0]) : null
    const st = read(path.join(root, e.source))
    if (!tf || !fs.existsSync(tf)) { e.status = 'todo'; console.log(`○ ${e.source} → ${e.target.split('  ')[0]}: not written yet`); continue }
    const tt = read(tf)
    const missing = compare(st, a.lang, tt, b.lang, e)
    e.status = missing.length ? 'partial' : 'ported'
    if (!missing.length) { ok++; console.log(`✓ ${e.source} → ${e.target.split('  ')[0]}`) } else console.log(`✗ ${e.source} → ${e.target.split('  ')[0]}\n${missing.map((m) => `    missing ${m}`).join('\n')}`)
  }
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n')
  console.log(`\n${ok}/${total} files ported with parity${ok < total ? ' — port the rest, or record intentional drops in the plan ("ignore": ["Type.member", "test name"])' : ''}`)
  process.exit(ok === total || opt.report ? 0 : 1)
}
