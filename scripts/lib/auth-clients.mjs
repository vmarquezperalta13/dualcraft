// AuthService implementations per stack and provider (DualCraft auth). Written once by auth.mjs init/gen when missing;
// the developer owns them afterwards. Only the methods enabled in auth.json are included, matching the generated
// interface (a method enabled later shows up as a compile error and in `auth.mjs check`).
const on = (cond, text) => (cond ? text : '')
const has = (c, m) => c.methods.includes(m)
const mfa = (c) => (c.mfa?.factors || []).length > 0
const mf = (c, f) => (c.mfa?.factors || []).includes(f)

// ---------------------------------------------------------------- Flutter + Firebase
export function flutterFirebase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const providerOf = [email && "'password' => AuthMethod.email", google && "'google.com' => AuthMethod.google", apple && "'apple.com' => AuthMethod.apple", phone && "'phone' => AuthMethod.phone"].filter(Boolean)
  const idOf = [email && "AuthMethod.email => 'password'", google && "AuthMethod.google => 'google.com'", apple && "AuthMethod.apple => 'apple.com'", phone && "AuthMethod.phone => 'phone'"].filter(Boolean)
  return `// Firebase implementation of AuthService (DualCraft auth). Yours after creation: adapt freely.
// pubspec: firebase_auth${on(google, ', google_sign_in: ^7')}${on(apple, ', sign_in_with_apple, crypto')}
// Setup: enable the providers in Firebase Console → Authentication${on(google, '; Google: SHA-1/SHA-256 of your signing keys in the Firebase Android app, GoogleService-Info.plist REVERSED_CLIENT_ID URL scheme on iOS')}${on(apple, '; Apple: "Sign in with Apple" capability + Services ID for Android/web')}.
import 'dart:async';
${on(apple, "import 'dart:convert';\nimport 'dart:math';\n\nimport 'package:crypto/crypto.dart';\n")}import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter/foundation.dart';
${on(google, "import 'package:google_sign_in/google_sign_in.dart';\n")}${on(apple, "import 'package:sign_in_with_apple/sign_in_with_apple.dart';\n")}
import '../generated/api_client.dart';
import '../generated/auth_catalog.dart';

class FirebaseAuthService implements AuthService {
  FirebaseAuthService(this._api, {fb.FirebaseAuth? auth}) : _auth = auth ?? fb.FirebaseAuth.instance;
  final Api _api;
  final fb.FirebaseAuth _auth;
  AuthUser? _current;
${on(mfa(c), '  fb.MultiFactorResolver? _pendingMfa;\n  String? _pendingSmsId;\n')}${on(mf(c, 'totp'), '  fb.TotpSecret? _pendingTotp;\n')}${on(phone, '  fb.ConfirmationResult? _webConfirmation;\n')}
  @override
  AuthUser? get currentUser => _current;

  @override
  Stream<AuthUser?> authStateChanges() => _auth.idTokenChanges().asyncMap((u) async => _current = u == null ? null : await _map(u));

  fb.User get _user => _auth.currentUser ?? (throw const AuthError(AuthErrorCode.unknown, 'no_user'));

  Future<AuthUser> _map(fb.User u, {bool refresh = false}) async {
    final token = await u.getIdTokenResult(refresh);
    return AuthUser(
      uid: u.uid,
      email: u.email,
      phone: u.phoneNumber,
      displayName: u.displayName,
      photoUrl: u.photoURL,
      isAnonymous: u.isAnonymous,
      emailVerified: u.emailVerified,
      role: roleFrom(token.claims?['role']),
      methods: [${on(c.guest, "if (u.isAnonymous) AuthMethod.guest, ")}...u.providerData.map((p) => _methodOf(p.providerId)).whereType<AuthMethod>()],
      mfaEnrolled: ${mfa(c) ? '(await u.multiFactor.getEnrolledFactors()).isNotEmpty' : 'false'},
    );
  }

  AuthMethod? _methodOf(String providerId) => switch (providerId) {
        ${[...providerOf, '_ => null'].join(',\n        ')},
      };
${on(c.linking, `
  String _providerId(AuthMethod m) => switch (m) {
        ${[...idOf, "_ => throw const AuthError(AuthErrorCode.methodDisabled, 'not_linkable')"].join(',\n        ')},
      };
