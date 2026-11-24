// DualCraft UI idioms — React Native (Expo). Same "@idiom" ids as references/port/ui/{flutter,compose,swiftui}.
// Compiled in CI (tsc with react-native types): keep it valid.
import { Image, Pressable, SafeAreaView, StyleSheet, Text, useColorScheme, View } from 'react-native'

const tokens = {
  light: { primaryContainer: '#E8DEF8', onPrimaryContainer: '#1D192B' },
  dark: { primaryContainer: '#4A4458', onPrimaryContainer: '#E8DEF8' },
}

// @idiom screen-scaffold — Screen with top bar, body and main action
// The top bar comes from the navigator: <Stack.Screen options={{ title: 'Perfil' }} />; a FAB is an absolute Pressable
export function ProfileScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ProfileHeader name="Ana" avatarUrl="https://example.com/a.png" />
      <Pressable style={styles.fab} onPress={() => {}} accessibilityRole="button" accessibilityLabel="Añadir">
        <Text>+</Text>
      </Pressable>
    </SafeAreaView>
  )
}

// @idiom stack-layout — Column, Row, spacing, padding, weight, overlap
// Flexbox: column is the default direction; flex: 1 = Expanded; position: 'absolute' = Positioned
export function ProfileHeader({ name, avatarUrl }: { name: string; avatarUrl: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
      <View>
        <Image source={{ uri: avatarUrl }} style={{ width: 64, height: 64, borderRadius: 32 }} />
        <Text style={{ position: 'absolute', right: 0, bottom: 0 }}>✓</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text>{name}</Text>
        <Text>Madrid</Text>
      </View>
    </View>
  )
}

// @idiom text-image-button — Styled text, images and buttons
export function ActionsPanel({ onSave }: { onSave: () => void }) {
  return (
    <View>
      <Text style={styles.title} numberOfLines={1}>Título</Text>
      <Image source={{ uri: 'https://example.com/cover.png' }} style={{ height: 120 }} resizeMode="cover" />
      <Pressable onPress={onSave} style={styles.primary} accessibilityRole="button"><Text>Guardar</Text></Pressable>
      <Pressable disabled style={styles.outlined} accessibilityRole="button"><Text>Deshabilitado</Text></Pressable>
    </View>
  )
}

// @idiom theme-tokens — Colours and typography from the theme (DualCraft tokens)
export function LabelBadge({ label }: { label: string }) {
  const c = tokens[useColorScheme() === 'dark' ? 'dark' : 'light'] // DualCraft: dsTheme(useColorScheme()).colors
  return (
    <View style={{ backgroundColor: c.primaryContainer, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: c.onPrimaryContainer, fontSize: 12, fontWeight: '500' }}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 16, width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8DEF8' },
  title: { fontSize: 22, fontWeight: '600' },
  primary: { padding: 12, borderRadius: 20, backgroundColor: '#6750A4' },
  outlined: { padding: 12, borderRadius: 20, borderWidth: 1, opacity: 0.5 },
})
