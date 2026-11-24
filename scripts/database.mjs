#!/usr/bin/env node
// DualCraft database helper — the schema (.dualcraft/db/schema.dbml) turned into each provider's artifacts.
//   doctor                         CLIs and files for the configured provider (and what's missing)
//   status                         provider, environments and generated artifacts
//   migration <name> [--rls] [--out dir] [--dry]   Postgres/Supabase SQL migration: full schema the first time,
//                                  then only the difference since the last generated snapshot
//   prisma [--out prisma/schema.prisma] [--stdout]   Prisma schema from the DBML
//   sql [--rls] [--stdout]         the full Postgres DDL (no snapshot change)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseDbml } from './lib/dbml.mjs'
import { project, parseArgs, die, posix } from './lib/project.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { pos, opt } = parseArgs(rest)
const CMDS = ['doctor', 'status', 'migration', 'prisma', 'sql']
if (cmd === 'help' || !CMDS.includes(cmd)) { console.log('node database.mjs doctor | status | migration <name> [--rls] [--dry] | prisma [--stdout] | sql [--rls] [--stdout]'); process.exit(cmd === 'help' ? 0 : 1) }

const { root, dir, config } = project()
const provider = config.backend?.provider || null
const schemaFile = path.join(dir, 'db', 'schema.dbml')
const snapFile = path.join(dir, 'db', 'snapshot.json')
const rel = (p) => posix(path.relative(root, p))

