---
name: i18n
description: Manages the app's texts and languages from one source shared by web and mobile - .dualcraft/i18n/<locale>.json (ICU messages) generates Flutter gen-l10n ARB files and next-intl message files - checks missing keys and placeholders across languages, finds hard-coded strings in the code and moves them, adds new languages. Use when the user runs /dualcraft:i18n, "traduce", "añade inglés", "textos de la app", "hay textos sin traducir", "cambia este texto", or when a feature adds user-facing text.
---

# DualCraft i18n

`$I18N` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs"`. Project facts: `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`.

## The rule
User-facing text lives in `.dualcraft/i18n/<locale>.json`, never hard-coded in widgets or components. Same key → same meaning on web and mobile. Generated files are never edited by hand.

## Source format
```json
{
  "auth": { "login": { "title": "Inicia sesión", "welcome": "Hola, {name}" } },
  "matches": { "count": "{count, plural, =0 {Sin partidos} one {# partido} other {# partidos}}" },
  "web":    { "seo": { "homeTitle": "…" } },
  "mobile": { "permissions": { "camera": "…" } }
}
```
- Nested keys by feature → screen → element; letters/digits/`_` only. Shared by default; `web` / `mobile` top-level sections are platform-only.
- ICU syntax for placeholders `{name}`, plurals and selects (works in both gen-l10n and next-intl). Never concatenate strings in code to build a sentence.
- Default locale: `config.i18n.default` or the project's `lang`.

## Generate
Outputs for every stack: see the table in `dualcraft:tokens` (same layout for i18n, schema and analytics).
- Android / KMP: `ds_strings.xml` next to the app's own `strings.xml` (placeholders → `%1$s`/`%1$d`, whole-message plurals → `<plurals>`): `stringResource(R.string.auth_login_title)` / `pluralStringResource(…)`; KMP `stringResource(Res.string.auth_login_title)`.
- iOS: `DualCraft.xcstrings` (String Catalog, table "DualCraft"; `%@`/`%lld`, plural variations): `String(localized: "auth.login.title", table: "DualCraft")`; with arguments `String(format: String(localized: "auth.login.welcome", table: "DualCraft"), name)`.
- React Native / React + Vite: i18next with `i18next-icu` (keeps ICU plurals). Nuxt: vue-i18n format (plurals converted to `a | b | c`).
- Android/vue-i18n/iOS can't express ICU `select` or nested plurals: the script warns — split those messages into simpler keys.
`$I18N check` (missing keys, placeholder mismatches, unbalanced braces, key collisions) → `$I18N gen`:
- Flutter: `lib/l10n/app_<locale>.arb` (or `arb-dir` from `l10n.yaml`), keys camelCased (`auth.login.title` → `authLoginTitle`), placeholders typed. Use: `AppLocalizations.of(context)!.authLoginTitle`. First time: `flutter_localizations` + `intl` deps, `generate: true`, `l10n.yaml`, `localizationsDelegates`/`supportedLocales` in `MaterialApp` — the script prints the hint.
- Next.js: `messages/<locale>.json` nested for **next-intl** (`useTranslations('auth.login')('title')`). If the project uses another library (i18next), adapt the setup — note that i18next plurals need its ICU plugin.
Generated files carry a hash; if `gen` refuses because one was hand-edited, move those edits into the source first.

## Adopting it in an existing project
Read the existing ARB / message files and build the source from them: group keys by feature, keep the existing translations, mark shared keys (same text on both platforms) and platform-only ones. Then generate, replace the old files, and fix references in code (the analyzer/type-check finds them).

## Hard-coded strings
`$I18N scan` lists candidates (`Text('…')`, `hintText:`, JSX text, `alt`/`placeholder`/`aria-label`). Move real UI text into the source with good keys, replace in code, regenerate. Ignore logs, keys, URLs, test data.

## New language
Copy the default file to `<locale>.json`, translate every value (keep placeholders and plural branches intact, adapt tone, not word by word), `check`, `gen`, add the locale to the app (`supportedLocales`, next-intl routing/config, store listings later in marketing).

## In the flow
A feature with new texts: add keys in the default language first, other languages before the release (`check` lists what's missing — the release checklist will too).
