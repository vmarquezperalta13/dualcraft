---
description: "A natural request for mobile-architecture loads the dualcraft:mobile-architecture skill"
tags: ["trigger", "mobile"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

¿Dónde va en la app una pantalla nueva de ajustes? ¿Cómo está organizada?
