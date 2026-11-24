#!/usr/bin/env node
// DualCraft legal & privacy (EU/Spain: GDPR, LOPDGDD, LSSI-CE, ePrivacy + App Store / Google Play rules).
// .dualcraft/legal/data-map.json is the record of what personal data the product processes, why, on which legal basis,
// for how long and with which providers. Everything legal is generated from it as a DRAFT to review with a professional.
//   scan [--write]     infer data collection from SDKs, the DB schema and permissions; --write merges suggestions (needsReview)
//   gen [--force]      privacy policy, terms, cookie policy (web), App Store privacy answers, Google Data safety answers,
//                      iOS PrivacyInfo.xcprivacy — in every project language
//   check [--json]     map complete and consistent, undeclared collection, account deletion, ATT, permission texts, cookie consent
import fs from 'node:fs'
import path from 'node:path'
import { project, parseArgs, die, posix } from './lib/project.mjs'
import { stamp, writeGuarded } from './lib/guard.mjs'
import { projectStacks } from './lib/targets.mjs'
import { CATEGORIES, PURPOSES, BASES, PROCESSORS, EEA, SDKS, KNOWN_COOKIES, IOS_USAGE, COOKIE_CATEGORIES } from './lib/legal-data.mjs'
import { parseDbml } from './lib/dbml.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['scan', 'gen', 'check'].includes(cmd)) {
  console.log(`node legal.mjs scan [--write] | gen [--force] | check [--json]
data-map.json: {"controller":{"name":"Acme","legalName":"Acme S.L.","taxId":"B12345678","address":"…","email":"privacy@acme.app","country":"ES"},
  "minimumAge":14,"privacyPolicyUrl":"https://acme.app/privacy","accountDeletionUrl":"https://acme.app/delete-account","tracking":false,
  "data":[{"category":"email","purposes":["account"],"legalBasis":"contract","linked":true,"retention":"Hasta que elimines tu cuenta","processors":["firebase"]}],
  "processors":[{"id":"firebase"}],"cookies":[{"name":"_ga","provider":"Google Analytics","category":"analytics","duration":"2 años"}]}
categories: ${Object.keys(CATEGORIES).join(' ')}
purposes: ${Object.keys(PURPOSES).join(' ')} · legal bases: ${Object.keys(BASES).join(' ')}`)
  process.exit(cmd === 'help' ? 0 : 1)
}

const { root, dir, config } = project()
const file = path.join(dir, 'legal', 'data-map.json')
const rel = (p) => posix(path.relative(root, p))
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const stacks = projectStacks(root, config)
const mobile = stacks.filter((s) => s.kind === 'mobile'); const web = stacks.filter((s) => s.kind === 'web')
const iosCapable = mobile.filter((s) => ['flutter', 'ios', 'kmp', 'react-native'].includes(s.id))
const androidCapable = mobile.filter((s) => ['flutter', 'android', 'kmp', 'react-native'].includes(s.id))
const langs = () => { const d = path.join(dir, 'i18n'); const ls = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^(es|en)\.json$/.test(f)).map((f) => f.slice(0, 2)) : []; return ls.length ? [...new Set([config.lang === 'en' ? 'en' : 'es', ...ls])].filter((l) => ['es', 'en'].includes(l)) : [config.lang === 'en' ? 'en' : 'es'] }

function walk(d, re, acc = [], depth = 0) {
  if (depth > 8 || !fs.existsSync(d)) return acc
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|build|\.|Pods|DerivedData|dist|generated|\.dart_tool)/.test(e.name)) walk(p, re, acc, depth + 1) } else if (re.test(e.name)) acc.push(p)
  }
  return acc
}
const depsText = () => [...new Set([root, ...stacks.map((s) => s.dir)])].flatMap((d) => walk(d, /^(pubspec\.yaml|package\.json|build\.gradle(\.kts)?|libs\.versions\.toml|Podfile|Package\.swift|Package\.resolved|project\.pbxproj)$/)).filter((f) => !/functions[\\/]package\.json$/.test(f)).map(read).join('\n')
const codeText = (ss, re) => ss.flatMap((s) => walk(s.id === 'flutter' ? path.join(s.dir, 'lib') : s.dir, re)).map(read).join('\n')

