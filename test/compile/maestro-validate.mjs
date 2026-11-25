// Validates generated Maestro flows against the SchemaStore Maestro schema (CI: out/e2e-maestro).
//   node maestro-validate.mjs <schema.json> <flow.yaml>...
// Each flow file = a config document (appId, name, tags) and a command list; both must match the schema.
import fs from 'node:fs'
import { parseAllDocuments } from 'yaml'
import Ajv from 'ajv'

const [schemaFile, ...files] = process.argv.slice(2)
const ajv = new Ajv({ allErrors: true, strict: false })
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
const validate = ajv.compile(schema)
// the schema admits unknown (future) commands; generated flows may only use the documented ones
const BARE = new Set(schema.$defs.bareCommand.examples)
const KNOWN = new Set(Object.keys(schema.$defs.commandObject.properties))
let bad = 0
for (const f of files) {
  const docs = parseAllDocuments(fs.readFileSync(f, 'utf8'))
  const errs = docs.flatMap((d) => d.errors.map((e) => e.message))
  if (docs.length !== 2) errs.push(`expected 2 YAML documents (config + commands), got ${docs.length}`)
  docs.forEach((d, i) => { if (!validate(d.toJS())) errs.push(`document ${i + 1}: ${ajv.errorsText(validate.errors, { separator: '; ' }).slice(0, 600)}`) })
  for (const c of docs[1]?.toJS() || []) {
    if (typeof c === 'string' && !BARE.has(c)) errs.push(`unknown bare command "${c}"`)
    if (c && typeof c === 'object') for (const k of Object.keys(c)) if (!KNOWN.has(k)) errs.push(`unknown command "${k}"`)
  }
  if (errs.length) { bad++; console.log(`✗ ${f}\n    ${errs.join('\n    ')}`) } else console.log(`✓ ${f}`)
}
process.exit(bad ? 1 : 0)
