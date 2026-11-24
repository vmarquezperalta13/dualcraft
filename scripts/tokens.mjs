#!/usr/bin/env node
// DualCraft design tokens: .dualcraft/design/tokens.json (a copy of the project's claude.ai
// Design System project/tokens.json) → code for every platform.
//   check            validate tokens + WCAG contrast of text/background pairs in every theme
//   web              CSS variables with light/dark (+ Tailwind v4 @theme when the project uses it)
//   dart             Flutter: ThemeData light/dark, DsColors ThemeExtension, spacing, radius, text styles
//   all              everything that applies to the project's stacks
// Options: --file tokens.json · --out path · --stdout · --force (overwrite files edited by hand)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseColor, toHex, toArgbInt, contrast } from './lib/color.mjs'
import { findRoot, parseArgs, die, posix } from './lib/project.mjs'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const { opt } = parseArgs(rest)
if (cmd === 'help' || !['check', 'web', 'dart', 'all'].includes(cmd)) {
  console.log('node tokens.mjs check|web|dart|all [--file tokens.json] [--out path] [--stdout] [--force]'); process.exit(cmd === 'help' ? 0 : 1)
}

const root = findRoot()
const config = root ? JSON.parse(fs.readFileSync(path.join(root, '.dualcraft', 'config.json'), 'utf8')) : {}
const file = opt.file ? path.resolve(String(opt.file)) : root ? path.join(root, '.dualcraft', 'design', 'tokens.json') : die('no DualCraft project here and no --file given.')
if (!fs.existsSync(file)) die(`tokens not found: ${posix(file)} — pull them from the Design System with /dualcraft:tokens`)
let raw
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { die(`tokens.json is not valid JSON: ${e.message}`) }
const SRC = root ? posix(path.relative(root, file)) : path.basename(file)

// ---------- normalize & validate ----------
const errors = []; const warnings = []
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const seen = new Set()
const checkName = (n, fam) => {
  if (!NAME.test(n || '')) { errors.push(`${fam}: invalid token name "${n}"`); return false }
  if (seen.has(n)) { errors.push(`${fam}: duplicated token name "${n}"`); return false }
  seen.add(n); return true
}
const list = (fam) => {
  const v = raw[fam]
  if (v === undefined) return []
  if (!v || !Array.isArray(v.tokens)) { errors.push(`${fam}: expected {"tokens": [ … ]} (a list, not a name→value map)`); return [] }
  return v.tokens.filter((t) => checkName(t.name, fam))
}

const themes = (raw.color?.themes?.length ? raw.color.themes : [{ id: 'light', name: 'Light' }]).map((t) => ({ id: t.id, name: t.name || t.id }))
const colorTokens = list('color')
const colorByName = Object.fromEntries(colorTokens.map((t) => [t.name, t]))
function resolveColor(name, theme, trail = []) {
  const t = colorByName[name]
  if (!t) return null
  if (trail.includes(name)) return null
  let v = typeof t.value === 'object' && t.value !== null ? t.value[theme] ?? t.value[themes[0].id] : t.value
  if (v === undefined || v === null) return null
  v = String(v).trim()
  const alias = v.match(/^\{([^}]+)\}$/)
  if (alias) return resolveColor(alias[1], theme, [...trail, name])
  return parseColor(v)
}
const colors = []
for (const t of colorTokens) {
  const values = {}
  for (const th of themes) {
    const c = resolveColor(t.name, th.id)
    if (!c) errors.push(`color "${t.name}" (${th.id}): unsupported or unresolved value ${JSON.stringify(typeof t.value === 'object' ? t.value?.[th.id] ?? t.value?.[themes[0].id] : t.value)}`)
    else values[th.id] = c
  }
  if (Object.keys(values).length === themes.length) colors.push({ name: t.name, usage: t.usage || '', values })
}

