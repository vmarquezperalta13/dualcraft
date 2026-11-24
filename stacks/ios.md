# Stack: iOS nativo (Swift + SwiftUI)

**Builds, simulators and signing need macOS + Xcode.** On Windows/Linux DualCraft can write and review Swift code but cannot compile, run or test it — say so explicitly in every verification report, and leave a brain task "verify on macOS".

## Scaffold
Xcode → New Project → App (SwiftUI, Swift Testing) into `<dir>`; or XcodeGen (`brew install xcodegen`, a `project.yml`, `xcodegen generate`) so the project file isn't hand-edited. Dependencies via Swift Package Manager.

## Architecture
```
<App>/
  App/              @main App, root navigation (NavigationStack), dependency container
  Features/<X>/     Views (SwiftUI) + @Observable view models
  Core/             networking, persistence (SwiftData/Core Data), services
  DesignSystem/     generated DsTokens.swift + shared components
  Resources/        Localizable.xcstrings, assets
<App>Tests/         Swift Testing / XCTest
```
Swift Concurrency (async/await, actors, `@MainActor` on UI state); `@Observable` (iOS 17+) or `ObservableObject` for older targets; no force unwraps on external data.

## Commands (macOS)
| | |
|---|---|
| Build | `xcodebuild -scheme <App> -destination 'platform=iOS Simulator,name=iPhone 16' build` |
| Test | `xcodebuild … test` (or `swift test` for packages) |
| Lint/format | SwiftLint / swift-format if configured |
| Simulator | `xcrun simctl list` · `boot` · `install` · `launch` · `io booted screenshot <file>` |
| Release | Archive in Xcode / `xcodebuild archive` + export, upload with Transporter or `xcrun altool`/App Store Connect API; TestFlight first |

## Security
Keychain for tokens; ATS on (no arbitrary loads); Universal Links validated; privacy manifest (`PrivacyInfo.xcprivacy`) and usage descriptions accurate; App Attest for App Check.

## DualCraft outputs
tokens → `DesignSystem/DsTokens.swift` (`Color` per theme via asset-free dynamic colors, `DsSpacing`, `DsRadius`, `Font` styles) · i18n → `Resources/DualCraft.xcstrings` (String Catalog, table "DualCraft") · schema → `Core/Models/DbModels.swift` (`Codable` structs) · analytics → `Core/Analytics/AnalyticsEvents.swift`.

## Backends
Firebase iOS SDK (SPM) · Supabase: `supabase-swift` · REST: URLSession + Codable.
