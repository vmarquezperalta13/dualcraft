---
name: photos
description: Product photos from your real photos, free and local - background removal, white store packshots, cutouts, brand backgrounds and ads per language in the DS colours. Use for "fotos de producto", "quita el fondo", "fondo blanco", "packshot".
---

# DualCraft photos

`$PHOTOS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/photos.mjs"`. Talk in the user's language.

## The rule
**Edit real photos, don't invent them.** The user's own product photos (`marketing/photos/input/`) are cut out and composed — the product in every image is the real one, so it never misleads. Everything runs on the user's machine: **free, no API, no account, offline** after the model download. Generated: `marketing/photos/studio.mjs` (never edit). Yours: the spec, `input/`, and `cutouts/` (fix a cutout by hand if needed).

## What it does not do
It never generates or invents images (no AI image or video generation, no paid provider, no GPU): it cannot create new scenes such as a product on a beach table. For those, the user shoots the photo or provides the background (`background: {"image": "path"}`).

## Presets (defaults, editable in the spec)
`store-white` 2000×2000 jpg, pure white, contact shadow, product fills 85 % (Amazon main image) · `cutout` transparent png · `brand-square` 1080×1080 brand spotlight · `ad-feed` 1080×1350 · `ad-story` 1080×1920 (text kept out of the top 14 % and bottom 20 %) · `ad-square` 1080×1080. A preset: `kind` packshot|ad, `width`, `height`, `format` jpg|png|webp, `background` white|transparent|brand|surface|`#rrggbb`|`{"image": "path"}`, `shadow` contact|drop|none, `fill` 0.2–1. A product may list its own `presets`.

## Texts (ads)
Per product: `name`, `headline`, `cta` — literal, `{"es": "…", "en": "…"}`, `"t:<i18n key>"` or `"listing:<store>.<field>"`. Headlines wrap to 3 lines max. Colours from the DS tokens (on-surface, primary, on-primary); fonts from the tokens when a .ttf/.otf exists (woff2 can't be used for images — system font meanwhile).

## 1. Set up
`$PHOTOS init` → spec + `marketing/photos/` (studio, package.json). Then `cd marketing/photos && npm install` (sharp, transformers.js). Ask the user for photos: product alone, plain background, soft light, whole product in frame, as large as possible. Drop them in `input/` and run `$PHOTOS gen` (one product per photo, name from the file name). Edit headlines and CTAs per language in the spec.

## 2. Render (local)
`$PHOTOS render [--product id] [--preset p] [--locale l]` → `marketing/photos/out/<locale|all>/<preset>/<product>.<ext>`, each with a `.json` recipe (source hash, settings, product coverage). `--dry-run` plans without processing. **Look at every result** (open the images) before handing them over; if a cutout is wrong, fix `cutouts/<product>.png` and render again. Ask before a long render if the user may be using the computer for something heavy.

## 3. Check (`$PHOTOS check`)
Spec valid, every input photo has a product, studio current, renders present and current (photo or settings changed → stale), `store-white` fill ≥ 85 %, headlines fit. Always remind: **only photos of the user's own products**; store main images pure white without text, logos or watermarks — check each marketplace's rules.

Pairs with `dualcraft:marketing` (what to say), `dualcraft:video` (cutouts and ads can be scenes in the Remotion videos) and `dualcraft:screenshots` (app store images).
