---
name: review
description: Code review - correctness, lifecycle, web/mobile consistency, decisions, tokens, security, accessibility - ranked findings with file:line. Use for "revisa el código", "¿está bien esto?", or before merging.
---

# DualCraft review

What to review: by default the current changes (`git diff` + `git diff --staged`; or the branch vs its base: `git diff <base>...HEAD`). The user may name files, a commit, a branch or a PR.

## Read context first
The spec/plan of the task if any, the schema, and the decisions that apply: `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" relevant "<summary of the change and touched areas>"` (+ `decisions --area <area>` for each touched area). A review that ignores agreed decisions is noise.

## Checklist
**Decisions** — the change follows every decision in force that applies. A contradiction is 🟠 Importante (🔴 if it's a security/data decision): quote the decision id and rule; the fix is either changing the code or superseding the decision with the user (`dualcraft:decisions`), never ignoring it.

**Correctness** — does it do what the task/spec says? Edge cases: empty, null, errors, offline, double taps, concurrent edits, time zones, pagination ends.

**Flutter**
- `setState`/`context` after `await` without `mounted` check; `BuildContext` across async gaps.
- Controllers, streams, listeners, timers, `FocusNode`s disposed/cancelled; Firestore listeners cancelled.
- Heavy work in `build()`; missing `const`; rebuilding big trees; lists without builders.
- State management used the way the project already does (don't mix patterns).
- Platform differences handled (permissions, back button, safe areas, keyboard insets).

**Next.js**
- Server vs client components: `'use client'` only where needed; no secrets or server-only imports in client code; env vars exposure (`NEXT_PUBLIC_`).
- Hydration risks (dates, `window`, randomness during render).
- Data fetching/caching/revalidation correct; route handlers validate input and auth.
- Effects with proper deps and cleanup; no fetch waterfalls; images via `next/image`; metadata/SEO for public pages.

**Design system** — no raw hex colors, font sizes, paddings or radii where a token exists (Flutter: `Color(0x…)`, `Colors.<name>`, `EdgeInsets.all(13)`, `fontSize: 17`; web: `#hex`, arbitrary Tailwind values like `p-[13px]`, `text-[#…]`); generated token files not edited by hand; screens match their Design artboards.

**Cross-platform consistency** — the same business rule behaves the same on web and mobile (validations, limits, rounding, permissions); both use the generated models/types from the schema; strings come from i18n, not hard-coded.

**Data & backend** — stored data matches `.dualcraft/db/schema.dbml` (no fields invented in code); Firestore queries have the needed indexes; rules still protect the change; writes can't be abused (mass writes, client-trusted values like prices or scores).

**Security basics** — input validation, authz on every write path, no secrets in code/logs, safe storage of tokens. (Quick automated pass: `node "${CLAUDE_PLUGIN_ROOT}/scripts/security.mjs" --min medium` on the changed area; deep audits: `dualcraft:security-global`.)

**Accessibility**
- Mobile: `Semantics`/labels on icon buttons and images, tap targets ≥ 48dp, text scales with system font size, contrast ≥ 4.5:1, focus order.
- Web: semantic HTML, `alt` on images, labels on inputs, keyboard navigation and visible focus, `aria-*` only when needed, contrast ≥ 4.5:1.

**Maintainability** — follows existing project patterns and naming; no dead code or leftover debug logs; tests cover the new behaviour (see `dualcraft:tdd`).

## Report
Findings ranked by severity, each with `file:line`, what's wrong, a concrete failure scenario, and the fix:
- 🔴 **Bloqueante** — bug, data loss, security hole, crash.
- 🟠 **Importante** — likely bug, missing test for core behaviour, cross-platform inconsistency, accessibility barrier.
- 🟡 **Mejora** — maintainability, performance, minor UX.

Only report what you verified in the code — no speculative findings. End with a one-line verdict (listo / listo tras corregir 🔴🟠 / necesita otra vuelta). Offer to fix; fix only what the user approves. Out-of-scope improvements → brain tasks.
