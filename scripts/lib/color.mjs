// Color parsing (hex, rgb, hsl, oklch, oklab) to sRGB and WCAG contrast — zero dependencies.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const num = (s, scale = 1) => (String(s).trim().endsWith('%') ? parseFloat(s) / 100 * scale : parseFloat(s))

function args(inner) {
  const [main, alpha] = inner.split('/')
  const parts = main.trim().split(/[\s,]+/).filter(Boolean)
  return { parts, alpha: alpha !== undefined ? num(alpha.trim(), 1) : parts.length === 4 ? num(parts.pop(), 1) : 1 }
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  return lin.map((c) => { c = clamp(c); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) })
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map((x) => Math.round(255 * x))
}

/** Parse a CSS color string → {r,g,b,a} (0-255, alpha 0-1) or null if unsupported. */
export function parseColor(input) {
  const s = String(input).trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (m) {
    let h = m[1]
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1 }
  }
  m = s.match(/^(rgba?|hsla?|oklch|oklab)\((.*)\)$/)
  if (!m || /\(/.test(m[2])) return null
  const { parts, alpha } = args(m[2])
  if (parts.length < 3) return null
  let rgb
  if (m[1].startsWith('rgb')) rgb = parts.slice(0, 3).map((p) => Math.round(clamp(num(p, 255), 0, 255)))
  else if (m[1].startsWith('hsl')) rgb = hslToRgb(parseFloat(parts[0]), num(parts[1].endsWith('%') ? parts[1] : parts[1] + '%', 1), num(parts[2].endsWith('%') ? parts[2] : parts[2] + '%', 1))
  else if (m[1] === 'oklch') {
    const L = num(parts[0], 1); const C = num(parts[1], 0.4); const H = parseFloat(parts[2]) || 0
    rgb = oklabToRgb(L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180))
  } else rgb = oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4))
  if (rgb.some((x) => Number.isNaN(x))) return null
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: clamp(Number.isNaN(alpha) ? 1 : alpha) }
}

export const toHex = ({ r, g, b, a }) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('') + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '')
export const toArgbInt = ({ r, g, b, a }) => '0x' + [Math.round(a * 255), r, g, b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('')

const lum = ({ r, g, b }) => {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** Composite fg over bg (for translucent text), then WCAG contrast ratio. */
export function contrast(fg, bg) {
  const over = (c) => Math.round(c * fg.a + 0)
  const f = fg.a < 1 ? { r: over(fg.r) + Math.round(bg.r * (1 - fg.a)), g: over(fg.g) + Math.round(bg.g * (1 - fg.a)), b: over(fg.b) + Math.round(bg.b * (1 - fg.a)) } : fg
  const [L1, L2] = [lum(f), lum(bg)].sort((x, y) => y - x)
  return (L1 + 0.05) / (L2 + 0.05)
}