`)}
  Future<AuthUser> _signedIn(fb.UserCredential c) async => _current = await _map(c.user!);

  /// Every SDK error becomes an AuthError with a normalized code (texts: authErrorKey(code)).
  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    }${on(mfa(c), ` on fb.FirebaseAuthMultiFactorException catch (e) {
      _pendingMfa = e.resolver;
      final hint = e.resolver.hints.first;
      if (hint is fb.PhoneMultiFactorInfo) _pendingSmsId = await _sendSms(multiFactorInfo: hint, session: e.resolver.session);
      throw AuthError(AuthErrorCode.mfaRequired, e.code);
    }`)} on fb.FirebaseAuthException catch (e) {
      throw AuthError(authErrorFrom(e.code), e.code);
    }${on(google, ` on GoogleSignInException catch (e) {
      throw AuthError(e.code == GoogleSignInExceptionCode.canceled ? AuthErrorCode.cancelled : AuthErrorCode.unknown, e.description);
    }`)}${on(apple, ` on SignInWithAppleAuthorizationException catch (e) {
      throw AuthError(e.code == AuthorizationErrorCode.canceled ? AuthErrorCode.cancelled : AuthErrorCode.unknown, e.message);
    }`)}
  }
${on(email, `
  @override
  Future<AuthUser> signUpWithEmail(String email, String password, {String? displayName}) => _guard(() async {
        final c = await _auth.createUserWithEmailAndPassword(email: email, password: password);
        if (displayName != null) await c.user!.updateDisplayName(displayName);
        await c.user!.sendEmailVerification();
        return _signedIn(c);
      });

  @override
  Future<AuthUser> signInWithEmail(String email, String password) => _guard(() async => _signedIn(await _auth.signInWithEmailAndPassword(email: email, password: password)));

  @override
  Future<void> sendPasswordReset(String email) => _guard(() => _auth.sendPasswordResetEmail(email: email));

  @override
  Future<void> sendEmailVerification() => _guard(() => _user.sendEmailVerification());
`)}${on(google, `
  static Future<void>? _googleReady;
  /// Pass serverClientId (the Web client id) if your Android setup needs it.
  Future<void> _initGoogle() => _googleReady ??= GoogleSignIn.instance.initialize();

  Future<fb.AuthCredential> _googleCredential() async {
    await _initGoogle();
    final account = await GoogleSignIn.instance.authenticate();
    return fb.GoogleAuthProvider.credential(idToken: account.authentication.idToken);
  }

  @override
  Future<AuthUser> signInWithGoogle() => _guard(() async => _signedIn(kIsWeb ? await _auth.signInWithPopup(fb.GoogleAuthProvider()) : await _auth.signInWithCredential(await _googleCredential())));
`)}${on(apple, `
  /// Apple only returns the name the first time: keep it.
  String? _appleName;

  Future<fb.AuthCredential> _appleCredential() async {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
    final random = Random.secure();
    final rawNonce = List.generate(32, (_) => chars[random.nextInt(chars.length)]).join();
    final apple = await SignInWithApple.getAppleIDCredential(
      scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
      nonce: sha256.convert(utf8.encode(rawNonce)).toString(),
    );
    _appleName = [apple.givenName, apple.familyName].whereType<String>().join(' ').trim();
    return fb.OAuthProvider('apple.com').credential(idToken: apple.identityToken, rawNonce: rawNonce, accessToken: apple.authorizationCode);
  }

  @override
  Future<AuthUser> signInWithApple() => _guard(() async {
        final c = kIsWeb ? await _auth.signInWithPopup(fb.AppleAuthProvider()) : await _auth.signInWithCredential(await _appleCredential());
        final name = _appleName;
        if (name != null && name.isNotEmpty && c.user?.displayName == null) await c.user!.updateDisplayName(name);
        return _signedIn(c);
      });
`)}${on(phone || mf(c, 'sms'), `
  Future<String> _sendSms({String? phoneNumber, fb.MultiFactorSession? session, fb.PhoneMultiFactorInfo? multiFactorInfo}) {
    final done = Completer<String>();
    _auth.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      multiFactorSession: session,
      multiFactorInfo: multiFactorInfo,
      verificationCompleted: (_) {}, // Android auto-retrieval: we still confirm with the typed code
      verificationFailed: (e) => done.isCompleted ? null : done.completeError(e),
      codeSent: (id, _) => done.isCompleted ? null : done.complete(id),
      codeAutoRetrievalTimeout: (_) {},
    );
    return done.future;
  }
