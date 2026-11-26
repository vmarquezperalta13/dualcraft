---
name: marketing
description: What to communicate in each update and ready copy - stores and ASO, web, social, in-app, push, email - with campaign plan and metrics. Use for "ideas de marketing", "cómo anunciamos esta versión", "ASO".
---

# DualCraft marketing

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`, `$REL` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs"`. Write in the project's languages; tone from the brand book (Design System README) — if the project has its own brand/marketing skill, follow it.

## 1. Inputs
- What changed: `$REL notes --version <v>` (CHANGELOG + brain items), specs of the new features, the functional document.
- Who it's for: users/roles in the functional document; current audience and channels (ask once, then record them as a brain note `Marketing: audiencia y canales`).
- What we can measure: `docs/ANALYTICS.md` (tracking plan).
- Brand: Design System README (voice, do/don't), visual assets.

## 2. Pick what to communicate
Rank the version's changes by **user value × visibility**: a new capability or a pain removed > visible improvement > fixes. Per highlight, one line: *for whom · what they can do now · why it matters*. Most updates have 1–3 highlights; a version with only fixes gets a short "better and faster" message — don't inflate it.

## 3. Produce (save as `docs/marketing/<version>.md`)
| Channel | Deliverable |
|---|---|
| **Stores (ASO)** | screenshots via `dualcraft:screenshots` (captions = the highlights). "What's new" already in `.dualcraft/release/<v>.json` (from `dualcraft:release`); if the highlight changes the app's value: new screenshot order/captions (first 2–3 screenshots sell), updated short/promo text, keyword ideas. Persistent listing texts live in `.dualcraft/store/listing.json` (`{"es": {"play": {"title", "short", "full"}, "appstore": {"name", "subtitle", "promo", "keywords", "description"}}}`) → `$REL store-check`. |
| **Web** | landing/hero section or feature block for the highlight, news/blog post outline with SEO target query, meta title/description (`dualcraft:web-seo`), app store badges/deep links. |
| **Social** | one post per network the project uses, adapted (not copy-paste): Instagram/TikTok (hook in the first line, visual idea or short video script with 3–5 shots), X/Threads (short), LinkedIn (if B2B). Hashtags few and relevant. Videos (reel/TikTok of the release, App Store preview, Play promo) → `dualcraft:video` (Remotion, per language). Product photos and static ads from real photos → `dualcraft:photos` (free, local). |
| **In-app** | "what's new" sheet or tooltip copy for the feature (texts through `dualcraft:i18n`), shown once. |
| **Push / email** | only if the highlight justifies interrupting: title ≤ 40 chars, body ≤ 120, clear action, deep link; segment (who benefits). |
| **Campaign plan** | day 0 / day 3 / day 7 sequence, owner, channel; launch-day checklist. |
| **Metrics** | 1–3 success metrics per highlight using tracking-plan events (e.g. `% of active users firing match_shared in 7 days`); missing events → `dualcraft:analytics` before launch. |

Copy rules: benefit before feature, concrete over vague ("Guarda tus partidos favoritos" > "Nueva funcionalidad mejorada"), no false claims, accessible language, store policy compliant (no rankings claims without proof, no misleading screenshots).

## 4. Growth ideas backlog
Each run, propose 3–5 ideas beyond this version, specific to the product: review prompt at a happy moment (`in_app_review` after a success, never after an error), referral/share loops built on the new feature, onboarding tweaks, seasonal/event hooks (matches, holidays), web ↔ app bridges (smart banners, QR, deep links), re-engagement for dormant users, ASO experiments (store listing A/B tests). Save the good ones: `$BRAIN new idea "<idea>" --tags marketing --target <version>` — they appear in the map and roadmap like any other work.

## 5. After launch
Compare the metrics with the targets after 7 and 30 days; record the learning as a brain note (`tags: marketing`) so the next campaign starts from evidence.
