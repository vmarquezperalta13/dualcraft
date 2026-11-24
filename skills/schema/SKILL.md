---
name: schema
description: Database schema (.dualcraft/db/schema.dbml) as the single source of truth, generating models for every stack and Firestore rules. Use to define or change data, "saca el modelo de datos del código", or before hand-writing models.
---

# DualCraft schema

Paths: `$ER` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/er.mjs"`, `$GEN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/gen.mjs"`. Example schema: `${CLAUDE_PLUGIN_ROOT}/examples/hockey.dbml`.

## The rule
`.dualcraft/db/schema.dbml` is the **single source of truth** for stored data. Model classes and types are generated from it so web and mobile never drift. A data change starts in the schema, not in a model class.

## Create the schema
- **From the code** (existing project): read the real data model — Dart model classes, `fromJson/toJson`, Firestore calls (`collection('…')`, `.doc(…)`, `.set/.update({...})`), Prisma/SQL migrations, TS types. Write only what the code proves; mark doubts with a `note:` and list them for the user.
- **From a description**: interview briefly (entities, key fields, who owns what, relations), propose the schema, confirm.

## DBML conventions in DualCraft
```dbml
Project app { database_type: 'Firestore' }   // or 'PostgreSQL' (Supabase, Prisma), 'MySQL', 'SQLite'

Enum role { admin  member }

Table User [note: 'path: users'] {
  id string [pk]                       // Firestore: the document id
  displayName string [not null]
  role role [not null]
  tags string[]                        // arrays: type[]
  createdAt timestamp [not null]
}

Table Session [note: 'path: users/{userId}/sessions'] {   // subcollection
  id string [pk]
  userId string [not null, ref: > User.id]                 // many sessions → one user
  teamName string [note: 'denormalized from Team.name']
}
```
- Table names: singular PascalCase for Firestore (they become class/interface names); for SQL providers (Supabase, Postgres) prefer `snake_case` tables and columns — SQL works better unquoted. Field names exactly as stored. Supabase user ownership: a `user_id uuid` column (it gets owner RLS policies).
- `[not null]` for required fields — anything without it is nullable (and optional in rules).
- Relations: `ref: > T.id` (many-to-one), `<` (one-to-many), `-` (one-to-one), `<>` (many-to-many). Firestore has no joins: still declare references so the diagram and docs show them; mark denormalized copies with a note.
- Firestore types: `string int double bool timestamp map geopoint reference` + arrays. SQL types work as usual (`varchar`, `int`, `uuid`…).
- `note:` on tables and fields for meaning, units, invariants. For Firestore, the table note holds the `path:`.

## After every change
1. `$ER check` — fix all errors.
2. Show the user the change (diff of the schema) and get a yes before generating.
3. `$GEN all` generates the models for **every stack** (TypeScript for Next.js/React/Astro/Nuxt/React Native, Dart for Flutter, `@Serializable` data classes for KMP/Android — needs the kotlinx.serialization plugin —, `Codable` structs for iOS; paths in the table in `dualcraft:tokens` (same layout for i18n, schema and analytics).) plus:
   - `dart` → `<mobile>/lib/generated/db_models.dart` (if mobile is Flutter): classes with `fromJson`, `toJson`, `copyWith`; enums with their stored values; Firestore Timestamps handled.
   - `ts` → `<web>/src/types/db.ts` (if there is a web stack): interfaces + enum unions.
   - `rules` → `firestore.rules.generated` (only if `database_type` is Firestore): type/shape validation per collection. It is a **skeleton**: access rules are TODO. Never overwrite `firestore.rules` with it — merge by hand, with the user, ideally through the security review.
   Custom locations: `"db": { "dart": "…", "ts": "…", "rules": "…" }` in `.dualcraft/config.json`. Single target: `$GEN dart|ts|rules [--out path]`.
4. Generated files must not be edited by hand. If the project already has hand-written models, don't replace them silently: propose adopting the generated ones as a brain task (`dualcraft:brain`), migrating screen by screen.
5. Run the project's analyzer/type-check on the generated files if available (`dart analyze`, `npx tsc --noEmit`).
6. Record important modelling choices (denormalization, why a subcollection, id strategy) as decisions in the brain.
7. Offer `dualcraft:er` to see the result.
8. Apply the change to the database with `dualcraft:database` (Supabase migration, Prisma migration or Firestore rules/indexes, per environment).
