---
name: analytics
description: Tracking plan (.dualcraft/analytics/events.json) validated and generated as typed helpers for every stack, with ANALYTICS.md and per-platform coverage. Use for "analítica", "eventos", "quiero medir…", "¿estamos midiendo X?".
---

# DualCraft analytics

`$AN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/analytics.mjs"`. Project facts (which SDKs): `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"`.

## The rule
Every event is declared in `.dualcraft/analytics/events.json` before it's sent. Code sends events only through the generated helpers, so names and params can't drift between web and mobile.

## Designing events
Start from the question the product/marketing wants answered ("¿cuántos usuarios completan el registro?"), then the event:
```json
{"events": [
  {"name": "sign_up", "description": "El usuario crea una cuenta", "platforms": ["web", "mobile"],
   "params": {"method": {"type": "string", "values": ["google", "email"], "required": true}},
   "since": "1.3.0", "origin": "T-004"}
 ],
 "userProperties": [{"name": "plan", "type": "string", "values": ["free", "pro"], "description": "Plan contratado"}]}
```
- Names: `snake_case`, object_action (`match_viewed`, `ticket_purchased`), ≤ 40 chars; prefer GA4 recommended events when they fit (`sign_up`, `login`, `purchase`, `share`, `search`, `select_content`, `tutorial_complete`) — reports work better.
- Params: few and meaningful (≤ 25), typed (`string|int|double|bool`), enumerated values when closed. Never personal data (emails, names, phone, exact location) — that's both a privacy and a policy problem.
- `origin` = the brain task that introduced it; `since` = version.
- Screen views are usually automatic (Firebase `screen_view`, GA page views) — don't redeclare them.

## Generate & wire
`$AN check` → `$AN gen`:
- Flutter `lib/generated/analytics_events.dart`: `AnalyticsEvents.signUp(method: SignUpMethod.google)` → an `AnalyticsEvent(name, parameters)`. One adapter in the app sends it (`FirebaseAnalytics.instance.logEvent(name: e.name, parameters: e.parameters)`) — create it once in the services layer if missing.
- Next.js `…/lib/analytics-events.ts`: `analyticsEvents.signUp({ method: 'google' })` → `{ name, params }`; one client-side adapter sends it (gtag / Firebase JS / PostHog — whatever `detect` shows).
- `docs/ANALYTICS.md`: the tracking plan as a table, for product and marketing.

Outputs for every stack: see the table in `dualcraft:tokens` (same layout for i18n, schema and analytics). Kotlin: `AnalyticsEvents.signUp(SignUpMethod.GOOGLE)` → `AnalyticsEvent(name, params)`; Swift: `AnalyticsEvents.signUp(method: .google)`. Each app has one small adapter that sends `AnalyticsEvent` to its SDK.

## Coverage
`$AN coverage` → which declared events are used in each platform's code (✓/✗). A ✗ for a platform the event is declared on = a gap to fix or a platform to remove from the event.

## Consent & privacy
Respect consent where required (EU: no analytics cookies on the web before consent; Firebase `setAnalyticsCollectionEnabled` tied to the user's choice). If the project has no consent handling and targets the EU, raise it as a brain task (security/legal).

## In the flow
In a brainstorm, ask "how will we know this works?" → events with `origin` = the task. Before a release, `coverage` must be clean for the events of that version.
