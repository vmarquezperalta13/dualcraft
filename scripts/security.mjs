#!/usr/bin/env node
// DualCraft static security scan — zero dependencies. A first pass, not a full audit:
// every finding needs human/agent confirmation, and absence of findings proves nothing.
//   node security.mjs [--scope all|web|mobile|backend] [--json] [--deps] [--min info|low|medium|high|critical]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { findRoot, parseArgs, posix } from './lib/project.mjs'

const { opt } = parseArgs(process.argv.slice(2))
if (opt.help) { console.log('node security.mjs [--scope all|web|mobile|backend] [--json] [--deps] [--min low]'); process.exit(0) }
const root = findRoot() || process.cwd()
const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, '.dualcraft', 'config.json'), 'utf8')) } catch { return {} } })()
const scope = String(opt.scope || 'all')
const want = (s) => scope === 'all' || scope === s
const SEV = ['info', 'low', 'medium', 'high', 'critical']
const findings = []
const add = (severity, rule, file, line, message, fix) => findings.push({ severity, rule, file: file ? posix(path.relative(root, file)) : null, line, message, fix })

// ---------- file list (tracked files when in git, else a walk) ----------
let files; let inGit = true
try {
  files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean).map((f) => path.join(root, f))
} catch {
  inGit = false
  files = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.git|build|\.dart_tool|\.next|dist|Pods|\.gradle)$/.test(e.name)) walk(p) } else files.push(p) } }
  walk(root)
}
files = files.filter((f) => fs.existsSync(f) && !/(^|[\\/])(node_modules|\.dart_tool|build|\.next|dist|Pods)[\\/]/.test(f) && fs.statSync(f).size < 2 * 1024 * 1024)
const text = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length
const isBinary = (f) => /\.(png|jpe?g|gif|webp|ico|pdf|zip|jar|aar|so|ttf|otf|woff2?|mp4|mp3|keystore|jks|p12|apk|aab|ipa)$/i.test(f)
const rel = (f) => posix(path.relative(root, f))
// test code and fixtures: by folder or file name, never by a substring of an unrelated name ("latest", "contest")
const IS_TEST = (r) => /(^|\/)(tests?|spec|__tests__|__mocks__|mocks?|fixtures?|examples?|testdata)\//i.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$|_test\.(dart|go|py)$|Tests?\.(kt|swift)$/i.test(r)

