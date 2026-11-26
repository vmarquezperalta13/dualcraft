---
name: new-project
description: New project from zero - intake form (idea, platforms, stacks, backend, design, MVP) → brief, decisions, tasks, functional doc and scaffolding. Use for "nuevo proyecto", "empezamos de cero", or in an empty folder.
---

# DualCraft new project

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"` · `$STACKS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/stacks.mjs"`. Talk in the user's language. Stack facts: `${CLAUDE_PLUGIN_ROOT}/stacks/<id>.md`.

The form is the foundation of everything that follows — take the time. Use AskUserQuestion for closed questions (max 4 per round, the user can always answer "Other"), plain chat for open ones. Don't ask what an earlier answer already settled; recommend an option (first, "(Recomendado)") based on what they told you.

## The form
**1 · La idea** (chat, open): name (or "aún sin nombre"), what it is in 2–3 sentences, the problem it solves and for whom, what would make it a success in 6 months.

**2 · Tipo y alcance** (AskUserQuestion):
- Type: app de producto / SaaS · web de contenido o marketing (blog, SEO, AdSense) · e-commerce / reservas · comunidad / social · herramienta interna · juego / entretenimiento.
- Platforms: web · app móvil · ambas (web + app).
- Audience: consumidores (B2C) · empresas (B2B) · uso interno.
- Monetization: gratis · suscripción · compras in-app / pago único · anuncios · venta de productos/servicios · aún no.

**3 · Tecnología** (AskUserQuestion; recommend from the type — `$STACKS list` shows all):
- Web stack: Next.js (apps con SEO y servidor) · Astro (contenido/SEO/AdSense) · React + Vite (SPA/paneles) · Vue / Nuxt.
- Mobile stack: Flutter · React Native (Expo) (si la web es React) · Kotlin Multiplatform · nativo Android + iOS.
- Backend/DB: Firebase · Supabase · PostgreSQL + Prisma · aún no.
- Auth: email · Google · Apple (obligatorio en iOS si hay otros logins sociales) · anónimo / sin cuentas.

**4 · Diseño** (AskUserQuestion + chat):
- Style: minimalista · atrevido / colorido · elegante / premium · divertido / cercano · corporativo / sobrio.
- Themes: claro + oscuro (recomendado) · solo claro · solo oscuro.
- Chat: 3 adjectives for the personality, apps/webs they like as reference, existing logo/brand colors, colors to avoid.

**5 · Funciones principales** (chat, then AskUserQuestion multiSelect): ask for the main features (3–10, one line each — secondary ones will come later as tasks). Propose a short description and platform for each; then ask which go in the **MVP** (first version). Suggest an order based on dependencies (auth → core → extras).

**6 · Contexto** (AskUserQuestion): languages (es, en, …) · deadline or launch date · legal/sensitive (datos personales UE/RGPD, pagos, menores, salud) · analytics (sí desde el inicio / más adelante).

Close with a 10-line summary of the brief and ask to confirm or correct.

## Create everything from the answers
1. **Folder & config** — in the project root: `$BRAIN init --name "<name>" --version 0.1.0 --lang <lang> --commit-lang <en|es>`; then `$BRAIN config set stacks.web=<id> stacks.mobile=<id> backend.provider=<firebase|supabase|postgres-prisma> i18n.default=<lang>`. Two native apps: `stacks.mobile=android,ios`. Paths per stack: `paths.web=web paths.mobile=mobile` (or `paths.android=android paths.ios=ios`).
2. **Brief** — `.dualcraft/brief.md`: every answer, organised (idea, type, audience, monetization, platforms, stacks, backend, auth, design direction, MVP features with descriptions, later features, languages, constraints, success criteria). Later skills read it instead of asking again.
3. **Decisions** (`dualcraft:decisions`, with area): web stack, mobile stack, backend, auth methods, design direction, monetization model, languages.
4. **Brain tasks** — setup first, then features:
   - `Crear el design system` (area design) · `Definir el esquema de datos` · `Configurar base de datos y entornos` (depends on the schema) · `Configurar textos e idiomas` · `Plan de analítica` (if chosen).
   - One task per MVP feature: target `0.1.0`, tags with platforms, depending on the setup tasks it needs (auth before everything that needs a user). Non-MVP features: target `0.2.0` or ideas.
   Show the roadmap (`dualcraft:roadmap`).
5. **Functional document** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/docs.mjs" init`, then fill Overview, Users and roles, Platforms and one section per MVP feature (goal + main flow as far as known; the rest `_Pendiente_`).
6. **Scaffold** — for each chosen stack, show the CLI command from `$STACKS scaffold <id> --dir <path>` and run it **after the user confirms** (network, new files). Stacks without a CLI (KMP wizard, Android Studio, Xcode on macOS) → give the exact steps and wait. Then `git init` if needed, first commit with the user's OK (`chore: scaffold <stacks> with DualCraft`).
7. **Hand-off** — next steps in order: `dualcraft:design-system` (reuses section 4, no repeated questions) → `dualcraft:schema` → `dualcraft:database` → first MVP feature with `dualcraft:start`.
