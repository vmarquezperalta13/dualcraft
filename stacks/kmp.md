# Stack: Kotlin Multiplatform (Compose Multiplatform)

Shared Kotlin code (logic and, with Compose Multiplatform, UI) for Android and iOS. iOS builds need macOS + Xcode.

## Scaffold
No official CLI generator: use the JetBrains KMP wizard (https://kmp.jetbrains.com — Android + iOS, "Share UI" with Compose Multiplatform), download and unzip into `<dir>`, or clone `https://github.com/Kotlin/KMP-App-Template`. Ask the user which; record it as a decision.

## Architecture
```
composeApp/src/
  commonMain/kotlin/   shared UI (Compose) + features: ui/, presentation (ViewModels), domain/, data/
  commonMain/composeResources/  strings (values/strings.xml, values-<lang>/), fonts, drawables
  androidMain/         Android-specific (MainActivity, actuals)
  iosMain/             iOS-specific (MainViewController, actuals)
  commonTest/          shared tests
iosApp/                Xcode project hosting the shared framework
```
(Or a separate `shared/` module when UI stays native.) Libraries usually used: Koin (DI), Ktor (HTTP), kotlinx.serialization, kotlinx.coroutines/Flow, Room KMP or SQLDelight (local DB), multiplatform ViewModel + Navigation Compose. Platform APIs via `expect`/`actual` or interfaces injected per platform.

## Commands
| | |
|---|---|
| Build Android | `./gradlew :composeApp:assembleDebug` (Windows: `gradlew.bat`) |
| Tests | `./gradlew allTests` · common/JVM: `./gradlew :composeApp:jvmTest` or `testDebugUnitTest` |
| Lint | `./gradlew lint` (Android) + ktlint/detekt if configured |
| iOS | open `iosApp/iosApp.xcodeproj` in Xcode (macOS) or `xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp -destination 'platform=iOS Simulator,name=iPhone 16' build` |
| Dependencies | `gradle/libs.versions.toml` (version catalog) — keep Kotlin, Compose Multiplatform and AGP versions compatible |

## Security
Same mobile checklist (`security-mobile`): Android manifest + R8; iOS ATS/Keychain via actuals (e.g. `multiplatform-settings` with encrypted storage, or Keychain/EncryptedSharedPreferences actuals); secrets never in common code.

## DualCraft outputs
tokens → `commonMain/kotlin/.../theme/DsTokens.kt` (Compose `ColorScheme` light/dark, `DsSpacing`, `DsRadius`, `Typography`) · i18n → `commonMain/composeResources/values[-<lang>]/ds_strings.xml` (`stringResource(Res.string.x)`, `pluralStringResource`) · schema → `commonMain/kotlin/.../model/DbModels.kt` (`@Serializable` data classes) · analytics → `commonMain/kotlin/.../analytics/AnalyticsEvents.kt`.

## Backends
Firebase: GitLive `firebase-kotlin-sdk` (multiplatform) · Supabase: `supabase-kt` · REST/Prisma backends: Ktor client.
