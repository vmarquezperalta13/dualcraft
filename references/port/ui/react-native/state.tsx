// DualCraft UI idioms — React Native state (hooks, zustand, TanStack Query).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import { create } from 'zustand'

// @idiom local-state — State owned by one widget
export function CounterButton() {
  const [count, setCount] = useState(0)
  return <Pressable onPress={() => setCount((c) => c + 1)}><Text>{count}</Text></Pressable>
}

// @idiom shared-state — Screen/app state outside the UI (zustand store)
type CartState = { items: string[]; busy: boolean; add: (id: string) => void }
export const useCart = create<CartState>()((set) => ({
  items: [],
  busy: false,
  add: (id) => set((s) => ({ items: [...s.items, id] })),
}))
export function CartBadge() {
  const count = useCart((s) => s.items.length) // select only what you render
  const add = useCart((s) => s.add)
  return <Pressable onPress={() => add('x')}><Text>{count}</Text></Pressable>
}

// @idiom async-state — Loading / data / error from an async source
const fetchProducts = async (): Promise<string[]> => ['a', 'b']
export function ProductsView() {
  const q = useQuery({ queryKey: ['products'], queryFn: fetchProducts }) // needs <QueryClientProvider> at the root
  if (q.isPending) return <ActivityIndicator />
  if (q.isError) return <Text>Error: {String(q.error)}</Text>
  return <Text>{q.data.length}</Text>
}

// @idiom effects — Start work when shown, clean up when removed
export function TickerText() {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setValue((v) => v + 1), 1000)
    return () => clearInterval(id) // cleanup on unmount (or when deps change)
  }, [])
  return <Text>{value}</Text>
}