`)}${on(phone, `
  @override
  Future<String> startPhoneSignIn(String phone) => _guard(() async {
        if (kIsWeb) {
          _webConfirmation = await _auth.signInWithPhoneNumber(phone); // invisible reCAPTCHA
          return 'web';
        }
        return _sendSms(phoneNumber: phone);
      });

  @override
  Future<AuthUser> confirmPhoneCode(String verificationId, String code) => _guard(() async {
        final web = _webConfirmation;
        if (kIsWeb && web != null) return _signedIn(await web.confirm(code));
        return _signedIn(await _auth.signInWithCredential(fb.PhoneAuthProvider.credential(verificationId: verificationId, smsCode: code)));
      });
`)}${on(has(c, 'passkey'), `
  // Passkeys: Firebase has no native support — they are verified by your Cloud Functions (passkeyOptions /
  // passkeyVerify) and the session comes as a custom token. Implemented by the passkey step of the auth pack.
  @override
  Future<AuthUser> signInWithPasskey() => throw const AuthError(AuthErrorCode.methodDisabled, 'passkeys_not_set_up');

  @override
  Future<void> registerPasskey() => throw const AuthError(AuthErrorCode.methodDisabled, 'passkeys_not_set_up');
`)}${on(c.guest, `
  @override
  Future<AuthUser> signInAsGuest() => _guard(() async => _signedIn(await _auth.signInAnonymously()));
`)}${on(c.linking && email, `
  @override
  Future<AuthUser> linkEmail(String email, String password) => _guard(() async => _signedIn(await _user.linkWithCredential(fb.EmailAuthProvider.credential(email: email, password: password))));
`)}${on(c.linking && google, `
  @override
  Future<AuthUser> linkGoogle() => _guard(() async => _signedIn(kIsWeb ? await _user.linkWithPopup(fb.GoogleAuthProvider()) : await _user.linkWithCredential(await _googleCredential())));
`)}${on(c.linking && apple, `
  @override
  Future<AuthUser> linkApple() => _guard(() async => _signedIn(kIsWeb ? await _user.linkWithPopup(fb.AppleAuthProvider()) : await _user.linkWithCredential(await _appleCredential())));
`)}${on(c.linking, `
  @override
  Future<AuthUser> unlink(AuthMethod method) => _guard(() async => _current = await _map(await _user.unlink(_providerId(method))));
`)}${on(mfa(c), `
  @override
  Future<List<MfaFactor>> mfaFactors() => _guard(() async => [
        for (final f in await _user.multiFactor.getEnrolledFactors()) MfaFactor(f.uid, f.factorId == 'phone' ? 'sms' : 'totp', f.displayName),
      ]);

  @override
  Future<AuthUser> completeMfaSignIn(String code) => _guard(() async {
        final resolver = _pendingMfa ?? (throw const AuthError(AuthErrorCode.codeExpired, 'no_pending_mfa'));
        final hint = resolver.hints.first;
        final fb.MultiFactorAssertion assertion;
        if (hint is fb.PhoneMultiFactorInfo) {
          assertion = fb.PhoneMultiFactorGenerator.getAssertion(fb.PhoneAuthProvider.credential(verificationId: _pendingSmsId ?? '', smsCode: code));
        } else {
          ${mf(c, 'totp') ? 'assertion = await fb.TotpMultiFactorGenerator.getAssertionForSignIn(hint.uid, code);' : "throw const AuthError(AuthErrorCode.methodDisabled, 'totp');"}
        }
        final result = await resolver.resolveSignIn(assertion);
        _pendingMfa = null;
        return _signedIn(result);
      });

  @override
  Future<void> unenrollMfa(String factorId) => _guard(() => _user.multiFactor.unenroll(factorUid: factorId));
`)}${on(mf(c, 'totp'), `
  @override
  Future<TotpEnrollment> enrollTotpStart() => _guard(() async {
        final secret = await fb.TotpMultiFactorGenerator.generateSecret(await _user.multiFactor.getSession());
        _pendingTotp = secret;
        return TotpEnrollment(secret.secretKey, await secret.generateQrCodeUrl(accountName: _user.email, issuer: ${JSON.stringify(c.passkey?.rpName || 'App')}));
      });

  @override
  Future<void> enrollTotpFinish(String code) => _guard(() async {
        final secret = _pendingTotp ?? (throw const AuthError(AuthErrorCode.codeExpired, 'no_pending_totp'));
        await _user.multiFactor.enroll(await fb.TotpMultiFactorGenerator.getAssertionForEnrollment(secret, code), displayName: 'Authenticator');
        _pendingTotp = null;
      });
