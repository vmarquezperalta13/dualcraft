// DualCraft UI idioms — React Native lists.
import { FlatList, Pressable, Text, View } from 'react-native'

export type Item = { id: string; title: string }
const Separator = () => <View style={{ height: 1, backgroundColor: '#ddd' }} />

// @idiom lazy-list — Long list built lazily, with stable keys and item tap
export function ItemList({ items, onTap }: { items: Item[]; onTap: (item: Item) => void }) {
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      ItemSeparatorComponent={Separator}
      renderItem={({ item }) => (
        <Pressable onPress={() => onTap(item)}><Text>{item.title}</Text></Pressable>
      )}
    />
  )
}

// @idiom pull-refresh — Pull to refresh
export function RefreshableList({ items, refreshing, onRefresh }: { items: Item[]; refreshing: boolean; onRefresh: () => void }) {
  return <FlatList data={items} keyExtractor={(i) => i.id} renderItem={({ item }) => <Text>{item.title}</Text>} refreshing={refreshing} onRefresh={onRefresh} />
}

// @idiom grid — Adaptive grid
export function ItemGrid({ items }: { items: Item[] }) {
  return (
    <FlatList
      data={items}
      numColumns={2} // fixed column count: compute it from useWindowDimensions() for an adaptive grid
      keyExtractor={(i) => i.id}
      columnWrapperStyle={{ gap: 8 }}
      contentContainerStyle={{ gap: 8 }}
      renderItem={({ item }) => <View style={{ flex: 1, padding: 16 }}><Text>{item.title}</Text></View>}
    />
  )
}
