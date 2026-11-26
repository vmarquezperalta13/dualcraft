// DualCraft code graph — a fast, dependency-free index of every stack's sources: symbols (with kind, line and the type
// that contains them) and file dependencies. Dependencies come from imports where the language has them (TypeScript,
// Vue, Astro, Dart, Kotlin) and from type names used across files of the same module where it does not (Swift; Kotlin
// files of the same package). Reading source text is not compiling it: results are marked exact or approximate.
import fs from 'node:fs'
import path from 'node:path'

export const LANG_OF = { '.ts': 'ts', '.tsx': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.vue': 'ts', '.astro': 'ts', '.dart': 'dart', '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift' }
const SKIP_DIR = /^(node_modules|\.git|\.next|\.nuxt|\.output|\.astro|\.svelte-kit|dist|build|out|coverage|\.dart_tool|\.gradle|\.idea|\.vscode|Pods|DerivedData|\.expo|ios\/Pods|\.turbo|\.vercel|\.netlify|\.cache|\.dualcraft|\.maestro|playwright-report|test-results)$/
const SKIP_FILE = /(\.d\.ts|\.min\.js|\.g\.dart|\.freezed\.dart|\.mocks\.dart|\.config\.(js|mjs|ts))$/
const MAX_BYTES = 400_000

// ---------------------------------------------------------------- symbols
const strip = (line) => line.replace(/\/\/.*$/, '')
const RULES = {
  ts: [
    [/^\s*export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, (n) => (/^[A-Z]/.test(n) ? 'component' : 'function')],
    [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/, (n) => (/^[A-Z]/.test(n) ? 'component' : 'function')],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, () => 'class'],
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, () => 'interface'],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, () => 'type'],
    [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, () => 'enum'],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, (n) => (/^[A-Z]/.test(n) ? 'component' : 'function')],
    [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:memo|forwardRef|defineComponent|createContext|create|defineStore)\b/, () => 'const'],
    [/^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/, () => 'const'],
    [/^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*([a-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/, () => 'method'],
  ],
  dart: [
    [/^\s*(?:abstract\s+|sealed\s+|final\s+|base\s+|interface\s+)*class\s+([A-Za-z_]\w*)/, () => 'class'],
    [/^\s*mixin\s+([A-Za-z_]\w*)/, () => 'mixin'],
    [/^\s*enum\s+([A-Za-z_]\w*)/, () => 'enum'],
    [/^\s*extension\s+([A-Za-z_]\w*)\s+on\b/, () => 'extension'],
    [/^\s*typedef\s+([A-Za-z_]\w*)/, () => 'type'],
    [/^(?:Future|Stream|void|Widget|bool|int|double|String|num|dynamic|[A-Z]\w*)(?:<[^()]*>)?\??\s+([a-z_]\w*)\s*\(/, () => 'function'],
    [/^\s{2,}(?:static\s+|@override\s+)*(?:Future|Stream|void|Widget|bool|int|double|String|num|dynamic|[A-Z]\w*)(?:<[^()]*>)?\??\s+([a-z_]\w*)\s*\([^;]*$/, () => 'method'],
  ],
  kotlin: [
    [/^\s*(?:(?:public|private|internal|protected|data|sealed|abstract|open|enum|inner|value|annotation|expect|actual)\s+)*class\s+([A-Za-z_]\w*)/, () => 'class'],
    [/^\s*(?:(?:public|private|internal|sealed|fun|expect|actual)\s+)*interface\s+([A-Za-z_]\w*)/, () => 'interface'],
    [/^\s*(?:(?:public|private|internal|data|companion|expect|actual)\s+)*object\s+([A-Za-z_]\w*)/, () => 'object'],
    [/^\s*(?:(?:public|private|internal|protected|override|open|abstract|suspend|inline|operator|infix|tailrec|expect|actual)\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/, (n, line) => (/@Composable/.test(line) || /^[A-Z]/.test(n) ? 'component' : 'function')],
    [/^\s*(?:(?:public|private|internal)\s+)*typealias\s+([A-Za-z_]\w*)/, () => 'type'],
  ],
  swift: [
    [/^\s*(?:(?:public|private|fileprivate|internal|open|final|@MainActor|@Observable|indirect)\s+)*(class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/, (n, line, m) => m[1]],
    [/^\s*(?:(?:public|private|fileprivate|internal|open)\s+)*extension\s+([A-Za-z_][\w.]*)/, () => 'extension'],
    [/^\s*(?:(?:public|private|fileprivate|internal|open|static|class|override|final|mutating|nonisolated|@MainActor)\s+)*func\s+([A-Za-z_]\w*)/, () => 'function'],
    [/^\s*(?:(?:public|private|fileprivate|internal)\s+)*typealias\s+([A-Za-z_]\w*)/, () => 'type'],
  ],
}
const CONTAINERS = new Set(['class', 'interface', 'object', 'struct', 'enum', 'protocol', 'actor', 'extension', 'mixin'])
/** Symbols of a source file: [{ name, kind, line, in? }] (in = the enclosing type, by indentation). */
export function symbolsOf(text, lang) {
  const out = []; const stack = []
  const lines = text.split(/\r?\n/)
  let inBlockComment = false; let prev = ''
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i]
    if (inBlockComment) { if (raw.includes('*/')) { inBlockComment = false; raw = raw.slice(raw.indexOf('*/') + 2) } else continue }
    if (/^\s*\/\*/.test(raw) && !raw.includes('*/')) { inBlockComment = true; continue }
    const line = strip(raw); if (!line.trim()) continue
    const indent = line.match(/^\s*/)[0].length
    while (stack.length && indent <= stack.at(-1).indent && /^\s*[^\s}\])]/.test(line)) stack.pop()
    for (const [re, kindOf] of RULES[lang] || []) {
      const m = line.match(re); if (!m) continue
      const name = lang === 'swift' && m[2] ? m[2] : m[1]
      if (!name || /^(if|for|while|switch|catch|return|new|await|function|super|this|else|try|when|guard)$/.test(name)) continue
      const kind = kindOf(name, prev + '\n' + line, m)
      if (kind === 'method' && !stack.length) continue
      out.push({ name, kind, line: i + 1, ...(stack.length && !CONTAINERS.has(kind) ? { in: stack.at(-1).name } : {}) })
      if (CONTAINERS.has(kind)) stack.push({ name, indent })
      break
    }
    prev = line
  }
  return out
}

