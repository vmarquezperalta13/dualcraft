# Changelog

## [0.2.0] - 2026-11-24
### Added
- `/dualcraft:map`: visual brain map (nodes, dependency arrows, filters, search, detail panel) with a Roadmap view
- `/dualcraft:roadmap`: tasks grouped by version with progress, blocked and parked items
- `/dualcraft:er`: ER diagram from `.dualcraft/db/schema.dbml` with crow's-foot notation, drag, PNG/SVG export, saved layout
- `/dualcraft:schema`: DBML schema as single source of truth; generates Dart models, TypeScript types and a Firestore rules skeleton
- DBML parser (zero dependencies) and example schema `examples/hockey.dbml`

## [0.1.0] - 2026-11-24
### Added
- Brain CLI (notes, roadmap, graph, check, work mode, session summary)
- Skills: using-dualcraft, help, start, brain, park, commit
- SessionStart hook that loads the project context
