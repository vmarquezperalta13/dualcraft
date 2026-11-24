#!/usr/bin/env node
// DualCraft backend: .dualcraft/backend/api.json is the contract of every server function (Firebase Cloud Functions,
// Supabase Edge Functions or the web's own API routes). From it DualCraft generates the server validators and a typed
// client for every stack, scaffolds new functions and checks that code and contract agree.
//   init [--provider firebase|supabase|http] [--region europe-west1]   contract + functions folder
//   add <name> --kind callable|http|webhook|trigger|schedule [--auth user|public|admin] [--on …] [--cron "…"] [--tz …]
//       [--desc "…"] [--origin T-12] [--platforms web,mobile]                            declare + scaffold (+ gen)
//   gen [--force] [--stdout]     server contract (validators) + typed clients (TS, Dart, Kotlin, Swift)
//   check [--json]               contract valid, every function implemented, regions, v1/v2, clients in sync
//   list                         functions found in the code and their contract status
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks, outputFor } from './lib/targets.mjs'
import * as T from './lib/backend-templates.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt, pos } = parseArgs(rest)
const CMDS = ['init', 'add', 'gen', 'check', 'list']
if (cmd === 'help' || !CMDS.includes(cmd)) {
  console.log(`node backend.mjs init [--provider firebase|supabase|http] [--region <r>] | add <name> --kind <k> | gen [--force] | check | list
api.json: {"provider":"firebase","region":"europe-west1","functions":[
  {"name":"redeemCode","kind":"callable","auth":"user","description":"Canjea un código","platforms":["web","mobile"],
   "input":{"code":{"type":"string","required":true,"pattern":"^[A-Z0-9_-]{3,32}$"}},
   "output":{"coins":{"type":"int","required":true}},"errors":["not-found","already-exists"],"origin":"T-012"},
  {"name":"stripeWebhook","kind":"webhook"}, {"name":"onUserCreated","kind":"trigger","on":"firestore.created:users/{uid}"},
  {"name":"dailyCleanup","kind":"schedule","cron":"0 3 * * *"}]}
field: type string|int|double|bool|json · required · array · values[] · min/max · minLength/maxLength/pattern · maxItems`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'backend', 'api.json')
const rel = (p) => posix(path.relative(root, p))
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const writeNew = (p, s) => { if (fs.existsSync(p)) return null; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return rel(p) }

// ---------------------------------------------------------------- names
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
const camel = (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('')
const pascal = (s) => { const c = camel(s); return c[0].toUpperCase() + c.slice(1) }
const kebab = (s) => words(s).map((w) => w.toLowerCase()).join('-')
const snakeUp = (s) => words(s).map((w) => w.toUpperCase()).join('_')
const fnInfo = (f) => ({ ...f, pascal: pascal(f.name), slug: kebab(f.name), secret: f.secret || snakeUp(f.name).replace(/_(WEBHOOK|CRON|JOB)$/, '') + (f.kind === 'webhook' ? '_WEBHOOK_SECRET' : '_SECRET'), auth: f.auth || 'user' })

// ---------------------------------------------------------------- contract
const PROVIDERS = ['firebase', 'supabase', 'http']
const KINDS = ['callable', 'http', 'webhook', 'trigger', 'schedule']
const TYPES = ['string', 'int', 'double', 'bool', 'json']
const AUTH = ['user', 'public', 'admin']
const CODES = ['cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found', 'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated']
const providerOf = (c) => c.provider || ({ firebase: 'firebase', supabase: 'supabase', 'postgres-prisma': 'http' })[config.backend?.provider] || null

function loadContract() {
  if (!fs.existsSync(file)) die('no .dualcraft/backend/api.json yet — run /dualcraft:backend (init) first')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`api.json is not valid JSON: ${e.message}`) }
}
const saveContract = (c) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n') }

function validate(c) {
  const errors = []; const warnings = []
  const prov = providerOf(c)
  if (!PROVIDERS.includes(prov)) errors.push(`provider must be ${PROVIDERS.join('|')} (or set backend.provider in the config)`)
  if (prov === 'firebase' && !/^[a-z]+-[a-z]+\d+$/.test(c.region || '')) errors.push('firebase: "region" is required (e.g. europe-west1) — every function and every client use it')
  const seen = new Set()
  for (const f of c.functions || []) {
    const w = `function "${f.name}"`
    if (!/^[a-z][A-Za-z0-9]{1,62}$/.test(f.name || '')) errors.push(`${w}: name must be lowerCamelCase (letters and digits)`)
    if (seen.has(f.name)) errors.push(`${w}: duplicated`)
    seen.add(f.name)
    if (!KINDS.includes(f.kind)) { errors.push(`${w}: kind must be ${KINDS.join('|')}`); continue }
    if (f.auth && !AUTH.includes(f.auth)) errors.push(`${w}: auth must be ${AUTH.join('|')}`)
    if (!f.description) warnings.push(`${w}: no description`)
    if (f.platforms && f.platforms.some((p) => !['web', 'mobile'].includes(p))) errors.push(`${w}: platforms must be "web" and/or "mobile"`)
    if (f.kind === 'callable' || f.kind === 'http') {
      for (const part of ['input', 'output']) {
        for (const [k, s] of Object.entries(f[part] || {})) {
          const where = `${w} ${part}.${k}`
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) errors.push(`${where}: field names are identifiers (letters, digits, _)`)
          if (!TYPES.includes(s.type)) { errors.push(`${where}: type must be ${TYPES.join('|')}`); continue }
          if (s.values && (s.type !== 'string' || !Array.isArray(s.values) || !s.values.length || s.values.some((v) => typeof v !== 'string' || !/[A-Za-z0-9]/.test(v)))) errors.push(`${where}: values[] only for string fields (non-empty strings)`)
          if ((s.min !== undefined || s.max !== undefined) && !['int', 'double'].includes(s.type)) errors.push(`${where}: min/max only for int/double`)
          if ((s.minLength !== undefined || s.maxLength !== undefined || s.pattern) && s.type !== 'string') errors.push(`${where}: minLength/maxLength/pattern only for strings`)
          if (s.pattern) { try { new RegExp(s.pattern) } catch { errors.push(`${where}: invalid pattern`) } }
          if (part === 'input' && s.type === 'string' && !s.values && s.maxLength === undefined && !s.pattern) warnings.push(`${where}: no maxLength/pattern (defaults to 5000 chars)`)
        }
      }
      for (const e of f.errors || []) if (!CODES.includes(e)) warnings.push(`${w}: error "${e}" is not a standard code (${CODES.slice(0, 6).join(', ')}…)`)
      if (prov === 'firebase' && f.kind === 'http' && f.auth !== 'public') warnings.push(`${w}: prefer kind "callable" for app clients on Firebase (auth + App Check built in); "http" is for REST consumers`)
    }
    if (f.kind === 'trigger') {
      if (prov === 'http') errors.push(`${w}: triggers need Firebase or Supabase (use "schedule" or a webhook on your own server)`)
      if (prov === 'firebase' && !T.firebaseTriggerKinds.includes(T.splitOn(f.on || '')[0])) errors.push(`${w}: "on" must be one of ${T.firebaseTriggerKinds.join(', ')} (with ":<path|topic>" where needed, e.g. firestore.created:users/{uid})`)
      if (prov === 'firebase' && /^(firestore|pubsub)/.test(f.on || '') && !T.splitOn(f.on)[1]) errors.push(`${w}: "${f.on}" needs a document path or topic after ":"`)
      if (prov === 'supabase' && !/^db:[a-z_][a-z0-9_]*\.(insert|update|delete)$/.test(f.on || '')) errors.push(`${w}: "on" must be db:<table>.<insert|update|delete> (a Database Webhook)`)
    }
    if (f.kind === 'schedule' && String(f.cron || '').trim().split(/\s+/).length !== 5) errors.push(`${w}: "cron" must have 5 fields, e.g. "0 3 * * *"`)
  }
  return { errors, warnings, prov }
}

