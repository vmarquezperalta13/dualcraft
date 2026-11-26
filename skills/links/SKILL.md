---
name: links
description: Deep links from one spec - typed link builders and parsers per stack, App Links and Universal Links files (.well-known), platform snippets, and checks that push and screenshots link to real routes. Use for "deep link", "enlace que abra la app", "universal links", "app links", "compartir enlace".
---

# DualCraft links

`$LINKS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/links/links.json` lists the routes a link can open: `name` (camelCase), `path` with `{params}` (like push routes), `params` types (string|int), optional `query` values, and `app` / `web` (both by default). Plus the `domain` (https links that open the app when installed, the web otherwise), the app `scheme`, `android.package` + `sha256`, `ios.appId` (`TEAMID.bundle id`). DualCraft generates per stack — never edit:
- builders: `links.match({ id })` (TS), `MatchRoute(id: …).path` (Dart), `AppRoute.Match(id = …).path` (Kotlin), `AppRoute.match(id:).path` (Swift), and the full link (`linkUrl`, `AppLinks.url`);
- a parser: any incoming link → the typed route, or null when it is not one of ours (other host, bad parameter) — never crash on a link;
- `.well-known/assetlinks.json` and `apple-app-site-association` in the web's `public/` (merged with passkeys if auth uses them).

## 1. Set up
1. `$LINKS init --domain <domain> --scheme <scheme>` (routes imported from push notifications and store screenshots).
2. Add the routes the app opens: `$LINKS add match "/matches/{id}" [--params id:int] [--query tab:string]`. More specific routes win over parameters (`/matches/new` before `/matches/{id}`).
3. Wire each platform with `$LINKS snippets <android|ios|flutter|react-native|hosting>`: intent filters with `autoVerify`, Associated Domains, the app's routing calling the parser, and serving the `.well-known` files as JSON over https without redirects. Ask before touching signing or the hosting config.
4. Fill `android.sha256` (Play Console → App signing; plus the upload key for local tests) and `ios.appId`; deploy the web so the files are live.
5. Prove it on a device: `adb shell am start -a android.intent.action.VIEW -d "https://<domain>/…"` and `xcrun simctl openurl booted "https://<domain>/…"` (`dualcraft:mobile-device`) — the app opens on the right screen; an unknown link lands on a safe screen.

## 2. Use
Share links with the builders (never hand-written strings). Push notifications and screenshots use the same paths; `dualcraft:e2e` flows can open them. Security: treat every incoming link as untrusted input — the parser validates types; the screen still checks permissions (`dualcraft:auth` route rules).

## 3. Check (`$LINKS check`)
Spec valid, generated code and `.well-known` current, domain / package / fingerprint / app id set, Android manifest and iOS entitlements declare the domain, **push routes that are not app routes (error)**, screenshot links that do not resolve.