const px = (v, base = 16) => {
  if (typeof v === 'number') return v
  const m = String(v).trim().match(/^(-?[\d.]+)(px|rem|em|%)?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2] === 'rem' || m[2] === 'em' ? n * base : m[2] === '%' ? null : n
}
const lengths = (fam) => list(fam).map((t) => {
  const v = px(t.value)
  if (v === null) warnings.push(`${fam} "${t.name}": value "${t.value}" is not a plain length — kept for CSS only`)
  return { name: t.name, value: String(t.value), px: v, usage: t.usage || '' }
})
const spacing = lengths('spacing')
const radius = lengths('radius')
const shadows = list('shadow').map((t) => ({ name: t.name, value: String(t.value), usage: t.usage || '' }))
const others = Object.keys(raw).filter((k) => !['name', 'version', 'meta', 'color', 'type', 'spacing', 'radius', 'shadow', '$schema'].includes(k) && raw[k]?.tokens)
  .flatMap((fam) => list(fam).map((t) => ({ fam, name: t.name, value: String(t.value), usage: t.usage || '' })))

const families = raw.type?.families || {}
const fonts = raw.type?.fonts || []
const textStyles = []
for (const g of raw.type?.groups || []) for (const s of g.styles || []) {
  if (!NAME.test(s.name || '')) { errors.push(`type: invalid style name "${s.name}"`); continue }
  if (textStyles.some((x) => x.name === s.name)) { errors.push(`type: duplicated style "${s.name}"`); continue }
  const fam = s.family || g.family
  if (fam && !families[fam]) warnings.push(`type style "${s.name}": family "${fam}" is not in type.families`)
  const size = px(s.fontSize)
  if (size === null) errors.push(`type style "${s.name}": fontSize "${s.fontSize}" not understood`)
  let lh = null
  if (s.lineHeight !== undefined) {
    const L = String(s.lineHeight).trim()
    lh = /^[\d.]+$/.test(L) ? parseFloat(L) : L.endsWith('%') ? parseFloat(L) / 100 : px(L) !== null && size ? px(L) / size : null
  }
  textStyles.push({ name: s.name, group: g.name, family: fam, stack: fam ? families[fam] : null, size, sizeCss: String(s.fontSize), lh, lhCss: s.lineHeight !== undefined ? String(s.lineHeight) : null, weight: s.fontWeight ?? null, tracking: s.letterSpacing ?? null })
}

// ---------- contrast ----------
function contrastPairs() {
  const names = new Set(colors.map((c) => c.name))
  const pairs = new Map()
  const add = (fg, bg, why) => { if (fg !== bg && names.has(fg) && names.has(bg)) pairs.set(fg + '|' + bg, { fg, bg, why }) }
  for (const c of colors) {
    const n = c.name
    if (n.startsWith('on-')) add(n, n.slice(3), 'on-*')
    if (n.endsWith('-foreground')) add(n, n.slice(0, -11), '*-foreground')
    if (n === 'foreground') add(n, 'background', 'foreground')
    for (const m of c.usage.matchAll(/\bon\s+`?([A-Za-z0-9][\w.-]*)`?/gi)) add(n, m[1].replace(/[.-]+$/, ''), 'usage')
  }
  return [...pairs.values()]
}
const isLarge = (fg) => /display|headline|title|large|heading/i.test(fg)
const contrastReport = []
for (const p of contrastPairs()) for (const th of themes) {
  const fg = colors.find((c) => c.name === p.fg).values[th.id]; const bg = colors.find((c) => c.name === p.bg).values[th.id]
  const ratio = contrast(fg, bg)
  const min = isLarge(p.fg) ? 3 : 4.5
  contrastReport.push({ ...p, theme: th.id, ratio, ok: ratio >= min, min })
}

