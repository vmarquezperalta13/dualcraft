---
description: "A natural request for perf loads the dualcraft:perf skill"
tags: ["trigger", "perf"]
runs: 1
max_turns: 8
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill]
disallowed_tools: [Agent]
append_system_prompt: "Eval run: there is no real project or repository behind this request and nothing must be changed. Decide how you would handle it with the tools and skills you have, then reply in one or two sentences with your next step instead of doing the work."
---

Quiero que el CI avise si la web empeora en Lighthouse o si la app pesa demasiado.