// ---------- doctor / status ----------
function which(bin, args = ['--version']) {
  try { return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32', timeout: 20000 }).trim().split('\n')[0] } catch { return null }
}
if (cmd === 'doctor') {
  const need = {
    firebase: [['firebase', 'firebase', 'npm i -g firebase-tools  (then: firebase login)'], ['java', 'java', 'Java 11+ for the Firestore emulator (Temurin/OpenJDK)']],
    supabase: [['supabase', 'supabase', 'npx supabase … works without installing; or scoop install supabase (Windows) / brew install supabase/tap/supabase  (then: supabase login)'], ['docker', 'docker', 'Docker Desktop — needed for the local stack (supabase start)']],
    'postgres-prisma': [['docker', 'docker', 'Docker Desktop for a local Postgres (or install PostgreSQL)'], ['node', 'node', 'Node.js 18+']],
  }
  console.log(`Provider: ${provider || '— (not chosen: set it with /dualcraft:database)'}`)
  const list = provider ? need[provider] : Object.values(need).flat()
  for (const [label, bin, how] of list) {
    const v = which(bin, bin === 'java' ? ['-version'] : ['--version'])
    console.log(`${v ? '✓' : '✗'} ${label.padEnd(9)} ${v || 'not found → ' + how}`)
  }
  if (provider === 'postgres-prisma') { const p = fs.existsSync(path.join(root, config.paths?.web || '', 'node_modules', 'prisma')); console.log(`${p ? '✓' : '·'} prisma    ${p ? 'installed in the web project' : 'not installed yet → npm i -D prisma && npm i @prisma/client'}`) }
  const files = { firebase: ['firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json'], supabase: ['supabase/config.toml', 'supabase/migrations'], 'postgres-prisma': ['prisma/schema.prisma', '.env'] }[provider] || []
  for (const f of files) console.log(`${fs.existsSync(path.join(root, f)) ? '✓' : '·'} ${f}`)
  console.log(fs.existsSync(schemaFile) ? '✓ .dualcraft/db/schema.dbml' : '· .dualcraft/db/schema.dbml (create it with /dualcraft:schema)')
  process.exit(0)
}
if (cmd === 'status') {
  console.log(`Provider: ${provider || '—'}`)
  const envs = config.backend?.environments || {}
  if (!Object.keys(envs).length) console.log('Environments: none configured (default plan: local + dev + prod)')
  for (const [name, e] of Object.entries(envs)) console.log(`  ${name.padEnd(6)} ${Object.entries(e).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  if (fs.existsSync(snapFile)) { const s = JSON.parse(fs.readFileSync(snapFile, 'utf8')); console.log(`Last migration snapshot: ${s.migration} (${s.generated.slice(0, 10)}) — ${s.model.tables.length} tables`) }
  const migDir = path.join(root, 'supabase', 'migrations')
  if (fs.existsSync(migDir)) console.log(`supabase/migrations: ${fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).length} file(s)`)
  process.exit(0)
}

// ---------- model ----------
if (!fs.existsSync(schemaFile)) die('no .dualcraft/db/schema.dbml — create it with /dualcraft:schema')
const model = parseDbml(fs.readFileSync(schemaFile, 'utf8'))
if (model.errors.length) { model.errors.forEach((e) => console.log('✗ ' + e)); die('fix the schema errors first (er.mjs check).') }
const enumNames = new Set(model.enums.map((e) => e.name))
// always quoted: avoids clashes with SQL keywords (user, position, order…) and keeps the DBML casing
const q = (n) => `"${String(n).replace(/"/g, '""')}"`
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`

function pgType(f) {
  if (enumNames.has(f.baseType)) return q(f.baseType) + (f.isArray ? '[]' : '')
  const t = f.baseType.toLowerCase(); const raw = f.type.replace(/\[\]$/, '')
  let b
  if (/^(int|integer|int4|serial)$/.test(t)) b = 'integer'
  else if (/^(bigint|int8|bigserial)$/.test(t)) b = 'bigint'
  else if (/^(smallint|int2|tinyint)$/.test(t)) b = 'smallint'
  else if (/^(float|double|real|float8|number)$/.test(t)) b = 'double precision'
  else if (/^(decimal|numeric|money)$/.test(t)) b = /\(/.test(raw) ? raw.replace(/^\w+/, 'numeric') : 'numeric'
  else if (/^(bool|boolean)$/.test(t)) b = 'boolean'
  else if (/^(timestamp|timestamptz|datetime)$/.test(t)) b = 'timestamptz'
  else if (t === 'date') b = 'date'
  else if (t === 'time') b = 'time'
  else if (/^(json|jsonb|map|object)$/.test(t)) b = 'jsonb'
  else if (t === 'uuid') b = 'uuid'
  else if (/^(varchar|char)$/.test(t) && /\(/.test(raw)) b = raw
  else b = 'text' // string, text, varchar, reference, geopoint…
  return b + (f.isArray ? '[]' : '')
}
function defaultSql(f) {
  if (f.default === null || f.default === undefined) return null
  const d = String(f.default).trim()
  if (/^`.*`$/.test(d)) return d.slice(1, -1) // DBML expression: `now()`
  if (/^(true|false|null)$/i.test(d) || /^-?\d+(\.\d+)?$/.test(d)) return d.toLowerCase()
  if (/^(now\(\)|gen_random_uuid\(\)|current_timestamp)$/i.test(d)) return d
  return lit(d.replace(/^['"]|['"]$/g, ''))
}
function columnSql(f) {
  const parts = [q(f.name), pgType(f)]
  if (f.pk && f.increment && /int/.test(pgType(f))) parts.push('generated by default as identity')
  else if (f.pk && pgType(f) === 'uuid' && f.default == null) parts.push('default gen_random_uuid()')
  const d = defaultSql(f); if (d) parts.push('default ' + d)
  if (f.notNull && !f.pk) parts.push('not null')
  if (f.unique && !f.pk) parts.push('unique')
  return parts.join(' ')
}
const fkName = (r) => `${r.fk.table}_${r.fk.field}_fkey`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 63)
function refSql(r) {
  const other = r.fk.table === r.a.table && r.fk.field === r.a.field ? r.b : r.a
  const del = r.settings?.delete ? ` on delete ${r.settings.delete}` : ''
  const upd = r.settings?.update ? ` on update ${r.settings.update}` : ''
  return `alter table ${q(r.fk.table)} add constraint ${q(fkName(r))} foreign key (${q(r.fk.field)}) references ${q(other.table)} (${q(other.field)})${del}${upd};\ncreate index if not exists ${q((r.fk.table + '_' + r.fk.field + '_idx').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 63))} on ${q(r.fk.table)} (${q(r.fk.field)});`
}
const OWNER_FIELDS = ['user_id', 'owner_id', 'userId', 'ownerId', 'created_by', 'createdBy', 'profile_id']
function rlsSql(t) {
  const candidate = t.fields.find((f) => OWNER_FIELDS.includes(f.name))
  const ownerType = candidate && pgType(candidate)
  const owner = ownerType === 'uuid' || ownerType === 'text' ? candidate : null
  const L = [`alter table ${q(t.name)} enable row level security;`]
  if (candidate && !owner) L.push(`-- ${candidate.name} is ${ownerType}, not a Supabase user id (uuid): owner policies not generated — link rows to auth.users(id) to use auth.uid().`)
  if (owner) {
    const c = ownerType === 'uuid' ? `(select auth.uid()) = ${q(owner.name)}` : `(select auth.uid())::text = ${q(owner.name)}`
    L.push(`-- Owner-based policies (review!): rows belong to ${owner.name}`,
      `create policy ${q(t.name + '_select_own')} on ${q(t.name)} for select to authenticated using (${c});`,
      `create policy ${q(t.name + '_insert_own')} on ${q(t.name)} for insert to authenticated with check (${c});`,
      `create policy ${q(t.name + '_update_own')} on ${q(t.name)} for update to authenticated using (${c}) with check (${c});`,
      `create policy ${q(t.name + '_delete_own')} on ${q(t.name)} for delete to authenticated using (${c});`)
  } else L.push(`-- TODO policies for ${t.name}: with RLS on and no policy, nobody (except service_role) can read or write it.`, `-- e.g. public read: create policy ${q(t.name + '_read')} on ${q(t.name)} for select to anon, authenticated using (true);`)
  return L.join('\n')
}
function fullSql(m, rls) {
  const L = []
  for (const e of m.enums) L.push(`create type ${q(e.name)} as enum (${e.values.map((v) => lit(v.name)).join(', ')});`)
  if (m.enums.length) L.push('')
  for (const t of m.tables) {
    if (t.note) L.push(`-- ${t.note.split('\n')[0]}`)
    const pk = t.fields.filter((f) => f.pk)
    const cols = t.fields.map((f) => '  ' + columnSql(f))
    if (pk.length) cols.push(`  primary key (${pk.map((f) => q(f.name)).join(', ')})`)
    L.push(`create table ${q(t.name)} (\n${cols.join(',\n')}\n);`)
    for (const f of t.fields.filter((x) => x.note)) L.push(`comment on column ${q(t.name)}.${q(f.name)} is ${lit(f.note)};`)
    L.push('')
  }
  for (const r of m.refs) L.push(refSql(r))
  if (rls) { L.push('', '-- Row Level Security (Supabase): every table locked by default, then explicit policies'); for (const t of m.tables) L.push(rlsSql(t), '') }
  return L.join('\n')
}

// ---------- diff against the last snapshot ----------
function diffSql(prev, cur, rls) {
  const L = []; const warn = []
  const pt = new Map(prev.tables.map((t) => [t.name, t])); const ct = new Map(cur.tables.map((t) => [t.name, t]))
  const pe = new Map(prev.enums.map((e) => [e.name, e]))
  for (const e of cur.enums) {
    const old = pe.get(e.name)
    if (!old) L.push(`create type ${q(e.name)} as enum (${e.values.map((v) => lit(v.name)).join(', ')});`)
    else for (const v of e.values) if (!old.values.some((x) => x.name === v.name)) L.push(`alter type ${q(e.name)} add value if not exists ${lit(v.name)};`)
    if (old) for (const v of old.values) if (!e.values.some((x) => x.name === v.name)) warn.push(`enum ${e.name}: value "${v.name}" removed — Postgres can't drop enum values; migrate data and recreate the type by hand`)
  }
  for (const e of prev.enums) if (!cur.enums.some((x) => x.name === e.name)) warn.push(`enum ${e.name} removed — drop it by hand after removing its uses: drop type ${q(e.name)};`)
  for (const t of cur.tables) {
    const old = pt.get(t.name)
    if (!old) { L.push(fullSql({ enums: [], tables: [t], refs: [] }, false).trim()); if (rls) L.push(rlsSql(t)); continue }
    for (const f of t.fields) {
      const of = old.fields.find((x) => x.name === f.name)
      if (!of) { L.push(`alter table ${q(t.name)} add column ${columnSql(f)};`); if (f.notNull && f.default == null && !f.pk) warn.push(`${t.name}.${f.name} is NOT NULL without default — fails if the table has rows; add a default or backfill first`); continue }
      if (pgType(of) !== pgType(f)) L.push(`alter table ${q(t.name)} alter column ${q(f.name)} type ${pgType(f)} using ${q(f.name)}::${pgType(f)}; -- was ${pgType(of)}, check data conversion`)
      if (of.notNull !== f.notNull && !f.pk) L.push(`alter table ${q(t.name)} alter column ${q(f.name)} ${f.notNull ? 'set' : 'drop'} not null;`)
      if (String(defaultSql(of)) !== String(defaultSql(f))) L.push(defaultSql(f) ? `alter table ${q(t.name)} alter column ${q(f.name)} set default ${defaultSql(f)};` : `alter table ${q(t.name)} alter column ${q(f.name)} drop default;`)
      if (of.unique !== f.unique && !f.pk) L.push(f.unique ? `alter table ${q(t.name)} add constraint ${q((t.name + '_' + f.name + '_key').toLowerCase())} unique (${q(f.name)});` : `alter table ${q(t.name)} drop constraint if exists ${q((t.name + '_' + f.name + '_key').toLowerCase())};`)
    }
    for (const f of old.fields) if (!t.fields.some((x) => x.name === f.name)) warn.push(`${t.name}.${f.name} removed — destructive; if intended: alter table ${q(t.name)} drop column ${q(f.name)};  (or a rename: alter table … rename column …)`)
  }
  for (const t of prev.tables) if (!ct.has(t.name)) warn.push(`table ${t.name} removed — destructive; if intended: drop table ${q(t.name)};  (or a rename: alter table … rename to …)`)
  const key = (r) => `${r.fk.table}.${r.fk.field}`
  for (const r of cur.refs) if (!prev.refs.some((x) => key(x) === key(r))) L.push(refSql(r))
  for (const r of prev.refs) if (!cur.refs.some((x) => key(x) === key(r))) L.push(`alter table ${q(r.fk.table)} drop constraint if exists ${q(fkName(r))};`)
  return { sql: L.join('\n'), warnings: warn }
}

