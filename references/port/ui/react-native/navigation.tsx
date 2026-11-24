// DualCraft UI idioms — React Native navigation (React Navigation; Expo Router notes inline).
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack'
import { Pressable, Text } from 'react-native'

// @idiom routes — Route table with parameters
// Expo Router instead: files app/index.tsx and app/product/[id].tsx, read params with useLocalSearchParams()
export type RootStack = { Home: undefined; Product: { id: string } }
const Stack = createNativeStackNavigator<RootStack>()
export function AppNavigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomePage} options={{ title: 'Inicio' }} />
        <Stack.Screen name="Product" component={ProductPage} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
function HomePage({ navigation }: NativeStackScreenProps<RootStack, 'Home'>) {
  return <Pressable onPress={() => navigation.navigate('Product', { id: '42' })}><Text>Ver</Text></Pressable>
}
function ProductPage({ route }: NativeStackScreenProps<RootStack, 'Product'>) {
  return <Text>Producto {route.params.id}</Text>
}

// @idiom navigate — Push, back, replace the stack, return a result
export function navigateExamples(navigation: NativeStackScreenProps<RootStack, 'Home'>['navigation']) {
  navigation.navigate('Product', { id: '42' }) // push (Expo Router: router.push('/product/42'))
  navigation.goBack() // back (router.back())
  navigation.reset({ index: 0, routes: [{ name: 'Home' }] }) // replace the stack (router.replace('/'))
  // result: navigate back with params (navigation.popTo('Home', {...})) or a shared store
}

// @idiom tabs — Bottom navigation keeping one stack per tab
const Tabs = createBottomTabNavigator()
const HomeTab = () => <Text>Inicio</Text>
const ProfileTab = () => <Text>Perfil</Text>
export function TabsNavigation() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="Inicio" component={HomeTab} />
      <Tabs.Screen name="Perfil" component={ProfileTab} />
    </Tabs.Navigator>
  )
}
