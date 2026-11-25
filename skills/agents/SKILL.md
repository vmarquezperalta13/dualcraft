---
name: agents
description: Lists DualCraft's specialist agents (security, reviewer, qa, architect, debugger, designer, marketing, release), which are installed and what each does, and hands a task to one. Use for /dualcraft:agents, "¿qué agentes hay?", "lista los agentes", or "/dualcraft:agents <agente> <tarea>".
---

# DualCraft agents

`$AGENTS` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/agents.mjs"`. Talk in the user's language.

## No arguments → list
Run `$AGENTS` and show its output as it is: each agent, installed (✓) or not (·), what it does, and how to add the missing ones. Add one line on when each kind of agent helps, only if the user seems unsure which to use.

## `<agent> <task>` → delegate
1. The first word is the agent (`security`, `reviewer`, `qa`, `architect`, `debugger`, `designer`, `marketing`, `release`; accept Spanish names: seguridad → security, revisor → reviewer, arquitecto → architect, depurador → debugger, diseño → designer, lanzamiento/versión → release). Unknown or not installed → show the list (`$AGENTS`) and say how to add it; stop.
2. Write the agent a self-contained brief: the task, the scope (files, branch, platform, version), what the user already decided, and the output wanted. The agent starts without this conversation's context.
3. Launch it: Claude Code → the Agent tool with `subagent_type: "dualcraft:<agent>"`; Gemini CLI or Codex → your sub-agent named `dualcraft-<agent>`. If sub-agents are not available, say so and do the task here following that agent's skills.
4. Relay its report to the user: verdict first, then findings or results, then the questions it returned. `security` and `reviewer` only report — offer to apply their fixes here, after the user agrees.

## Agent without a task
Ask what it should do, with two or three examples that fit the project (e.g. security: "audita la app antes del lanzamiento", "revisa los endpoints de pagos").