// ---------- commands: sql / migration ----------
const header = (title) => `-- ${title}\n-- Generated by DualCraft from .dualcraft/db/schema.dbml on ${new Date().toISOString()}\n-- Review before applying. Destructive changes are never generated automatically.\n\n`
const strip = (m) => ({ enums: m.enums, tables: m.tables.map((t) => ({ name: t.name, note: t.note, fields: t.fields })), refs: m.refs.map((r) => ({ a: r.a, b: r.b, fk: r.fk, settings: r.settings })) })

if (cmd === 'sql') {
  const sql = header('Full schema') + fullSql(model, !!opt.rls || provider === 'supabase')
  if (opt.stdout || !opt.out) { console.log(sql); process.exit(0) }
  fs.mkdirSync(path.dirname(path.resolve(String(opt.out))), { recursive: true }); fs.writeFileSync(path.resolve(String(opt.out)), sql); console.log('→ ' + rel(path.resolve(String(opt.out)))); process.exit(0)
}
if (cmd === 'migration') {
  if (provider === 'firebase') die('Firestore has no SQL migrations — use: gen.mjs rules (and firestore.indexes.json); see /dualcraft:database')
  if (provider === 'postgres-prisma' && !opt.force) die('with Prisma, migrations are created by Prisma: run "database.mjs prisma" then "npx prisma migrate dev --name <name>" (or pass --force to get raw SQL)')
  const name = (pos[0] || 'schema').toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  const rls = opt.rls !== undefined ? !!opt.rls : provider === 'supabase'
  const prev = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : null
  let body; let warnings = []
  if (!prev) body = fullSql(model, rls)
  else { const d = diffSql(prev.model, strip(model), rls); body = d.sql; warnings = d.warnings }
  if (!body.trim() && !warnings.length) { console.log('No schema changes since the last migration (' + (prev?.migration || '—') + ').'); process.exit(0) }
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const outDir = opt.out ? path.resolve(String(opt.out)) : path.join(root, 'supabase', 'migrations')
  const file = path.join(outDir, `${ts}_${name}.sql`)
  const text = header(prev ? `Migration "${name}" (changes since ${prev.migration})` : `Initial migration "${name}"`) + (body || '-- (no automatic statements — see warnings)') + (warnings.length ? '\n\n-- ⚠ Manual review needed:\n' + warnings.map((w) => '-- ' + w).join('\n') : '') + '\n'
  if (opt.dry) { console.log(text); warnings.forEach((w) => console.error('⚠ ' + w)); process.exit(0) }
  fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(file, text)
  fs.writeFileSync(snapFile, JSON.stringify({ migration: path.basename(file), generated: new Date().toISOString(), model: strip(model) }, null, 2) + '\n')
  console.log(`→ ${rel(file)}${prev ? '' : ' (initial)'}`)
  warnings.forEach((w) => console.log('⚠ ' + w))
  console.log(`Snapshot updated (.dualcraft/db/snapshot.json). Apply locally: supabase db reset (or supabase migration up); to a linked project: supabase db push.`)
  process.exit(0)
}