// ---------- naming helpers ----------
const strip = (n, ...prefixes) => { for (const p of prefixes) if (n.startsWith(p + '-') && n.length > p.length + 1) return n.slice(p.length + 1); return n }
const cssName = (n) => n.replace(/\./g, '_')
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
const DART_RESERVED = new Set('abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for function get hide if implements import in interface is late library mixin new null of on operator part required rethrow return set show static super switch sync this throw true try typedef var void when while with yield lerp copyWith hashCode runtimeType toString type'.split(' '))
const dartId = (s) => { const w = words(s); let c = w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x.toLowerCase())).join('') || 'x'; if (/^\d/.test(c)) c = 'v' + c; return DART_RESERVED.has(c) ? c + 'Token' : c }
const firstFamily = (stack) => (stack ? stack.split(',')[0].trim().replace(/^["']|["']$/g, '') : null)

// ---------- generated-file protection ----------
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
function stamp(body, comment) { return `${comment} dualcraft:hash=${sha(body)}\n${body}` }
function writeGuarded(out, content) {
  if (fs.existsSync(out) && !opt.force) {
    const cur = fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n')
    const m = cur.match(/^(?:\/\/|\/\*) dualcraft:hash=([0-9a-f]{16})(?: \*\/)?\n([\s\S]*)$/)
    if (!m) die(`${posix(path.relative(root || '.', out))} exists and was not generated by DualCraft — use --out for another path or --force to replace it.`)
    if (sha(m[2]) !== m[1]) die(`${posix(path.relative(root || '.', out))} was edited by hand after generation. Move those edits to the Design System (source of truth) or rerun with --force to discard them.`)
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, content)
}

// ---------- web ----------
function webMode() {
  if (config.design?.web) return config.design.web
  const pkg = root && path.join(root, config.paths?.web || '', 'package.json')
  if (pkg && fs.existsSync(pkg)) {
    const p = JSON.parse(fs.readFileSync(pkg, 'utf8')); const v = p.dependencies?.tailwindcss || p.devDependencies?.tailwindcss
    if (v && /(^|[^\d])4/.test(v)) return 'tailwind4'
  }
  return 'css'
}
function genWeb(mode) {
  const tw = mode === 'tailwind4'
  const P = tw ? '--ds-' : '--' // base variables; Tailwind's @theme maps its namespaces onto them
  const cv = (n) => `${P}color-${cssName(strip(n, 'color'))}`
  const L = []
  L.push(`/* GENERATED by DualCraft from ${SRC} (Design System "${raw.name || '?'}" v${raw.version ?? '?'}) — do not edit by hand.`)
  L.push(`   Change the Design System and run /dualcraft:tokens. ${tw ? 'Import after @import "tailwindcss";' : 'Import once, globally.'}`)
  L.push(`   Dark theme: follows the OS, or force it with data-theme="dark" / class="dark" on <html>. */`, '')
  const first = themes[0].id
  const dark = themes.find((t) => t.id === 'dark')
  L.push(':root {')
  if (dark && first !== 'dark') L.push('  color-scheme: light dark;')
  for (const c of colors) L.push(`  ${cv(c.name)}: ${toHex(c.values[first])};${c.usage ? ` /* ${c.usage.replace(/\*\//g, '')} */` : ''}`)
  for (const s of spacing) L.push(`  ${P}spacing-${cssName(strip(s.name, 'spacing', 'space'))}: ${s.value};`)
  for (const r of radius) L.push(`  ${P}radius-${cssName(strip(r.name, 'radius', 'rounded'))}: ${r.value};`)
  for (const s of shadows) L.push(`  ${P}shadow-${cssName(strip(s.name, 'shadow', 'elevation'))}: ${s.value};`)
  for (const [k, v] of Object.entries(families)) L.push(`  ${P}font-${cssName(k)}: ${v};`)
  for (const o of others) L.push(`  ${P}${cssName(o.fam)}-${cssName(strip(o.name, o.fam))}: ${o.value};`)
  L.push('}')
  const themeBlock = (th, sel) => {
    const diff = colors.filter((c) => toHex(c.values[th.id]) !== toHex(c.values[first]))
    if (!diff.length) return
    L.push('', `${sel} {`)
    if (th.id === 'dark') L.push('  color-scheme: dark;')
    for (const c of diff) L.push(`  ${cv(c.name)}: ${toHex(c.values[th.id])};`)
    L.push('}')
  }
  for (const th of themes.slice(1)) {
    if (th.id === 'dark') {
      const diff = colors.filter((c) => toHex(c.values.dark) !== toHex(c.values[first]))
      if (diff.length) {
        L.push('', '@media (prefers-color-scheme: dark) {', '  :root:not([data-theme="light"]):not(.light) {', '    color-scheme: dark;')
        for (const c of diff) L.push(`    ${cv(c.name)}: ${toHex(c.values.dark)};`)
        L.push('  }', '}')
      }
      themeBlock(th, ':root[data-theme="dark"], :root.dark')
    } else themeBlock(th, `:root[data-theme="${th.id}"]`)
  }
  if (tw) {
    L.push('', '@theme {')
    for (const c of colors) { const n = cssName(strip(c.name, 'color')); L.push(`  --color-${n}: var(--ds-color-${n});`) }
    for (const s of spacing) { const n = cssName(strip(s.name, 'spacing', 'space')); L.push(`  --spacing-${n}: var(--ds-spacing-${n});`) }
    for (const r of radius) { const n = cssName(strip(r.name, 'radius', 'rounded')); L.push(`  --radius-${n}: var(--ds-radius-${n});`) }
    for (const s of shadows) { const n = cssName(strip(s.name, 'shadow', 'elevation')); L.push(`  --shadow-${n}: var(--ds-shadow-${n});`) }
    for (const k of Object.keys(families)) L.push(`  --font-${cssName(k)}: var(--ds-font-${cssName(k)});`)
    for (const t of textStyles) {
      const n = cssName(t.name)
      L.push(`  --text-${n}: ${t.sizeCss};`)
      if (t.lhCss) L.push(`  --text-${n}--line-height: ${t.lhCss};`)
      if (t.weight != null) L.push(`  --text-${n}--font-weight: ${t.weight};`)
      if (t.tracking != null) L.push(`  --text-${n}--letter-spacing: ${t.tracking};`)
    }
    L.push('}')
  }
  for (const t of textStyles) {
    L.push('', tw ? `@utility type-${cssName(t.name)} {` : `.type-${cssName(t.name)} {`)
    if (t.family) L.push(`  font-family: var(${P}font-${cssName(t.family)});`)
    L.push(`  font-size: ${t.sizeCss};`)
    if (t.lhCss) L.push(`  line-height: ${t.lhCss};`)
    if (t.weight != null) L.push(`  font-weight: ${t.weight};`)
    if (t.tracking != null) L.push(`  letter-spacing: ${t.tracking};`)
    L.push('}')
  }
  return L.join('\n') + '\n'
}

// ---------- Flutter ----------
const MATERIAL_ROLES = ['primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer', 'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer', 'error', 'onError', 'errorContainer', 'onErrorContainer', 'surface', 'onSurface', 'onSurfaceVariant', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'outline', 'outlineVariant', 'shadow', 'scrim', 'inverseSurface', 'onInverseSurface', 'inversePrimary']
const ROLE_ALIASES = { background: 'surface', foreground: 'onSurface', primaryForeground: 'onPrimary', secondaryForeground: 'onSecondary', destructive: 'error', destructiveForeground: 'onError', border: 'outline', mutedForeground: 'onSurfaceVariant' }
const MATERIAL_TEXT = ['displayLarge', 'displayMedium', 'displaySmall', 'headlineLarge', 'headlineMedium', 'headlineSmall', 'titleLarge', 'titleMedium', 'titleSmall', 'bodyLarge', 'bodyMedium', 'bodySmall', 'labelLarge', 'labelMedium', 'labelSmall']
const fw = (w) => { const n = parseInt(String(w).split(/\s+/)[0], 10); return Number.isNaN(n) ? null : `FontWeight.w${Math.min(900, Math.max(100, Math.round(n / 100) * 100))}` }
const dnum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)))

