// Validates generated YAML/JSON files against a JSON Schema (CI: out/dependabot against SchemaStore's dependabot-2.0).
//   node schema-validate.mjs <schema.json> <file.yml>...
import fs from 'node:fs'
import { parse } from 'yaml'
import Ajv from 'ajv'

const [schemaFile, ...files] = process.argv.slice(2)
if (!files.length) { console.error('usage: schema-validate.mjs <schema.json> <file>...'); process.exit(1) }
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')))
let bad = 0
for (const f of files) {
  const ok = validate(parse(fs.readFileSync(f, 'utf8')))
  if (ok) console.log(`✓ ${f}`)
  else { bad++; console.log(`✗ ${f}`); for (const e of validate.errors) console.log(`    ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`) }
}
process.exit(bad ? 1 : 0)
