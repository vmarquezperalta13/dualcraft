// Auth screens per UI stack (DualCraft auth), written once by auth.mjs gen and owned by the developer afterwards.
// Router-agnostic: AuthFlow (sign in, sign up, forgot password, phone, second factor, verify email) and
// AccountScreen (methods and linking, MFA, passkey, sign out, delete account) take the AuthService and callbacks;
// a small guard helper turns decideAccess() into a redirect for the app's router.
// Colors and type come from the platform theme (Material / CSS variables / SwiftUI), which the DS tokens feed.
import { ERROR_CODES, snake } from './auth-gen.mjs'

const camel = (k) => k.split(/[._]/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
const pascal = (s) => s[0].toUpperCase() + s.slice(1)
const on = (cond, s) => (cond ? s : '')

/** What the screens offer for a config. */
export function features(c) {
  const has = (m) => c.methods.includes(m)
  const f = c.mfa?.factors || []
  return {
    email: has('email'), google: has('google'), apple: has('apple'), phone: has('phone'), passkey: has('passkey'),
    guest: !!c.guest, linking: !!c.linking, totp: f.includes('totp'), sms: f.includes('sms'), mfa: f.length > 0,
    verifyRequired: (c.email?.verification || 'optional') === 'required',
    linkable: c.linking ? ['email', 'google', 'apple'].filter(has) : [],
  }
}

// ================================================================ Flutter (Material 3)
export function flutterScreens(c, { catalog, l10n }) {
  const F = features(c)
  const t = (k) => 'l.' + camel('auth.ui.' + k)
  const social = [
    F.google && `          OutlinedButton.icon(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.signInWithGoogle())), icon: const Icon(Icons.g_mobiledata), label: Text(${t('continue_google')})),`,
    F.apple && `          OutlinedButton.icon(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.signInWithApple())), icon: const Icon(Icons.apple), label: Text(${t('continue_apple')})),`,
    F.passkey && `          OutlinedButton.icon(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.signInWithPasskey())), icon: const Icon(Icons.key), label: Text(${t('continue_passkey')})),`,
    F.phone && `          OutlinedButton.icon(onPressed: _busy ? null : () => _go(AuthStep.phone), icon: const Icon(Icons.phone), label: Text(${t('continue_phone')})),`,
  ].filter(Boolean)
  const methodLabel = ['email', 'google', 'apple', 'phone', 'passkey'].filter((m) => c.methods.includes(m))
  return `// Auth screens (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// AuthFlow: sign in / sign up / forgot password / phone / second factor / verify email. AccountScreen: methods,
// MFA, passkey, sign out, delete account. authRedirect(): GoRouter redirect from the generated decideAccess().
import 'package:flutter/material.dart';
import '${catalog}';
import '${l10n}';

/// GoRouter: \`redirect: (context, state) => authRedirect(state.uri.toString(), auth.currentUser)\` with
/// \`refreshListenable\` fed by auth.authStateChanges(). null = stay.
String? authRedirect(String location, AuthUser? user) {
  final path = Uri.parse(location).path;
  switch (decideAccess(path, user)) {
    case AccessDecision.allow:
      if (user != null && !user.isAnonymous && path == AuthRoutes.signIn) return Uri.parse(location).queryParameters['next'] ?? AuthRoutes.afterSignIn;
      return null;
    case AccessDecision.signIn:
      return path == AuthRoutes.signIn ? null : '\${AuthRoutes.signIn}?next=\${Uri.encodeComponent(location)}';
    case AccessDecision.verifyEmail:
      return path == AuthRoutes.verifyEmail ? null : AuthRoutes.verifyEmail;
    case AccessDecision.forbidden:
      return path == AuthRoutes.afterSignIn ? null : AuthRoutes.afterSignIn;
  }
}

/// Localized text of an auth error.
String authErrorText(AppLocalizations l, Object error) {
  final code = error is AuthError ? error.code : AuthErrorCode.unknown;
  return switch (code) {
${ERROR_CODES.map((e) => `    AuthErrorCode.${e} => l.${camel('auth.errors.' + snake(e))},`).join('\n')}
  };
}

String passwordProblemText(AppLocalizations l, PasswordProblem p) => switch (p) {
      PasswordProblem.tooShort => l.authPasswordTooShort('\${PasswordPolicy.minLength}'),
      PasswordProblem.noUpper => l.authPasswordNoUpper,
      PasswordProblem.noDigit => l.authPasswordNoDigit,
      PasswordProblem.noSymbol => l.authPasswordNoSymbol,
    };

String authMethodText(AppLocalizations l, AuthMethod m) => switch (m) {
${methodLabel.map((m) => `      AuthMethod.${m} => ${t('method_' + m)},`).join('\n')}
${on(F.guest, `      AuthMethod.guest => ${t('continue_guest')},\n`)}    };

enum AuthStep { signIn, signUp, forgot, phone, mfa, verifyEmail }

/// The whole sign-in flow in one widget; [onSignedIn] runs when the user is in (and verified, if required).
class AuthFlow extends StatefulWidget {
  const AuthFlow({super.key, required this.service, required this.onSignedIn, this.initialStep = AuthStep.signIn});
  final AuthService service;
  final ValueChanged<AuthUser> onSignedIn;
  final AuthStep initialStep;

  @override
  State<AuthFlow> createState() => _AuthFlowState();
}

class _AuthFlowState extends State<AuthFlow> {
  late AuthStep _step = widget.initialStep;
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _verificationId;
  bool _busy = false;
  String? _error;
  String? _info;

  @override
  void dispose() {
    for (final c in [_email, _password, _name, _phone, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  void _go(AuthStep s) => setState(() {
        _step = s;
        _error = null;
        _info = null;
        _code.clear();
      });

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await action();
    } on AuthError catch (e) {
      if (e.code == AuthErrorCode.mfaRequired) {
        _go(AuthStep.mfa);
      } else if (e.code == AuthErrorCode.emailNotVerified) {
        _go(AuthStep.verifyEmail);
      } else if (e.code != AuthErrorCode.cancelled && mounted) {
        setState(() => _error = authErrorText(AppLocalizations.of(context)!, e));
      }
    } catch (e) {
      if (mounted) setState(() => _error = authErrorText(AppLocalizations.of(context)!, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _done(AuthUser user) {
    if (${F.verifyRequired ? 'true' : 'false'} && user.email != null && !user.emailVerified && !user.isAnonymous) {
      _go(AuthStep.verifyEmail);
    } else {
      widget.onSignedIn(user);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final children = switch (_step) {
      AuthStep.signIn => _signIn(l),
      AuthStep.signUp => _signUp(l),
      AuthStep.forgot => _forgot(l),
      AuthStep.phone => _phoneStep(l),
      AuthStep.mfa => _mfa(l),
      AuthStep.verifyEmail => _verify(l),
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ...children,
                    if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: Center(child: CircularProgressIndicator())),
                    if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error), textAlign: TextAlign.center)),
                    if (_info != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_info!, textAlign: TextAlign.center)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _title(String text) => Padding(padding: const EdgeInsets.only(bottom: 24), child: Text(text, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center));
  Widget _gap() => const SizedBox(height: 12);
  Widget _field(TextEditingController c, String label, {bool obscure = false, TextInputType? type, Iterable<String>? autofill}) =>
      TextField(controller: c, obscureText: obscure, keyboardType: type, autofillHints: autofill, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()));

  List<Widget> _signIn(AppLocalizations l) => [
        _title(${t('sign_in_title')}),
${on(F.email, `        _field(_email, ${t('email')}, type: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
        _gap(),
        _field(_password, ${t('password')}, obscure: true, autofill: const [AutofillHints.password]),
        Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _go(AuthStep.forgot), child: Text(${t('forgot')}))),
        FilledButton(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.signInWithEmail(_email.text.trim(), _password.text))), child: Text(${t('sign_in')})),
        TextButton(onPressed: () => _go(AuthStep.signUp), child: Text(${t('no_account')})),
