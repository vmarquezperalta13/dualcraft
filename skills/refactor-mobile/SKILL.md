---
name: refactor-mobile
description: Safe mobile refactoring without behaviour change - widget/screen decomposition, state, repositories, lifecycle, duplication, shared sources - small green steps. Use for "refactoriza la app", "este widget es enorme".
---

# DualCraft refactor — mobile

> **Stack:** examples here are Flutter. If the project's mobile stack (`config.stacks.mobile`) is React Native (Expo), Kotlin Multiplatform, Android native or iOS native, first read `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` and use its commands, structure and conventions — the checklist below still applies where it makes sense. iOS builds and simulators need macOS.

Architecture map: `.dualcraft/architecture/mobile.md` (`dualcraft:mobile-architecture` if missing). Commands: `${CLAUDE_PLUGIN_ROOT}/references/stack-commands.md`. If the project has its own widget-decomposition skill or rules, follow them.

## Safety first
1. Define the target and what "better" means; agree it with the user.
2. Behaviour lock: tests over what you'll touch must pass first. Missing → characterization tests (widget tests of the screen's visible behaviour, unit tests of the state class, goldens for visuals).
3. Small steps; after each: `flutter analyze` + tests green. Commit at green points (`refactor(mobile): …`). No behaviour changes mixed in — bugs found go to the brain and get their own fix.

## Typical targets
| Smell | Refactor |
|---|---|
| `build()` > ~80 lines, deep nesting | extract private widget **classes** (not helper methods) with `const` constructors; reusable ones to the shared widgets folder |
| Widget talks to Firestore directly | repository in the data layer; widget → state → repository |
| Business logic inside widgets | move to the state class / domain; unit-test it there |
| Listeners/controllers/timers not disposed | owned by the state class or `State` and released in `dispose` |
| `context` used after `await` | `if (!context.mounted) return;` or move navigation into the state layer |
| Mixed state-management styles | converge on the project's main one (one feature at a time, brain task for the rest) |
| Hand-written models for stored data | generated models from `dualcraft:schema` |
| `Color(0x…)`, magic paddings/font sizes | `context.ds.*`, `DsSpacing`, `DsText` (`dualcraft:tokens`) |
| Hard-coded texts | `dualcraft:i18n` |
| Unused files/code/packages | remove after checking references (`flutter analyze`, search) |

## Close
`dualcraft:verify` → `dualcraft:review` → commit. Update `.dualcraft/architecture/mobile.md` if the structure changed; record significant choices as brain decisions.
