// DualCraft UI idioms — React Native forms and feedback.
import { useState } from 'react'
import { Alert, Modal, Platform, Pressable, Text, TextInput, ToastAndroid, View } from 'react-native'

// @idiom text-field — Text input bound to state
export function NameField({ onChanged }: { onChanged: (s: string) => void }) {
  const [text, setText] = useState('')
  return (
    <TextInput
      value={text}
      onChangeText={(t) => {
        setText(t)
        onChanged(t)
      }}
      placeholder="Nombre"
      returnKeyType="next"
    />
  )
}

// @idiom validation — Validate fields and submit
// Bigger forms: react-hook-form + zod
export function SignUpForm({ onSubmit }: { onSubmit: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const error = email.includes('@') ? null : 'Email no válido'
  return (
    <View>
      <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="Email" />
      {showErrors && error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <Pressable
        onPress={() => {
          setShowErrors(true)
          if (!error) onSubmit(email)
        }}
      >
        <Text>Enviar</Text>
      </Pressable>
    </View>
  )
}

// @idiom dialog — Confirmation dialog returning a value
export const confirmDelete = (): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert('¿Eliminar?', undefined, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
    ]),
  )

// @idiom snackbar — Transient message
// No cross-platform snackbar: ToastAndroid (Android only) or a library (react-native-toast-message, burnt)
export const showSaved = (): void => {
  if (Platform.OS === 'android') ToastAndroid.show('Guardado', ToastAndroid.SHORT)
}

// @idiom bottom-sheet — Modal bottom sheet
// Draggable sheet with snap points: @gorhom/bottom-sheet
export function OptionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ marginTop: 'auto', backgroundColor: 'white', padding: 16 }}>
        <Text>Compartir</Text>
      </View>
    </Modal>
  )
}
