---
name: decisions
description: Project decisions (ADR) - record, list by area, check conflicts, supersede with history. Use for "hemos decidido", "a partir de ahora", "¿qué decidimos sobre…?", "cambiamos de idea", or when a request contradicts a decision.
---

# DualCraft decisions

`$BRAIN` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs"`. Talk in the user's language.

## How decisions reach every conversation
- **Session start**: the context lists every decision **in force**, grouped by area (superseded ones are hidden).
- **Every message**: a hook searches the brain for decisions and notes related to what the user asked and adds them to the context ("decisions and notes related to this request"). When that block appears, read it before acting.
- **Rule**: a decision in force is followed. If the request contradicts one, stop and say so — quote the decision (id + one line) and ask: keep the decision (adapt the request), or change it (supersede). Never silently break a decision, never silently change one.

## Record a decision
When a real choice is made (architecture, library, data model, design rule, security rule, product rule, process) — by the user or agreed in a brainstorm/plan/review:
```
$BRAIN new decision "<short rule, stated positively>" --area <architecture|data|design|security|product|process|web|mobile|backend|infra|marketing|legal> [--tags a,b] [--related T-012]
```
Then fill the body (ADR):
- **Context** — the situation and forces (1–3 sentences).
- **Decision** — the rule, concrete and checkable ("Toda la gestión de estado con Provider; no Riverpod ni Bloc"). This section is what gets shown with each related request — make it self-contained.
- **Alternatives considered** — what was rejected and why.
- **Consequences** — what it implies (migrations, limits, costs).
Tags with the words people will use when it matters (e.g. `pagos, precios, checkout`) — they drive the automatic matching. One decision = one rule. Confirm the text with the user in one line before saving if they didn't dictate it.

## Find decisions
- In force, by area: `$BRAIN decisions [--area security]` · history included: `--all`.
- About a topic: `$BRAIN relevant "<topic or proposed change>"` → ranked decisions and notes; read the full ones with `$BRAIN show <ID>`.
- Answer "¿qué decidimos sobre X?" with the ids, the rule and the date; mention if it was superseded and by what.

## Check a change against the decisions
Before a non-trivial change (and in `dualcraft:review` / `dualcraft:verify`): `$BRAIN relevant "<what the change does>"`, read the matches, and state either "cumple D-003, D-007" or the conflict. A conflict is resolved with the user, never by ignoring it.

## Change a decision (supersede)
Decisions aren't edited to mean something else — they're replaced, so the history explains *why* things changed:
1. Create the new decision (same area), with Context saying what changed since the old one.
2. `$BRAIN supersede <OLD> <NEW> --why "<reason>"` → the old one becomes `superseded` (hidden from context, kept in the map with a link to the new one).
3. List the consequences: code that followed the old rule → brain tasks to migrate (`--related <NEW>`).
Small wording fixes that don't change the meaning: edit the note directly. Dropping a decision without replacement: `$BRAIN set <ID> status=dropped --log "<why>"`.

## Hygiene
`$BRAIN check` validates decisions (area, superseded chains). Periodically (e.g. before a release) review `$BRAIN decisions`: duplicates → merge by superseding; vague ones → rewrite the Decision section to be checkable.
