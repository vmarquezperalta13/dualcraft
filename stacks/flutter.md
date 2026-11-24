# Stack: Flutter (mobile)

The mobile skills (`mobile-architecture`, `mobile-build`, `mobile-test`, `mobile-device`, `mobile-crash`, `security-mobile`, `refactor-mobile`) are written for Flutter first — follow them as they are.

- **Scaffold**: `flutter create --org <reverse.domain> --platforms android,ios <dir>` (add `web` only if the Flutter app must also run on the web).
- **Commands**: see `references/stack-commands.md` → Flutter.
- **DualCraft outputs**: tokens → `lib/generated/design_tokens.dart` · i18n → `lib/l10n/app_<locale>.arb` (gen-l10n) · schema → `lib/generated/db_models.dart` · analytics → `lib/generated/analytics_events.dart`.
- **Backends**: Firebase (FlutterFire: `flutterfire configure` per environment/flavor), Supabase (`supabase_flutter`), REST/Prisma backends through an HTTP client.
