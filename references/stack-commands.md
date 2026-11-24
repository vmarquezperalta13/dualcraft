# Stack commands (Next.js · Flutter)

Other stacks (React + Vite, Astro, Nuxt, React Native, Kotlin Multiplatform, Android, iOS): commands in `stacks/<id>.md` (same folder level as `references/`).

Always prefer what the project itself defines (package.json scripts, Makefile, melos, CI workflow files under `.github/workflows/`) over these defaults — CI is the best evidence of how the project is really checked. Run commands from the stack's folder (`config.paths.web` / `config.paths.mobile`).

## Next.js (web)
Detect the package manager from the lockfile: `pnpm-lock.yaml` → pnpm · `yarn.lock` → yarn · `bun.lockb`/`bun.lock` → bun · else npm. Below, `pm run x` = `npm run x` / `pnpm x` / `yarn x` / `bun run x`.

| Check | Command (if the script exists) | Fallback |
|---|---|---|
| Types | `pm run typecheck` | `npx tsc --noEmit` |
| Lint | `pm run lint` | `npx next lint` (≤ Next 15) or `npx eslint .` |
| Unit / component tests | `pm test` / `pm run test` | Vitest: `npx vitest run` · Jest: `npx jest` |
| Single test file | Vitest: `npx vitest run path/to/file.test.tsx` · Jest: `npx jest path/to/file` |
| E2E | `pm run test:e2e` | Playwright: `npx playwright test` · Cypress: `npx cypress run` |
| Build | `pm run build` (catches server/client boundary and type errors that dev mode hides) |
| Dev server | `pm run dev` (run in background; check the port it prints) |

Test framework detection: `vitest` / `jest` / `@playwright/test` / `cypress` in `devDependencies`; config files `vitest.config.*`, `jest.config.*`, `playwright.config.*`. Testing Library (`@testing-library/react`) for components.

## Flutter (mobile)
| Check | Command |
|---|---|
| Dependencies | `flutter pub get` |
| Analyzer | `flutter analyze` (or `dart analyze`) |
| Format check | `dart format --output=none --set-exit-if-changed lib test` |
| Unit + widget tests | `flutter test` · one file: `flutter test test/path_test.dart` · one test: `--plain-name "name"` |
| Integration tests | `flutter test integration_test` (needs a device/emulator: `flutter devices`) |
| Code generation | if `build_runner` is a dev dependency: `dart run build_runner build --delete-conflicting-outputs` |
| Build (Android) | `flutter build apk --debug` (fast check) · release: `flutter build appbundle` |
| Build (iOS) | `flutter build ios --no-codesign` (macOS only) |
| Logs | `flutter logs` · Android: `adb logcat` (filter: `adb logcat -s flutter`) |

Flavors: if the project uses them (`--flavor`, `lib/main_<flavor>.dart`), pass the same flavor CI uses.

## Firebase (shared backend)
| Check | Command |
|---|---|
| Functions build/lint | in `functions/`: `npm run build`, `npm run lint` |
| Rules / functions locally | `firebase emulators:start` (or `emulators:exec "<test cmd>"`) |
| Rules tests | `@firebase/rules-unit-testing` with the emulator |

## Which checks apply
- Changed only web files → web checks. Only mobile → mobile checks.
- Changed the schema, shared logic, Firebase rules/functions, or anything in `shared` scope → **both** platforms + Firebase checks.
- Never claim a check passed if it wasn't run; if a check can't run here (no emulator, no macOS), say so explicitly.
