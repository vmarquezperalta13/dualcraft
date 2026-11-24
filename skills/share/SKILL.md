---
name: share
description: Publishes the roadmap or brain map as a private page for the team or, without internal details, for a client. Use for "comparte el roadmap", "enséñale el plan al cliente", "publica el mapa".
---

# DualCraft share

`$MAP` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs"`.

1. Ask who it's for (if not said):
   - **The team** → full version: `$MAP --share --view road` (or `--view map` for the dependency network). Includes note texts, decisions, assignees, issues.
   - **Someone outside** (client, partner, investor) → `$MAP --share --view road --no-details`: only tasks, bugs and ideas with title, state, version, estimate and dependencies; no note bodies, decisions, internal notes, branches, flags or repo links.
2. The script writes `.dualcraft/out/share/<roadmap|map>[-public].html` — a page without its own `<html>/<head>/<body>`, ready to publish.
3. Publish it with the Artifact tool (`file_path` = that file, `icon` "chart" on the first publish, a one-line description). The page is **private**: tell the user that only people they share it with (Share menu on the page) can open it. To refresh it later, regenerate and publish the same file path again (same URL); from another conversation, publish to the saved URL.
4. Save the URL so the next update keeps the link: `node "${CLAUDE_PLUGIN_ROOT}/scripts/brain.mjs" config set share.roadmap=<url>` (or `share.roadmapPublic`, `share.map`).
5. Before publishing the external version, glance at the titles: a task title can itself reveal something private (client names, security holes). Rename or leave those out with the user.

Outside Claude Code (no Artifact tool): give the user the HTML file path; it opens in any browser and works offline.
