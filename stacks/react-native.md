# Stack: React Native (Expo)

TypeScript mobile app with Expo (managed workflow + config plugins, EAS builds). Shares language, types and much logic with React/Next.js web.

## Scaffold
`npx create-expo-app@latest <dir> --template default` (TypeScript + Expo Router). Native code is generated on demand (`npx expo prebuild`) — don't commit `android/` and `ios/` unless the project chose the bare workflow.

## Architecture
```
app/                Expo Router file-based routes: (tabs)/, [id].tsx, _layout.tsx
src/features/<x>/   components/, hooks/, api/ (data access), state
src/components/ui/  shared components
src/lib/            clients (firebase / supabase), storage, analytics adapter
src/theme/          generated tokens (ds-tokens.ts)
src/types/          generated db.ts
```
State: React Query for server data; Zustand/Context for app state. Navigation through Expo Router (deep links come for free from the routes).

## Commands
| | |
|---|---|
| Dev | `npx expo start` (press a/i; `--android` / `--ios`) |
| Native run | `npx expo run:android` · `npx expo run:ios` (macOS) |
| Types / lint | `npx tsc --noEmit` · `npx expo lint` |
| Tests | Jest with `jest-expo` + React Native Testing Library (`@testing-library/react-native`); e2e: Maestro (`maestro test flows/`) or Detox |
| Doctor | `npx expo-doctor` (dependency/config problems) · `npx expo install --check` (SDK-compatible versions) |
| Builds | EAS: `eas build -p android --profile preview` · store: `eas build --profile production` + `eas submit` |
| Updates | `eas update` (JS-only OTA — never for native changes) |

## Device
Android emulator/adb exactly as in `mobile-device`; iOS Simulator on macOS. Logs: Metro output + `adb logcat`.

## Security
Secrets: never in `EXPO_PUBLIC_*` or JS bundle; tokens in `expo-secure-store`; deep links (Expo Router) validated; `app.json`/`app.config.ts` permissions minimal; release builds via EAS with credentials managed by EAS.

## DualCraft outputs
tokens → `src/theme/ds-tokens.ts` (colors per theme, spacing, radius, text styles; used via a `useTheme()` hook) · i18n → `src/locales/<locale>.json` (i18next + `i18next-icu` + `expo-localization`) · schema → `src/types/db.ts` · analytics → `src/lib/analytics-events.ts` (adapter: `@react-native-firebase/analytics` or PostHog).

## Backends
Firebase: `@react-native-firebase/*` (needs dev build, not Expo Go) or the Firebase JS SDK (Expo Go compatible, fewer native features). Supabase: `@supabase/supabase-js` + `expo-secure-store` session storage.
