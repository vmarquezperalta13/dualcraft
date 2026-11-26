---
name: refactor-global
description: Cross-platform refactoring - business rules duplicated or drifting between web and mobile moved to one place or shared test cases. Use for "unifica web y app", "esto está duplicado", "no hacen lo mismo".
---

# DualCraft refactor — global

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Both architecture maps: `.dualcraft/architecture/web.md` and `mobile.md`.

## 1. Find the drift
Compare the two platforms feature by feature (use the functional document's feature list as the index):
- **Business rules** implemented twice: validations (lengths, formats, ages), calculations (prices, points, scores, dates/time zones, rounding), permissions ("who can edit"), state machines (order status…). Read both implementations side by side; list every difference.
- **Data**: fields read/written differently, names that differ from the schema, one platform writing fields the other doesn't know.
- **Shared sources not adopted**: hand-written models/types (vs `dualcraft:schema`), raw colors (vs `dualcraft:tokens`), hard-coded texts (`node "${CLAUDE_PLUGIN_ROOT}/scripts/i18n.mjs" scan`), events sent outside the plan (`node "${CLAUDE_PLUGIN_ROOT}/scripts/analytics.mjs" coverage`).
Present the findings as a table: rule · web · mobile · difference · risk.

## 2. Decide where each rule lives (with the user)
| Option | When |
|---|---|
| **Backend** (Cloud Function, API route, Firestore rules) | the rule protects data or money, or must be trusted (prices, scores, permissions, limits) — clients can be bypassed |
| **Mirrored** in both clients + shared test cases | UX-level rules needed offline/instantly (form validation) — the backend still enforces the critical part |
| **Generated** from a shared source | data shapes (schema), look (tokens), texts (i18n), events (analytics) |
Record each choice as a brain decision.

## 3. Refactor in safe steps
- Characterization tests on both platforms first (same cases table for mirrored rules).
- Backend first when moving a rule server-side (deploy behind compatibility: old clients keep working), then switch each client, then remove client duplicates.
- One rule/feature at a time; both platforms green after each step; commit per step (`refactor(shared): …`).
- Behaviour differences that were bugs: fix them as separate `fix` commits after agreeing which behaviour is right.

## 4. Close
`dualcraft:verify` on both platforms (+ Firebase checks) → `dualcraft:review` → functional document if a rule's documented behaviour changed (`dualcraft:docs`). Leftovers → brain tasks linked with `depends_on`.
