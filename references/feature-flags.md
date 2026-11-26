# Feature flags — provider adapters

The generated `FeatureFlags` / `flags` never imports a provider SDK. Each app plugs its provider in **once, at startup**, by
setting the source: a function from flag key to the raw remote value (or null/undefined when the provider has none).
Until the first fetch finishes, and whenever a value is missing or has the wrong type, the catalog default is used.
Write the adapter in the app (it is yours, not generated), next to where the provider SDK is initialised.

Rules for every adapter:
- Return "no value" (null/undefined/nil) when the provider only has its static fallback, so the catalog default wins.
- Fetch with a sane cache (Remote Config: `minimumFetchInterval` 1 h in production, 0 in debug builds).
- Do not block the first screen on the fetch: read flags where the feature starts, not at import time.
- Tests and QA: set overrides (`setFlagOverrides({...})`, `FeatureFlags.overrides[...] = …`) instead of mocking the SDK.

## Firebase Remote Config

Publish the catalog: `firebase.json` → `"remoteconfig": { "template": ".dualcraft/flags/remoteconfig.template.json" }`, then
`firebase deploy --only remoteconfig`. That **replaces** the live template: change live values in the console (conditions,
percentages), and change keys, types and defaults in the catalog.

**Web (Next.js, React + Vite, Astro, Nuxt)** — `firebase/remote-config`
```ts
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config'
import { setFlagSource } from '@/lib/feature-flags'

export async function initFlags(app: FirebaseApp) {
  const rc = getRemoteConfig(app)
  rc.settings.minimumFetchIntervalMillis = process.env.NODE_ENV === 'production' ? 3_600_000 : 0
  setFlagSource((key) => { const v = getValue(rc, key); return v.getSource() === 'static' ? undefined : v.asString() })
  await fetchAndActivate(rc).catch(() => {}) // offline or blocked: defaults stay
}
```
Remote Config runs in the browser only (call `initFlags` from a client component / `onMounted`); server-rendered pages read the defaults unless you fetch the template server-side with the Admin SDK.

**React Native** — `@react-native-firebase/remote-config`
```ts
import { getRemoteConfig, fetchAndActivate, getValue, setConfigSettings } from '@react-native-firebase/remote-config'
import { setFlagSource } from './lib/feature-flags'

export async function initFlags() {
  const rc = getRemoteConfig()
  await setConfigSettings(rc, { minimumFetchIntervalMillis: __DEV__ ? 0 : 3_600_000 })
  setFlagSource((key) => { const v = getValue(rc, key); return v.getSource() === 'static' ? undefined : v.asString() })
  await fetchAndActivate(rc).catch(() => {})
}
```

**Flutter** — `firebase_remote_config`
```dart
import 'package:firebase_remote_config/firebase_remote_config.dart';
import 'package:flutter/foundation.dart';
import 'generated/feature_flags.dart';

Future<void> initFlags() async {
  final rc = FirebaseRemoteConfig.instance;
  await rc.setConfigSettings(RemoteConfigSettings(fetchTimeout: const Duration(seconds: 10), minimumFetchInterval: kDebugMode ? Duration.zero : const Duration(hours: 1)));
  FeatureFlags.source = (key) { final v = rc.getValue(key); return v.source == ValueSource.valueStatic ? null : v.asString(); };
  try { await rc.fetchAndActivate(); } catch (_) {} // defaults stay
}
```

**Android (Compose)** — `com.google.firebase:firebase-config`
```kotlin
fun initFlags() {
    val rc = Firebase.remoteConfig
    rc.setConfigSettingsAsync(remoteConfigSettings { minimumFetchIntervalInSeconds = if (BuildConfig.DEBUG) 0 else 3600 })
    FeatureFlags.source = { key -> rc.getValue(key).takeIf { it.source != FirebaseRemoteConfig.VALUE_SOURCE_STATIC }?.asString() }
    rc.fetchAndActivate()
}
```

**iOS (SwiftUI)** — `FirebaseRemoteConfig`
```swift
import FirebaseRemoteConfig

func initFlags() {
    let rc = RemoteConfig.remoteConfig()
    let settings = RemoteConfigSettings()
    #if DEBUG
    settings.minimumFetchInterval = 0
    #endif
    rc.configSettings = settings
    FeatureFlags.source = { key in let v = rc.configValue(forKey: key); return v.source == .static ? nil : v.stringValue }
    rc.fetchAndActivate { _, _ in }
}
```

**Kotlin Multiplatform** — `FeatureFlags` lives in `commonMain`; set `FeatureFlags.source` from `androidMain` (Android snippet) and from the iOS app (Swift snippet, through the shared framework), or use a multiplatform wrapper such as GitLive's `firebase-config` in `commonMain`.

## Supabase

Add `.dualcraft/flags/supabase-feature-flags.sql` as a migration (`/dualcraft:database`): a `feature_flags` table everyone can read and only the service role can change, seeded with the defaults (re-running it keeps live values). Change values in the dashboard or from the server. Values are JSON, so they arrive already typed.

**TypeScript (web and React Native)** — `@supabase/supabase-js`
```ts
export async function initFlags() {
  const { data } = await supabase.from('feature_flags').select('key, value')
  const values = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]))
  setFlagSource((key) => values.get(key))
}
```

**Flutter** — `supabase_flutter`
```dart
Future<void> initFlags() async {
  try {
    final rows = await Supabase.instance.client.from('feature_flags').select('key, value');
    final values = {for (final r in rows) r['key'] as String: r['value']};
    FeatureFlags.source = (key) => values[key];
  } catch (_) {} // defaults stay
}
```

**Kotlin (Android, KMP)** — `supabase-kt`
```kotlin
@Serializable data class FlagRow(val key: String, val value: JsonElement)

suspend fun initFlags(client: SupabaseClient) {
    val rows = runCatching { client.from("feature_flags").select().decodeList<FlagRow>() }.getOrDefault(emptyList())
    val values = rows.associate { r -> r.key to (r.value as? JsonPrimitive)?.let { it.booleanOrNull ?: it.longOrNull ?: it.doubleOrNull ?: it.content } }
    FeatureFlags.source = { key -> values[key] }
}
```

**iOS** — `supabase-swift`
```swift
struct FlagRow: Decodable { let key: String; let value: AnyJSON }

func initFlags(_ client: SupabaseClient) async {
    guard let rows: [FlagRow] = try? await client.from("feature_flags").select().execute().value else { return }
    var values: [String: Any] = [:]
    for r in rows {
        switch r.value {
        case let .bool(b): values[r.key] = b
        case let .integer(i): values[r.key] = i
        case let .double(d): values[r.key] = d
        case let .string(s): values[r.key] = s
        default: break
        }
    }
    FeatureFlags.source = { key in values[key] }
}
```

## Local (no remote config)

The catalog defaults are the values. To change one without a release, use overrides from your own config (a JSON in the
app, a debug menu, an environment value). Next.js only inlines `NEXT_PUBLIC_*` variables referenced literally, so list them:
`setFlagSource((k) => ({ new_checkout: process.env.NEXT_PUBLIC_FLAG_NEW_CHECKOUT } as Record<string, unknown>)[k])`.