// ---------------------------------------------------------------- where things live
const functionsDir = () => {
  if (config.paths?.functions) return path.join(root, config.paths.functions)
  try { const fj = JSON.parse(read(path.join(root, 'firebase.json'))); const s = [].concat(fj.functions || [])[0]?.source; if (s) return path.join(root, s) } catch { /* none */ }
  return path.join(root, 'functions')
}
const webServer = () => projectStacks(root, config).find((s) => s.id === 'nextjs' || s.id === 'nuxt')
const nextAppDir = (d) => ['src/app', 'app'].map((x) => path.join(d, x)).find((p) => fs.existsSync(p)) || path.join(d, fs.existsSync(path.join(d, 'src')) ? 'src/app' : 'app')
function serverContractFile(prov) {
  if (config.backend?.out?.server) return path.join(root, config.backend.out.server)
  if (prov === 'firebase') return path.join(functionsDir(), 'src', 'generated', 'api.ts')
  if (prov === 'supabase') return path.join(root, 'supabase', 'functions', '_shared', 'api.ts')
  const w = webServer()
  if (!w) die('provider "http" needs a Next.js or Nuxt stack (the API lives in the web server) — or set backend.out.server in the config')
  if (w.id === 'nuxt') return path.join(w.dir, 'server', 'utils', 'api-contract.ts')
  return path.join(w.dir, fs.existsSync(path.join(w.dir, 'src')) ? 'src' : '', 'server', 'api-contract.ts')
}
function implFile(f, prov) {
  if (prov === 'firebase') return path.join(functionsDir(), 'src', `${f.name}.ts`)
  if (prov === 'supabase') return path.join(root, 'supabase', 'functions', f.slug, 'index.ts')
  const w = webServer()
  if (w.id === 'nuxt') return path.join(w.dir, 'server', 'api', `${f.slug}.${f.kind === 'schedule' ? 'get' : 'post'}.ts`)
  return path.join(nextAppDir(w.dir), 'api', f.slug, 'route.ts')
}
const endpoint = (f, prov) => (prov === 'firebase' ? f.name : prov === 'supabase' ? f.slug : '/api/' + f.slug)
const importPath = (from, to) => { let r = posix(path.relative(path.dirname(from), to)).replace(/\.ts$/, ''); if (!r.startsWith('.')) r = './' + r; return r }

// ---------------------------------------------------------------- generators
const clientFns = (c, kind) => (c.functions || []).filter((f) => f.kind === 'callable' && (f.platforms || ['web', 'mobile']).includes(kind)).map(fnInfo)
const typed = (c) => (c.functions || []).filter((f) => f.kind === 'callable' || f.kind === 'http').map(fnInfo)
const fieldsOf = (f, part) => Object.entries(f[part] || {})
const enumName = (f, part, k) => f.pascal + pascal(k)
const docLine = (s) => String(s || '').replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim()
const fnDoc = (f) => { const d = docLine(f.description || f.name); return f.errors?.length ? `${d}${/[.!?]$/.test(d) ? '' : '.'} Errors: ${f.errors.join(', ')}.` : d }
const HEAD = (lang) => `// GENERATED by DualCraft from .dualcraft/backend/api.json — do not edit. Change the contract and run /dualcraft:backend gen.${lang ? '\n' + lang : ''}`

// TypeScript type of a field
const tsBase = (s) => (s.values ? s.values.map((v) => JSON.stringify(v)).join(' | ') : { string: 'string', int: 'number', double: 'number', bool: 'boolean', json: 'unknown' }[s.type])
const tsType = (s) => { const b = tsBase(s); return s.array ? (s.values ? `(${b})[]` : `${b}[]`) : b }
const tsIface = (name, fields) => fields.length ? [`export interface ${name} {`, ...fields.map(([k, s]) => `  ${s.description ? `/** ${docLine(s.description)} */ ` : ''}${k}${s.required ? '' : '?'}: ${tsType(s)}`), '}'] : [`export type ${name} = Record<string, never>`]

