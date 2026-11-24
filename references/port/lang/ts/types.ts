// DualCraft language idioms — TypeScript types.

// @idiom class — Class with constructor, private state and getter
export class Counter {
  #value: number // runtime-private (`private` is compile-time only)
  constructor(readonly name: string, start = 0) {
    this.#value = start
  }
  get value(): number {
    return this.#value
  }
  increment(): void {
    this.#value++
  }
}

// @idiom data-class — Immutable value with copy and value equality
export interface User {
  readonly id: string
  readonly name: string
  readonly email?: string
}
export const renameUser = (u: User, name: string): User => ({ ...u, name }) // copyWith = spread
// No value equality: === compares references; compare fields (or use a deep-equal helper)
export const sameUser = (a: User, b: User): boolean => a.id === b.id && a.name === b.name && a.email === b.email
export type LabelCount = { label: string; count: number }
export const makePair = (): LabelCount => ({ label: 'a', count: 1 })

// @idiom enum — Enum with values and behaviour
// Prefer a const object + union type over `enum` (works with JSON, tree-shakes)
export const PLANS = { free: { priceCents: 0 }, pro: { priceCents: 999 } } as const
export type Plan = keyof typeof PLANS
export const isPaid = (p: Plan): boolean => PLANS[p].priceCents > 0
export const parsePlan = (s: string): Plan | undefined => (s in PLANS ? (s as Plan) : undefined)

// @idiom sealed — Closed hierarchy + exhaustive switch
export type LoadState = { kind: 'loading' } | { kind: 'loaded'; items: string[] } | { kind: 'failed'; message: string }
export function render(s: LoadState): string {
  switch (s.kind) {
    case 'loading':
      return 'loading'
    case 'loaded':
      return `${s.items.length} items`
    case 'failed':
      return `error: ${s.message}`
  }
}

// @idiom extension — Add members to an existing type
// No extensions: write a plain function (never patch String.prototype)
export const initials = (s: string): string =>
  s.split(' ').filter(Boolean).map((w) => w[0].toUpperCase()).join('')

// @idiom interface — Interfaces, default behaviour (mixins), implementation
export interface Repository<T> {
  byId(id: string): Promise<T | undefined>
  save(item: T): Promise<void>
}
export class MemoryRepository implements Repository<User> {
  readonly logs: string[] = []
  private items = new Map<string, User>()
  async byId(id: string): Promise<User | undefined> {
    return this.items.get(id)
  }
  async save(item: User): Promise<void> {
    this.logs.push(`save ${item.id}`)
    this.items.set(item.id, item)
  }
}

// @idiom generics — Generic classes, bounds and functions
export interface Comparable<T> {
  compareTo(other: T): number
}
export class Box<T extends Comparable<T>> {
  constructor(readonly value: T) {}
  isBigger(other: Box<T>): boolean {
    return this.value.compareTo(other.value) > 0
  }
}
export const firstOr = <T,>(xs: readonly T[], fallback: T): T => (xs.length ? xs[0] : fallback)
