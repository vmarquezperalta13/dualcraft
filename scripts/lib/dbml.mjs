// Minimal DBML parser (subset of https://dbml.dbdiagram.io/docs) — zero dependencies.
// Supports: Project (database_type, note), Table (alias, headercolor, note, fields,
// field settings, inline refs, Note, indexes — skipped), Ref (short and long form),
// Enum, TableGroup (recorded). Arrays as type suffix `string[]` (DualCraft extension).

const OPS = ['<>', '>', '<', '-']

function stripComments(src) {
  let out = ''; let i = 0
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1]
    if (src.startsWith("'''", i)) { const e = src.indexOf("'''", i + 3); const end = e < 0 ? src.length : e + 3; out += src.slice(i, end); i = end; continue }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++ } out += src.slice(i, j + 1); i = j + 1; continue }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const chunk = src.slice(i, e < 0 ? src.length : e + 2); out += chunk.replace(/[^\n]/g, ' '); i = e < 0 ? src.length : e + 2; continue }
    out += c; i++
  }
  return out
}

function matchBrace(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (text.startsWith("'''", i)) { const e = text.indexOf("'''", i + 3); i = e < 0 ? text.length : e + 2; continue }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++ } i = j; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

const unq = (s) => {
  s = String(s ?? '').trim()
  if (s.startsWith("'''") && s.endsWith("'''")) return s.slice(3, -3).trim()
  if (/^(['"`]).*\1$/s.test(s)) return s.slice(1, -1)
  return s
}

/** Split on commas that are not inside quotes, parens or brackets. */
function splitTop(s, sep = ',') {
  const parts = []; let cur = ''; let depth = 0; let q = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue }
    if ('([{'.includes(c)) depth++
    if (')]}'.includes(c)) depth--
    if (c === sep && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

function parseSettings(s) {
  const out = {}
  if (!s) return out
  for (const part of splitTop(s)) {
    const m = part.match(/^([\w ]+?)\s*:\s*([\s\S]*)$/)
    if (m) out[m[1].trim().toLowerCase()] = unq(m[2])
    else out[part.trim().toLowerCase()] = true
  }
  return out
}

/** "public.users" or "\"my table\"" → users / my table */
const ident = (s) => { const u = unq(s.trim()); const parts = u.split('.'); return unq(parts[parts.length - 1]) }

function parseEndpoint(s) {
  const t = s.trim()
  if (t.includes('(')) return null // composite keys: not supported
  const parts = t.split('.').map(unq)
  if (parts.length < 2) return null
  return { table: parts[parts.length - 2], field: parts[parts.length - 1] }
}

function parseRefExpr(expr, line) {
  const m = expr.match(/^(.*?)\s*(\[[^\]]*\])?\s*$/s)
  const body = m[1]; const settings = parseSettings(m[2]?.slice(1, -1))
  for (const op of OPS) {
    const idx = body.indexOf(` ${op} `) >= 0 ? body.indexOf(` ${op} `) + 1 : body.indexOf(op)
    if (idx < 0) continue
    const a = parseEndpoint(body.slice(0, idx)); const b = parseEndpoint(body.slice(idx + op.length))
    if (!a || !b) return null
    return { a, b, op, ...cardinality(op), settings, line }
  }
  return null
}

const cardinality = (op) => ({ '>': { aMany: true, bMany: false }, '<': { aMany: false, bMany: true }, '-': { aMany: false, bMany: false }, '<>': { aMany: true, bMany: true } }[op])

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

/** `Keyword header … {` where the header may contain quoted text and [settings] with braces. Returns a match-like array. */
function blockHeader(rest) {
  const k = rest.match(/^(\w+)/)
  if (!k) return null
  let q = null; let depth = 0
  for (let i = k[0].length; i < rest.length; i++) {
    const c = rest[i]
    if (q) { if (c === q && rest[i - 1] !== '\\') q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === '\n' && depth === 0) return null
    else if (c === '{' && depth === 0) return [rest.slice(0, i + 1), k[1], rest.slice(k[0].length, i)]
  }
  return null
}

export function parseDbml(src) {
  const text = stripComments(src.replace(/\r\n?/g, '\n'))
  const model = { project: {}, database: null, tables: [], refs: [], enums: [], groups: [], errors: [], warnings: [] }
  let i = 0
  while (i < text.length) {
    const ws = text.slice(i).match(/^\s+/); if (ws) { i += ws[0].length; continue }
    const rest = text.slice(i)
    // Ref short form:  Ref [name]: a.b > c.d [settings]
    let m = rest.match(/^Ref\b[^:{\n]*:\s*([^\n]+)/i)
    if (m) {
      const r = parseRefExpr(m[1], lineOf(text, i))
      r ? model.refs.push(r) : model.errors.push(`line ${lineOf(text, i)}: cannot parse Ref "${m[1].trim()}"`)
      i += m[0].length; continue
    }
    m = blockHeader(rest)
    if (m) {
      const open = i + m[0].length - 1
      const close = matchBrace(text, open)
      if (close < 0) { model.errors.push(`line ${lineOf(text, i)}: missing closing "}"`); break }
      const kind = m[1].toLowerCase(); const header = m[2].trim(); const body = text.slice(open + 1, close)
      const line = lineOf(text, i)
      if (kind === 'table') parseTable(header, body, line, text.slice(0, open + 1), model)
      else if (kind === 'ref') for (const l of body.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const r = parseRefExpr(l, line); r ? model.refs.push(r) : model.errors.push(`line ${line}: cannot parse Ref "${l}"`)
      }
      else if (kind === 'enum') {
        const values = body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const mm = l.match(/^("[^"]+"|[\w-]+)\s*(\[(.*)\])?/); return mm ? { name: unq(mm[1]), note: parseSettings(mm[3]).note || '' } : null }).filter(Boolean)
        model.enums.push({ name: ident(header.split(/\s+/)[0]), values })
      } else if (kind === 'project') {
        model.project.name = unq(header)
        for (const l of body.split('\n')) { const mm = l.match(/^\s*(\w+)\s*:\s*(.+)$/); if (mm) model.project[mm[1].toLowerCase()] = unq(mm[2]) }
        model.database = (model.project.database_type || '').toLowerCase() || null
      } else if (kind === 'tablegroup') {
        model.groups.push({ name: ident(header.split(/\s+/)[0]), tables: body.split('\n').map((l) => l.trim()).filter(Boolean).map(ident) })
      } else model.warnings.push(`line ${line}: "${m[1]}" block ignored`)
      i = close + 1; continue
    }
    const nl = rest.indexOf('\n'); const bad = rest.slice(0, nl < 0 ? undefined : nl).trim()
    model.errors.push(`line ${lineOf(text, i)}: unexpected "${bad.slice(0, 60)}"`)
    i += nl < 0 ? rest.length : nl + 1
  }
  resolve(model)
  return model
}

function parseTable(header, body, line, _prefix, model) {
  const hm = header.match(/^("[^"]+"|[\w.]+)(?:\s+as\s+("[^"]+"|\w+))?\s*(?:\[(.*)\])?\s*$/s)
  if (!hm) { model.errors.push(`line ${line}: cannot parse Table header "${header}"`); return }
  const settings = parseSettings(hm[3])
  const table = { name: ident(hm[1]), alias: hm[2] ? unq(hm[2]) : null, headercolor: settings.headercolor || null, note: settings.note || '', fields: [], line }
  let j = 0
  while (j < body.length) {
    const ws = body.slice(j).match(/^\s+/); if (ws) { j += ws[0].length; continue }
    const rest = body.slice(j)
    let mm = rest.match(/^(indexes|Note)\s*\{/i)
    if (mm) {
      const close = matchBrace(body, j + mm[0].length - 1)
      if (mm[1].toLowerCase() === 'note') table.note = unq(body.slice(j + mm[0].length, close))
      j = close < 0 ? body.length : close + 1; continue
    }
    mm = rest.match(/^Note\s*:\s*('''[\s\S]*?'''|'[^'\n]*'|"[^"\n]*")/i)
    if (mm) { table.note = unq(mm[1]); j += mm[0].length; continue }
    const nl = rest.indexOf('\n'); const l = rest.slice(0, nl < 0 ? undefined : nl).trim(); j += nl < 0 ? rest.length : nl + 1
    if (!l) continue
    const fm = l.match(/^("[^"]+"|[\w$-]+)\s+("[^"]+"|[\w.$]+(?:\s*\([^)]*\))?(?:\[\])?)\s*(?:\[(.*)\])?\s*$/)
    if (!fm) { model.errors.push(`line ${line}: cannot parse field "${l}" in table ${table.name}`); continue }
    const s = parseSettings(fm[3])
    const rawType = unq(fm[2]).replace(/\s+/g, '')
    const field = {
      name: unq(fm[1]),
      type: rawType,
      isArray: rawType.endsWith('[]'),
      baseType: rawType.replace(/\[\]$/, '').replace(/\(.*\)$/, ''),
      pk: !!(s.pk || s['primary key']),
      notNull: !!(s['not null'] || s.pk || s['primary key']),
      unique: !!s.unique,
      increment: !!s.increment,
      default: s.default ?? null,
      note: s.note || '',
    }
    if (s.ref) {
      const r = parseRefExpr(`${table.name}.${field.name} ${s.ref}`, line)
      r ? model.refs.push(r) : model.errors.push(`line ${line}: cannot parse inline ref "${s.ref}"`)
    }
    table.fields.push(field)
  }
  model.tables.push(table)
}

function resolve(model) {
  const byName = new Map()
  for (const t of model.tables) {
    if (byName.has(t.name)) model.errors.push(`table "${t.name}" defined twice`)
    byName.set(t.name, t); if (t.alias) byName.set(t.alias, t)
    if (!t.fields.some((f) => f.pk)) model.warnings.push(`table "${t.name}" has no primary key`)
  }
  const enumNames = new Set(model.enums.map((e) => e.name))
  for (const r of model.refs) {
    for (const end of [r.a, r.b]) {
      const t = byName.get(end.table)
      if (!t) { model.errors.push(`Ref line ${r.line}: unknown table "${end.table}"`); continue }
      end.table = t.name
      if (!t.fields.some((f) => f.name === end.field)) model.errors.push(`Ref line ${r.line}: unknown field "${t.name}.${end.field}"`)
    }
    // the "many" side holds the foreign key; for 1-1 the a side does
    const fkEnd = r.aMany && !r.bMany ? r.a : !r.aMany && r.bMany ? r.b : r.a
    const t = byName.get(fkEnd.table); const f = t?.fields.find((x) => x.name === fkEnd.field)
    r.fk = { table: fkEnd.table, field: fkEnd.field }
    r.required = !!f?.notNull
    if (f) f.fk = true
  }
  for (const t of model.tables) for (const f of t.fields) f.isEnum = enumNames.has(f.baseType)
  for (const g of model.groups) for (const n of g.tables) if (!byName.has(n)) model.warnings.push(`TableGroup ${g.name}: unknown table "${n}"`)
}