function genServerTs(c, prov) {
  const L = [HEAD('// Server side: request validators (unknown fields are rejected) and response types.'), '']
  if (prov === 'firebase') L.push(`/** Region of every function. Clients must call the same one. */`, `export const REGION = ${JSON.stringify(c.region)}`, '')
  L.push(
    'export class ApiInputError extends Error {',
    '  constructor(public readonly field: string, message: string) { super(message); this.name = \'ApiInputError\' }',
    '}',
    "type Spec = { type: 'string' | 'int' | 'double' | 'bool' | 'json'; required?: boolean; array?: boolean; values?: readonly string[]; min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; maxItems?: number }",
    '',
    'function one(k: string, v: unknown, s: Spec): unknown {',
    "  if (s.type === 'string') {",
    "    if (typeof v !== 'string') throw new ApiInputError(k, k + ' must be a string')",
    "    if (s.values && !s.values.includes(v)) throw new ApiInputError(k, k + ' must be one of ' + s.values.join(', '))",
    "    if (s.minLength !== undefined && v.length < s.minLength) throw new ApiInputError(k, k + ' is too short')",
    "    if (v.length > (s.maxLength ?? 5000)) throw new ApiInputError(k, k + ' is too long')",
    "    if (s.pattern !== undefined && !new RegExp(s.pattern).test(v)) throw new ApiInputError(k, k + ' has an invalid format')",
    '    return v',
    '  }',
    "  if (s.type === 'int' || s.type === 'double') {",
    "    if (typeof v !== 'number' || !Number.isFinite(v) || (s.type === 'int' && !Number.isInteger(v))) throw new ApiInputError(k, k + ' must be ' + (s.type === 'int' ? 'an integer' : 'a number'))",
    "    if ((s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max)) throw new ApiInputError(k, k + ' is out of range')",
    '    return v',
    '  }',
    "  if (s.type === 'bool') { if (typeof v !== 'boolean') throw new ApiInputError(k, k + ' must be a boolean'); return v }",
    '  return v',
    '}',
    '',
    '/** Validates a request body against a field spec; returns only the declared fields. */',
    'export function parseObject(data: unknown, specs: Record<string, Spec>): Record<string, unknown> {',
    "  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ApiInputError('', 'the body must be an object')",
    '  const o = data as Record<string, unknown>',
    '  const out: Record<string, unknown> = {}',
    "  for (const k of Object.keys(o)) if (!Object.prototype.hasOwnProperty.call(specs, k)) throw new ApiInputError(k, 'unknown field ' + k)",
    '  for (const k of Object.keys(specs)) {',
    '    const s = specs[k]; const v = o[k]',
    "    if (v === undefined || v === null) { if (s.required) throw new ApiInputError(k, k + ' is required'); continue }",
    '    if (s.array) {',
    "      if (!Array.isArray(v)) throw new ApiInputError(k, k + ' must be a list')",
    "      if (v.length > (s.maxItems ?? 1000)) throw new ApiInputError(k, k + ' has too many items')",
    "      out[k] = v.map((x, i) => one(k + '[' + i + ']', x, s))",
    '    } else out[k] = one(k, v, s)',
    '  }',
    '  return out',
    '}',
    '')
  for (const f of typed(c)) {
    L.push(`// ---- ${f.name} (${f.kind}, auth: ${f.auth})${f.description ? ' — ' + docLine(f.description) : ''}`)
    L.push(...tsIface(`${f.pascal}Input`, fieldsOf(f, 'input')), ...tsIface(`${f.pascal}Output`, fieldsOf(f, 'output')))
    const spec = Object.fromEntries(fieldsOf(f, 'input').map(([k, s]) => [k, Object.fromEntries(['type', 'required', 'array', 'values', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'maxItems'].filter((x) => s[x] !== undefined).map((x) => [x, s[x]]))]))
    L.push(`const ${f.name}Spec: Record<string, Spec> = ${JSON.stringify(spec)}`)
    L.push(`export const parse${f.pascal}Input = (data: unknown): ${f.pascal}Input => parseObject(data, ${f.name}Spec) as unknown as ${f.pascal}Input`, '')
  }
  return L.join('\n')
}

function genTsClient(fns, prov) {
  const L = [HEAD('// Client: typed calls through an ApiTransport you provide once (see /dualcraft:backend → "Transports").'), '',
    `export type ApiErrorCode = ${CODES.map((x) => `'${x}'`).join(' | ')}`,
    'export class ApiError extends Error {',
    "  constructor(public readonly code: ApiErrorCode | string, message?: string) { super(message ?? code); this.name = 'ApiError' }",
    '}',
    '/** Sends one call to the backend and returns the decoded JSON result; throws ApiError(code) on failure. */',
    'export interface ApiTransport { call(endpoint: string, data: object): Promise<unknown> }', '']
  for (const f of fns) L.push(...tsIface(`${f.pascal}Input`, fieldsOf(f, 'input')), ...tsIface(`${f.pascal}Output`, fieldsOf(f, 'output')), '')
  L.push('export function createApi(transport: ApiTransport) {', '  return {')
  for (const f of fns) {
    const hasIn = fieldsOf(f, 'input').length; const hasOut = fieldsOf(f, 'output').length
    L.push(`    /** ${fnDoc(f)} */`)
    L.push(`    ${f.name}: (${hasIn ? `input: ${f.pascal}Input` : ''}): Promise<${hasOut ? f.pascal + 'Output' : 'void'}> => transport.call(${JSON.stringify(endpoint(f, prov))}, ${hasIn ? 'input' : '{}'})${hasOut ? ` as Promise<${f.pascal}Output>` : '.then(() => undefined)'},`)
  }
  L.push('  }', '}', 'export type Api = ReturnType<typeof createApi>', '')
  return L.join('\n')
}

