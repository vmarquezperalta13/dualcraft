---
description: "A natural request for security-web loads the dualcraft:security-web skill"
tags: ["trigger", "security"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

¿Es segura esta API de la web? Revisa los endpoints y las cabeceras.
