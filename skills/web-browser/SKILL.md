---
name: web-browser
description: Runs the Next.js app and checks it in a real browser - starts the dev server, opens pages, takes screenshots at desktop and mobile widths, reads console and network errors, clicks through flows, and compares with the Design artboards. Use when the user runs /dualcraft:web-browser, "ábrela en el navegador", "mira cómo se ve la web", "prueba este flujo en la web", "haz captura", or when verifying a web UI change.
---

# DualCraft web browser

## 1. Run the app
From the web folder: `pm run dev` **in the background**; read its output for the URL/port and wait until it's ready (poll the URL; don't sleep blindly). If a server is already running on the port, reuse it. Production-like check: `pm run build && pm run start`.

## 2. Choose the browser tool
- **Interactive** (click, type, follow a flow, read console): if browser tools are available in this session (Claude in Chrome — `mcp__claude-in-chrome__*` — or the built-in browser — `mcp__Claude_Browser__*`), load their skill first and use them, in a new tab.
- **Screenshots only**: headless Chrome/Edge:
  `"<chrome or msedge>" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --virtual-time-budget=5000 --screenshot=<abs path>.png <url>`
  Mobile width: `--window-size=390,844`. Use a throwaway `--user-data-dir` in the scratchpad. Then read the PNG.

## 3. Check
- Layout at 1440 and 390 (and 768 if the design has a tablet layout); dark mode (`data-theme="dark"` or OS emulation).
- Console errors and failed requests (interactive tool) — hydration warnings count as bugs.
- The flow the task is about, end to end, with realistic data; empty/error states.
- Keyboard: Tab through the page — visible focus, logical order, everything reachable.
- Compare with the `· Web` / `· Móvil` artboards if the screen was designed (`dualcraft:design-to-code`).

## 4. Report
What was checked, screenshots taken (paths), problems found with how to reproduce. Stop background servers you started when you're done (unless the user wants them running).