// Dart
const DART_RESERVED = new Set('abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield'.split(' '))
const dId = (k) => { const c = camel(k); return DART_RESERVED.has(c) ? c + 'Value' : c }
const enumCase = (v) => { const c = camel(v.replace(/[^A-Za-z0-9]+/g, ' ')); return /^[0-9]/.test(c) ? 'v' + c : c }
function genDart(fns, prov) {
  const L = [HEAD(), "// ignore_for_file: prefer_const_constructors, unnecessary_cast", '',
    'class ApiError implements Exception {', '  final String code;', '  final String? message;', '  const ApiError(this.code, [this.message]);',
    "  @override\n  String toString() => 'ApiError($code${message == null ? \"\" : \": $message\"})';", '}', '',
    '/// Sends one call to the backend and returns the decoded result; throws [ApiError] on failure.',
    'abstract class ApiTransport {', '  Future<Object?> call(String endpoint, Map<String, Object?> data);', '}', '',
    "Map<String, Object?> _map(Object? v) => v == null ? <String, Object?>{} : Map<String, Object?>.from(v as Map);", '']
  const dBase = (f, part, k, s) => (s.values ? enumName(f, part, k) : { string: 'String', int: 'int', double: 'double', bool: 'bool', json: 'Object?' }[s.type])
  const dType = (f, part, k, s) => { const b = dBase(f, part, k, s); return s.array ? `List<${b}>` : b }
  const dec = (f, part, k, s, x) => (s.values ? `${enumName(f, part, k)}.fromValue(${x} as String)` : { string: `${x} as String`, int: `(${x} as num).toInt()`, double: `(${x} as num).toDouble()`, bool: `${x} as bool`, json: x }[s.type])
  const enc = (s, x) => (s.values ? (s.array ? `${x}.map((e) => e.value).toList()` : `${x}.value`) : x)
  for (const f of fns) {
    for (const part of ['input', 'output']) for (const [k, s] of fieldsOf(f, part)) if (s.values) {
      const n = enumName(f, part, k)
      L.push(`enum ${n} {`, '  ' + s.values.map((v) => `${enumCase(v)}(${JSON.stringify(v)})`).join(',\n  ') + ';', `  const ${n}(this.value);`, '  final String value;', `  static ${n} fromValue(String v) => values.firstWhere((e) => e.value == v, orElse: () => throw ApiError('internal', 'unknown ${n} ' + v));`, '}', '')
    }
    const ins = fieldsOf(f, 'input'); const outs = fieldsOf(f, 'output')
    if (ins.length) {
      L.push(`class ${f.pascal}Input {`)
      for (const [k, s] of ins) L.push(`  final ${dType(f, 'input', k, s)}${s.required || s.type === 'json' ? '' : '?'} ${dId(k)};`)
      L.push(`  const ${f.pascal}Input({${ins.map(([k, s]) => `${s.required ? 'required ' : ''}this.${dId(k)}`).join(', ')}});`)
      L.push('  Map<String, Object?> toMap() => {')
      for (const [k, s] of ins) L.push(s.required ? `    '${k}': ${enc(s, dId(k))},` : `    if (${dId(k)} != null) '${k}': ${enc(s, dId(k) + (s.type === 'json' ? '' : '!'))},`)
      L.push('  };', '}', '')
    }
    if (outs.length) {
      L.push(`class ${f.pascal}Output {`)
      for (const [k, s] of outs) L.push(`  final ${dType(f, 'output', k, s)}${s.required || s.type === 'json' ? '' : '?'} ${dId(k)};`)
      L.push(`  const ${f.pascal}Output({${outs.map(([k, s]) => `${s.required ? 'required ' : ''}this.${dId(k)}`).join(', ')}});`)
      L.push(`  factory ${f.pascal}Output.fromMap(Map<String, Object?> m) => ${f.pascal}Output(`)
      for (const [k, s] of outs) {
        const x = `m['${k}']`
        const v = s.array ? (s.required ? `(${x} as List).map((e) => ${dec(f, 'output', k, s, 'e')}).toList()` : `(${x} as List?)?.map((e) => ${dec(f, 'output', k, s, 'e')}).toList()`)
          : s.required || s.type === 'json' ? dec(f, 'output', k, s, x) : `${x} == null ? null : ${dec(f, 'output', k, s, x)}`
        L.push(`    ${dId(k)}: ${v},`)
      }
      L.push('  );', '}', '')
    }
  }
  L.push('/// Typed backend API. Create once with your transport: `final api = Api(FirebaseApiTransport())`.', 'class Api {', '  final ApiTransport _t;', '  const Api(this._t);')
  for (const f of fns) {
    const hasIn = fieldsOf(f, 'input').length; const hasOut = fieldsOf(f, 'output').length
    const call = `_t.call(${JSON.stringify(endpoint(f, prov))}, ${hasIn ? 'input.toMap()' : '<String, Object?>{}'})`
    L.push('', `  /// ${fnDoc(f)}`)
    L.push(hasOut ? `  Future<${f.pascal}Output> ${dId(f.name)}(${hasIn ? `${f.pascal}Input input` : ''}) async => ${f.pascal}Output.fromMap(_map(await ${call}));`
      : `  Future<void> ${dId(f.name)}(${hasIn ? `${f.pascal}Input input` : ''}) async { await ${call}; }`)
  }
  L.push('}', '')
  return L.join('\n')
}

