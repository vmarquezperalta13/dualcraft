# Error monitoring — wiring per stack

The generated settings (`monitoring.ts`, `monitoring.dart`, `Monitoring.kt`, `Monitoring.swift`) hold what every app must
report the same way: the release name (`<app>@<version>`, the name the build uploads source maps / symbols under), the
environment, the trace sample rate, `sendDefaultPii: false`, the errors to ignore, and `scrubReport()` — which replaces
sensitive keys (password, token, email…) with `"[redacted]"` before anything leaves the device. Wire them once per app.

Rules for every app:
- **Consent first** (`requiresConsent`): start collecting only after the user agrees (Sentry: call `init` after consent;
  Crashlytics: `setCrashlyticsCollectionEnabled(true)` after consent, and disable automatic collection until then).
- **No personal data**: keep `sendDefaultPii` false; identify users only by your internal id (never email or phone).
- **Scrub what you attach**: pass extras, context and breadcrumb data through `scrubReport()`.
- **Symbols**: release builds must upload source maps (web), ProGuard/R8 mappings (Android), dSYMs (iOS) and Dart debug
  symbols (Flutter), or stack traces stay unreadable. `deploy.mjs gen` adds the Sentry token to the deploy workflows.
- **DSN**: the DSN is not secret, but keep it per environment in the host's / build's configuration, not hard-coded.

## Sentry

Install with the official wizard, then replace the options it writes with the generated settings:
`npx @sentry/wizard@latest -i nextjs` (also `nuxt`, `reactNative`, `flutter`, `android`, `ios`, `sourcemaps` for Vite);
Astro: `npx astro add @sentry/astro`.

**JavaScript / TypeScript (Next.js, React + Vite, Astro, Nuxt, React Native)** — the same options everywhere:
```ts
import * as Sentry from '@sentry/nextjs' // @sentry/react · @sentry/astro · @sentry/nuxt · @sentry/react-native
import { monitoring, monitoringEnvironment, tracesSampleRate, scrubReport, shouldReport } from '@/lib/monitoring'

const environment = monitoringEnvironment(process.env.NEXT_PUBLIC_APP_ENV) // your own "preview" / "dev" / "prod"
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, // the variable named in monitoring.dsnEnv
  release: monitoring.release,
  environment,
  tracesSampleRate: tracesSampleRate(environment),
  sendDefaultPii: monitoring.sendDefaultPii,
  ignoreErrors: [...monitoring.ignoreErrors],
  beforeSend: (event) => (shouldReport(event.exception?.values?.[0]?.value) ? scrubReport(event) : null),
  beforeBreadcrumb: (crumb) => scrubReport(crumb),
})
```
Build-time upload: the wizard's build plugin (`withSentryConfig`, `sentryVitePlugin`, the Astro/Nuxt module) reads
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and the release from `SENTRY_RELEASE` — set `release: { name: process.env.SENTRY_RELEASE }` in its options so the uploaded files match `monitoring.release`.

**Flutter** — `sentry_flutter` (+ `sentry_dart_plugin` as a dev dependency to upload debug symbols; build with `--obfuscate --split-debug-info=build/symbols` and point the plugin at it)
```dart
await SentryFlutter.init((o) {
  o.dsn = const String.fromEnvironment('SENTRY_DSN'); // --dart-define=SENTRY_DSN=…
  o.release = Monitoring.release;
  o.environment = Monitoring.environment(const String.fromEnvironment('APP_ENV'));
  o.tracesSampleRate = Monitoring.tracesSampleRate(o.environment!);
  o.sendDefaultPii = Monitoring.sendDefaultPii;
  o.beforeSend = (event, hint) => Monitoring.shouldReport(event.throwable?.toString()) ? event : null;
}, appRunner: () => runApp(const App()));
```

**Android** — `io.sentry:sentry-android` + the `io.sentry.android.gradle` plugin (uploads mappings); set `io.sentry.auto-init` to false in the manifest and init after consent:
```kotlin
SentryAndroid.init(context) { o ->
    o.dsn = BuildConfig.SENTRY_DSN
    o.release = Monitoring.RELEASE
    o.environment = Monitoring.environment(BuildConfig.APP_ENV)
    o.tracesSampleRate = Monitoring.tracesSampleRate(o.environment!!)
    o.isSendDefaultPii = Monitoring.SEND_DEFAULT_PII
    o.beforeSend = SentryOptions.BeforeSendCallback { event, _ -> if (Monitoring.shouldReport(event.throwable?.message)) event else null }
}
```

**iOS** — `sentry-cocoa` (SwiftPM) + a build phase that uploads dSYMs (`sentry-cli debug-files upload`, added by the wizard):
```swift
SentrySDK.start { o in
    o.dsn = Bundle.main.object(forInfoDictionaryKey: Monitoring.dsnKey) as? String
    o.releaseName = Monitoring.release
    o.environment = Monitoring.environment(Bundle.main.object(forInfoDictionaryKey: "APP_ENV") as? String)
    o.tracesSampleRate = NSNumber(value: Monitoring.tracesSampleRate(o.environment))
    o.sendDefaultPii = Monitoring.sendDefaultPii
    o.beforeSend = { event in Monitoring.shouldReport(event.exceptions?.first?.value) ? event : nil }
}
```

**Kotlin Multiplatform** — `Monitoring` lives in `commonMain`; init Sentry in `androidMain` (Android snippet) and in the iOS app (Swift snippet), or use `sentry-kotlin-multiplatform` from `commonMain` with the same options.

## Firebase Crashlytics (mobile)

Crashlytics names releases by the app version and build itself; the generated settings still give you the consent flag,
the ignore list and the scrubber for custom keys and logs.

**Flutter** — `firebase_crashlytics`
```dart
Future<void> initCrashReporting({required bool consent}) async {
  await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(consent && !kDebugMode);
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
  PlatformDispatcher.instance.onError = (error, stack) {
    if (Monitoring.shouldReport(error.toString())) FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };
}
```
Obfuscated builds: upload symbols with `firebase crashlytics:symbols:upload --app=<appId> build/symbols`.

**Android** — `com.google.firebase:firebase-crashlytics` + the `com.google.firebase.crashlytics` Gradle plugin (uploads mappings on release builds). In the manifest, `firebase_crashlytics_collection_enabled` = false; after consent:
```kotlin
Firebase.crashlytics.setCrashlyticsCollectionEnabled(consent)
```

**iOS** — `FirebaseCrashlytics` (SwiftPM) + a Run Script build phase with the Crashlytics `run` script (uploads dSYMs; with SwiftPM: `"${BUILD_DIR%/Build/*}/SourcePackages/checkouts/firebase-ios-sdk/Crashlytics/run"`). In Info.plist, `FirebaseCrashlyticsCollectionEnabled` = NO; after consent:
```swift
Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(consent)
```

**React Native** — `@react-native-firebase/crashlytics`: `firebase.json` → `"crashlytics_auto_collection_enabled": false`, then enable collection after consent with `setCrashlyticsCollectionEnabled(true)`.

## After wiring
- Throw a test error in a debug build and see it arrive with a readable stack trace (then remove it).
- `monitoring.mjs check`, `deploy.mjs gen` + `deploy.mjs secrets` (Sentry token), `legal.mjs gen` (the provider in the privacy policy and the store privacy forms).
- Crashes found later: `dualcraft:mobile-crash` / `dualcraft:debug` from the issue's stack trace.
