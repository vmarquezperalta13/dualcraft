// DualCraft language idioms — TypeScript errors and JSON.

// @idiom exceptions — Custom errors, try/catch/finally
export class NotFoundError extends Error {
  constructor(readonly id: string) {
    super(`NotFound(${id})`)
    this.name = 'NotFoundError'
  }
}
export function safeLoad(load: () => string): string {
  try {
    return load()
  } catch (e) {
    // catch has no type filter: e is `unknown`, check it
    if (e instanceof NotFoundError) return `missing ${e.id}`
    return `error ${e instanceof Error ? e.message : String(e)}`
  } finally {
    // cleanup
  }
}

// @idiom result — Errors as values
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }
export function parseAge(s: string): Outcome<number> {
  const n = Number.parseInt(s, 10)
  return Number.isNaN(n) ? { ok: false, error: `not a number: ${s}` } : { ok: true, value: n }
}
export const ageOrZero = (s: string): number => {
  const r = parseAge(s)
  return r.ok ? r.value : 0
}

// @idiom json — Decode/encode a model
export interface Product {
  id: string
  price: number
  tags: string[]
}
export function decodeProduct(body: string): Product {
  const j = JSON.parse(body) as Partial<Product> // JSON.parse does NOT validate: check fields (or use zod)
  if (typeof j.id !== 'string' || typeof j.price !== 'number') throw new Error('invalid product')
  return { id: j.id, price: j.price, tags: Array.isArray(j.tags) ? j.tags : [] }
}
export const encodeProduct = (p: Product): string => JSON.stringify(p)