// Kotlin
const KT_RESERVED = new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' '))
const kId = (k) => { const c = camel(k); return KT_RESERVED.has(c) ? '`' + c + '`' : c }
const KT_ENUM = (v) => snakeUp(v.replace(/[^A-Za-z0-9]+/g, ' ')).replace(/^(\d)/, 'V$1')
function genKotlin(fns, prov, pkg) {
  const L = [HEAD(), `package ${pkg}`, '',
    'class ApiError(val code: String, message: String? = null) : Exception(message ?: code)', '',
    '/** Sends one call to the backend and returns the decoded result (maps, lists, numbers, strings); throws [ApiError] on failure. */',
    'interface ApiTransport {', '    suspend fun call(endpoint: String, data: Map<String, Any?>): Any?', '}', '',
    '@Suppress("UNCHECKED_CAST")', 'private fun asMap(v: Any?): Map<String, Any?> = (v as? Map<String, Any?>) ?: emptyMap()', '']
  const kBase = (f, part, k, s) => (s.values ? enumName(f, part, k) : { string: 'String', int: 'Long', double: 'Double', bool: 'Boolean', json: 'Any?' }[s.type])
  const kType = (f, part, k, s) => { const b = kBase(f, part, k, s); return s.array ? `List<${b}>` : b }
  const dec = (f, part, k, s, x) => (s.values ? `${enumName(f, part, k)}.fromValue(${x} as String)` : { string: `${x} as String`, int: `(${x} as Number).toLong()`, double: `(${x} as Number).toDouble()`, bool: `${x} as Boolean`, json: x }[s.type])
  const enc = (s, x) => (s.values ? (s.array ? `${x}.map { it.value }` : `${x}.value`) : x)
  const opt = (s) => !s.required && s.type !== 'json'
  for (const f of fns) {
    for (const part of ['input', 'output']) for (const [k, s] of fieldsOf(f, part)) if (s.values) {
      const n = enumName(f, part, k)
      L.push(`enum class ${n}(val value: String) {`, '    ' + s.values.map((v) => `${KT_ENUM(v)}(${JSON.stringify(v)})`).join(',\n    ') + ';', `    companion object { fun fromValue(v: String): ${n} = entries.firstOrNull { it.value == v } ?: throw ApiError("internal", "unknown ${n} " + v) }`, '}', '')
    }
    const ins = fieldsOf(f, 'input'); const outs = fieldsOf(f, 'output')
    if (ins.length) {
      L.push(`data class ${f.pascal}Input(`, ins.map(([k, s]) => `    val ${kId(k)}: ${kType(f, 'input', k, s)}${opt(s) ? '? = null' : s.type === 'json' && !s.required ? ' = null' : ''}`).join(',\n'), ') {')
      L.push('    fun toMap(): Map<String, Any?> = buildMap {')
      for (const [k, s] of ins) L.push(!s.required ? `        ${kId(k)}?.let { put("${k}", ${enc(s, 'it')}) }` : `        put("${k}", ${enc(s, kId(k))})`)
      L.push('    }', '}', '')
    }
    if (outs.length) {
      L.push(`data class ${f.pascal}Output(`, outs.map(([k, s]) => `    val ${kId(k)}: ${kType(f, 'output', k, s)}${opt(s) ? '?' : ''}`).join(',\n'), ') {')
      L.push(`    companion object {`, `        fun fromMap(m: Map<String, Any?>): ${f.pascal}Output = ${f.pascal}Output(`)
      const lines = outs.map(([k, s]) => {
        const x = `m["${k}"]`
        const v = s.array ? (s.required ? `(${x} as List<*>).map { ${dec(f, 'output', k, s, 'it!!')} }` : `(${x} as List<*>?)?.map { ${dec(f, 'output', k, s, 'it!!')} }`)
          : s.required || s.type === 'json' ? dec(f, 'output', k, s, x) : `${x}?.let { ${dec(f, 'output', k, s, 'it')} }`
        return `            ${kId(k)} = ${v}`
      })
      L.push(lines.join(',\n'), '        )', '    }', '}', '')
    }
  }
  L.push('/** Typed backend API. Create once with your transport: `val api = Api(FirebaseApiTransport())`. */', 'class Api(private val transport: ApiTransport) {')
  for (const f of fns) {
    const hasIn = fieldsOf(f, 'input').length; const hasOut = fieldsOf(f, 'output').length
    const call = `transport.call(${JSON.stringify(endpoint(f, prov))}, ${hasIn ? 'input.toMap()' : 'emptyMap()'})`
    L.push(`    /** ${fnDoc(f)} */`)
    L.push(hasOut ? `    suspend fun ${kId(f.name)}(${hasIn ? `input: ${f.pascal}Input` : ''}): ${f.pascal}Output = ${f.pascal}Output.fromMap(asMap(${call}))`
      : `    suspend fun ${kId(f.name)}(${hasIn ? `input: ${f.pascal}Input` : ''}) { ${call} }`)
  }
  L.push('}', '')
  return L.join('\n')
}

// Swift
const SW_RESERVED = new Set('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try'.split(' '))
const sId = (k) => { const c = camel(k); return SW_RESERVED.has(c) ? '`' + c + '`' : c }
const sBare = (k) => camel(k)
function genSwift(fns, prov) {
  const L = [HEAD(), 'import Foundation', '',
    'struct ApiError: Error, Equatable {', '    let code: String', '    let message: String?', '    init(_ code: String, _ message: String? = nil) { self.code = code; self.message = message }', '}', '',
    '/// Sends one call to the backend and returns the decoded result; throws `ApiError` on failure.',
    'protocol ApiTransport {', '    func call(_ endpoint: String, _ data: [String: Any]) async throws -> Any?', '}', '',
    'private func _map(_ v: Any?) -> [String: Any] { v as? [String: Any] ?? [:] }',
    'private func _bad(_ k: String) -> ApiError { ApiError("internal", "bad field " + k) }',
    'private func _str(_ v: Any?, _ k: String) throws -> String { guard let s = v as? String else { throw _bad(k) }; return s }',
    'private func _int(_ v: Any?, _ k: String) throws -> Int { if let n = v as? NSNumber { return n.intValue }; if let i = v as? Int { return i }; throw _bad(k) }',
    'private func _dbl(_ v: Any?, _ k: String) throws -> Double { if let n = v as? NSNumber { return n.doubleValue }; if let d = v as? Double { return d }; throw _bad(k) }',
    'private func _bool(_ v: Any?, _ k: String) throws -> Bool { guard let b = v as? Bool else { throw _bad(k) }; return b }',
    'private func _list(_ v: Any?, _ k: String) throws -> [Any] { guard let a = v as? [Any] else { throw _bad(k) }; return a }',
    'private func _enum<E: RawRepresentable>(_ v: Any?, _ k: String, _ t: E.Type) throws -> E where E.RawValue == String { guard let s = v as? String, let e = E(rawValue: s) else { throw _bad(k) }; return e }',
    'private func _opt<T>(_ v: Any?, _ f: (Any?) throws -> T) rethrows -> T? { if v == nil || v is NSNull { return nil }; return try f(v) }', '']
  const sBase = (f, part, k, s) => (s.values ? enumName(f, part, k) : { string: 'String', int: 'Int', double: 'Double', bool: 'Bool', json: 'Any?' }[s.type])
  const sType = (f, part, k, s) => { const b = sBase(f, part, k, s); return s.array ? `[${b}]` : b }
  const dec = (f, part, k, s, x) => (s.values ? `try _enum(${x}, "${k}", ${enumName(f, part, k)}.self)` : { string: `try _str(${x}, "${k}")`, int: `try _int(${x}, "${k}")`, double: `try _dbl(${x}, "${k}")`, bool: `try _bool(${x}, "${k}")`, json: x }[s.type])
  const enc = (s, x) => (s.values ? (s.array ? `${x}.map { $0.rawValue }` : `${x}.rawValue`) : x)
  const opt = (s) => !s.required && s.type !== 'json'
  for (const f of fns) {
    for (const part of ['input', 'output']) for (const [k, s] of fieldsOf(f, part)) if (s.values) {
      L.push(`enum ${enumName(f, part, k)}: String {`, ...s.values.map((v) => `    case ${sId(enumCase(v))} = ${JSON.stringify(v)}`), '}', '')
    }
    const ins = fieldsOf(f, 'input'); const outs = fieldsOf(f, 'output')
    if (ins.length) {
      L.push(`struct ${f.pascal}Input {`)
      for (const [k, s] of ins) L.push(`    var ${sId(k)}: ${sType(f, 'input', k, s)}${opt(s) ? '? = nil' : s.type === 'json' && !s.required ? ' = nil' : ''}`)
      L.push('    func toMap() -> [String: Any] {', '        var m: [String: Any] = [:]')
      for (const [k, s] of ins) L.push(opt(s) || s.type === 'json' ? `        if let v = ${sId(k)} { m["${k}"] = ${enc(s, 'v')} }` : `        m["${k}"] = ${enc(s, sId(k))}`)
      L.push('        return m', '    }', '}', '')
    }
    if (outs.length) {
      L.push(`struct ${f.pascal}Output {`)
      for (const [k, s] of outs) L.push(`    var ${sId(k)}: ${sType(f, 'output', k, s)}${opt(s) ? '?' : ''}`)
      L.push(`    static func fromMap(_ m: [String: Any]) throws -> ${f.pascal}Output {`, `        ${f.pascal}Output(`)
      const lines = outs.map(([k, s]) => {
        const x = `m["${k}"]`
        const one = (y) => dec(f, 'output', k, s, y)
        const v = s.array ? (s.required ? `try _list(${x}, "${k}").map { ${one('$0')} }` : `try _opt(${x}) { try _list($0, "${k}").map { ${one('$0')} } }`)
          : s.type === 'json' ? `${x} as Any?` : s.required ? one(x) : `try _opt(${x}) { ${one('$0')} }`
        return `            ${sBare(k)}: ${v}`
      })
      L.push(lines.join(',\n'), '        )', '    }', '}', '')
    }
  }
  L.push('/// Typed backend API. Create once with your transport: `let api = Api(transport: FirebaseApiTransport())`.', 'struct Api {', '    let transport: ApiTransport')
  for (const f of fns) {
    const hasIn = fieldsOf(f, 'input').length; const hasOut = fieldsOf(f, 'output').length
    const call = `try await transport.call(${JSON.stringify(endpoint(f, prov))}, ${hasIn ? 'input.toMap()' : '[:]'})`
    L.push('', `    /// ${fnDoc(f)}`)
    L.push(hasOut ? `    func ${sId(f.name)}(${hasIn ? `_ input: ${f.pascal}Input` : ''}) async throws -> ${f.pascal}Output { try ${f.pascal}Output.fromMap(_map(${call})) }`
      : `    func ${sId(f.name)}(${hasIn ? `_ input: ${f.pascal}Input` : ''}) async throws { _ = ${call} }`)
  }
  L.push('}', '')
  return L.join('\n')
}