// ---------------------------------------------------------------- scan
function scan() {
  const deps = depsText()
  const found = SDKS.filter((s) => s.re.test(deps))
  const data = []; const processors = new Set(); const cookies = []; const permissions = new Set(); let tracking = false; let auth = false
  const add = (x, source) => { const cur = data.find((y) => y.category === x.category); if (cur) { cur.purposes = [...new Set([...cur.purposes, ...x.purposes])]; cur.sources = [...new Set([...cur.sources, source])]; if (x.tracking) cur.tracking = true } else data.push({ ...x, sources: [source] }) }
  for (const s of found) {
    for (const x of s.data) add({ ...x, processors: s.processor ? [s.processor] : [] }, s.name)
    if (s.processor) processors.add(s.processor)
    if (s.tracking) tracking = true
    if (s.auth) auth = true
    if (s.permission) permissions.add(s.permission)
    if (s.cookies && web.length) for (const c of KNOWN_COOKIES[s.name] || []) cookies.push({ ...c, provider: s.name })
  }
  if (found.some((s) => s.name === 'Store billing')) { if (androidCapable.length) processors.add('google_play'); if (iosCapable.length) processors.add('apple') }
  // DB schema columns that look personal
  const dbml = read(path.join(dir, 'db', 'schema.dbml'))
  if (dbml) {
    try {
      const m = parseDbml(dbml)
      const COLS = [[/^(e_?mail)$/i, 'email'], [/phone|mobile|tel(efono)?$/i, 'phone'], [/^(full_?)?name$|display_?name|first_?name|last_?name|apellido|nombre/i, 'name'], [/address|direccion|street|postal|zip/i, 'address'], [/birth|dob|nacimiento/i, 'birthdate'], [/^lat(itude)?$|^lng$|^lon(gitude)?$|geo|location/i, 'precise_location'], [/photo|avatar|image_url|picture/i, 'photos'], [/health|medical|allerg|diagnos/i, 'health']]
      for (const t of m.tables) for (const f of t.fields) for (const [re, cat] of COLS) if (re.test(f.name)) add({ category: cat, purposes: ['app_functionality'], legalBasis: 'contract', linked: true, processors: [] }, `schema ${t.name}.${f.name}`)
    } catch { /* schema errors are reported by dualcraft:schema */ }
  }
  return { sdks: found.map((s) => s.name), data, processors: [...processors], cookies, permissions: [...permissions], tracking, auth }
}

// ---------------------------------------------------------------- map
const blankMap = () => ({ controller: { name: config.name || '', legalName: '', taxId: '', address: '', email: '', country: 'ES' }, minimumAge: 14, privacyPolicyUrl: '', accountDeletionUrl: '', tracking: false, data: [], processors: [], cookies: [] })
function load() {
  if (!fs.existsSync(file)) die('no .dualcraft/legal/data-map.json yet — run /dualcraft:legal (scan --write) first')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`data-map.json is not valid JSON: ${e.message}`) }
}
const procOf = (m, id) => ({ id, ...PROCESSORS[id], ...(m.processors || []).find((p) => p.id === id) })

function validate(m) {
  const errors = []; const warnings = []
  const c = m.controller || {}
  for (const k of ['legalName', 'email', 'address']) if (!c[k]) errors.push(`controller.${k} is required (who is responsible for the data — it goes in every legal text)`)
  if (c.country === 'ES' && !c.taxId) warnings.push('controller.taxId (NIF/CIF) — required by LSSI-CE for businesses established in Spain')
  if (!Number.isInteger(m.minimumAge)) errors.push('minimumAge must be a number (14 in Spain without parental consent)')
  else if (m.minimumAge < 14) warnings.push(`minimumAge ${m.minimumAge}: under 14 in Spain needs verifiable parental consent; stores also require a kids/families declaration`)
  if (mobile.length && !m.privacyPolicyUrl) errors.push('privacyPolicyUrl: both stores require a public privacy policy URL')
  for (const [i, x] of (m.data || []).entries()) {
    const w = `data[${i}] ${x.category}`
    if (!CATEGORIES[x.category]) { errors.push(`${w}: unknown category (${Object.keys(CATEGORIES).join(', ')})`); continue }
    if (!x.purposes?.length || x.purposes.some((p) => !PURPOSES[p])) errors.push(`${w}: purposes must be some of ${Object.keys(PURPOSES).join(', ')}`)
    if (!BASES[x.legalBasis]) errors.push(`${w}: legalBasis must be ${Object.keys(BASES).join('|')}`)
    if ((x.purposes || []).some((p) => ['advertising', 'marketing'].includes(p)) && x.legalBasis !== 'consent') errors.push(`${w}: advertising/marketing needs consent`)
    if (x.tracking && x.legalBasis !== 'consent') errors.push(`${w}: tracking needs consent`)
    if (CATEGORIES[x.category].special && x.legalBasis !== 'consent') errors.push(`${w}: special category data (art. 9 GDPR) needs explicit consent`)
    if (!x.retention) errors.push(`${w}: retention (how long it is kept) is required`)
    for (const p of x.processors || []) if (!(m.processors || []).some((y) => y.id === p)) errors.push(`${w}: processor "${p}" is not listed in processors`)
    if (x.needsReview) warnings.push(`${w}: suggested by scan (${(x.sources || []).join(', ')}) — confirm purposes, basis and retention, then remove needsReview`)
  }
  for (const p of m.processors || []) {
    const full = procOf(m, p.id)
    if (!full.name) errors.push(`processor "${p.id}": unknown — give name, country, purpose (es/en) and privacy URL`)
    if (full.country && !EEA.has(full.country) && !full.transfer) errors.push(`processor "${p.id}" (${full.country}): international transfer needs a mechanism (adequacy/DPF, SCCs)`)
  }
  for (const c2 of m.cookies || []) if (!COOKIE_CATEGORIES[c2.category]) errors.push(`cookie "${c2.name}": category must be ${Object.keys(COOKIE_CATEGORIES).join('|')}`)
  if ((m.data || []).some((x) => x.tracking) && !m.tracking) errors.push('some data is used for tracking but "tracking" is false (App Store ATT and labels depend on it)')
  if (m.tracking && iosCapable.length && !(m.trackingDomains || []).length) warnings.push('tracking: list the domains your tracking SDKs contact in "trackingDomains" (NSPrivacyTrackingDomains; iOS blocks them until the user allows tracking) — copy them from each SDK\'s privacy manifest')
  return { errors, warnings }
}