function genDart() {
  const prefix = config.design?.dartPrefix || 'Ds'
  const C = `${prefix}Colors`
  const L = [`// GENERATED by DualCraft from ${SRC} (Design System "${raw.name || '?'}" v${raw.version ?? '?'}) — do not edit by hand.`, '// Change the Design System and run /dualcraft:tokens.', '// Use: MaterialApp(theme: ' + prefix + 'Theme.light()' + (themes.some((t) => t.id === 'dark') ? `, darkTheme: ${prefix}Theme.dark()` : '') + ') · colors: context.ds.<name> · ' + prefix + 'Spacing / ' + prefix + 'Radius / ' + prefix + 'Text.', '// ignore_for_file: type=lint', '', "import 'package:flutter/material.dart';", '']
  const themeIds = new Set(themes.map((t) => dartId(t.id)))
  const ids = colors.map((c) => { const id = dartId(c.name); return { ...c, id: themeIds.has(id) ? id + 'Color' : id } })
  // colors extension
  L.push('@immutable', `class ${C} extends ThemeExtension<${C}> {`)
  L.push(`  const ${C}({${ids.map((c) => `required this.${c.id}`).join(', ')}});`, '')
  for (const c of ids) { if (c.usage) L.push(`  /// ${c.usage}`); L.push(`  final Color ${c.id};`) }
  for (const th of themes) {
    L.push('', `  static const ${C} ${dartId(th.id)} = ${C}(`)
    for (const c of ids) L.push(`    ${c.id}: Color(${toArgbInt(c.values[th.id])}),`)
    L.push('  );')
  }
  L.push('', '  @override', `  ${C} copyWith({${ids.map((c) => `Color? ${c.id}`).join(', ')}}) => ${C}(`)
  for (const c of ids) L.push(`        ${c.id}: ${c.id} ?? this.${c.id},`)
  L.push('      );', '', '  @override', `  ${C} lerp(ThemeExtension<${C}>? other, double t) {`, `    if (other is! ${C}) return this;`, `    return ${C}(`)
  for (const c of ids) L.push(`      ${c.id}: Color.lerp(${c.id}, other.${c.id}, t)!,`)
  L.push('    );', '  }', '}', '')
  L.push(`extension ${prefix}ThemeContext on BuildContext {`, `  /// The design system colors of the current theme.`, `  ${C} get ds => Theme.of(this).extension<${C}>()!;`, '}', '')
  // spacing / radius
  const lengthClass = (name, items, pre, lead) => {
    const ok = items.filter((i) => i.px !== null)
    if (!ok.length) return
    L.push(`abstract final class ${prefix}${name} {`)
    for (const i of ok) { if (i.usage) L.push(`  /// ${i.usage}`); const st = strip(i.name, ...pre); L.push(`  static const double ${/^[0-9]/.test(st) ? lead + st.replace(/[^A-Za-z0-9]+/g, '_') : dartId(st)} = ${dnum(i.px)};`) }
    L.push('}', '')
  }
  lengthClass('Spacing', spacing, ['spacing', 'space'], 's')
  lengthClass('Radius', radius, ['radius', 'rounded'], 'r')
  // text styles
  if (textStyles.length) {
    L.push(`abstract final class ${prefix}Text {`)
    for (const t of textStyles) {
      const props = []
      const fam = firstFamily(t.stack); if (fam && !/^(system-ui|sans-serif|serif|monospace|-apple-system)$/.test(fam)) props.push(`fontFamily: '${fam.replace(/'/g, "\\'")}'`)
      if (t.size !== null) props.push(`fontSize: ${dnum(t.size)}`)
      if (t.lh !== null && t.lh !== undefined) props.push(`height: ${dnum(t.lh)}`)
      if (t.weight != null && fw(t.weight)) props.push(`fontWeight: ${fw(t.weight)}`)
      if (t.tracking != null) { const ls = String(t.tracking).endsWith('em') ? parseFloat(t.tracking) * (t.size || 16) : px(t.tracking); if (ls !== null) props.push(`letterSpacing: ${dnum(ls)}`) }
      L.push(`  static const TextStyle ${dartId(t.name)} = TextStyle(${props.join(', ')});`)
    }
    L.push('}', '')
  }
  // theme
  const byRole = {}
  for (const c of ids) { const role = MATERIAL_ROLES.includes(c.id) ? c.id : ROLE_ALIASES[c.id]; if (role && !byRole[role]) byRole[role] = c.id }
  const seed = byRole.primary || ids[0]?.id
  const textMap = textStyles.map((t) => ({ t, id: dartId(t.name) })).filter((x) => MATERIAL_TEXT.includes(x.id))
  const baseFam = firstFamily(families.sans || families.body || families.base || Object.values(families)[0])
  L.push(`abstract final class ${prefix}Theme {`)
  const themeFn = (fnName, themeId, brightness) => {
    L.push(`  static ThemeData ${fnName}() => _build(Brightness.${brightness}, ${C}.${dartId(themeId)});`)
  }
  const lightTheme = themes.find((t) => t.id === 'light') || themes[0]
  themeFn('light', lightTheme.id, 'light')
  if (themes.some((t) => t.id === 'dark')) themeFn('dark', 'dark', 'dark')
  for (const th of themes.filter((t) => t !== lightTheme && t.id !== 'dark')) themeFn(dartId(th.id), th.id, 'light')
  L.push('', `  static ThemeData _build(Brightness brightness, ${C} c) {`)
  L.push(seed ? `    final scheme = ColorScheme.fromSeed(seedColor: c.${seed}, brightness: brightness)${Object.keys(byRole).length ? '.copyWith(' + Object.entries(byRole).map(([r, id]) => `${r}: c.${id}`).join(', ') + ')' : ''};` : '    final scheme = ColorScheme.fromSeed(seedColor: Colors.blue, brightness: brightness);')
  L.push('    return ThemeData(', '      useMaterial3: true,', '      brightness: brightness,', '      colorScheme: scheme,')
  if (byRole.surface) L.push(`      scaffoldBackgroundColor: c.${byRole.surface},`)
  if (baseFam && !/^(system-ui|sans-serif|serif|-apple-system)$/.test(baseFam)) L.push(`      fontFamily: '${baseFam.replace(/'/g, "\\'")}',`)
  if (textMap.length) L.push(`      textTheme: TextTheme(${textMap.map((x) => `${x.id}: ${prefix}Text.${x.id}`).join(', ')}),`)
  L.push('      extensions: [c],', '    );', '  }', '}', '')
  if (fonts.some((f) => f.file)) {
    L.push('// Font files to declare in pubspec.yaml (flutter: fonts:), copied from the Design System:')
    for (const f of fonts.filter((x) => x.file)) L.push(`//   family: ${f.family} · asset: ${f.file} · weight: ${f.weight || 400}${f.style ? ' · style: ' + f.style : ''}${/.woff2?$/i.test(f.file) ? '  ⚠ Flutter needs .ttf/.otf — get that format of this font' : ''}`)
  }
  return L.join('\n') + '\n'
}