`)}${on(mf(c, 'sms'), `
  @override
  Future<String> enrollSmsStart(String phone) => _guard(() async => _sendSms(phoneNumber: phone, session: await _user.multiFactor.getSession()));

  @override
  Future<void> enrollSmsFinish(String verificationId, String code) => _guard(() => _user.multiFactor.enroll(
        fb.PhoneMultiFactorGenerator.getAssertion(fb.PhoneAuthProvider.credential(verificationId: verificationId, smsCode: code)),
        displayName: 'SMS',
      ));
`)}
  @override
  Future<void> reauthenticate({String? password}) => _guard(() async {
        final u = _user;
        final providers = [for (final p in u.providerData) p.providerId];
${on(email, `        if (password != null && u.email != null && providers.contains('password')) {
          await u.reauthenticateWithCredential(fb.EmailAuthProvider.credential(email: u.email!, password: password));
          return;
        }
`)}${on(google, `        if (providers.contains('google.com')) {
          kIsWeb ? await u.reauthenticateWithPopup(fb.GoogleAuthProvider()) : await u.reauthenticateWithCredential(await _googleCredential());
          return;
        }
`)}${on(apple, `        if (providers.contains('apple.com')) {
          kIsWeb ? await u.reauthenticateWithPopup(fb.AppleAuthProvider()) : await u.reauthenticateWithCredential(await _appleCredential());
          return;
        }
`)}        throw const AuthError(AuthErrorCode.requiresRecentLogin, 'sign_in_again');
      });

  @override
  Future<AuthUser?> refreshUser() => _guard(() async {
        final u = _auth.currentUser;
        if (u == null) return _current = null;
        await u.reload();
        return _current = await _map(_auth.currentUser!, refresh: true); // refresh = new role claim
      });

  @override
  Future<void> signOut() async {
${on(google, '    if (!kIsWeb) await GoogleSignIn.instance.signOut().catchError((_) {});\n')}    await _auth.signOut();
    _current = null;
  }

  @override
  Future<void> deleteAccount() => _guard(() async {
        try {
          await _api.deleteAccount(); // server: data cleanup + deletion
        } on ApiError catch (e) {
          if (e.code == 'failed-precondition') throw const AuthError(AuthErrorCode.requiresRecentLogin, 'requires_recent_login');
          rethrow;
        }
        await signOut();
      });
}
`
}