// ---------------------------------------------------------------- documents
const T = {
  es: {
    draft: '> **Borrador generado por DualCraft** a partir de `.dualcraft/legal/data-map.json`. Revísalo con un profesional antes de publicarlo; no es asesoramiento legal.',
    updated: 'Última actualización', privacy: 'Política de privacidad', terms: 'Términos y condiciones', cookies: 'Política de cookies',
  },
  en: {
    draft: '> **Draft generated by DualCraft** from `.dualcraft/legal/data-map.json`. Review it with a professional before publishing; it is not legal advice.',
    updated: 'Last updated', privacy: 'Privacy policy', terms: 'Terms and conditions', cookies: 'Cookie policy',
  },
}
const today = () => new Date().toISOString().slice(0, 10)
const purposesOf = (m) => [...new Set((m.data || []).flatMap((x) => x.purposes || []))]

function privacyDoc(m, l) {
  const c = m.controller || {}; const es = l === 'es'; const app = config.name || c.name
  const procs = (m.processors || []).map((p) => procOf(m, p.id))
  const outside = procs.filter((p) => p.country && !EEA.has(p.country))
  const L = [`# ${T[l].privacy} — ${app}`, '', T[l].draft, '', `${T[l].updated}: ${today()}`, '',
    es ? '## 1. Responsable del tratamiento' : '## 1. Data controller',
    `- ${es ? 'Titular' : 'Controller'}: ${c.legalName}${c.taxId ? ` (${es ? 'NIF' : 'Tax ID'} ${c.taxId})` : ''}`, `- ${es ? 'Domicilio' : 'Address'}: ${c.address}`, `- ${es ? 'Contacto' : 'Contact'}: ${c.email}`, ...(c.dpoEmail ? [`- ${es ? 'Delegado de protección de datos' : 'Data protection officer'}: ${c.dpoEmail}`] : []), '',
    es ? '## 2. Qué datos tratamos, para qué y con qué base legal' : '## 2. What data we process, why and on which legal basis', '',
    es ? '| Dato | Finalidad | Base legal | Conservación |' : '| Data | Purpose | Legal basis | Retention |', '|---|---|---|---|']
  for (const x of m.data || []) L.push(`| ${CATEGORIES[x.category]?.[l] || x.category}${x.optional ? (es ? ' (opcional)' : ' (optional)') : ''} | ${(x.purposes || []).map((p) => PURPOSES[p]?.[l]).join('; ')} | ${BASES[x.legalBasis]?.[l] || ''} | ${x.retention || ''} |`)
  L.push('', es ? 'No usamos tus datos para tomar decisiones automatizadas con efectos jurídicos sobre ti.' : 'We do not use your data for automated decisions with legal effects on you.')
  if (m.tracking) L.push('', es ? 'Con tu permiso, algunos datos se usan para medir y personalizar publicidad junto con datos de otras empresas (seguimiento). Puedes negarte o retirar el permiso en los ajustes del dispositivo y de la app.' : 'With your permission, some data is used to measure and personalize advertising together with other companies\' data (tracking). You can refuse or withdraw permission in the device and app settings.')
  L.push('', es ? '## 3. Con quién compartimos los datos' : '## 3. Who we share data with', '',
    es ? 'Proveedores que tratan datos por cuenta nuestra (encargados del tratamiento), con contrato conforme al art. 28 RGPD:' : 'Providers that process data on our behalf (processors), under contracts compliant with Art. 28 GDPR:', '',
    es ? '| Proveedor | Para qué | País | Privacidad |' : '| Provider | What for | Country | Privacy |', '|---|---|---|---|')
  for (const p of procs) L.push(`| ${p.name} | ${p[l] || ''} | ${p.country || ''} | ${p.privacy || ''} |`)
  L.push('', es ? 'No vendemos tus datos. Solo los comunicamos a autoridades cuando una ley nos obliga.' : 'We do not sell your data. We only disclose it to authorities when the law requires it.')
  if (outside.length) {
    L.push('', es ? '## 4. Transferencias internacionales' : '## 4. International transfers', '')
    for (const p of outside) L.push(`- ${p.name} (${p.country}): ${p.transfer}`)
  }
  const n = outside.length ? 5 : 4
  L.push('', es ? `## ${n}. Tus derechos` : `## ${n}. Your rights`, '',
    es ? `Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad, y retirar tu consentimiento en cualquier momento, escribiendo a ${c.email}. Si no estás conforme con nuestra respuesta, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).` : `You can exercise your rights of access, rectification, erasure, objection, restriction and portability, and withdraw your consent at any time, by writing to ${c.email}. If you are not satisfied with our answer, you can lodge a complaint with the Spanish Data Protection Agency (www.aepd.es) or your local authority.`)
  if (m.accountDeletionUrl || mobile.length) L.push('', es ? `**Eliminar tu cuenta:** desde la propia app (Ajustes → Eliminar cuenta)${m.accountDeletionUrl ? ` o en ${m.accountDeletionUrl}` : ''}. Borramos tus datos personales salvo los que una ley nos obligue a conservar, que se bloquean hasta que prescriban.` : `**Deleting your account:** from the app itself (Settings → Delete account)${m.accountDeletionUrl ? ` or at ${m.accountDeletionUrl}` : ''}. We delete your personal data except what a law requires us to keep, which is blocked until it expires.`)
  L.push('', es ? `## ${n + 1}. Menores` : `## ${n + 1}. Children`, '', es ? `La app no está dirigida a menores de ${m.minimumAge} años. Si eres menor de esa edad, necesitas el consentimiento de tus padres o tutores.` : `The app is not intended for children under ${m.minimumAge}. If you are under that age, you need your parents' or guardians' consent.`,
    '', es ? `## ${n + 2}. Seguridad` : `## ${n + 2}. Security`, '', es ? 'Aplicamos medidas técnicas y organizativas adecuadas: cifrado en tránsito, control de acceso por usuario en la base de datos, mínimos privilegios y registro de errores sin datos personales.' : 'We apply appropriate technical and organizational measures: encryption in transit, per-user access control in the database, least privilege and error logging without personal data.',
    '', es ? `## ${n + 3}. Cambios` : `## ${n + 3}. Changes`, '', es ? 'Si cambiamos esta política de forma relevante te avisaremos en la app antes de que el cambio se aplique.' : 'If we change this policy materially we will notify you in the app before the change applies.')
  if (purposesOf(m).includes('analytics') && web.length) L.push('', es ? 'Las cookies y tecnologías similares se explican en la política de cookies.' : 'Cookies and similar technologies are explained in the cookie policy.')
  return L.join('\n') + '\n'
}

