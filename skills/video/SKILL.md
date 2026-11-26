---
name: video
description: Marketing videos with Remotion from one spec - App Store previews, Play promo, Reels/TikTok and feed, per language, from the DS tokens, screenshots and release notes; rendered locally. Use for "vídeo", "Remotion", "app preview", "reel de la versión".
---

# DualCraft video

`$VIDEO` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/video.mjs"`. Talk in the user's language.

## The rule
`.dualcraft/marketing/videos.json` describes each video once, in neutral scenes; DualCraft turns it into a Remotion project (`marketing/video/`) with one composition per video × format × language. Brand from the Design System tokens, texts from the shared i18n and the store listing, screens from the store screenshots — so videos never drift from the product. Generated: `src/data.ts`, `src/theme.ts`, `src/Root.tsx` (never edit). Yours: `src/components.tsx` (the scenes' look and motion).

## Scenes
`title` (text, subtitle) · `screen` (`shot`: a store screenshot name, `caption`, `device`: phone|browser) · `bullets` (title, items) · `cta` (text, sub, `badges`: app-store, google-play). Each has `seconds`. Texts: literal, `{"es": "…", "en": "…"}`, `"t:<i18n key>"` or `"listing:<store>.<field>"`.

## Formats
`app-store` 886×1920, 15–30 s (App Store app preview, iPhone 6.5"+) · `play-promo` 1920×1080 (Google Play promo video, uploaded to YouTube) · `vertical` 1080×1920 (Reels, TikTok, Shorts; ≤ 60 s) · `square` 1080×1080 · `feed` 1080×1350. 30 fps, H.264.

## 1. Set up (`$VIDEO init`)
Derives, and keeps in sync on `gen`:
- **app-intro**: title (app name + subtitle from the listing) → up to 6 store screens with their captions → call to action with the store badges; stretched to fit the App Store 15–30 s window. Needs `.dualcraft/store/screenshots.json` and raw captures (`dualcraft:screenshots`, or the e2e store-screenshots flows).
- **release-<version>**: the latest `.dualcraft/release/<version>.json` store notes as animated bullets + call to action (vertical and square), per language.
Add your own videos (feature clips, campaigns) without `origin`; `"locked": true` keeps a derived one as you edited it. Then `cd marketing/video && npm install && npm run studio` to preview.

## 2. Render (local)
`$VIDEO render [--video app-intro] [--format vertical] [--locale es]` → `marketing/video/out/<locale>/<format>/<video>.mp4`. Review every language before publishing; App Store previews are uploaded per device size in App Store Connect, the Google Play promo as a YouTube link.

## 3. Check (`$VIDEO check`)
Spec valid, durations within each platform's window, texts and screenshots found for every language, generated files current, project installed. Always tell the user: **Remotion is free for individuals and companies of up to 3 people; bigger companies need a company license** (remotion.dev/license); and replace the badge pills with the **official store badges** (per Apple and Google guidelines) before publishing.

Pairs with `dualcraft:marketing` (what to say in each update) and `dualcraft:release` (store notes per language).