`)}${on(social.length, `${on(F.email, `        Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Row(children: [const Expanded(child: Divider()), Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Text(${t('or')})), const Expanded(child: Divider())])),\n`)}        ...[
${social.join('\n')}
        ].expand((w) => [w, _gap()]),
`)}${on(F.guest, `        TextButton(onPressed: _busy ? null : () => _run(() async => widget.onSignedIn(await widget.service.signInAsGuest())), child: Text(${t('continue_guest')})),
`)}      ];

  List<Widget> _signUp(AppLocalizations l) {
${F.email ? `    final problems = _password.text.isEmpty ? const <PasswordProblem>[] : passwordProblems(_password.text);
    return [
      _title(${t('sign_up_title')}),
      _field(_name, ${t('display_name')}, autofill: const [AutofillHints.name]),
      _gap(),
      _field(_email, ${t('email')}, type: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
      _gap(),
      TextField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.newPassword], onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: ${t('password')}, border: const OutlineInputBorder())),
      for (final p in problems) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• \${passwordProblemText(l, p)}', style: Theme.of(context).textTheme.bodySmall)),
      _gap(),
      FilledButton(
        onPressed: _busy || problems.isNotEmpty ? null : () => _run(() async => _done(await widget.service.signUpWithEmail(_email.text.trim(), _password.text, displayName: _name.text.trim().isEmpty ? null : _name.text.trim()))),
        child: Text(${t('sign_up')}),
      ),
      TextButton(onPressed: () => _go(AuthStep.signIn), child: Text(${t('have_account')})),
    ];` : `    return [TextButton(onPressed: () => _go(AuthStep.signIn), child: Text(${t('back')}))];`}
  }

  List<Widget> _forgot(AppLocalizations l) => [
        _title(${t('forgot_title')}),
${F.email ? `        _field(_email, ${t('email')}, type: TextInputType.emailAddress, autofill: const [AutofillHints.email]),
        _gap(),
        FilledButton(
          onPressed: _busy ? null : () => _run(() async {
            await widget.service.sendPasswordReset(_email.text.trim());
            if (mounted) setState(() => _info = l.authUiResetSent(_email.text.trim()));
          }),
          child: Text(${t('send_reset')}),
        ),