// ---------- commands ----------
function report() {
  for (const e of errors) console.log('✗ ' + e)
  for (const w of warnings) console.log('⚠ ' + w)
  console.log(`${raw.name || 'tokens'} v${raw.version ?? '?'} · themes: ${themes.map((t) => t.id).join(', ')} · ${colors.length} colors · ${textStyles.length} text styles · ${spacing.length} spacing · ${radius.length} radius${shadows.length ? ` · ${shadows.length} shadows` : ''}`)
  if (contrastReport.length) {
    const bad = contrastReport.filter((r) => !r.ok)
    console.log(`Contrast: ${contrastReport.length - bad.length}/${contrastReport.length} pairs pass WCAG AA`)
    for (const r of bad) console.log(`✗ contrast ${r.fg} on ${r.bg} (${r.theme}): ${r.ratio.toFixed(2)}:1 < ${r.min}:1`)
  } else console.log('Contrast: no text/background pairs detected (use on-*, *-foreground, or "on <token>" in usage).')
}
if (cmd === 'check') { report(); process.exit(errors.length ? 1 : 0) }
if (errors.length) { report(); die('fix the token errors first.') }

const stackDir = (k) => path.join(root || '.', config.paths?.[k] || '')
function webOut() {
  if (config.design?.out?.web) return path.join(root, config.design.out.web)
  const w = stackDir('web')
  for (const d of ['src/app', 'app', 'src/styles', 'styles']) if (fs.existsSync(path.join(w, d))) return path.join(w, d, 'ds-tokens.css')
  return path.join(w, 'styles', 'ds-tokens.css')
}
const dartOut = () => (config.design?.out?.dart ? path.join(root, config.design.out.dart) : path.join(stackDir('mobile'), 'lib', 'generated', 'design_tokens.dart'))

let targets = cmd === 'all' ? ['web', 'dart'].filter((t) => (t === 'web' ? !!config.stacks?.web : config.stacks?.mobile === 'flutter')) : [cmd]
if (!targets.length) die('nothing to generate: the project has no web or Flutter stack in .dualcraft/config.json.')
for (const t of targets) {
  const mode = t === 'web' ? webMode() : 'dart'
  const body = t === 'web' ? genWeb(mode) : genDart()
  const content = t === 'web' ? stamp(body, '/*').replace(/^(\/\* dualcraft:hash=[0-9a-f]+)/, '$1 */') : stamp(body, '//')
  if (opt.stdout) { console.log(content); continue }
  const out = opt.out && targets.length === 1 ? path.resolve(String(opt.out)) : t === 'web' ? webOut() : dartOut()
  writeGuarded(out, content)
  console.log(`${t === 'web' ? `web (${mode})` : 'flutter'} → ${posix(path.relative(root || '.', out))}`)
}
const bad = contrastReport.filter((r) => !r.ok)
if (bad.length) console.log(`⚠ ${bad.length} contrast pair(s) below WCAG AA — run "check" for details.`)
