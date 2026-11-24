// DualCraft language idioms — TypeScript. Same "@idiom" ids as references/port/lang/{dart,kotlin,swift}.
// Compiled in CI (tsc --strict): keep it valid.

// @idiom variables — Variables, constants, type inference
export const MAX_ITEMS = 20 // const = binding can't change (the object it points to still can)
export const startedAt = new Date()
export function describe(): string {
  let count = 0 // mutable, inferred number
  count += 1
  const label = `items: ${count}`
  return label
}

// @idiom null-safety — Nullable types and null operators
export function nameLength(name?: string | null): number {
  const n = name ?? 'anonymous' // default value
  const upper = name?.toUpperCase() // optional chaining
  if (name == null) return 0 // narrowing: name is string below (== null also matches undefined)
  return name.length + n.length + (upper?.length ?? 0)
}

export const forceUnwrap = (s: string | null): string => s! // no runtime check: prefer an explicit throw

// @idiom strings — Interpolation, multiline, number formatting
export const greeting = (user: string, total: number): string =>
  `Hola ${user}, total: ${total.toFixed(2)} €\n` +
  `Línea 1
Línea 2`

// @idiom functions — Named, optional and default parameters
// No named parameters: use an options object with defaults
export function formatPrice(amount: number, { currency = 'EUR', withSymbol = true, decimals }: { currency?: string; withSymbol?: boolean; decimals?: number } = {}): string {
  return `${amount.toFixed(decimals ?? 2)} ${withSymbol ? '€' : currency}`
}
export const priceExample = formatPrice(9.5, { withSymbol: false })

// @idiom lambdas — Closures and higher-order functions
export const applyTwice = (f: (x: number) => number, x: number): number => f(f(x))
export const doubled = applyTwice((x) => x * 2, 3)
export function counter(): () => number {
  let c = 0
  return () => c++
}

// @idiom control-flow — if/switch as expressions, loops
export function grade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 70) return 'B'
  return 'C'
}
export function sumEven(xs: number[]): number {
  let s = 0
  for (const x of xs) if (x % 2 === 0) s += x
  return s
}