function termsDoc(m, l) {
  const c = m.controller || {}; const es = l === 'es'; const app = config.name || c.name
  const payments = readJson(path.join(dir, 'payments', 'products.json'))
  const subs = (payments?.products || []).some((p) => p.type === 'subscription')
  const L = [`# ${T[l].terms} — ${app}`, '', T[l].draft, '', `${T[l].updated}: ${today()}`, '',
    es ? '## 1. Quiénes somos' : '## 1. Who we are', '', `${c.legalName}${c.taxId ? `, ${es ? 'NIF' : 'Tax ID'} ${c.taxId}` : ''}, ${c.address}. ${es ? 'Contacto' : 'Contact'}: ${c.email}.`, '',
    es ? '## 2. Uso del servicio' : '## 2. Using the service', '', es ? `Para usar ${app} debes tener al menos ${m.minimumAge} años y aceptar estos términos. Te comprometes a usarlo de forma lícita, sin suplantar a otros, sin intentar acceder a datos ajenos ni alterar su funcionamiento.` : `To use ${app} you must be at least ${m.minimumAge} and accept these terms. You agree to use it lawfully, without impersonating others, accessing other people's data or disrupting it.`, '',
    es ? '## 3. Tu cuenta' : '## 3. Your account', '', es ? 'Eres responsable de la confidencialidad de tu acceso. Puedes eliminar tu cuenta cuando quieras desde la app. Podemos suspender cuentas que incumplan estos términos, avisándote salvo que la ley lo impida.' : 'You are responsible for keeping your access confidential. You can delete your account at any time from the app. We may suspend accounts that breach these terms, notifying you unless the law prevents it.', '',
    es ? '## 4. Contenido' : '## 4. Content', '', es ? 'El contenido que publiques sigue siendo tuyo; nos das la licencia necesaria para alojarlo y mostrarlo dentro del servicio. Retiraremos contenido ilícito cuando tengamos conocimiento efectivo de él.' : 'Content you post remains yours; you grant us the licence needed to host and display it within the service. We remove unlawful content once we have actual knowledge of it.', '']
  if (payments) {
    L.push(es ? '## 5. Compras y suscripciones' : '## 5. Purchases and subscriptions', '')
    L.push(es ? '- Las compras dentro de la app se procesan por Apple (App Store) o Google (Google Play) con su método de pago; el precio final, con impuestos, se muestra antes de confirmar.' : '- In-app purchases are processed by Apple (App Store) or Google (Google Play) with their payment method; the final price, taxes included, is shown before you confirm.')
    if (subs) L.push(es ? '- Las suscripciones se renuevan automáticamente al final de cada periodo salvo que las canceles al menos 24 horas antes desde los ajustes de tu cuenta de la tienda. Si hay periodo de prueba, se cobra al terminar salvo cancelación previa.' : '- Subscriptions renew automatically at the end of each period unless cancelled at least 24 hours before, from your store account settings. Free trials convert to paid at the end unless cancelled before.')
    L.push(es ? '- Contenido digital: al comprar, solicitas que se te dé acceso inmediato y aceptas que pierdes el derecho de desistimiento de 14 días una vez comenzado el suministro (art. 103.m TRLGDCU). Los reembolsos se gestionan con la tienda según sus condiciones.' : '- Digital content: by purchasing you request immediate access and acknowledge that you lose the 14-day right of withdrawal once supply has started. Refunds are handled by the store under its terms.', '')
  }
  const n = payments ? 6 : 5
  L.push(es ? `## ${n}. Responsabilidad` : `## ${n}. Liability`, '', es ? 'Prestamos el servicio con la diligencia debida, pero no garantizamos que esté libre de interrupciones. Nada en estos términos limita los derechos que te reconoce la normativa de consumidores.' : 'We provide the service with due care but do not guarantee it will be uninterrupted. Nothing in these terms limits your rights under consumer protection law.', '',
    es ? `## ${n + 1}. Ley aplicable` : `## ${n + 1}. Governing law`, '', es ? 'Se aplica la ley española. Si eres consumidor, son competentes los juzgados de tu domicilio. También puedes usar la plataforma europea de resolución de litigios en línea.' : 'Spanish law applies. If you are a consumer, the courts of your place of residence have jurisdiction, and your mandatory local rights still apply.', '',
    es ? `## ${n + 2}. Privacidad` : `## ${n + 2}. Privacy`, '', es ? 'El tratamiento de tus datos se explica en la política de privacidad.' : 'How we process your data is explained in the privacy policy.')
  return L.join('\n') + '\n'
}

