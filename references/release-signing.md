# Release signing and pipeline setup (used by `dualcraft:deploy`)

## GitHub environments (once per repo)
Settings → Environments: **preview** (pull requests), **dev** (push to main), **production** (tags `v*`).
- production: **Required reviewers** (you) + deployment branches/tags limited to `v*` tags → nothing reaches prod without your click.
- Same secret/variable **names** in each environment with that environment's values (e.g. `FIREBASE_PROJECT_ID` = `acme-dev` in dev/preview, `acme-prod` in production). Repo-level secrets for things shared by all (store keys, hosting tokens).
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy.mjs" secrets` lists what each workflow needs and checks what's missing (GitHub API). Set them with `gh secret set NAME --env production < file` / `gh variable set NAME --env dev --body value`.

## Android upload key
- Create once (keep it in a password manager, **never in git**): `keytool -genkeypair -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`.
- Use **Play App Signing** (Google holds the app signing key; this is only the upload key — it can be reset if lost).
- Secret: `base64 -w0 upload-keystore.jks` (macOS: `base64 -i upload-keystore.jks`) → `ANDROID_KEYSTORE_BASE64`, plus `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- The first upload of a new app must be done by hand in Play Console (the API can't create the app); afterwards the workflow uploads to the internal track.
- `PLAY_SERVICE_ACCOUNT_JSON`: Google Cloud → service account → JSON key; Play Console → Users and permissions → invite its email with "Release apps to testing tracks" for the app.

### Flutter — `android/app/build.gradle.kts`
```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) load(FileInputStream(f))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = (keystoreProperties["storeFile"] as String?)?.let { file(it) }
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```
Locally: the same `android/key.properties` (git-ignored) pointing at your keystore. Groovy `build.gradle`: same idea with `def keystoreProperties = new Properties()` and `signingConfigs { release { … } }`.

### Android native / KMP — `app/build.gradle.kts` (or `composeApp/`)
```kotlin
android {
    defaultConfig {
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = project.findProperty("versionName") as String? ?: "0.1.0"
    }
    signingConfigs {
        create("release") {
            System.getenv("ANDROID_KEYSTORE_PATH")?.let { storeFile = file(it) }
            storePassword = System.getenv("KEYSTORE_PASSWORD")
            keyAlias = System.getenv("KEY_ALIAS")
            keyPassword = System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
        }
    }
}
```

## iOS (automatic signing with an App Store Connect API key)
- App Store Connect → Users and Access → Integrations → **Team Keys** → new key with **Admin** role (needed for cloud-managed distribution certificates) → `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPSTORE_PRIVATE_KEY` (content of the .p8, downloadable once).
- `IOS_TEAM_ID` variable (developer.apple.com → Membership).
- The app record must exist in App Store Connect with the bundle id; the project uses **Automatically manage signing**.
- `ExportOptions.plist` (created by `deploy init`): `method app-store-connect`, `destination upload` → `xcodebuild -exportArchive` uploads straight to TestFlight. Build numbers must grow: the workflow uses the run number (+ `BUILD_NUMBER_OFFSET`).
- Internal testers get it after processing (minutes); external testers need a Beta App Review the first time.
- Flutter: `flutter build ios --no-codesign` prepares the project (pods, version), then `xcodebuild archive` signs it.

## React Native (Expo)
`eas build:configure` → `eas.json` with `build.production` and `submit.production`:
```json
{ "build": { "production": { "autoIncrement": true } },
  "submit": { "production": { "android": { "track": "internal", "serviceAccountKeyPath": "./play-service-account.json" }, "ios": { "ascAppId": "1234567890" } } } }
```
Store credentials live in EAS (`eas credentials`); the workflow only needs `EXPO_TOKEN`.

## Web hosts
| Host | One-time setup | Previews |
|---|---|---|
| Firebase Hosting | `firebase init hosting` in the web folder (public dir = build output); service account with Firebase Hosting Admin per project. SSR (Next/Nuxt) → **Firebase App Hosting** instead (connects to GitHub, deploys on push; no workflow) | preview channels per PR (URL commented on the PR, expire in 7 days) |
| Vercel | `vercel link` in the web folder → org/project ids; disable Vercel's own Git deploys if you want CI to gate deploys | preview URL per PR; production on tags |
| Cloudflare Pages | create the Pages project (Direct Upload); production branch = `production` | one URL per branch |
| Netlify | create the site (no Git link if CI deploys) | `pr-<n>` / `dev` aliases; `--prod` on tags |

## Promote to production
1. Merge to main → CI + deploy to dev (web, backend) → test there.
2. `dualcraft:release` closes the version (CHANGELOG, store notes, version bump) → tag `vX.Y.Z` → push the tag.
3. production deploys wait for your approval; mobile builds go to internal testing/TestFlight.
4. Promote the mobile builds in Play Console / App Store Connect when the testing is done (by hand, on purpose).
Rollback: web hosts keep previous deploys (Firebase `hosting:clone` / rollback in the console, Vercel/Netlify "promote previous", Cloudflare "rollback"); backend: redeploy the previous tag (`workflow_dispatch` on it); database migrations need a forward fix.
