---
name: stacks
description: Shows the stacks DualCraft supports (web - Next.js, React + Vite, Astro, Vue/Nuxt; mobile - Flutter, React Native/Expo, Kotlin Multiplatform, Android native, iOS native; backends - Firebase, Supabase, PostgreSQL + Prisma), which ones the current project uses, and adds a new stack to a project (create it with its CLI and register it). Use when the user runs /dualcraft:stacks, asks "¿qué lenguajes/tecnologías soporta?", "añade una app móvil al proyecto", "quiero la web en Astro", or before working in a stack to load its reference.
---

# DualCraft stacks

`$STACKS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/stacks.mjs"`. Each stack has a reference sheet `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md` (scaffold, architecture, commands, tests, security, what DualCraft generates).

## Show
- Supported: `$STACKS list` → present as a short table.
- This project: `$STACKS project` (from `.dualcraft/config.json`), and `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs"` for what the code really contains — if they disagree, fix the config with the user.

## Work in a stack
Before any work in a stack other than Next.js or Flutter, read its reference sheet. The general skills (`web-*`, `mobile-*`, `security-*`, `refactor-*`, `tdd`, `verify`…) apply to every stack; the sheet gives the commands, architecture and specifics that replace their Next.js/Flutter examples. iOS native: no build/test outside macOS — say so in every verification.

## Add a stack to the project
0. If DualCraft was installed with packs and this stack (or its web/mobile platform skills) isn't installed yet, add it first: `npx github:vmarquezperalta13/dualcraft add <stack-id>` (then a new chat).
1. Agree the stack (recommend from the project brief/type: content → Astro, app with SEO → Next.js, SPA → React + Vite; React web → React Native shares the most; Kotlin team → KMP).
2. `$STACKS scaffold <id> --dir <folder> [--org com.company]` → show the command or manual steps; run only after the user confirms.
3. Register: `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" config set stacks.<web|mobile>=<id> paths.<web|mobile>=<folder>` (two native apps: `stacks.mobile=android,ios paths.android=… paths.ios=…`); record a decision (area architecture).
4. Wire the shared sources into the new stack: tokens, i18n, schema types/models, analytics (`dualcraft:tokens`, `dualcraft:i18n`, `dualcraft:schema`, `dualcraft:analytics`) and the backend client (`dualcraft:database`).
5. Map its architecture (`dualcraft:web-architecture` / `dualcraft:mobile-architecture`, following the sheet).
6. If the features exist in another stack already, bring them over with `dualcraft:convert`.
