// Source analysis for scripts/port.mjs: declared types, members, enum cases, top-level symbols and test names in
// Dart, Kotlin, Swift and TypeScript (regex + brace depth over code with comments and strings blanked out).
const uniq = (a) => [...new Set(a)]

export const SRC_EXT = { dart: /\.dart$/, kotlin: /\.kt$/, swift: /\.swift$/, ts: /\.(tsx?|jsx?)$/ }
export const isGenerated = (f, text) => /\.(g|freezed|gr|mocks)\.dart$|\.d\.ts$/.test(f) || /^(?:\/\/|\/\*|#) dualcraft:hash=/.test(text)
export const isTestFile = (f) => /([\\/](test|tests|__tests__|androidTest|commonTest|jvmTest|iosTest)[\\/])|(_test\.dart|Tests?\.(kt|swift)|\.(test|spec)\.[jt]sx?)$/.test(f)

/** Blank out comments and string contents (keeps line structure). */
export function strip(text, lang) {
  let out = ''; let i = 0; const n = text.length
  while (i < n) {
    const c = text[i], c2 = text.slice(i, i + 2), c3 = text.slice(i, i + 3)
    if (c2 === '//') { while (i < n && text[i] !== '\n') i++; continue }
    if (c2 === '/*') { const e = text.indexOf('*/', i + 2); const seg = text.slice(i, e < 0 ? n : e + 2); out += seg.replace(/[^\n]/g, ' '); i += seg.length; continue }
    if (c3 === '"""' || c3 === "'''") { const e = text.indexOf(c3, i + 3); const seg = text.slice(i, e < 0 ? n : e + 3); out += '""' + seg.slice(2).replace(/[^\n]/g, ' '); i += seg.length; continue }
    if (c === '"' || c === "'" || (c === '`' && lang === 'ts')) {
      let j = i + 1
      while (j < n && text[j] !== c && !(text[j] === '\n' && c !== '`')) j += text[j] === '\\' ? 2 : 1
      const seg = text.slice(i, j + 1); out += c + seg.slice(1, -1).replace(/[^\n]/g, ' ') + c; i = j + 1; continue
    }
    out += c; i++
  }
  return out
}
export const TYPE_RE = {
  dart: /^\s*(?:@\w+\s+)*(?:(?:abstract|sealed|final|base|interface|mixin)\s+)*(class|mixin|enum|extension)\s+(\w+)/,
  kotlin: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*((?:(?:public|internal|private|protected|data|sealed|abstract|open|enum|value|inline|annotation|inner|fun)\s+)*)(class|interface|object)\s+(\w+)/,
  swift: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*((?:(?:public|internal|private|fileprivate|open|final|indirect)\s+)*)(class|struct|enum|protocol|actor|extension)\s+(\w+)/,
  ts: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type)\s+(\w+)/,
}
const noGen = (h) => { let x = h; for (let i = 0; i < 4; i++) x = x.replace(/<[^<>]*>/g, ''); return x }
/** Declared name in a Dart declaration head: drop generics and function types (`int Function() counter()`). */
const dartName = (l) => (noGen(noGen(l).replace(/\bFunction\s*\([^()]*\)\??/g, '').split(/=>|[(=;{]/)[0]).match(/[A-Za-z_]\w*/g) || []).pop()
export const TOP_RE = {
  dart: (l) => (/^(import|export|part|library|class|abstract|sealed|base|interface|mixin|enum|extension|typedef|@|}|\)|\]|;)/.test(l) || /^final\s+class\b/.test(l) ? null : dartName(l)),
  kotlin: (l) => l.match(/^(?:(?:public|internal|private|suspend|inline|operator|infix|tailrec|const|@\w+(?:\([^)]*\))?)\s+)*(?:fun|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)/)?.[1],
  swift: (l) => l.match(/^(?:(?:public|internal|private|fileprivate|@\w+)\s+)*(?:func|let|var)\s+(\w+)/)?.[1],
  ts: (l) => l.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|(?:const|let)\s+(\w+))/)?.slice(1).find(Boolean),
}
export function memberName(l, lang, typeName, isEnum) {
  if (lang === 'dart') {
    if (/^\s*(return|if|for|while|switch|case|default|super|assert|@|\}|\)|\]|\.|:)/.test(l) || /\boperator\b/.test(l)) return []
    if (isEnum && /^\s*\w+\s*(\(|,|;|$)/.test(l)) return [...l.matchAll(/(?:^|,)\s*(\w+)\s*(?:\([^)]*\))?/g)].map((m) => m[1])
    const name = dartName(l)
    return name && name !== typeName && !/^(get|set|static|final|const|late|var|override|factory|required)$/.test(name) ? [name] : []
  }
  if (lang === 'kotlin') {
    if (/\bprivate\b/.test(l)) return []
    if (isEnum && /^\s*[A-Z][A-Z0-9_]*\s*(\(|,|;|\{|$)/.test(l)) return [...l.matchAll(/(?:^|,)\s*([A-Z][A-Z0-9_]*)\s*(?:\([^)]*\))?/g)].map((m) => m[1])
    const m = l.match(/(?:fun|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)/); return m ? [m[1]] : []
  }
  if (lang === 'swift') {
    if (/\b(private|fileprivate)\b(?!\(set\))/.test(l)) return []
    const c = l.match(/^\s*(?:indirect\s+)?case\s+(.+)$/); if (c) return c[1].replace(/\([^)]*\)/g, '').split(',').map((x) => x.trim().match(/^\w+/)?.[0]).filter(Boolean)
    const m = l.match(/\b(?:func|var|let)\s+(\w+)/); return m ? [m[1]] : []
  }
  if (/\bprivate\b|^\s*#/.test(l)) return []
  if (isEnum) { const m = l.match(/^\s*(\w+)\s*(?:=|,|$)/); return m ? [m[1]] : [] }
  const m = l.match(/^\s*(?:(?:public|protected|readonly|static|async|get|set|override|abstract|declare)\s+)*(\w+)\s*\??\s*(?:[:(=<]|$)/)
  return m && m[1] !== 'constructor' ? [m[1]] : []
}
/** { types: {name: {members, kind}}, top: [names] } */
export function analyze(text, lang) {
  const lines = strip(text, lang).split('\n')
  const depth = []; let d = 0; const paren = []; let p = 0
  for (const l of lines) { depth.push(d); paren.push(p); for (const ch of l) { if (ch === '{') d++; else if (ch === '}') d--; else if (ch === '(') p++; else if (ch === ')') p-- } }
  const types = {}; const top = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = l.match(TYPE_RE[lang])
    if (m) {
      const [kw, name, mods] = lang === 'kotlin' || lang === 'swift' ? [m[2], m[3], m[1]] : [m[1], m[2], '']
      if (name.startsWith('_') || /private/.test(mods)) continue
      const isEnum = kw === 'enum' || /enum/.test(mods)
      const members = []
      if (lang === 'kotlin' && new RegExp(`\\b${name}\\s*(<[^>]*>)?\\s*\\(`).test(l)) { let hdr = ''; for (let k = i; k < Math.min(lines.length, i + 30); k++) { hdr += lines[k] + '\n'; if (paren[k + 1] === paren[i] && (lines[k].includes(')') || lines[k].includes('{'))) break } for (const v of (hdr.match(/\(([\s\S]*)\)/)?.[1] || '').matchAll(/(?:val|var)\s+(\w+)/g)) members.push(v[1]) }
      if (lang === 'ts' && kw === 'type') { const raw = text.split(/\r?\n/)[i] || ''; for (const u of raw.matchAll(/'([^']+)'/g)) members.push(u[1]) }
      let start = -1
      for (let k = i; k < Math.min(lines.length, i + 30); k++) {
        if (k > i && lines[k].trim() && paren[k] === paren[i] && !/^\s*[:,.){]/.test(lines[k]) && !/[,(:=]\s*$/.test(lines[k - 1])) break
        if (lines[k].includes('{') && paren[k + 1] === paren[i]) { start = k; break }
      }
      if (start >= 0 && depth[start + 1] === depth[i]) { // body on one line: enum Plan { free, pro }
        const l1 = lines[start]; for (const part of l1.slice(l1.indexOf('{') + 1, l1.lastIndexOf('}')).split(';')) if (part.trim()) members.push(...memberName(part, lang, name, isEnum))
      } else if (start >= 0) {
        const bd = depth[i] + 1
        for (let k = start + 1; k < lines.length && depth[k] >= bd; k++) if (depth[k] === bd && paren[k] === paren[start + 1] && lines[k].trim() && !TYPE_RE[lang].test(lines[k])) members.push(...memberName(lines[k], lang, name, isEnum))
      }
      const prev = types[name]
      types[name] = { kind: prev && kw === 'extension' ? prev.kind : isEnum ? 'enum' : kw, members: uniq([...(prev?.members || []), ...members.filter((x) => !/^[_#]/.test(x))]) }
      continue
    }
    if (depth[i] === 0 && paren[i] === 0 && /^\S/.test(l)) { const t = TOP_RE[lang](l); if (t && !t.startsWith('_') && !(lang !== 'dart' && /\bprivate\b/.test(l))) top.push(t) }
  }
  return { types, top: uniq(top.filter((t) => !types[t])) }
}
export const TEST_RE = {
  dart: [/\b(?:test|testWidgets|blocTest)\s*(?:<[^>]*>)?\(\s*(['"])(.+?)\1/g],
  kotlin: [/fun\s+`([^`]+)`\s*\(/g, /@Test\s+fun\s+(\w+)\s*\(/g],
  swift: [/@Test\s*\(\s*"([^"]+)"/g, /func\s+(test\w+)\s*\(/g, /@Test\s+func\s+(\w+)\s*\(/g],
  ts: [/\b(?:it|test)\s*\(\s*(['"`])(.+?)\1/g],
}
export const testsOf = (text, lang) => uniq(TEST_RE[lang].flatMap((re) => [...text.matchAll(re)].map((m) => m[m.length - 1])))
export const STOP = new Set(['test', 'tests', 'should', 'when', 'then', 'the', 'a', 'an', 'it', 'is', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'el', 'la', 'los', 'las', 'de', 'del', 'que', 'un', 'una', 'en', 'y', 'con', 'se', 'si', 'al', 'por', 'para'])
export const words = (s) => new Set(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9áéíóúñü]+/).filter((w) => w && !STOP.has(w)))
export const similar = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; const inter = [...A].filter((w) => B.has(w)).length; return inter / new Set([...A, ...B]).size >= 0.5 }
export const SUFFIX = /(Notifier|Cubit|Bloc|Controller|ViewModel|Store|Provider|Screen|Page|View|Widget|Model)$/
export const normType = (n) => n.replace(/^_+/, '').replace(/^use(?=[A-Z])/, '').replace(SUFFIX, '').replace(/(Exception|Error)$/, 'Error').toLowerCase()
export const normMember = (n) => n.replace(/^[_#]+/, '').replace(/_/g, '').toLowerCase()
export const IGNORED = new Set(['build', 'createstate', 'initstate', 'dispose', 'didchangedependencies', 'didupdatewidget', 'body', 'key', 'tostring', 'hashcode', 'equals', 'copywith', 'copy', 'tojson', 'fromjson', 'props', 'init', 'deinit', 'constructor', 'serializer', 'companion', 'debugfillproperties', 'oncleared', 'state', 'emit', 'stringify', 'nosuchmethod', 'runtimetype'])

/**
 * What the source file declares that the target file lacks. `opts`: { kind, rename: {Src: Tgt}, ignore: ['Type.member' | 'member' | 'test name'] }.
 * Types match after removing role suffixes (CartNotifier ≈ CartViewModel ≈ useCartStore); a widget class may become a function.
 */
export function compare(srcText, srcLang, tgtText, tgtLang, { kind = 'util', rename = {}, ignore = [] } = {}) {
  const ign = new Set(ignore.map((x) => normMember(String(x))))
  const missing = []
  if (kind === 'test') {
    const tgt = testsOf(tgtText, tgtLang)
    for (const t of testsOf(srcText, srcLang)) if (!ign.has(normMember(t)) && !tgt.some((x) => similar(t, x))) missing.push(`test "${t}"`)
    return missing
  }
  const S = analyze(srcText, srcLang); const T = analyze(tgtText, tgtLang)
  const tSyms = new Map([...Object.keys(T.types), ...T.top].map((n) => [normType(n), n]))
  const tAll = new Set([...Object.values(T.types).flatMap((x) => x.members), ...T.top].map(normMember))
  const renamed = (n) => rename[n] || n
  for (const [n, info] of Object.entries(S.types)) {
    if (ign.has(normMember(n)) || (info.kind === 'extension' && tgtLang === 'ts')) continue
    const tn = tSyms.get(normType(renamed(n))) || (info.kind === 'extension' ? '*' : null)
    if (!tn && tAll.has(normMember(n))) continue // sealed subclass → enum case with associated values (Swift) / union member (TS)
    if (!tn) { missing.push(`${info.kind} ${n}${renamed(n) !== n ? ` (→ ${renamed(n)})` : ''}`); continue }
    if (['screen', 'widget'].includes(kind)) continue
    const tm = new Set([...(T.types[tn]?.members || []).map(normMember), ...tAll])
    for (const m of info.members) {
      const nm = normMember(m)
      if (nm && !IGNORED.has(nm) && !ign.has(nm) && !ign.has(normMember(`${n}.${m}`)) && nm !== normMember(n) && !tm.has(nm) && !(srcLang === 'ts' && info.kind === 'type' && tSyms.has(nm)) && !(info.kind === 'enum' && new RegExp(`\\b${m}\\b`, 'i').test(tgtText))) missing.push(`${info.kind === 'enum' ? 'case' : 'member'} ${n}.${m}`)
    }
  }
  for (const t of S.top) {
    const nm = normMember(t)
    if (ign.has(nm) || IGNORED.has(nm) || (/Provider$/.test(t) && tgtLang !== 'dart') || t === 'main') continue
    if (!tSyms.has(normType(renamed(t))) && !tAll.has(nm)) missing.push(`function/value ${t}`)
  }
  return missing
}