function generate(c, { force = false, stdout = false } = {}) {
  const { errors, prov } = validate(c)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('fix the contract errors first.') }
  const written = []
  const out = (f, code) => { if (stdout) { console.log(code); return } written.push(writeGuarded(f, stamp(code), { root, force })) }
  if (typed(c).length || prov === 'firebase') out(serverContractFile(prov), genServerTs(c, prov))
  for (const s of projectStacks(root, config)) {
    const fns = clientFns(c, s.kind)
    if (!fns.length) continue
    const t = outputFor('api', s, root, config)
    const lang = { nextjs: 'ts', 'react-vite': 'ts', astro: 'ts', nuxt: 'ts', 'react-native': 'ts', flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }[s.id]
    out(t.file, lang === 'ts' ? genTsClient(fns, prov) : lang === 'dart' ? genDart(fns, prov) : lang === 'kotlin' ? genKotlin(fns, prov, t.pkg) : genSwift(fns, prov))
  }
  return written
}

// ---------------------------------------------------------------- inventory (code → functions)
function walk(d, re, acc = []) {
  if (!fs.existsSync(d)) return acc
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|lib|dist|\.|generated)/.test(e.name)) walk(p, re, acc) } else if (re.test(e.name)) acc.push(p)
  }
  return acc
}
function inventory(prov) {
  const found = []
  if (prov === 'firebase') {
    const fd = functionsDir()
    for (const f of walk(path.join(fd, fs.existsSync(path.join(fd, 'src')) ? 'src' : ''), /\.(ts|js)$/)) {
      if (/\.d\.ts$/.test(f)) continue
      const s = read(f)
      for (const m of s.matchAll(/(?:export\s+const\s+(\w+)|exports\.(\w+))\s*=\s*(?:functions\s*\.)?([\w.]+)\s*\(/g)) {
        const call = m[3]
        if (!/^(on[A-Z]\w*|before[A-Z]\w*|https\.|firestore\.|pubsub\.|auth\.|storage\.|region\()/.test(call) && !/^functions\./.test(m[0].split('=')[1].trim())) continue
        const args = s.slice(m.index, m.index + 400)
        const v1 = /functions\s*\.\s*(https|firestore|auth|pubsub|storage|region)\b/.test(m[0] + args.slice(0, 120)) || /^(https|firestore|pubsub|auth|storage|region)\./.test(call)
        const region = (args.match(/region\s*:\s*(REGION|['"][\w-]+['"])/) || [])[1]
        found.push({ id: m[1] || m[2], file: rel(f), call, v1, region: region ? region.replace(/['"]/g, '') : null, line: s.slice(0, m.index).split('\n').length })
      }
    }
    const idx = read(path.join(fd, 'src', 'index.ts')) || read(path.join(fd, 'index.js')) || read(path.join(fd, 'src', 'index.js'))
    for (const x of found) x.exported = /[\\/]index\.(ts|js)$/.test(x.file) || new RegExp(`\\b${x.id}\\b`).test(idx)
  } else if (prov === 'supabase') {
    const d = path.join(root, 'supabase', 'functions')
    if (fs.existsSync(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('_') && fs.existsSync(path.join(d, e.name, 'index.ts'))) found.push({ id: e.name, file: rel(path.join(d, e.name, 'index.ts')), exported: true })
  } else {
    const w = webServer()
    if (w?.id === 'nextjs') { const app = nextAppDir(w.dir); for (const f of walk(path.join(app, 'api'), /^route\.(ts|js)$/)) found.push({ id: '/' + posix(path.relative(app, path.dirname(f))), file: rel(f), exported: true }) }
    if (w?.id === 'nuxt') { const api = path.join(w.dir, 'server', 'api'); for (const f of walk(api, /\.(ts|js)$/)) found.push({ id: '/api/' + posix(path.relative(api, f)).replace(/\.(get|post|put|patch|delete)?\.?(ts|js)$/, '').replace(/\/index$/, ''), file: rel(f), exported: true }) }
  }
  return found
}

// client code calling a different region than the contract
function clientRegions(region) {
  const issues = []
  for (const s of projectStacks(root, config)) {
    const ext = { flutter: /\.dart$/, kmp: /\.kt$/, android: /\.kt$/, ios: /\.swift$/ }[s.id] || /\.(tsx?|jsx?|vue)$/
    for (const f of walk(s.id === 'flutter' ? path.join(s.dir, 'lib') : s.dir, ext)) {
      const t = read(f)
      const res = [/instanceFor\(\s*(?:app\s*:\s*[\w.]+\s*,\s*)?region\s*:\s*['"]([\w-]+)['"]/g, /getFunctions\(\s*[\w.]+\s*,\s*['"]([\w-]+)['"]/g, /\.functions\(\s*['"]([\w-]+)['"]\s*\)/g, /Functions\.functions\(\s*region\s*:\s*['"]([\w-]+)['"]/g]
      for (const re of res) for (const m of t.matchAll(re)) if (m[1] !== region) issues.push(`${rel(f)}:${t.slice(0, m.index).split('\n').length} calls region ${m[1]} but the functions run in ${region}`)
      if (/FirebaseFunctions\.instance\b(?!For)|getFunctions\(\s*\w*\s*\)|Firebase\.functions(?!\()|Functions\.functions\(\s*\)/.test(t)) issues.push(`${rel(f)} uses the default region (us-central1) — call ${region} explicitly`)
    }
  }
  return issues
}

// ---------------------------------------------------------------- commands
if (cmd === 'init') {
  const exists = fs.existsSync(file)
  const c = exists ? loadContract() : { provider: null, functions: [] }
  if (opt.provider) c.provider = String(opt.provider)
  if (!c.provider) c.provider = providerOf(c)
  if (!PROVIDERS.includes(c.provider)) die('which provider? --provider firebase|supabase|http (http = API routes of the Next.js/Nuxt app)')
  if (opt.region) c.region = String(opt.region)
  if (c.provider === 'firebase' && !c.region) die('firebase needs --region (e.g. europe-west1, us-central1) — the same region the clients will call')
  if (c.provider !== 'firebase') delete c.region
  if (c.provider === 'http') serverContractFile('http') // dies without a Next.js/Nuxt stack to host the API
  saveContract(c)
  console.log(`${exists ? 'updated' : 'created'} ${rel(file)} (provider ${c.provider}${c.region ? ', region ' + c.region : ''})`)
  const made = []
  if (c.provider === 'firebase') {
    const fd = functionsDir()
    made.push(writeNew(path.join(fd, 'package.json'), T.firebaseFunctionsPackage(kebab(config.name || 'app'))), writeNew(path.join(fd, 'tsconfig.json'), T.firebaseTsconfig), writeNew(path.join(fd, '.gitignore'), 'node_modules/\nlib/\n*.local\n.env*\n!.env.example\n'), writeNew(path.join(fd, 'src', 'index.ts'), T.firebaseIndex))
    const fjPath = path.join(root, 'firebase.json')
    if (fs.existsSync(fjPath)) {
      try {
        const fj = JSON.parse(read(fjPath))
        if (!fj.functions) { fj.functions = [{ source: rel(fd), codebase: 'default', ignore: ['node_modules', '.git', '*.local'], predeploy: ['npm --prefix "$RESOURCE_DIR" run build'] }]; fs.writeFileSync(fjPath, JSON.stringify(fj, null, 2) + '\n'); made.push('firebase.json (functions)') }
      } catch { console.log('⚠ firebase.json is not valid JSON — add the "functions" entry by hand') }
    }
  }
  if (c.provider === 'supabase') made.push(writeNew(path.join(root, 'supabase', 'functions', '_shared', 'cors.ts'), T.supabaseCors))
  made.filter(Boolean).forEach((m) => console.log('+ ' + m))
  generate(c, { force: !!opt.force }).forEach((w) => console.log('→ ' + w))
  if (c.provider === 'firebase') console.log(`next: cd ${rel(functionsDir()) || '.'} && npm install · node "<plugin>/scripts/backend.mjs" add <name> --kind callable`)
  process.exit(0)
}

if (cmd === 'add') {
  const c = loadContract()
  const name = camel(pos[0] || die('add <name> --kind callable|http|webhook|trigger|schedule'))
  if ((c.functions || []).some((f) => f.name === name)) die(`"${name}" is already in the contract`)
  const kind = String(opt.kind || 'callable')
  const f = { name, kind }
  if (opt.desc) f.description = String(opt.desc)
  if (opt.auth) f.auth = String(opt.auth)
  if (opt.platforms) f.platforms = String(opt.platforms).split(',').map((x) => x.trim())
  if (opt.origin) f.origin = String(opt.origin)
  if (kind === 'trigger') f.on = String(opt.on || '')
  if (kind === 'schedule') { f.cron = String(opt.cron || ''); if (opt.tz) f.tz = String(opt.tz) }
  if (kind === 'callable' || kind === 'http') { f.input = {}; f.output = {}; f.errors = [] }
  if (kind === 'webhook' && opt.secret) f.secret = String(opt.secret)
  const next = { ...c, functions: [...(c.functions || []), f] }
  const { errors, prov } = validate(next)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('not added.') }
  saveContract(next)
  console.log(`+ ${rel(file)}: ${name} (${kind})`)
  const info = fnInfo(f)
  const contractTs = serverContractFile(prov)
  const target = implFile(info, prov)
  let code
  if (prov === 'firebase') code = T.firebase(info, importPath(target, contractTs))
  else if (prov === 'supabase') code = T.supabase(info)
  else code = webServer().id === 'nuxt' ? T.nuxt(info, importPath(target, contractTs)) : T.next(info, importPath(target, contractTs))
  const made = writeNew(target, code)
  console.log(made ? `+ ${made}` : `= ${rel(target)} already exists — left untouched`)
  if (prov === 'firebase') {
    const idx = path.join(functionsDir(), 'src', 'index.ts')
    const line = `export { ${name} } from './${name}'\n`
    if (fs.existsSync(idx) && !new RegExp(`\\b${name}\\b`).test(read(idx))) { fs.appendFileSync(idx, (read(idx).endsWith('\n') ? '' : '\n') + line); console.log(`+ ${rel(idx)}: export ${name}`) }
  }
  if (prov === 'supabase' && kind !== 'callable' && kind !== 'http') {
    const toml = path.join(root, 'supabase', 'config.toml')
    if (fs.existsSync(toml) && !read(toml).includes(`[functions.${info.slug}]`)) { fs.appendFileSync(toml, `\n[functions.${info.slug}]\nverify_jwt = false\n`); console.log(`+ supabase/config.toml: [functions.${info.slug}] verify_jwt = false`) }
    console.log(`secret: npx supabase secrets set ${info.secret}=<value>`)
    if (kind === 'schedule') console.log('\n' + T.supabaseScheduleSql(info))
    if (kind === 'trigger') console.log(`Database Webhook: Dashboard → Database → Webhooks → ${info.on.slice(3)} → Supabase Edge Function ${info.slug}, header Authorization: Bearer <${info.secret}>`)
  }
  if (prov === 'firebase' && kind === 'webhook') console.log(`secret: firebase functions:secrets:set ${info.secret}`)
  if (kind === 'callable' || kind === 'http') console.log(`next: describe input/output/errors of ${name} in ${rel(file)}, then run gen`)
  generate(next, { force: !!opt.force }).forEach((w) => console.log('→ ' + w))
  process.exit(0)
}

if (cmd === 'gen') {
  const w = generate(loadContract(), { force: !!opt.force, stdout: !!opt.stdout })
  w.forEach((x) => console.log('→ ' + x))
  process.exit(0)
}

const c = loadContract()
const { errors, warnings, prov } = validate(c)
const found = PROVIDERS.includes(prov) ? inventory(prov) : []
const fns = (c.functions || []).map(fnInfo)

if (cmd === 'list') {
  const ids = new Set(fns.map((f) => endpoint(f, prov)))
  console.log(`provider ${prov}${c.region ? ' · region ' + c.region : ''} · ${fns.length} in contract · ${found.length} in code`)
  for (const f of fns) {
    const impl = found.find((x) => x.id === (prov === 'http' ? '/api/' + f.slug : prov === 'supabase' ? f.slug : f.name))
    console.log(`  ${impl ? '✓' : '✗'} ${f.name.padEnd(26)} ${f.kind.padEnd(9)} ${f.kind === 'callable' || f.kind === 'http' ? 'auth ' + f.auth.padEnd(6) : ''.padEnd(11)} ${impl ? impl.file : '(not implemented)'}`)
  }
  for (const x of found.filter((x) => !ids.has(x.id) && !(prov === 'http' && fns.some((f) => '/api/' + f.slug === x.id)))) console.log(`  ? ${x.id.padEnd(26)} ${''.padEnd(9)} ${x.file} (not in the contract)`)
  process.exit(0)
}

// check
const issues = [...errors.map((m) => ({ level: 'error', m })), ...warnings.map((m) => ({ level: 'warn', m }))]
const implId = (f) => (prov === 'firebase' ? f.name : prov === 'supabase' ? f.slug : '/api/' + f.slug)
for (const f of fns) {
  const impl = found.find((x) => x.id === implId(f))
  if (!impl) { issues.push({ level: 'error', m: `${f.name}: declared but not implemented (expected ${rel(implFile(f, prov))}) — /dualcraft:backend add scaffolds it` }); continue }
  if (prov === 'firebase' && !impl.exported) issues.push({ level: 'error', m: `${f.name}: defined in ${impl.file} but not exported from src/index.ts — it won't deploy` })
}
for (const x of found) {
  if (!fns.some((f) => implId(f) === x.id)) issues.push({ level: 'warn', m: `${x.id} (${x.file}) is not in the contract — add it to api.json so clients get a typed call` })
  if (prov === 'firebase' && x.v1) issues.push({ level: 'error', m: `${x.id} (${x.file}:${x.line}) uses Cloud Functions v1 — migrate to firebase-functions/v2 (never mix v1 and v2)` })
  if (prov === 'firebase' && !x.v1 && !x.region) issues.push({ level: 'warn', m: `${x.id} (${x.file}:${x.line}) has no explicit region (relies on setGlobalOptions) — prefer { region: REGION }` })
  if (prov === 'firebase' && x.region && x.region !== 'REGION' && x.region !== c.region) issues.push({ level: 'error', m: `${x.id} (${x.file}:${x.line}) runs in ${x.region} but the contract says ${c.region}` })
}
if (prov === 'firebase' && c.region) for (const m of clientRegions(c.region)) issues.push({ level: 'error', m })
// generated files in sync with the contract
if (!errors.length) {
  const stale = []
  const cmp = (f, code) => { const cur = read(f).replace(/\r\n/g, '\n'); if (!cur) stale.push(`${rel(f)} missing`); else if (cur !== stamp(code)) stale.push(`${rel(f)} out of date`) }
  if (typed(c).length || prov === 'firebase') cmp(serverContractFile(prov), genServerTs(c, prov))
  for (const s of projectStacks(root, config)) {
    const list = clientFns(c, s.kind); if (!list.length) continue
    const t = outputFor('api', s, root, config)
    const lang = { flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }[s.id] || 'ts'
    cmp(t.file, lang === 'ts' ? genTsClient(list, prov) : lang === 'dart' ? genDart(list, prov) : lang === 'kotlin' ? genKotlin(list, prov, t.pkg) : genSwift(list, prov))
  }
  for (const s of stale) issues.push({ level: 'error', m: `${s} — run gen` })
}
if (opt.json) console.log(JSON.stringify({ provider: prov, region: c.region || null, functions: fns.length, implemented: found.length, issues }, null, 2))
else {
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
  const n = issues.filter((i) => i.level === 'error').length
  console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `backend OK — ${fns.length} function(s), ${issues.length} warning(s)`)
}
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