// ---------- secrets (everywhere) ----------
const SECRET_RULES = [
  ['critical', 'secret.private-key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'Private key in the repository'],
  ['critical', 'secret.service-account', /"type"\s*:\s*"service_account"[\s\S]{0,400}"private_key"/, 'Google service account key file in the repository'],
  ['critical', 'secret.aws', /\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  ['critical', 'secret.stripe-live', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/, 'Stripe live secret key'],
  ['high', 'secret.github', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  ['high', 'secret.slack', /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  ['high', 'secret.openai-like', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/, 'API secret key (sk-…)'],
  ['high', 'secret.anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, 'Anthropic API key'],
  ['critical', 'secret.stripe-webhook', /\bwhsec_[A-Za-z0-9]{20,}\b/, 'Stripe webhook signing secret'],
  ['high', 'secret.sendgrid', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, 'SendGrid API key'],
  ['high', 'secret.fcm-server-key', /\bAAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{100,}\b/, 'Firebase Cloud Messaging legacy server key'],
  ['low', 'secret.google-api-key', /\bAIzaSy[0-9A-Za-z_-]{33}\b/, 'Google API key in code — not secret by itself, but restrict it (app/package + SHA, or HTTP referrers) in Google Cloud'],
  ['medium', 'secret.generic', /\b(api[_-]?secret|client[_-]?secret|secret[_-]?key|password|passwd|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'Hard-coded credential-looking value'],
]
for (const f of files) {
  if (isBinary(f) || /\.(lock|sum)$|package-lock\.json|pubspec\.lock|yarn\.lock|pnpm-lock\.yaml/.test(f)) continue
  const base = path.basename(f)
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base)) add('high', 'secret.env-committed', f, null, inGit ? `${base} is committed or not git-ignored` : `${base} is in the project (not a git repo yet: make sure it will be git-ignored)`, 'Remove it from git (git rm --cached), rotate the values, add it to .gitignore, keep a .env.example without values')
  if (/\.(jks|keystore|p12|pem)$/i.test(f)) add('critical', 'secret.keystore', f, null, 'Signing key / certificate file in the repository', 'Move it out of the repo and rotate it if the repo was ever shared')
  if (/key\.properties$/.test(f)) add('high', 'secret.key-properties', f, null, 'Android signing key.properties tracked by git', 'Untrack it and keep it local / in CI secrets')
  const s = text(f)
  if (IS_TEST(rel(f)) && !/\.env/.test(base)) continue
  for (const [sev, rule, re, msg] of SECRET_RULES) {
    const m = s.match(re)
    if (m && !/(your|example|xxx|changeme|placeholder|<)/i.test(m[0])) add(sev, rule, f, lineOf(s, m.index), msg, 'Remove it from the code, rotate it, load it from server-side env/secret manager')
  }
}

// ---------- backend: Firebase rules & functions ----------
if (want('backend')) {
  for (const f of files.filter((x) => /(firestore|storage|database)\.rules$|\.rules$/.test(x))) {
    const s = text(f); const kind = /storage/.test(f) ? 'Storage' : 'Firestore'
    const each = (re, cb) => { for (const m of s.matchAll(re)) cb(m, lineOf(s, m.index)) }
    each(/allow\s+[\w, ]*:\s*if\s+true\s*;/g, (m, l) => add('critical', 'rules.open', f, l, `${kind} rule allows access to anyone: "${m[0]}"`, 'Require auth and ownership, e.g. request.auth != null && request.auth.uid == resource.data.ownerId'))
    each(/allow\s+[\w, ]*;/g, (m, l) => add('critical', 'rules.unconditional', f, l, `${kind} rule without condition: "${m[0]}"`, 'Add an explicit condition'))
    each(/request\.time\s*<\s*timestamp\.date\(/g, (m, l) => add('critical', 'rules.test-mode', f, l, `${kind} rules still in "test mode" (open until a date)`, 'Replace with real rules before any real data'))
    each(/match\s+\/\{(document|path|allPaths)=\*\*\}\s*\{[^}]*allow\s+(read|write|read,\s*write)[^;]*request\.auth\s*!=\s*null\s*;/g, (m, l) => add('high', 'rules.any-signed-in', f, l, `${kind}: any signed-in user can ${m[2]} everything`, 'Scope rules per collection with ownership/role checks'))
    if (/service\s+cloud\.firestore/.test(s) && !/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;?\s*\}/.test(s)) add('low', 'rules.no-default-deny', f, null, 'No explicit default-deny rule at the end', 'Add match /{document=**} { allow read, write: if false; } so anything without a rule stays closed')
    each(/allow\s+(write|create|update)[^;]*;/g, (m, l) => { if (!/request\.resource\.data|keys\(\)|is\s+(string|int|number|bool|timestamp|map|list)/.test(m[0]) && !/if\s+false/.test(m[0]) && !/valid\w*\(/.test(m[0])) add('medium', 'rules.no-validation', f, l, `${kind} write without data validation: "${m[0].slice(0, 90)}"`, 'Validate shape and types (hasOnly/hasAll, types, sizes) — see firestore.rules.generated from /dualcraft:schema') })
  }
  // Supabase / Postgres migrations: every table needs RLS; write policies must not be open
  const migs = files.filter((x) => /[\\/]supabase[\\/]migrations[\\/].*\.sql$/.test(x)).sort()
  if (migs.length) {
    const all = migs.map((f) => text(f)).join('\n')
    const norm = (n) => n.replace(/"/g, '').replace(/^public\./, '').toLowerCase()
    const rlsOn = new Set([...all.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)].map((m) => norm(m[1])))
    for (const f of migs) {
      const s = text(f)
      for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
        const name = norm(m[1]); if (name.includes('.') && !name.startsWith('public.')) continue
        if (!rlsOn.has(name)) add('high', 'supabase.no-rls', f, lineOf(s, m.index), `Table ${name} has no Row Level Security — with the anon key anyone can read/write it through the API`, `alter table ${name} enable row level security; then add explicit policies`)
      }
      for (const m of s.matchAll(/create\s+policy[\s\S]*?for\s+(insert|update|delete|all)[\s\S]*?(?:using|with\s+check)\s*\(\s*true\s*\)[\s\S]*?;/gi)) add('high', 'supabase.open-write-policy', f, lineOf(s, m.index), `Policy allows ${m[1]} for everyone (true)`, 'Restrict to the owner/role: (select auth.uid()) = user_id, or a role check')
    }
  }
  for (const f of files.filter((x) => /(^|[\\/])\.env[^\\/]*$/.test(x) || /\.(tsx?|jsx?|vue|astro|dart|kt|swift)$/.test(x))) {
    const s = text(f)
    for (const m of s.matchAll(/(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_)[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*/g)) add('critical', 'supabase.service-role-public', f, lineOf(s, m.index), `${m[0]}: the Supabase service_role key bypasses RLS and is exposed to clients`, 'Use the anon key in clients; keep service_role only in server code/secrets and rotate it now')
    if (/\.(dart|kt|swift)$/.test(f) || /^\s*['"]use client['"]/m.test(s)) for (const m of s.matchAll(/service_role|SUPABASE_SERVICE_ROLE_KEY/g)) add('critical', 'supabase.service-role-client', f, lineOf(s, m.index), 'Supabase service_role referenced in client code', 'Clients use the anon key + RLS; privileged operations go to an Edge Function/server')
  }
  for (const f of files.filter((x) => /(^|[\\/])functions[\\/](src[\\/])?.*\.(ts|js)$/.test(rel(x)) && !/\.d\.ts$/.test(x) && !IS_TEST(rel(x)))) {
    const s = text(f)
    for (const m of s.matchAll(/\bonCall\s*\(/g)) {
      const body = s.slice(m.index, m.index + 1500)
      if (!/\b(context|request)\.auth\b|\bauth\s*\)|enforceAppCheck|HttpsError\(\s*['"]unauthenticated/.test(body)) add('high', 'functions.oncall-no-auth', f, lineOf(s, m.index), 'Callable function without an auth check in its first lines', 'Check request.auth (and ownership/role) and throw unauthenticated/permission-denied')
      if (!/enforceAppCheck/.test(body)) add('low', 'functions.no-appcheck', f, lineOf(s, m.index), 'Callable function without App Check enforcement', 'Consider { enforceAppCheck: true } for client-only callables')
    }
    for (const m of s.matchAll(/\bonRequest\s*\(/g)) {
      const body = s.slice(m.index, m.index + 1500)
      if (/cors\s*:\s*true|origin\s*:\s*(true|['"]\*['"])/.test(body)) add('medium', 'functions.cors-any', f, lineOf(s, m.index), 'HTTP function accepts any origin (CORS *)', 'Restrict origins to your domains')
      if (!/verifyIdToken|authorization|Authorization|auth\(|timingSafeEqual|constructEvent|verifySignature|verifyAndDecode|appleNotification/.test(body)) add('medium', 'functions.onrequest-no-auth', f, lineOf(s, m.index), 'HTTP function without visible authentication', 'Verify a Firebase ID token or a signed secret (webhooks: verify the provider signature)')
    }
  }
}

// ---------- web (Next.js) ----------
if (want('web')) {
  const webRoot = path.join(root, config.paths?.web || '')
  const webFiles = files.filter((f) => f.startsWith(webRoot) && /\.(tsx?|jsx?|mjs)$/.test(f) && !/[\\/]functions[\\/]/.test(f))
  for (const f of files.filter((x) => /(^|[\\/])\.env[^\\/]*$/.test(x) || /\.(tsx?|jsx?)$/.test(x))) {
    const s = text(f)
    for (const m of s.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ACCOUNT|ADMIN)[A-Z0-9_]*/g)) add('high', 'web.public-secret-env', f, lineOf(s, m.index), `${m[0]} is exposed to the browser (NEXT_PUBLIC_)`, 'Keep secrets server-side (no NEXT_PUBLIC_ prefix) and read them in server code only')
  }
  for (const f of webFiles) {
    const s = text(f); const isClient = /^\s*['"]use client['"]/m.test(s)
    for (const m of s.matchAll(/dangerouslySetInnerHTML/g)) add('medium', 'web.dangerous-html', f, lineOf(s, m.index), 'dangerouslySetInnerHTML — XSS risk if the content is not trusted', 'Sanitize (DOMPurify) or render as text/markdown safely')
    for (const m of s.matchAll(/\beval\s*\(|new Function\s*\(/g)) add('high', 'web.eval', f, lineOf(s, m.index), 'eval / new Function', 'Remove dynamic code evaluation')
    if (isClient && /from\s+['"](firebase-admin|server-only)['"]|process\.env\.(?!NEXT_PUBLIC_)[A-Z]/.test(s)) add('high', 'web.server-in-client', f, null, 'Client component imports server-only code or reads non-public env', 'Move it to a server component, route handler or server action')
    if (/[\\/]route\.(ts|js)$/.test(f) && /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/.test(s) && !/auth\(|getServerSession|verifyIdToken|getToken|currentUser|session|clerk|headers\(\)\.get\(['"]authorization/i.test(s)) add('medium', 'web.route-no-auth', f, null, 'Mutating route handler without a visible auth check', 'Authenticate and authorize every mutating endpoint (or verify a webhook signature)')
    if (/^\s*['"]use server['"]/m.test(s) && !/auth\(|getServerSession|verifyIdToken|currentUser|session/i.test(s)) add('medium', 'web.action-no-auth', f, null, 'Server actions file without a visible auth check', 'Server actions are public endpoints: check the user inside each action')
    for (const m of s.matchAll(/redirect\(\s*(searchParams|req\.query|params)\b/g)) add('medium', 'web.open-redirect', f, lineOf(s, m.index), 'Redirect to a user-controlled value', 'Allow-list destinations or only allow relative paths')
    for (const m of s.matchAll(/fetch\(\s*(req\.|body\.|searchParams|params\.|url\b)/g)) add('medium', 'web.ssrf', f, lineOf(s, m.index), 'Server-side fetch to a user-controlled URL (SSRF)', 'Validate/allow-list hosts before fetching')
  }
  const nextConfig = ['next.config.js', 'next.config.mjs', 'next.config.ts'].map((n) => path.join(webRoot, n)).find((p) => fs.existsSync(p))
  if (nextConfig || fs.existsSync(path.join(webRoot, 'package.json')) && /"next"/.test(text(path.join(webRoot, 'package.json')))) {
    const s = nextConfig ? text(nextConfig) : ''; const mw = ['middleware.ts', 'src/middleware.ts', 'middleware.js'].map((n) => text(path.join(webRoot, n))).join('\n')
    const all = s + mw
    for (const h of ['Content-Security-Policy', 'X-Frame-Options|frame-ancestors', 'X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security']) if (!new RegExp(h, 'i').test(all)) add(h.startsWith('Content') ? 'medium' : 'low', 'web.header-missing', nextConfig || path.join(webRoot, 'next.config'), null, `Security header not configured: ${h.split('|')[0]}`, 'Add it in next.config headers() or middleware (CSP: start in report-only mode)')
    if (/poweredByHeader\s*:\s*true/.test(s)) add('low', 'web.powered-by', nextConfig, null, 'X-Powered-By header enabled', 'poweredByHeader: false')
  }
}

// ---------- mobile (Flutter + native config) ----------
if (want('mobile')) {
  const mob = path.join(root, config.paths?.mobile || '')
  for (const f of files.filter((x) => x.startsWith(mob) && /AndroidManifest\.xml$/.test(x) && /src[\\/]main/.test(x))) {
    const s = text(f)
    if (/android:debuggable\s*=\s*"true"/.test(s)) add('high', 'android.debuggable', f, lineOf(s, s.search(/android:debuggable/)), 'App marked debuggable in the main manifest', 'Remove android:debuggable (Gradle sets it per build type)')
    if (/usesCleartextTraffic\s*=\s*"true"/.test(s)) add('medium', 'android.cleartext', f, lineOf(s, s.search(/usesCleartextTraffic/)), 'Cleartext HTTP allowed', 'Use HTTPS only; allow cleartext per-domain in network_security_config only for local dev')
    if (/android:allowBackup\s*=\s*"true"/.test(s) || !/android:allowBackup/.test(s)) add('low', 'android.backup', f, null, 'App data can be included in device backups (allowBackup default true)', 'Set android:allowBackup="false" or define backup rules excluding tokens/sensitive data')
    for (const m of s.matchAll(/<(activity|service|receiver|provider)\b[^>]*android:exported\s*=\s*"true"[^>]*>/g)) if (!/android:permission/.test(m[0]) && !/MainActivity|\.MainActivity|FlutterActivity/.test(m[0])) add('medium', 'android.exported', f, lineOf(s, m.index), `Exported ${m[1]} without a permission: ${(m[0].match(/android:name="([^"]+)"/) || [])[1] || ''}`, 'Set exported="false" unless needed; protect with a permission and validate incoming intents')
  }
  for (const f of files.filter((x) => x.startsWith(mob) && /network_security_config\.xml$/.test(x))) if (/cleartextTrafficPermitted\s*=\s*"true"/.test(text(f))) add('medium', 'android.nsc-cleartext', f, null, 'network_security_config permits cleartext', 'Restrict to local dev domains or remove')
  for (const f of files.filter((x) => x.startsWith(mob) && /Info\.plist$/.test(x))) if (/NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(text(f))) add('medium', 'ios.ats-disabled', f, null, 'App Transport Security disabled (NSAllowsArbitraryLoads)', 'Remove it; add narrow exceptions only if unavoidable')
  const gradle = files.filter((x) => x.startsWith(mob) && /android[\\/]app[\\/]build\.gradle(\.kts)?$/.test(x))
  for (const f of gradle) { const s = text(f); if (/signingConfig\s*=?\s*signingConfigs\.debug/.test(s.slice(s.search(/release\s*\{/)))) add('high', 'android.release-debug-signing', f, null, 'Release build signed with the debug key', 'Configure a release signingConfig from key.properties (kept out of git)') }
  for (const f of files.filter((x) => x.startsWith(mob) && /[\\/]lib[\\/].*\.dart$/.test(x) && !/\.g\.dart$|generated/.test(x))) {
    const s = text(f)
    if (/shared_preferences|SharedPreferences/.test(s)) for (const m of s.matchAll(/\.set(String|StringList)\(\s*['"][^'"]*(token|password|secret|jwt|session|credential)[^'"]*['"]/gi)) add('high', 'flutter.prefs-secret', f, lineOf(s, m.index), 'Sensitive value stored in SharedPreferences (plain text)', 'Use flutter_secure_storage (Keychain/Keystore)')
    for (const m of s.matchAll(/['"]http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2)[^'"]+['"]/g)) add('medium', 'flutter.http-url', f, lineOf(s, m.index), `Plain HTTP URL ${m[0].slice(0, 60)}`, 'Use HTTPS')
    for (const m of s.matchAll(/(print|debugPrint|log)\([^)]*\b(token|password|idToken|secret)\b/gi)) add('medium', 'flutter.log-secret', f, lineOf(s, m.index), 'Possible secret written to logs', 'Never log tokens or passwords')
    for (const m of s.matchAll(/badCertificateCallback\s*=\s*\([^)]*\)\s*=>\s*true/g)) add('critical', 'flutter.tls-bypass', f, lineOf(s, m.index), 'TLS certificate validation disabled', 'Remove the override')
    for (const m of s.matchAll(/setJavaScriptMode\(\s*JavaScriptMode\.unrestricted\s*\)/g)) add('low', 'flutter.webview-js', f, lineOf(s, m.index), 'WebView with unrestricted JavaScript', 'Only load trusted content; restrict navigation; avoid JS channels exposing sensitive actions')
  }
  // lessons from production Flutter + Firebase apps
  const dartFiles = files.filter((x) => x.startsWith(mob) && /[\\/]lib[\\/].*\.dart$/.test(x) && !/\.g\.dart$|generated/.test(x))
  const allDart = dartFiles.map((f) => [f, text(f)])
  for (const [f, s] of allDart) for (const m of s.matchAll(/\.use(Functions|Firestore|Auth|Storage|Database)Emulator\s*\(/g)) {
    const before = s.slice(Math.max(0, m.index - 300), m.index)
    if (!/kDebugMode|kReleaseMode|assert\s*\(|isDebug|const bool\.fromEnvironment/.test(before)) add('high', 'flutter.emulator-in-release', f, lineOf(s, m.index), `use${m[1]}Emulator without a kDebugMode guard — in a release build every Firebase call fails ("unavailable")`, 'Wrap the emulator setup in if (kDebugMode) { … }')
  }
  const fnSrc = files.filter((x) => /(^|[\\/])functions[\\/]/.test(rel(x)) && /\.(ts|js)$/.test(x) && !IS_TEST(rel(x))).map(text).join('\n')
  const fnRegions = [...new Set([...fnSrc.matchAll(/region\s*[:=]\s*["']([a-z]+-[a-z]+\d)["']|REGION\s*=\s*["']([a-z]+-[a-z]+\d)["']/g)].map((m) => m[1] || m[2]))]
  if (fnRegions.length && !fnRegions.includes('us-central1')) for (const [f, s] of allDart) {
    for (const m of s.matchAll(/FirebaseFunctions\.instance\s*\.\s*httpsCallable/g)) add('medium', 'flutter.functions-default-region', f, lineOf(s, m.index), `Callable uses the default region (us-central1) but the functions run in ${fnRegions.join(', ')} → "unavailable"/"not-found"`, `FirebaseFunctions.instanceFor(region: '${fnRegions[0]}')`)
    for (const m of s.matchAll(/instanceFor\(\s*region:\s*['"]([a-z0-9-]+)['"]/g)) if (!fnRegions.includes(m[1])) add('high', 'flutter.functions-region-mismatch', f, lineOf(s, m.index), `Callable region ${m[1]} differs from the functions' region (${fnRegions.join(', ')})`, `Use region '${fnRegions[0]}' on both sides`)
  }
  const dartAll = allDart.map(([, s]) => s).join('\n')
  if (/purchaseStream/.test(dartAll)) {
    if (!/completePurchase\s*\(/.test(dartAll)) add('high', 'flutter.iap-no-complete', null, null, 'purchaseStream is used but completePurchase() is never called — Play keeps purchases pending ("you already own this item") and refunds them after 3 days', 'Call completePurchase() for every purchase with pendingCompletePurchase == true (purchased AND restored), after granting')
    if (!/restorePurchases\s*\(/.test(dartAll)) add('medium', 'flutter.iap-no-restore', null, null, 'No restorePurchases() call — purchases are lost after reinstall or clearing data', 'Call restorePurchases() at launch (after the listener) and from a "Restore purchases" button')
  }
  if (/in_app_purchase|purchases_flutter/.test(text(path.join(mob, 'pubspec.yaml'))) && !files.some((x) => /[\\/]functions[\\/]/.test(x) && /verifyPurchase|purchases\.products|androidpublisher|verifyReceipt|validateReceipt|appstoreconnect/i.test(text(x)))) add('high', 'flutter.iap-client-only', path.join(mob, 'pubspec.yaml'), null, 'In-app purchases without visible server-side receipt verification', 'Verify purchases server-side (Cloud Function + Google Play Developer API / App Store Server API) before granting content')
}

// ---------- dependencies (optional, runs package tools) ----------
if (opt.deps) {
  const webRoot = path.join(root, config.paths?.web || '')
  if (fs.existsSync(path.join(webRoot, 'package-lock.json'))) {
    try { execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: webRoot, encoding: 'utf8', shell: process.platform === 'win32' }) } catch (e) {
      try { const j = JSON.parse(e.stdout); const v = j.metadata?.vulnerabilities || {}; for (const s of ['critical', 'high', 'moderate']) if (v[s]) add(s === 'moderate' ? 'medium' : s, 'deps.npm-audit', path.join(webRoot, 'package-lock.json'), null, `npm audit: ${v[s]} ${s} vulnerabilities in production dependencies`, 'npm audit for details; upgrade the affected packages') } catch { add('info', 'deps.npm-audit', null, null, 'npm audit could not run', 'Run it manually') }
    }
  }
}

// ---------- output ----------
const min = SEV.indexOf(String(opt.min || 'info'))
const out = findings.filter((f) => SEV.indexOf(f.severity) >= min).sort((a, b) => SEV.indexOf(b.severity) - SEV.indexOf(a.severity))
if (opt.json) { console.log(JSON.stringify({ root: posix(root), scope, findings: out }, null, 2)); process.exit(0) }
const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪', info: 'ℹ' }
console.log(`DualCraft security scan — scope ${scope} — ${files.length} files`)
for (const f of out) console.log(`${icon[f.severity]} ${f.severity.toUpperCase().padEnd(8)} ${f.rule}  ${f.file ? f.file + (f.line ? ':' + f.line : '') : ''}\n   ${f.message}\n   → ${f.fix}`)
const count = Object.fromEntries(SEV.map((s) => [s, out.filter((f) => f.severity === s).length]))
console.log(`\n${out.length} finding(s): ${SEV.slice().reverse().map((s) => `${s} ${count[s]}`).join(' · ')}`)
console.log('Static heuristics only: confirm each finding, and do the manual review (/dualcraft:security-global).')
process.exit(count.critical || count.high ? 2 : 0)
