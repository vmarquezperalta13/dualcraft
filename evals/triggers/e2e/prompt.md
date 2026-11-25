---
description: "A natural request for e2e loads the dualcraft:e2e skill"
tags: ["trigger", "e2e"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

Quiero tests end to end del login que funcionen en la web y en la app.