function cookiesDoc(m, l) {
  const es = l === 'es'
  const L = [`# ${T[l].cookies} — ${config.name || m.controller?.name || ''}`, '', T[l].draft, '', `${T[l].updated}: ${today()}`, '',
    es ? 'Usamos cookies y tecnologías similares (almacenamiento local) en la web. Las técnicas son necesarias para que funcione; las demás solo se usan si las aceptas en el aviso de cookies, y puedes cambiar tu elección en cualquier momento desde el enlace "Configurar cookies" del pie de página.' : 'We use cookies and similar technologies (local storage) on the website. Strictly necessary ones make it work; the others are only used if you accept them in the cookie banner, and you can change your choice at any time from the "Cookie settings" link in the footer.', '',
    es ? '| Cookie | Proveedor | Tipo | Duración | Para qué |' : '| Cookie | Provider | Type | Duration | Purpose |', '|---|---|---|---|---|']
  for (const c of m.cookies || []) L.push(`| \`${c.name}\` | ${c.provider || ''} | ${COOKIE_CATEGORIES[c.category]?.[l] || c.category} | ${c.duration || ''} | ${c.purpose || ''} |`)
  L.push('', es ? 'También puedes bloquear o borrar cookies desde la configuración de tu navegador.' : 'You can also block or delete cookies in your browser settings.')
  return L.join('\n') + '\n'
}

function appleDoc(m) {
  const tracked = (m.data || []).filter((x) => x.tracking); const linked = (m.data || []).filter((x) => !x.tracking && x.linked !== false); const notLinked = (m.data || []).filter((x) => !x.tracking && x.linked === false)
  const row = (x) => `| ${CATEGORIES[x.category]?.en} (\`${CATEGORIES[x.category]?.apple}\`) | ${[...new Set((x.purposes || []).map((p) => PURPOSES[p]?.apple))].join(', ')} |`
  const L = ['# App Store — App Privacy answers', '', T.en.draft, '', 'App Store Connect → App Privacy. Answer with this table; keep it identical to `PrivacyInfo.xcprivacy` (generated).', '',
    `**Do you or your third-party partners collect data from this app?** ${(m.data || []).length ? 'Yes' : 'No'}`, `**Tracking (ATT required):** ${m.tracking ? 'Yes — the app must ask with AppTrackingTransparency before tracking' : 'No'}`, '']
  for (const [title, list] of [['Data Used to Track You', tracked], ['Data Linked to You', linked], ['Data Not Linked to You', notLinked]]) {
    if (!list.length) continue
    L.push(`## ${title}`, '', '| Data type | Purposes |', '|---|---|', ...list.map(row), '')
  }
  return L.join('\n') + '\n'
}