// ---------------------------------------------------------------- Flutter + Supabase
export function flutterSupabase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const providerOf = [email && "'email' => AuthMethod.email", google && "'google' => AuthMethod.google", apple && "'apple' => AuthMethod.apple", phone && "'phone' => AuthMethod.phone"].filter(Boolean)
  const nameOf = [google && "AuthMethod.google => 'google'", apple && "AuthMethod.apple => 'apple'", email && "AuthMethod.email => 'email'", phone && "AuthMethod.phone => 'phone'"].filter(Boolean)
  return `// Supabase implementation of AuthService (DualCraft auth). Yours after creation: adapt freely.
// pubspec: supabase_flutter${on(google, ', google_sign_in: ^7')}${on(apple, ', sign_in_with_apple, crypto')}
// Setup: enable the providers in Supabase → Authentication → Providers${on(google, '; Google: add your iOS/Android/Web client ids to "Client IDs" (native ID-token sign-in)')}${on(c.guest, '; anonymous sign-ins')}${on(c.linking, '; manual linking (for linkGoogle / linkApple)')}.
import 'dart:async';
${on(apple, "import 'dart:convert';\nimport 'dart:math';\n\nimport 'package:crypto/crypto.dart';\n")}import 'package:flutter/foundation.dart';
${on(google, "import 'package:google_sign_in/google_sign_in.dart';\n")}${on(apple, "import 'package:sign_in_with_apple/sign_in_with_apple.dart';\n")}import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import '../generated/api_client.dart';
import '../generated/auth_catalog.dart';

class SupabaseAuthService implements AuthService {
  SupabaseAuthService(this._api, {sb.SupabaseClient? client}) : _client = client ?? sb.Supabase.instance.client;
  final Api _api;
  final sb.SupabaseClient _client;
  AuthUser? _current;
${on(mfa(c), '  ({String factorId, String challengeId})? _pendingMfa;\n')}${on(mf(c, 'totp'), '  String? _pendingTotpFactor;\n')}
  sb.GoTrueClient get _auth => _client.auth;
  sb.User get _user => _auth.currentUser ?? (throw const AuthError(AuthErrorCode.unknown, 'no_user'));

  @override
  AuthUser? get currentUser => _current;

  @override
  Stream<AuthUser?> authStateChanges() => _auth.onAuthStateChange.map((s) => _current = s.session == null ? null : _map(s.session!.user));

  AuthUser _map(sb.User u) => AuthUser(
        uid: u.id,
        email: u.email,
        phone: (u.phone ?? '').isEmpty ? null : u.phone,
        displayName: u.userMetadata?['display_name'] as String? ?? u.userMetadata?['full_name'] as String?,
        photoUrl: u.userMetadata?['avatar_url'] as String?,
        isAnonymous: u.isAnonymous,
        emailVerified: u.emailConfirmedAt != null,
        role: roleFrom(u.appMetadata['role']),
        methods: [${on(c.guest, "if (u.isAnonymous) AuthMethod.guest, ")}...(u.identities ?? const <sb.UserIdentity>[]).map((i) => _methodOf(i.provider)).whereType<AuthMethod>()],
        mfaEnrolled: (u.factors ?? const <sb.Factor>[]).any((f) => f.status == sb.FactorStatus.verified),
      );

  AuthMethod? _methodOf(String provider) => switch (provider) {
        ${[...providerOf, '_ => null'].join(',\n        ')},
      };

  Future<AuthUser> _signedIn(sb.User? u) async {
    if (u == null) throw const AuthError(AuthErrorCode.unknown, 'no_user');
${on(mfa(c), `    // a second factor is enrolled: the session stays at aal1 until completeMfaSignIn
    final aal = _auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.nextLevel == sb.AuthenticatorAssuranceLevels.aal2 && aal.currentLevel != sb.AuthenticatorAssuranceLevels.aal2) {
      final factor = (await _auth.mfa.listFactors()).all.firstWhere((f) => f.status == sb.FactorStatus.verified);
      final challenge = await _auth.mfa.challenge(factorId: factor.id); // SMS factors get the code now
      _pendingMfa = (factorId: factor.id, challengeId: challenge.id);
      throw const AuthError(AuthErrorCode.mfaRequired, 'insufficient_aal');
    }
`)}    return _current = _map(u);
  }

  /// Every SDK error becomes an AuthError with a normalized code (texts: authErrorKey(code)).
  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on sb.AuthException catch (e) {
      throw AuthError(authErrorFrom(e.code ?? e.message), e.code ?? e.message);
    }${on(google, ` on GoogleSignInException catch (e) {
      throw AuthError(e.code == GoogleSignInExceptionCode.canceled ? AuthErrorCode.cancelled : AuthErrorCode.unknown, e.description);
    }`)}${on(apple, ` on SignInWithAppleAuthorizationException catch (e) {
      throw AuthError(e.code == AuthorizationErrorCode.canceled ? AuthErrorCode.cancelled : AuthErrorCode.unknown, e.message);
    }`)}
  }
${on(email, `
  @override
  Future<AuthUser> signUpWithEmail(String email, String password, {String? displayName}) => _guard(() async {
        final r = await _auth.signUp(email: email, password: password, data: {if (displayName != null) 'display_name': displayName});
        final u = r.user ?? (throw const AuthError(AuthErrorCode.unknown, 'no_user'));
        return _current = _map(u); // without a session until the email is confirmed (if confirmation is on)
      });

  @override
  Future<AuthUser> signInWithEmail(String email, String password) => _guard(() async => _signedIn((await _auth.signInWithPassword(email: email, password: password)).user));

  @override
  Future<void> sendPasswordReset(String email) => _guard(() => _auth.resetPasswordForEmail(email));

  @override
  Future<void> sendEmailVerification() => _guard(() async => _auth.resend(type: sb.OtpType.signup, email: _user.email));