` : ''}        TextButton(onPressed: () => _go(AuthStep.signIn), child: Text(${t('back')})),
      ];

  List<Widget> _phoneStep(AppLocalizations l) => [
        _title(${t('continue_phone')}),
${F.phone ? `        if (_verificationId == null) ...[
          _field(_phone, ${t('phone')}, type: TextInputType.phone, autofill: const [AutofillHints.telephoneNumber]),
          _gap(),
          FilledButton(onPressed: _busy ? null : () => _run(() async { final id = await widget.service.startPhoneSignIn(_phone.text.trim()); setState(() => _verificationId = id); }), child: Text(${t('send_code')})),
        ] else ...[
          _field(_code, ${t('code')}, type: TextInputType.number, autofill: const [AutofillHints.oneTimeCode]),
          _gap(),
          FilledButton(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.confirmPhoneCode(_verificationId!, _code.text.trim()))), child: Text(${t('verify')})),
        ],
` : ''}        TextButton(onPressed: () => setState(() { _verificationId = null; _go(AuthStep.signIn); }), child: Text(${t('back')})),
      ];

  List<Widget> _mfa(AppLocalizations l) => [
        _title(${t('mfa_title')}),
        Text(${t('mfa_hint')}, textAlign: TextAlign.center),
        _gap(),
${F.mfa ? `        _field(_code, ${t('code')}, type: TextInputType.number, autofill: const [AutofillHints.oneTimeCode]),
        _gap(),
        FilledButton(onPressed: _busy ? null : () => _run(() async => _done(await widget.service.completeMfaSignIn(_code.text.trim()))), child: Text(${t('verify')})),
` : ''}        TextButton(onPressed: () => _go(AuthStep.signIn), child: Text(${t('back')})),
      ];

  List<Widget> _verify(AppLocalizations l) => [
        _title(${t('verify_email_title')}),
        Text(l.authUiVerifyEmailBody(widget.service.currentUser?.email ?? _email.text.trim()), textAlign: TextAlign.center),
        _gap(),
${F.email ? `        OutlinedButton(onPressed: _busy ? null : () => _run(() async { await widget.service.sendEmailVerification(); setState(() => _info = ${t('email_sent')}); }), child: Text(${t('resend')})),
        _gap(),
