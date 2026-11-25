---
description: "A natural request for backend loads the dualcraft:backend skill"
tags: ["trigger", "backend"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

Necesito una Cloud Function que envíe un email de bienvenida cuando alguien se registre.