`)}${on(google, `
  static Future<void>? _googleReady;
  /// Pass serverClientId (the Web client id) on Android so the ID token is accepted by Supabase.
  Future<void> _initGoogle() => _googleReady ??= GoogleSignIn.instance.initialize();

  @override
  Future<AuthUser> signInWithGoogle() => _guard(() async {
        if (kIsWeb) {
          await _auth.signInWithOAuth(sb.OAuthProvider.google); // redirect: the session arrives through authStateChanges
          throw const AuthError(AuthErrorCode.cancelled, 'redirect');
        }
        await _initGoogle();
        final account = await GoogleSignIn.instance.authenticate();
        final idToken = account.authentication.idToken ?? (throw const AuthError(AuthErrorCode.unknown, 'no_id_token'));
        return _signedIn((await _auth.signInWithIdToken(provider: sb.OAuthProvider.google, idToken: idToken)).user);
      });
`)}${on(apple, `
  @override
  Future<AuthUser> signInWithApple() => _guard(() async {
        if (kIsWeb) {
          await _auth.signInWithOAuth(sb.OAuthProvider.apple);
          throw const AuthError(AuthErrorCode.cancelled, 'redirect');
        }
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
        final random = Random.secure();
        final rawNonce = List.generate(32, (_) => chars[random.nextInt(chars.length)]).join();
        final apple = await SignInWithApple.getAppleIDCredential(
          scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
          nonce: sha256.convert(utf8.encode(rawNonce)).toString(),
        );
        final idToken = apple.identityToken ?? (throw const AuthError(AuthErrorCode.unknown, 'no_id_token'));
        final r = await _auth.signInWithIdToken(provider: sb.OAuthProvider.apple, idToken: idToken, nonce: rawNonce);
        final name = [apple.givenName, apple.familyName].whereType<String>().join(' ').trim();
        if (name.isNotEmpty) await _auth.updateUser(sb.UserAttributes(data: {'full_name': name})); // Apple sends it only once
        return _signedIn(r.user);
      });
`)}${on(phone, `
  /// The "verification id" is the phone number itself (Supabase verifies phone + code).
  @override
  Future<String> startPhoneSignIn(String phone) => _guard(() async {
        await _auth.signInWithOtp(phone: phone);
        return phone;
      });

  @override
  Future<AuthUser> confirmPhoneCode(String verificationId, String code) => _guard(() async => _signedIn((await _auth.verifyOTP(type: sb.OtpType.sms, phone: verificationId, token: code)).user));
`)}${on(has(c, 'passkey'), `
  // Passkeys (Supabase beta, experimental in supabase_flutter): implemented by the passkey step of the auth pack.
  @override
  Future<AuthUser> signInWithPasskey() => throw const AuthError(AuthErrorCode.methodDisabled, 'passkeys_not_set_up');

  @override
  Future<void> registerPasskey() => throw const AuthError(AuthErrorCode.methodDisabled, 'passkeys_not_set_up');
`)}${on(c.guest, `
  @override
  Future<AuthUser> signInAsGuest() => _guard(() async => _signedIn((await _auth.signInAnonymously()).user));
`)}${on(c.linking && email, `
  /// Turns the guest (anonymous) account into an email account: same user id, same data. Sends a confirmation email.
  @override
  Future<AuthUser> linkEmail(String email, String password) => _guard(() async => _signedIn((await _auth.updateUser(sb.UserAttributes(email: email, password: password))).user));
`)}${on(c.linking && google, `
  @override
  Future<AuthUser> linkGoogle() => _guard(() async {
        await _auth.linkIdentity(sb.OAuthProvider.google); // OAuth flow; the identity appears after the redirect
        return _signedIn((await _auth.refreshSession()).user);
      });
`)}${on(c.linking && apple, `
  @override
  Future<AuthUser> linkApple() => _guard(() async {
        await _auth.linkIdentity(sb.OAuthProvider.apple);
        return _signedIn((await _auth.refreshSession()).user);
      });
`)}${on(c.linking, `
  @override
  Future<AuthUser> unlink(AuthMethod method) => _guard(() async {
        final name = switch (method) {
          ${[...nameOf, "_ => throw const AuthError(AuthErrorCode.methodDisabled, 'not_linkable')"].join(',\n          ')},
        };
        final identity = (_user.identities ?? const <sb.UserIdentity>[]).firstWhere((i) => i.provider == name, orElse: () => throw const AuthError(AuthErrorCode.unknown, 'not_linked'));
        await _auth.unlinkIdentity(identity);
        return _signedIn((await _auth.refreshSession()).user);
      });
