# Stack: Android nativo (Kotlin + Jetpack Compose)

## Scaffold
No official CLI generator: Android Studio → New Project → *Empty Activity* (Compose, Kotlin DSL, version catalog) into `<dir>`. If the user can't use Android Studio now, write the minimal Gradle project by hand (settings.gradle.kts, app/build.gradle.kts, AndroidManifest, MainActivity) and generate the wrapper with `gradle wrapper` if Gradle is installed.

## Architecture (Google's recommended app architecture)
```
app/src/main/java/<pkg>/
  ui/<feature>/      Composable screens + ViewModel (StateFlow<UiState>)
  ui/theme/          Theme.kt (+ generated DsTokens.kt)
  domain/            use cases (optional)
  data/              repositories, data sources (remote/local), models
  di/                Hilt modules
app/src/main/res/values[-<lang>]/strings.xml
```
Libraries usually used: Hilt (DI), Navigation Compose, Room (local DB), Retrofit/OkHttp or Ktor (HTTP), kotlinx.serialization, Coroutines/Flow, DataStore. Unidirectional data flow: UI ← StateFlow from ViewModel; events up.

## Commands (`gradlew.bat` on Windows)
| | |
|---|---|
| Build | `./gradlew assembleDebug` |
| Unit tests | `./gradlew testDebugUnitTest` |
| UI tests | `./gradlew connectedDebugAndroidTest` (device/emulator; Compose testing `createComposeRule`) |
| Lint | `./gradlew lint` (+ ktlint/detekt if configured) |
| Release | `./gradlew bundleRelease` (signing config from a keystore outside the repo; R8 on) |
| Install/run | `./gradlew installDebug` then `adb shell monkey -p <applicationId> 1` |

Device tooling: `mobile-device` (adb) applies as is. Crashes: `mobile-crash` (Java/Kotlin traces, R8 mapping).

## Security
`security-mobile` Android items: manifest (exported, backup, cleartext), EncryptedSharedPreferences/DataStore + Keystore for secrets, network security config, R8, Play Integrity.

## DualCraft outputs
tokens → `ui/theme/DsTokens.kt` (Material 3 `lightColorScheme`/`darkColorScheme`, `DsSpacing`, `DsRadius`, `Typography`) · i18n → `res/values[-<lang>]/ds_strings.xml` (strings + plurals; the app's own `strings.xml` stays untouched) · schema → `data/model/DbModels.kt` (`@Serializable` data classes) · analytics → `analytics/AnalyticsEvents.kt`.

## Backends
Firebase Android SDK (BoM) · Supabase: `supabase-kt` · REST: Retrofit/Ktor.
