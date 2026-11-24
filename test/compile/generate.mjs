#!/usr/bin/env node
// Generates DualCraft output for every language into <outdir>, laid out so the CI can compile each one:
//   <out>/ts      → tsc --noEmit --strict
//   <out>/dart    → flutter pub get && flutter gen-l10n && flutter analyze
//   <out>/kotlin  → gradle run (Compose JVM + kotlinx.serialization: compiles and exercises the code)
//   <out>/swift   → swiftc -typecheck *.swift (macOS)
//   <out>/sql     → node pg.mjs (PGlite applies the migrations) · prisma validate
import fs from 'node:fs'
import path from 'node:path'
import { run, makeMultiProject, makeProject, write, read } from '../helpers.mjs'

const OUT = path.resolve(process.argv[2] || 'compile-out')
fs.rmSync(OUT, { recursive: true, force: true })
const must = (r, what) => { if (r.code !== 0) { console.error(`✗ ${what}\n${r.out}\n${r.err}`); process.exit(1) } }
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) }

// ---------- multi-stack project (Firestore schema: enums, maps, reserved names) ----------
const multi = makeMultiProject('firestore')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], multi), s)
const M = (...p) => path.join(multi, ...p)

// TypeScript
for (const [f, name] of [['rn/src/theme/ds-tokens.ts', 'rn-tokens.ts'], ['rn/src/types/db.ts', 'rn-db.ts'], ['rn/src/lib/analytics-events.ts', 'rn-analytics.ts'], ['web/src/types/db.ts', 'web-db.ts'], ['web/src/lib/analytics-events.ts', 'web-analytics.ts']]) copy(M(f), path.join(OUT, 'ts', name))
write(path.join(OUT, 'ts', 'rn.d.ts'), "declare module 'react-native' { export function useColorScheme(): 'light' | 'dark' | null | undefined }\n")
write(path.join(OUT, 'ts', 'use.ts'), "import { dsTheme, dsText } from './rn-tokens'\nimport { analyticsEvents } from './rn-analytics'\nimport type { Users } from './rn-db'\nconst t = dsTheme('dark'); const c: string = t.colors.onSurface; const w: '600' = dsText.titleLarge.fontWeight\nconst e = analyticsEvents.signUp({ method: 'google' }); const u: Pick<Users, 'id'> = { id: 'x' }\nvoid c; void w; void e; void u\n")

// Kotlin (KMP outputs: theme, models, analytics)
const K = (...p) => M('kmp', 'composeApp', 'src', 'commonMain', 'kotlin', 'com', 'test', 'app', ...p)
for (const [f, to] of [[K('theme', 'DsTokens.kt'), 'theme/DsTokens.kt'], [K('model', 'DbModels.kt'), 'model/DbModels.kt'], [K('analytics', 'AnalyticsEvents.kt'), 'analytics/AnalyticsEvents.kt']]) copy(f, path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'com', 'test', 'app', to))
write(path.join(OUT, 'kotlin', 'settings.gradle.kts'), 'pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\ndependencyResolutionManagement { repositories { mavenCentral(); google() } }\nrootProject.name = "dualcraft-kotlin-check"\n')
write(path.join(OUT, 'kotlin', 'build.gradle.kts'), 'plugins {\n    kotlin("jvm") version "2.0.21"\n    kotlin("plugin.serialization") version "2.0.21"\n    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"\n    id("org.jetbrains.compose") version "1.7.0"\n    application\n}\ndependencies {\n    implementation(compose.desktop.currentOs)\n    implementation(compose.material3)\n    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")\n}\napplication { mainClass.set("check.MainKt") }\n')
write(path.join(OUT, 'kotlin', 'src', 'main', 'kotlin', 'check', 'Main.kt'), `package check
import com.test.app.model.*
import com.test.app.analytics.*
import com.test.app.theme.*
import kotlinx.serialization.json.Json
fun main() {
    val json = Json { ignoreUnknownKeys = true }
    val u = json.decodeFromString<Users>("""{"id":"u1","displayName":"Ana","email":"a@b.c","role":"in-progress","createdAt":"2026-01-01T00:00:00Z","class":"vip"}""")
    check(u.role == Role.IN_PROGRESS && u.classValue == "vip") { "serialization names" }
    check(json.encodeToString(Users.serializer(), u).contains("\\"class\\":\\"vip\\"")) { "SerialName on encode" }
    val e = AnalyticsEvents.matchViewed("m1", fromPush = true, position = 3)
    check(e.params["from_push"] == 1L) { "bool sent as 1" }
    check(DsSpacing.s4.value == 16f) { "spacing" }
    println("kotlin OK: \${e.name} \${DsColorsLight.primary}")
}
`)