` : ''}        FilledButton(
          onPressed: _busy ? null : () => _run(() async {
            final u = await widget.service.refreshUser();
            if (u != null && u.emailVerified) {
              widget.onSignedIn(u);
            } else if (mounted) {
              setState(() => _info = ${t('not_verified_yet')});
            }
          }),
          child: Text(${t('i_verified')}),
        ),
        TextButton(onPressed: _busy ? null : () => _run(() async { await widget.service.signOut(); _go(AuthStep.signIn); }), child: Text(${t('sign_out')})),
      ];
}

/// Account: who is signed in, sign-in methods${on(F.linking, ' and linking')}${on(F.mfa, ', second factor')}${on(F.passkey, ', passkey')}, sign out and account deletion.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.service, required this.onSignedOut});
  final AuthService service;
  final VoidCallback onSignedOut;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  bool _busy = false;
${on(F.mfa, `  late Future<List<MfaFactor>> _factors = widget.service.mfaFactors();\n`)}
  Future<void> _run(Future<void> Function() action, {String? done}) async {
    final l = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await action();
      if (done != null) messenger.showSnackBar(SnackBar(content: Text(done)));
    } on AuthError catch (e) {
      if (e.code != AuthErrorCode.cancelled) messenger.showSnackBar(SnackBar(content: Text(authErrorText(l, e))));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(authErrorText(l, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Runs [action]; if the provider asks for a recent sign-in, re-authenticates (password or the provider again) and retries.
  Future<void> _sensitive(Future<void> Function() action) async {
    try {
      await action();
    } on AuthError catch (e) {
      if (e.code != AuthErrorCode.requiresRecentLogin) rethrow;
      final user = widget.service.currentUser;
      String? password;
      if (user != null && user.methods.contains(AuthMethod.email)) {
        password = await _ask(AppLocalizations.of(context)!.authUiReauthTitle, AppLocalizations.of(context)!.authUiPassword, obscure: true);
        if (password == null) return;
      }
      await widget.service.reauthenticate(password: password);
      await action();
    }
  }

  Future<String?> _ask(String title, String label, {bool obscure = false, String? message}) {
    final c = TextEditingController();
    final l = AppLocalizations.of(context)!;
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (message != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: SelectableText(message)),
          TextField(controller: c, obscureText: obscure, autofocus: true, decoration: InputDecoration(labelText: label)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(${t('cancel')})),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: Text(${t('confirm')})),
        ],
      ),
    ).whenComplete(c.dispose);
  }

  Future<void> _delete(AppLocalizations l) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(${t('delete_title')}),
        content: Text(${t('delete_body')}),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(${t('cancel')})),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error), onPressed: () => Navigator.pop(ctx, true), child: Text(${t('delete_confirm')})),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => _sensitive(() async {
          await widget.service.deleteAccount();
          widget.onSignedOut();
        }));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return StreamBuilder<AuthUser?>(
      stream: widget.service.authStateChanges(),
      initialData: widget.service.currentUser,
      builder: (context, snap) {
        final user = snap.data;
        return Scaffold(
          appBar: AppBar(title: Text(${t('account_title')})),
          body: user == null
              ? const Center(child: CircularProgressIndicator())
              : AbsorbPointer(
                  absorbing: _busy,
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    ListTile(
                      leading: CircleAvatar(backgroundImage: user.photoUrl == null ? null : NetworkImage(user.photoUrl!), child: user.photoUrl == null ? const Icon(Icons.person) : null),
                      title: Text(user.displayName ?? user.email ?? user.phone ?? ''),
                      subtitle: Text(user.email ?? user.phone ?? ''),
                      trailing: Chip(label: Text(user.role.name)),
                    ),
${on(F.guest && F.linking, `                    if (user.isAnonymous) Card(color: theme.colorScheme.secondaryContainer, child: Padding(padding: const EdgeInsets.all(16), child: Text(${t('guest_banner')}))),\n`)}${on(F.email, `                    if (user.email != null && !user.emailVerified)
                      Card(
                        color: theme.colorScheme.tertiaryContainer,
                        child: ListTile(title: Text(${t('verify_banner')}), trailing: TextButton(onPressed: () => _run(widget.service.sendEmailVerification, done: ${t('email_sent')}), child: Text(${t('resend')}))),
                      ),
