---
description: "A natural request for decisions loads the dualcraft:decisions skill"
tags: ["trigger", "brain"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

Hemos decidido que a partir de ahora todo el estado de la app va con Riverpod, regístralo.