// Swift (iOS outputs)
for (const [f, to] of [['iosapp/Demo/DesignSystem/DsTokens.swift', 'DsTokens.swift'], ['iosapp/Demo/Core/Models/DbModels.swift', 'DbModels.swift'], ['iosapp/Demo/Core/Analytics/AnalyticsEvents.swift', 'AnalyticsEvents.swift'], ['iosapp/Demo/Resources/DualCraft.xcstrings', 'DualCraft.xcstrings']]) copy(M(f), path.join(OUT, 'swift', to))
write(path.join(OUT, 'swift', 'Use.swift'), 'import SwiftUI\nfunc dualcraftCheck() -> [Any] {\n    let u = Users(id: "1", displayName: "a", email: "e", role: .inProgress, tags: nil, createdAt: Date(), lastSeen: nil, settings: ["k": .string("v")], classValue: "vip")\n    return [DsColor.primary, DsSpacing.s4, DsText.titleLarge.font, AnalyticsEvents.signUp(method: .google).name, u.classValue as Any]\n}\n')

// ---------- Flutter project (hockey schema) ----------
const fl = makeProject({ mobile: 'flutter', paths: { mobile: 'app' }, schema: 'hockey' })
write(path.join(fl, 'app', 'pubspec.yaml'), 'name: dualcraft_check\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_localizations:\n    sdk: flutter\n  intl: any\nflutter:\n  generate: true\n')
write(path.join(fl, 'app', 'l10n.yaml'), 'arb-dir: lib/l10n\ntemplate-arb-file: app_es.arb\noutput-localization-file: app_localizations.dart\n')
for (const s of ['tokens.mjs', 'gen.mjs', 'analytics.mjs', 'i18n.mjs']) must(run(s, s === 'tokens.mjs' || s === 'gen.mjs' ? ['all'] : ['gen'], fl), `flutter ${s}`)
write(path.join(fl, 'app', 'lib', 'main.dart'), "import 'package:flutter/material.dart';\nimport 'generated/design_tokens.dart';\nimport 'generated/db_models.dart';\nimport 'generated/analytics_events.dart';\nvoid main() => runApp(MaterialApp(theme: DsTheme.light(), darkTheme: DsTheme.dark(), home: Builder(builder: (c) => Container(color: c.ds.surface, padding: const EdgeInsets.all(DsSpacing.s4)))));\nfinal t = HockeyTeam(id: 1, name: 'x');\nfinal e = AnalyticsEvents.signUp(method: SignUpMethod.google);\n")
fs.cpSync(path.join(fl, 'app'), path.join(OUT, 'dart'), { recursive: true })

// ---------- SQL / Prisma (hockey schema, Supabase) ----------
const db = makeProject({ schema: 'hockey', extra: { backend: { provider: 'supabase' } } })
must(run('database.mjs', ['migration', 'init'], db), 'migration init')
const schema = path.join(db, '.dualcraft', 'db', 'schema.dbml')
write(schema, read(schema).replace('  logo varchar', '  logo varchar\n  city varchar [default: \'\']') + '\nTable comment {\n  id uuid [pk]\n  user_id uuid [not null]\n  body text [not null]\n  created_at timestamp [not null, default: `now()`]\n}\n')
must(run('database.mjs', ['migration', 'changes'], db), 'migration diff')
fs.cpSync(path.join(db, 'supabase', 'migrations'), path.join(OUT, 'sql', 'migrations'), { recursive: true })
must(run('database.mjs', ['prisma', '--out', path.join(OUT, 'sql', 'prisma', 'schema.prisma')], db), 'prisma')
write(path.join(OUT, 'sql', 'pg.mjs'), `// Applies the migrations, in order, on an in-memory Postgres (PGlite) with a minimal Supabase auth stub.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
const dir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const db = new PGlite()
await db.exec("create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;")
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('applied ' + f) }
const t = await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")
const p = await db.query('select count(*)::int n from pg_policies')
if (t.rows[0].n !== 11 || p.rows[0].n < 4) { console.error('unexpected result', t.rows[0], p.rows[0]); process.exit(1) }
console.log('postgres OK: ' + t.rows[0].n + ' tables, ' + p.rows[0].n + ' policies')
`)
console.log(`compile fixtures → ${OUT}`)
for (const d of fs.readdirSync(OUT)) console.log(`  ${d}: ${fs.readdirSync(path.join(OUT, d)).length} entries`)