// ---------------------------------------------------------------- imports
const IMPORT = {
  ts: [/\bimport\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g, /\bexport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g],
  dart: [/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm],
  kotlin: [/^\s*import\s+([\w.]+)(?:\.\*)?/gm],
  swift: [],
}
export function importsOf(text, lang) {
  const out = new Set()
  for (const re of IMPORT[lang] || []) { re.lastIndex = 0; let m; while ((m = re.exec(text))) out.add(m[1]) }
  return [...out]
}
const kotlinPackage = (text) => text.match(/^\s*package\s+([\w.]+)/m)?.[1] || ''

// ---------------------------------------------------------------- files
export function listFiles(dir, out = [], depth = 0) {
  if (depth > 14 || !fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') { if (e.isDirectory()) continue }
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) listFiles(p, out, depth + 1) }
    else if (LANG_OF[path.extname(e.name)] && !SKIP_FILE.test(e.name)) out.push(p)
  }
  return out
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

/** Resolves import specifiers to indexed files: relative paths, tsconfig/jsconfig "paths" (@/…, ~/…), package:<self>/ for Dart, packages for Kotlin. */
function resolver(stack, files, byPackageSymbol) {
  const set = new Set(files)
  const tsExt = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.astro', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
  const tryTs = (base) => { for (const e of tsExt) { const f = base + e; if (set.has(f)) return f } return null }
  const tsconfig = readJson(path.join(stack.dir, 'tsconfig.json')) || readJson(path.join(stack.dir, 'jsconfig.json')) || {}
  const baseUrl = path.join(stack.dir, tsconfig.compilerOptions?.baseUrl || '.')
  const aliases = Object.entries(tsconfig.compilerOptions?.paths || {}).map(([k, v]) => [k.replace(/\*$/, ''), path.join(baseUrl, String(v[0] || '').replace(/\*$/, ''))])
  if (!aliases.length) { const src = fs.existsSync(path.join(stack.dir, 'src')) ? path.join(stack.dir, 'src') : stack.dir; aliases.push(['@/', src + path.sep], ['~/', (stack.id === 'nuxt' && fs.existsSync(path.join(stack.dir, 'app')) ? path.join(stack.dir, 'app') : src) + path.sep]) }
  const dartPkg = readText(path.join(stack.dir, 'pubspec.yaml')).match(/^name:\s*(\S+)/m)?.[1]
  return (from, spec, lang) => {
    if (lang === 'ts') {
      if (spec.startsWith('.')) return tryTs(path.resolve(path.dirname(from), spec))
      for (const [a, to] of aliases) if (spec.startsWith(a)) return tryTs(path.join(to, spec.slice(a.length)))
      return null
    }
    if (lang === 'dart') {
      if (spec.startsWith('dart:')) return null
      if (spec.startsWith('package:')) { const [pkg, ...rest] = spec.slice(8).split('/'); return pkg === dartPkg ? (set.has(path.join(stack.dir, 'lib', ...rest)) ? path.join(stack.dir, 'lib', ...rest) : null) : null }
      const f = path.resolve(path.dirname(from), spec); return set.has(f) ? f : null
    }
    if (lang === 'kotlin') { const i = spec.lastIndexOf('.'); return byPackageSymbol.get(spec.slice(0, i) + '#' + spec.slice(i + 1)) || null }
    return null
  }
}

