---
name: screenshots
description: Store screenshots - capture by deep link, frame at Google Play and App Store sizes with captions per language. Use for "capturas para la tienda", "screenshots de la ficha", "imágenes de Play/App Store".
---

# DualCraft store screenshots

`$SHOTS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/screenshots.mjs"`.

## 1. Plan (with the user, once)
Pick 4–8 screens that sell the app (first two matter most: they show in search) and write `.dualcraft/store/screenshots.json`:
```json
{ "package": "com.company.app",
  "screens": [ { "name": "home", "android": "myapp://home", "ios": "myapp://home", "web": "http://localhost:3000/",
                 "caption": { "es": "Consulta el aforo en directo", "en": "Check capacity live" } } ],
  "frame": { "background": "token:primary", "text": "token:on-primary", "font": "Inter" } }
```
- Each screen needs a deep link that opens it with realistic **demo data** (seed a demo account or use the emulator/local backend — never real users' data).
- Captions: one short benefit per screen, every store language, from `dualcraft:marketing`/ASO; ≤ ~40 characters reads well.
- Colors from design tokens (`token:<name>`) or hex.

## 2. Capture
- Android: start an emulator (`dualcraft:mobile-device`), install a release-like build, then `$SHOTS capture --platform android --locale es` (Android 13+ switches the app language per locale; clean status bar via demo mode).
- iOS (macOS only): boot a simulator, `$SHOTS capture --platform ios --locale es` (status bar 9:41, full battery).
- Web/PWA: `$SHOTS capture --platform web` with the dev server running (`--width 390 --height 844`).
Repeat per locale. Look at every raw image: wrong screen, empty data or a debug banner → fix and recapture.

## 3. Frame and check
`$SHOTS frame --locale all --size all` (or `play-phone`, `ios-6.9`, `ios-6.5`, `ipad-13`) → `.dualcraft/store/screenshots/framed/<locale>/<size>/NN-name.png`. Then `$SHOTS check` (Google Play 2–8 per type, App Store up to 10, exact pixel sizes). Show the user two or three framed images before uploading.

Uploading to the stores is manual (Play Console / App Store Connect) unless the project uses fastlane `supply`/`deliver` — then point them at the framed folders. Commit the plan; framed images only if the team wants them versioned.

Deep links: with `dualcraft:links`, capture by the scheme links it builds; its check flags screens whose link opens no route.