function googleDoc(m) {
  const L = ['# Google Play — Data safety answers', '', T.en.draft, '', 'Play Console → App content → Data safety. Third-party SDKs count as your app collecting.', '',
    `- Does your app collect or share any of the required user data types? **${(m.data || []).length ? 'Yes' : 'No'}**`, '- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS / TLS only)', `- Do you provide a way for users to request that their data is deleted? **Yes** — in the app and at ${m.accountDeletionUrl || '(set accountDeletionUrl)'}`, '',
    '| Data type | Collected | Shared | Processed ephemerally | Required / optional | Purposes |', '|---|---|---|---|---|---|']
  for (const x of m.data || []) {
    const shared = (x.purposes || []).some((p) => ['advertising'].includes(p)) || x.tracking
    L.push(`| ${CATEGORIES[x.category]?.google} | Yes | ${shared ? 'Yes' : 'No'} | No | ${x.optional ? 'Optional' : 'Required'} | ${[...new Set((x.purposes || []).map((p) => PURPOSES[p]?.google))].join(', ')} |`)
  }
  L.push('', '"Shared" means transferred to a third party for its own purposes; service providers processing on your behalf are not sharing.')
  return L.join('\n') + '\n'
}

const swiftAccessedApis = (s) => {
  if (s.id !== 'ios') return []
  const t = codeText([s], /\.swift$/)
  const out = []
  if (/UserDefaults|@AppStorage/.test(t)) out.push(['NSPrivacyAccessedAPICategoryUserDefaults', 'CA92.1'])
  if (/creationDate|modificationDate|attributesOfItem|contentModificationDateKey/.test(t)) out.push(['NSPrivacyAccessedAPICategoryFileTimestamp', 'C617.1'])
  if (/systemUptime|mach_absolute_time/.test(t)) out.push(['NSPrivacyAccessedAPICategorySystemBootTime', '35F9.1'])
  if (/volumeAvailableCapacity|systemFreeSize/.test(t)) out.push(['NSPrivacyAccessedAPICategoryDiskSpace', 'E174.1'])
  return out
}
const MANAGED = '<!-- dualcraft:managed — generated from .dualcraft/legal/data-map.json by /dualcraft:legal gen -->'
function xcprivacy(m, s) {
  const tracking = !!m.tracking
  const types = (m.data || []).map((x) => `\t\t<dict>
\t\t\t<key>NSPrivacyCollectedDataType</key>
\t\t\t<string>NSPrivacyCollectedDataType${CATEGORIES[x.category].apple}</string>
\t\t\t<key>NSPrivacyCollectedDataTypeLinked</key>
\t\t\t<${x.linked === false ? 'false' : 'true'}/>
\t\t\t<key>NSPrivacyCollectedDataTypeTracking</key>
\t\t\t<${x.tracking ? 'true' : 'false'}/>
\t\t\t<key>NSPrivacyCollectedDataTypePurposes</key>
\t\t\t<array>
${[...new Set((x.purposes || []).map((p) => PURPOSES[p].apple))].map((p) => `\t\t\t\t<string>NSPrivacyCollectedDataTypePurpose${p}</string>`).join('\n')}
\t\t\t</array>
\t\t</dict>`).join('\n')
  const apis = swiftAccessedApis(s).map(([cat, reason]) => `\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>${cat}</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>${reason}</string>
\t\t\t</array>
\t\t</dict>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
${MANAGED}
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<${tracking ? 'true' : 'false'}/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array>
${(m.trackingDomains || []).map((d) => `\t\t<string>${d}</string>`).join('\n')}
\t</array>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array>
${types}
\t</array>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
${apis}
\t</array>
</dict>
</plist>
`.replace(/\n\n+/g, '\n')
}
function xcprivacyPath(s) {
  if (s.id === 'flutter') return path.join(s.dir, 'ios', 'Runner', 'PrivacyInfo.xcprivacy')
  if (s.id === 'react-native') return null // Expo: ios.privacyManifests in app.json
  if (s.id === 'kmp') return fs.existsSync(path.join(s.dir, 'iosApp', 'iosApp')) ? path.join(s.dir, 'iosApp', 'iosApp', 'PrivacyInfo.xcprivacy') : null
  const main = walk(s.dir, /\.swift$/).find((f) => /@main/.test(read(f)))
  return main ? path.join(path.dirname(main), 'PrivacyInfo.xcprivacy') : null
}

function documents(m) {
  const out = []
  const ext = (l) => (langs().length > 1 || l !== 'es' ? `.${l}` : '')
  for (const l of langs()) {
    out.push([path.join(root, 'docs', 'legal', `privacy-policy${ext(l)}.md`), privacyDoc(m, l)])
    out.push([path.join(root, 'docs', 'legal', `terms${ext(l)}.md`), termsDoc(m, l)])
    if (web.length && (m.cookies || []).length) out.push([path.join(root, 'docs', 'legal', `cookies${ext(l)}.md`), cookiesDoc(m, l)])
  }
  if (iosCapable.length) out.push([path.join(root, 'docs', 'legal', 'app-store-privacy.md'), appleDoc(m)])
  if (androidCapable.length) out.push([path.join(root, 'docs', 'legal', 'google-data-safety.md'), googleDoc(m)])
  return out
}
// dates change every day: compare documents without the "updated" line
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/^(Última actualización|Last updated): .*$/m, '').replace(/^<!-- dualcraft:hash=[0-9a-f]+ -->\n/, '')