/** Builds or refreshes the index: only files whose size or mtime changed are read again. */
export function buildIndex(root, stacks, prev) {
  const files = {}; let read = 0
  const all = []
  for (const s of stacks) for (const f of listFiles(s.dir)) all.push([s, f])
  const seen = new Set()
  for (const [s, f] of all) {
    const rel = path.relative(root, f).split(path.sep).join('/'); if (seen.has(rel)) continue; seen.add(rel)
    const st = fs.statSync(f); if (st.size > MAX_BYTES) continue
    const old = prev?.files?.[rel]
    if (old && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) { files[rel] = { ...old, stack: s.id }; continue }
    const text = readText(f); const lang = LANG_OF[path.extname(f)]; read++
    files[rel] = { stack: s.id, kind: s.kind, lang, ...(/^(\/\/|#) dualcraft:hash=/.test(text) ? { generated: true } : {}), size: st.size, mtime: Math.round(st.mtimeMs), symbols: symbolsOf(text, lang), imports: importsOf(text, lang), ...(lang === 'kotlin' ? { package: kotlinPackage(text) } : {}) }
  }
  // dependencies: resolved imports, plus same-module type references for Swift and same-package Kotlin
  const abs = (rel) => path.join(root, rel)
  const byStack = new Map(); for (const [rel, x] of Object.entries(files)) { if (!byStack.has(x.stack)) byStack.set(x.stack, []); byStack.get(x.stack).push(rel) }
  for (const s of stacks) {
    const rels = byStack.get(s.id) || []; const absFiles = rels.map(abs)
    const byPackageSymbol = new Map()
    for (const rel of rels) { const x = files[rel]; if (x.lang === 'kotlin') for (const sym of x.symbols) if (!sym.in) byPackageSymbol.set(x.package + '#' + sym.name, abs(rel)) }
    const resolve = resolver(s, absFiles, byPackageSymbol)
    const typeOwners = new Map() // type name → file, for languages without file imports
    for (const rel of rels) { const x = files[rel]; if (x.lang === 'swift' || x.lang === 'kotlin') for (const sym of x.symbols) if (!sym.in && /^[A-Z]/.test(sym.name) && sym.kind !== 'extension') typeOwners.set((x.lang === 'kotlin' ? x.package + '#' : 'swift#') + sym.name, rel) }
    for (const rel of rels) {
      const x = files[rel]; const deps = new Set()
      for (const spec of x.imports) { const r = resolve(abs(rel), spec, x.lang); if (r) deps.add(path.relative(root, r).split(path.sep).join('/')) }
      if (x.lang === 'swift' || x.lang === 'kotlin') {
        const words = new Set(readText(abs(rel)).replace(/\/\/.*$/gm, '').match(/\b[A-Z][A-Za-z0-9_]*\b/g) || [])
        for (const w of words) { const owner = typeOwners.get((x.lang === 'kotlin' ? x.package + '#' : 'swift#') + w); if (owner && owner !== rel) deps.add(owner) }
      }
      x.deps = [...deps].sort()
    }
  }
  return { version: 1, built: new Date().toISOString(), files, read }
}

/** Reverse dependencies: file → files that depend on it. */
export function dependents(index) {
  const rev = {}
  for (const [f, x] of Object.entries(index.files)) for (const d of x.deps || []) (rev[d] ||= []).push(f)
  return rev
}
/** Words of a camelCase / snake_case / kebab-case name, lowercased. */
export const wordsOf = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9áéíóúñü]+/).filter(Boolean)