// ---------- prisma ----------
if (cmd === 'prisma') {
  const pascal = (s) => s.replace(/(^|[_\s-]+)(\w)/g, (_, __, c) => c.toUpperCase())
  const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1) }
  const prismaType = (f) => {
    if (enumNames.has(f.baseType)) return pascal(f.baseType)
    const t = f.baseType.toLowerCase()
    if (/^(int|integer|int4|serial|smallint|int2|tinyint)$/.test(t)) return 'Int'
    if (/^(bigint|int8|bigserial)$/.test(t)) return 'BigInt'
    if (/^(float|double|real|float8|number)$/.test(t)) return 'Float'
    if (/^(decimal|numeric|money)$/.test(t)) return 'Decimal'
    if (/^(bool|boolean)$/.test(t)) return 'Boolean'
    if (/^(timestamp|timestamptz|datetime|date|time)$/.test(t)) return 'DateTime'
    if (/^(json|jsonb|map|object)$/.test(t)) return 'Json'
    return 'String'
  }
  const L = ['// Generated by DualCraft from .dualcraft/db/schema.dbml — change the DBML and run /dualcraft:database, not this file.', '', 'generator client {', '  provider = "prisma-client-js"', '}', '', 'datasource db {', '  provider = "postgresql"', '  url      = env("DATABASE_URL")', '}', '']
  const warn = []
  for (const e of model.enums) { L.push(`enum ${pascal(e.name)} {`); for (const v of e.values) L.push(/^[A-Za-z_]\w*$/.test(v.name) ? `  ${v.name}` : `  ${v.name.replace(/\W/g, '_')} @map("${v.name}")`); L.push('}', '') }
  const relLines = new Map(model.tables.map((t) => [t.name, []]))
  // field names already used per model (scalars + relations) — relation names must not collide
  const used = new Map(model.tables.map((t) => [t.name, new Set(t.fields.map((f) => camel(f.name)))]))
  const uniqueName = (table, want) => { const set = used.get(table); let n = want; let i = 2; while (set.has(n)) n = want + i++; set.add(n); return n }
  for (const r of model.refs) {
    if (r.aMany && r.bMany) { warn.push(`many-to-many ${r.a.table} <> ${r.b.table}: model the join table explicitly in the DBML`); continue }
    const fkT = r.fk.table; const other = r.fk.table === r.a.table && r.fk.field === r.a.field ? r.b : r.a
    const relName = `${fkT}_${r.fk.field}`
    const base = r.fk.field.replace(/(_id|Id|ID)$/, '') || other.table
    const field = model.tables.find((t) => t.name === fkT).fields.find((f) => f.name === r.fk.field)
    const oneToOne = !r.aMany && !r.bMany
    const fwd = uniqueName(fkT, camel(base) === camel(r.fk.field) ? camel(other.table) : camel(base))
    const back = uniqueName(other.table, `${camel(fkT)}${pascal(base === r.fk.field ? '' : base)}${oneToOne ? '' : 's'}`)
    relLines.get(fkT).push(`  ${fwd} ${pascal(other.table)}${field.notNull ? '' : '?'} @relation("${relName}", fields: [${camel(r.fk.field)}], references: [${camel(other.field)}]${r.settings?.delete ? `, onDelete: ${pascal(r.settings.delete.replace(/\s+/g, '_').toLowerCase())}` : ''})`)
    relLines.get(other.table).push(`  ${back} ${pascal(fkT)}${oneToOne ? '?' : '[]'} @relation("${relName}")`)
    if (oneToOne) field._unique = true
  }
  for (const t of model.tables) {
    L.push(`model ${pascal(t.name)} {`)
    for (const f of t.fields) {
      const attrs = []
      if (f.pk) attrs.push('@id')
      if (f.pk && f.increment) attrs.push('@default(autoincrement())')
      else if (f.pk && prismaType(f) === 'String' && f.default == null) attrs.push(f.baseType === 'uuid' ? '@default(uuid()) @db.Uuid' : '@default(cuid())')
      else if (f.default != null) { const d = String(f.default).replace(/^`|`$/g, ''); attrs.push(/^now\(\)$/i.test(d) ? '@default(now())' : /^(true|false|-?\d+(\.\d+)?)$/.test(d) ? `@default(${d})` : enumNames.has(f.baseType) ? `@default(${d.replace(/^['"]|['"]$/g, '')})` : `@default("${d.replace(/^['"]|['"]$/g, '')}")`) }
      if ((f.unique || f._unique) && !f.pk) attrs.push('@unique')
      if (camel(f.name) !== f.name) attrs.push(`@map("${f.name}")`)
      const type = prismaType(f) + (f.isArray ? '[]' : !f.notNull && !f.pk ? '?' : '')
      L.push(`  ${camel(f.name)} ${type}${attrs.length ? ' ' + attrs.join(' ') : ''}${f.note ? ' /// ' + f.note : ''}`)
    }
    L.push(...relLines.get(t.name))
    if (pascal(t.name) !== t.name) L.push(`\n  @@map("${t.name}")`)
    L.push('}', '')
  }
  const text = L.join('\n')
  if (opt.stdout) { console.log(text); warn.forEach((w) => console.error('⚠ ' + w)); process.exit(0) }
  const out = opt.out ? path.resolve(String(opt.out)) : path.join(root, config.paths?.web || '', 'prisma', 'schema.prisma')
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text)
  console.log(`→ ${rel(out)}`); warn.forEach((w) => console.log('⚠ ' + w))
  console.log('Next: npx prisma format && npx prisma validate, then npx prisma migrate dev --name <name> (local/dev) · npx prisma migrate deploy (prod)')
}
