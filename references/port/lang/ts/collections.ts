// DualCraft language idioms — TypeScript collections.
import type { User } from './types'

// @idiom list-ops — map, filter, reduce, sort, take
export const topNames = (users: readonly User[]): string[] =>
  users
    .filter((u) => u.email != null)
    .sort((a, b) => a.name.localeCompare(b.name)) // sort() mutates: here it sorts the filtered copy
    .map((u) => u.name)
    .slice(0, 3)
export const totalLength = (xs: string[]): number => xs.reduce((acc, s) => acc + s.length, 0)
export const anyEmpty = (xs: string[]): boolean => xs.some((s) => s === '')

// @idiom map-ops — Dictionaries: count, lookup, iterate
export function countWords(words: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1)
  return m
}
export const lookup = (m: Record<string, string>, k: string): string | undefined => m[k] // undefined if missing
export const entryLabels = (m: Map<string, number>): string[] => [...m].map(([k, v]) => `${k}=${v}`) // insertion order

// @idiom set — Sets
export const common = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a].filter((x) => b.has(x)))
export const merged = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a, ...b])

// @idiom immutability — Read-only and copied collections
export const frozen = (): readonly number[] => Object.freeze([1, 2, 3]) // shallow freeze
export const fixed = [1, 2, 3] as const
export const appended = (xs: readonly number[], x: number): number[] => [...xs, x]

// @idiom grouping — groupBy, first-or-null
export function byHasEmail(users: readonly User[]): Map<boolean, User[]> {
  const m = new Map<boolean, User[]>()
  for (const u of users) {
    const k = u.email != null
    m.set(k, [...(m.get(k) ?? []), u])
  }
  return m // ES2024: Map.groupBy(users, (u) => u.email != null)
}
export const firstWithEmail = (users: readonly User[]): User | undefined => users.find((u) => u.email != null)