// ---------------------------------------------------------------- commands
if (cmd === 'scan') {
  const r = scan()
  const cur = readJson(file)
  if (!opt.write) {
    console.log(`SDKs: ${r.sdks.join(', ') || '—'}`)
    for (const x of r.data) console.log(`  ${(cur?.data || []).some((y) => y.category === x.category) ? '✓' : '+'} ${x.category.padEnd(18)} ${x.purposes.join(',').padEnd(28)} ${x.legalBasis.padEnd(19)} ← ${x.sources.join(', ')}`)
    console.log(`processors: ${r.processors.join(', ') || '—'} · permissions: ${r.permissions.join(', ') || '—'} · tracking: ${r.tracking} · cookies: ${r.cookies.map((c) => c.name).join(', ') || '—'}`)
    console.log(cur ? '(+ = not in the data map yet; run scan --write to add them for review)' : '(no data map yet: scan --write creates it)')
    process.exit(0)
  }
  const m = cur || blankMap()
  let added = 0
  for (const x of r.data) {
    const have = m.data.find((y) => y.category === x.category)
    if (have) { have.processors = [...new Set([...(have.processors || []), ...x.processors])]; continue }
    m.data.push({ category: x.category, purposes: x.purposes, legalBasis: x.legalBasis, linked: x.linked !== false, ...(x.tracking ? { tracking: true } : {}), retention: '', processors: x.processors, sources: x.sources, needsReview: true }); added++
  }
  for (const p of r.processors) if (!m.processors.some((y) => y.id === p)) m.processors.push({ id: p })
  for (const c of r.cookies) if (!m.cookies.some((y) => y.name === c.name)) m.cookies.push(c)
  if (r.tracking) m.tracking = true
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n')
  console.log(`${cur ? 'updated' : 'created'} ${rel(file)}: ${added} data type(s) added for review, ${m.processors.length} processor(s), ${m.cookies.length} cookie(s)`)
  process.exit(0)
}

if (cmd === 'gen') {
  const m = load(); const { errors, warnings } = validate(m)
  if (errors.length) { errors.forEach((e) => console.log('✗ ' + e)); die('complete the data map first.') }
  warnings.forEach((w) => console.log('⚠ ' + w))
  for (const [f, body] of documents(m)) {
    const cur = read(f)
    if (cur && norm(cur) === norm(stamp(body, 'html'))) { console.log('= ' + rel(f)); continue }
    console.log('→ ' + writeGuarded(f, stamp(body, 'html'), { root, force: !!opt.force }))
  }
  for (const s of iosCapable) {
    const f = xcprivacyPath(s)
    if (!f) { if (s.id === 'react-native') console.log('⚠ react-native: declare the privacy manifest in app.json → expo.ios.privacyManifests (same data as docs/legal/app-store-privacy.md)'); continue }
    const cur = read(f)
    if (cur && !cur.includes('dualcraft:managed') && !opt.force) { console.log(`⚠ ${rel(f)} exists and is not managed by DualCraft — merge by hand or use --force`); continue }
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, xcprivacy(m, s)); console.log('→ ' + rel(f) + (s.id === 'flutter' || s.id === 'ios' ? ' (add it to the app target in Xcode once)' : ''))
  }
  process.exit(0)
}

