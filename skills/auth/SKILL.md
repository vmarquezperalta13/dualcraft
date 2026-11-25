---
name: auth
description: Authentication on Firebase or Supabase from one config (.dualcraft/auth/auth.json) - email, Google, Apple, phone, passkeys, guest and linking, 2FA, roles and route rules, account deletion; typed AuthService and sign-in/account screens per stack, server functions. Use for "login", "registro", "roles", "borrar cuenta", "passkeys", "2FA".
---

# DualCraft auth

`$AUTH` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/auth.mjs"`, `$BACKEND` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/backend.mjs"`, `$I18N` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/auth/auth.json` is the single source: sign-in methods, guest + linking, email verification, password policy, MFA factors, roles (default + admin), route access rules, account deletion and passkey relying party. Everything else is generated from it, so web and apps can't disagree on who may see what. Never hard-code a role check or a route guard: use the generated `decideAccess()` / `roleFrom()`.

## 1. Set up (`$AUTH init`)
Needs a backend first (`dualcraft:backend` init: Firebase or Supabase). Ask the user (AskUserQuestion) for: methods (`--methods email,google,apple,passkey,phone`), roles (`--roles admin,editor,user`, `--admin-role`), second factor (`--mfa totp,sms|none`), guest (`--no-guest`), linking (`--no-linking`) and, with passkeys, the domain (`--rp-id acme.app`). Then complete in `auth.json`: `routes.rules` (first match wins; `public | guest | signedIn | verified | roles:[…]`, `**` globs), `deletion.cleanup` (collections/tables with the user's data, storage prefixes), `deletion.webUrl`, `passkey.origins` (web origins + `android:apk-key-hash:…`), `passkey.androidSha256`, `passkey.iosAppId`.

## 2. What `$AUTH gen` writes
- **Catalog per stack** (generated, never edit): `AuthRole`, `roleFrom`, `AuthMethod`, `AuthFeatures`, `AuthUser`, route rules + `decideAccess(path, user)` → allow / signIn / verifyEmail / forbidden, password policy + `passwordProblems`, 18 normalized error codes from Firebase and Supabase + `authErrorFrom` (texts `auth.errors.*`), and the `AuthService` interface.
- **Server**: `deleteAccount` (needs a recent sign-in, deletes the data, then the user) and `setUserRole` (admins only; Firebase custom claims / Supabase `app_metadata`) declared in the backend contract with typed clients; `functions/scripts/grant-role.mjs` (Firebase) or SQL (Supabase) for the first admin. Firebase + passkeys: `functions/src/passkeys.ts` (WebAuthn with SimpleWebAuthn, custom token).
- **AuthService implementation per stack** (written once, yours afterwards): Flutter, web (Next.js, Vite, Astro, Nuxt), React Native, Android, KMP (Supabase), iOS — Firebase or Supabase. A method enabled later → `check` lists what to add by hand.
- **Screens per stack** (written once): `AuthFlow` (sign in, sign up, forgot password, phone, second factor, verify email), `AccountScreen` (methods + linking, second factor, passkey, sign out, delete account with re-authentication) and `authRedirect()` for the router. Flutter `lib/features/auth/`, React `components/auth/`, RN `src/screens/auth/`, Nuxt `components/auth/*.vue`, Compose `ui/auth/`, SwiftUI `Features/Auth/`. They use the platform theme fed by the DS tokens and the shared texts `auth.ui.*`.
- **Texts**: `auth.errors.*`, `auth.password.*`, `auth.ui.*` seeded in every locale (never overwritten) → run `$I18N gen`.
- **Passkeys**: `public/.well-known/assetlinks.json` and `apple-app-site-association` in the web app (fill the placeholders).

## 3. Wire it
- Guards: web middleware/layout and app navigators call `authRedirect(location, user)`; server rules use the role claim (`init` prints Firestore rules / RLS `has_role` helpers).
- Firestore rules for passkeys (deny all to clients) and Supabase `[auth.passkey]` / `[auth.webauthn]` settings are printed by `init`.
- iOS: Sign in with Apple capability; Associated Domains `webcredentials:<rpId>` for passkeys. Android: SHA-1/SHA-256 in Firebase; assetlinks for passkeys.
- Account deletion is required by the App Store (5.1.1(v)) and Google Play (also a web URL) — link `deletion.webUrl` in `dualcraft:legal`.

## 4. Check (`$AUTH check`) before calling it done
Out-of-date catalogs, contract functions and implementations missing, AuthService methods not implemented, missing texts, and store/provider rules: App Store 4.8 (Google on iOS ⇒ Apple too), deletion URL, Identity Platform for Firebase MFA, MFA needs a verified email, RN Firebase has no TOTP, Supabase SMS provider, SMS cost and toll fraud, guest cleanup, passkey limits (Firebase: own functions; Supabase beta: JS ≥ 2.105, Flutter ≥ 2.15, Swift ≥ 2.48, none in supabase-kt) and the Android passkey origin. Then `$BACKEND check` and `dualcraft:verify`.

## Provider limits to tell the user
- Firebase TOTP/SMS second factor needs **Identity Platform** (paid tiers beyond the free quota).
- @react-native-firebase: no TOTP and no unenroll — SMS only on React Native.
- Supabase passkeys are **beta** (API may change; pin versions); no passkeys in supabase-kt or in React Native with supabase-js.
- Firebase has no native passkeys: DualCraft's functions verify them and sign in with a custom token (the service account needs "Service Account Token Creator").