`)}${on(F.linkable.length, `                    _section(${t('methods_title')}),
${F.linkable.map((m) => `                    _methodTile(l, user, AuthMethod.${m}, ${m === 'email' ? `() async {
                      final email = await _ask(${t('method_email')}, ${t('email')});
                      if (email == null || !mounted) return;
                      final password = await _ask(${t('method_email')}, ${t('password')}, obscure: true);
                      if (password == null) return;
                      await _run(() => widget.service.linkEmail(email, password));
                    }` : `() => _run(widget.service.link${pascal(m)})`}),`).join('\n')}
`)}${on(F.mfa, `                    _section(${t('mfa_section')}),
                    FutureBuilder<List<MfaFactor>>(
                      future: _factors,
                      builder: (context, f) => Column(children: [
                        if ((f.data ?? const []).isEmpty) ListTile(title: Text(${t('mfa_none')})),
                        for (final factor in f.data ?? const <MfaFactor>[])
                          ListTile(
                            leading: Icon(factor.kind == 'totp' ? Icons.qr_code : Icons.sms),
                            title: Text(factor.label ?? factor.kind),
                            trailing: TextButton(onPressed: () => _run(() async { await _sensitive(() => widget.service.unenrollMfa(factor.id)); setState(() => _factors = widget.service.mfaFactors()); }), child: Text(${t('mfa_remove')})),
                          ),
                      ]),
                    ),
${on(F.totp, `                    ListTile(
                      leading: const Icon(Icons.qr_code),
                      title: Text(${t('mfa_add_totp')}),
                      onTap: () => _run(() async {
                        final e = await widget.service.enrollTotpStart();
                        if (!mounted) return;
                        final code = await _ask(${t('mfa_add_totp')}, ${t('code')}, message: l.authUiMfaSecret(e.secret));
                        if (code == null) return;
                        await widget.service.enrollTotpFinish(code);
                        setState(() => _factors = widget.service.mfaFactors());
                      }),
                    ),
`)}${on(F.sms, `                    ListTile(
                      leading: const Icon(Icons.sms),
                      title: Text(${t('mfa_add_sms')}),
                      onTap: () => _run(() async {
                        final phone = await _ask(${t('mfa_add_sms')}, ${t('phone')});
                        if (phone == null) return;
                        final id = await widget.service.enrollSmsStart(phone);
                        if (!mounted) return;
                        final code = await _ask(${t('mfa_add_sms')}, ${t('code')});
                        if (code == null) return;
                        await widget.service.enrollSmsFinish(id, code);
                        setState(() => _factors = widget.service.mfaFactors());
                      }),
                    ),
`)}`)}${on(F.passkey, `                    ListTile(leading: const Icon(Icons.key), title: Text(${t('passkey_add')}), onTap: () => _run(widget.service.registerPasskey, done: ${t('passkey_added')})),\n`)}                    const Divider(height: 32),
                    ListTile(leading: const Icon(Icons.logout), title: Text(${t('sign_out')}), onTap: () => _run(() async { await widget.service.signOut(); widget.onSignedOut(); })),
                    ListTile(
                      leading: Icon(Icons.delete_forever, color: theme.colorScheme.error),
                      title: Text(${t('delete_account')}, style: TextStyle(color: theme.colorScheme.error)),
                      onTap: () => _delete(l),
                    ),
                  ]),
                ),
        );
      },
    );
  }

  Widget _section(String title) => Padding(padding: const EdgeInsets.fromLTRB(16, 24, 16, 8), child: Text(title, style: Theme.of(context).textTheme.titleSmall));
${on(F.linkable.length, `
  Widget _methodTile(AppLocalizations l, AuthUser user, AuthMethod m, Future<void> Function() link) {
    final linked = user.methods.contains(m);
    return ListTile(
      title: Text(authMethodText(l, m)),
      subtitle: linked ? Text(${t('linked')}) : null,
      trailing: linked
          ? (user.methods.length > 1 ? TextButton(onPressed: () => _run(() => widget.service.unlink(m)), child: Text(${t('unlink')})) : null)
          : OutlinedButton(onPressed: link, child: Text(${t('link')})),
    );
  }
`)}}
`
}