// check
const m = load()
const { errors, warnings } = validate(m)
const issues = [...errors.map((x) => ({ level: 'error', m: x })), ...warnings.map((x) => ({ level: 'warn', m: x }))]
const r = scan()
for (const x of r.data) if (!(m.data || []).some((y) => y.category === x.category)) issues.push({ level: 'error', m: `undeclared collection: ${x.category} (${x.sources.join(', ')}) — add it to the data map (scan --write) or remove the SDK/field` })
for (const p of r.processors) if (!(m.processors || []).some((y) => y.id === p)) issues.push({ level: 'error', m: `undeclared processor: ${p} — list it in processors` })
if (r.tracking && !m.tracking) issues.push({ level: 'error', m: 'an advertising SDK is present but the map says tracking: false' })
if (!errors.length) for (const [f, body] of documents(m)) { const cur = read(f); if (!cur) issues.push({ level: 'error', m: `${rel(f)} missing — run gen` }); else if (norm(cur) !== norm(stamp(body, 'html'))) issues.push({ level: 'error', m: `${rel(f)} out of date with the data map — run gen` }) }
const mobileCode = codeText(mobile, /\.(dart|kt|swift|tsx?|jsx?)$/)
if (mobile.length && (r.auth || (m.data || []).some((x) => (x.purposes || []).includes('account')))) {
  if (!/deleteAccount|deleteUser|currentUser!?\??\.delete\(|\.user\?*\.delete\(|auth\.admin\.deleteUser|Auth\.auth\(\)\.currentUser\?\.delete|eliminar (mi |la )?cuenta|delete (my |your )?account/i.test(mobileCode)) issues.push({ level: 'error', m: 'accounts exist but the app has no in-app account deletion (App Store 5.1.1(v), Google Play policy) — add Settings → Delete account, deleting server data too' })
  if (androidCapable.length && !m.accountDeletionUrl) issues.push({ level: 'error', m: 'accountDeletionUrl: Google Play requires a web page to request account deletion without the app' })
}
if (iosCapable.length && m.tracking) {
  if (!/AppTrackingTransparency|app_tracking_transparency|requestTrackingAuthorization|expo-tracking-transparency/.test(mobileCode + depsText())) issues.push({ level: 'error', m: 'tracking on iOS without App Tracking Transparency — ask before any tracking (ATTrackingManager.requestTrackingAuthorization)' })
}
for (const s of iosCapable) {
  const plists = s.id === 'flutter' ? [path.join(s.dir, 'ios', 'Runner', 'Info.plist')] : walk(s.dir, /^Info\.plist$/)
  const plist = plists.map(read).join('\n')
  if (!plist && s.id !== 'react-native') continue
  const appJson = s.id === 'react-native' ? read(path.join(s.dir, 'app.json')) : ''
  const need = [...r.permissions.flatMap((p) => IOS_USAGE[p] || []), ...(m.tracking ? ['NSUserTrackingUsageDescription'] : [])]
  for (const k of need) {
    const mm = (plist + appJson).match(new RegExp(`${k}["']?\\s*(?:</key>\\s*<string>|:\\s*["'])([^<"']*)`))
    if (!mm) issues.push({ level: 'error', m: `${s.id}: ${k} missing in Info.plist — the app crashes when it asks for that permission and App Review rejects it` })
    else if (mm[1].trim().length < 15) issues.push({ level: 'warn', m: `${s.id}: ${k} is too vague ("${mm[1].trim()}") — explain what for, e.g. "Para escanear la entrada del partido"` })
  }
  const pf = xcprivacyPath(s)
  if (pf && !fs.existsSync(pf)) issues.push({ level: 'error', m: `${rel(pf)} missing — Apple requires a privacy manifest (run gen)` })
  else if (pf && read(pf).includes('dualcraft:managed') && read(pf) !== xcprivacy(m, s)) issues.push({ level: 'error', m: `${rel(pf)} out of date with the data map — run gen` })
}
if (web.length && (m.cookies || []).some((c) => c.category !== 'necessary')) {
  const webCode = codeText(web, /\.(tsx?|jsx?|vue|astro|html)$/)
  if (!/cookieconsent|vanilla-cookieconsent|klaro|cookiebot|onetrust|usercentrics|iubenda|gtag\(\s*['"]consent['"]|consent(Banner|Manager|Mode)|CookieBanner|cookie-banner/i.test(webCode)) issues.push({ level: 'error', m: 'non-essential cookies without a consent banner — nothing but necessary cookies may load before the user accepts (ePrivacy/LSSI art. 22.2); Google Consent Mode v2 if you use Google tags' })
}
const allCode = mobileCode + codeText(web, /\.(tsx?|jsx?|vue|astro)$/)
if (stacks.length && m.privacyPolicyUrl && !allCode.includes(m.privacyPolicyUrl) && !/privacy|privacidad/i.test(allCode)) issues.push({ level: 'warn', m: 'no link to the privacy policy in the apps (settings, sign-up and paywall should link it)' })
if (opt.json) console.log(JSON.stringify({ issues, scan: r }, null, 2))
else {
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.m}`)
  const n = issues.filter((i) => i.level === 'error').length
  console.log(n ? `${n} error(s), ${issues.length - n} warning(s)` : `legal OK — ${(m.data || []).length} data type(s), ${(m.processors || []).length} processor(s), ${issues.length} warning(s)`)
  console.log('Drafts only: have a professional review the texts before publishing.')
}
process.exit(issues.some((i) => i.level === 'error') ? 1 : 0)