`)}${on(mfa(c), `
  @override
  Future<List<MfaFactor>> mfaFactors() => _guard(() async => [
        for (final f in (await _auth.mfa.listFactors()).all.where((f) => f.status == sb.FactorStatus.verified)) MfaFactor(f.id, f.factorType == sb.FactorType.phone ? 'sms' : 'totp', f.friendlyName),
      ]);

  @override
  Future<AuthUser> completeMfaSignIn(String code) => _guard(() async {
        final p = _pendingMfa ?? (throw const AuthError(AuthErrorCode.codeExpired, 'no_pending_mfa'));
        await _auth.mfa.verify(factorId: p.factorId, challengeId: p.challengeId, code: code);
        _pendingMfa = null;
        return _current = _map(_user);
      });

  @override
  Future<void> unenrollMfa(String factorId) => _guard(() async => _auth.mfa.unenroll(factorId));
`)}${on(mf(c, 'totp'), `
  @override
  Future<TotpEnrollment> enrollTotpStart() => _guard(() async {
        final r = await _auth.mfa.enroll(factorType: sb.FactorType.totp, issuer: ${JSON.stringify(c.passkey?.rpName || 'App')});
        _pendingTotpFactor = r.id;
        final totp = r.totp ?? (throw const AuthError(AuthErrorCode.unknown, 'no_totp'));
        return TotpEnrollment(totp.secret, totp.uri);
      });

  @override
  Future<void> enrollTotpFinish(String code) => _guard(() async {
        final id = _pendingTotpFactor ?? (throw const AuthError(AuthErrorCode.codeExpired, 'no_pending_totp'));
        await _auth.mfa.challengeAndVerify(factorId: id, code: code);
        _pendingTotpFactor = null;
      });
`)}${on(mf(c, 'sms'), `
  /// Returns "factorId:challengeId" — pass it back to enrollSmsFinish.
  @override
  Future<String> enrollSmsStart(String phone) => _guard(() async {
        final r = await _auth.mfa.enroll(factorType: sb.FactorType.phone, phone: phone);
        final challenge = await _auth.mfa.challenge(factorId: r.id);
        return '\${r.id}:\${challenge.id}';
      });

  @override
  Future<void> enrollSmsFinish(String verificationId, String code) => _guard(() async {
        final [factorId, challengeId] = verificationId.split(':');
        await _auth.mfa.verify(factorId: factorId, challengeId: challengeId, code: code);
      });
`)}
  /// Deletion checks that the last sign-in is recent: signing in again refreshes it.
  @override
  Future<void> reauthenticate({String? password}) => _guard(() async {
        final u = _user;
        final providers = [for (final i in u.identities ?? const <sb.UserIdentity>[]) i.provider];
${on(email, `        if (password != null && u.email != null && providers.contains('email')) {
          await _auth.signInWithPassword(email: u.email!, password: password);
          return;
        }
`)}${on(google, `        if (providers.contains('google')) {
          await signInWithGoogle();
          return;
        }
`)}${on(apple, `        if (providers.contains('apple')) {
          await signInWithApple();
          return;
        }
`)}        throw const AuthError(AuthErrorCode.requiresRecentLogin, 'sign_in_again');
      });

  @override
  Future<AuthUser?> refreshUser() => _guard(() async {
        if (_auth.currentSession == null) return _current = null;
        final r = await _auth.refreshSession(); // new JWT = new app_metadata.role
        return _current = r.user == null ? null : _map(r.user!);
      });

  @override
  Future<void> signOut() async {
${on(google, '    if (!kIsWeb) await GoogleSignIn.instance.signOut().catchError((_) {});\n')}    await _auth.signOut();
    _current = null;
  }

  @override
  Future<void> deleteAccount() => _guard(() async {
        try {
          await _api.deleteAccount(); // Edge Function: data cleanup + deletion
        } on ApiError catch (e) {
          if (e.code == 'failed-precondition') throw const AuthError(AuthErrorCode.requiresRecentLogin, 'requires_recent_login');
          rethrow;
        }
        await signOut();
      });
}
`
}
