// Swift AuthService implementations (DualCraft auth): iOS with Firebase Auth (+ GoogleSignIn, Sign in with Apple
// through AuthenticationServices) and supabase-swift. Written once; the developer owns them afterwards.
const on = (cond, text) => (cond ? text : '')
const has = (c, m) => c.methods.includes(m)
const mfa = (c) => (c.mfa?.factors || []).length > 0
const mf = (c, f) => (c.mfa?.factors || []).includes(f)
const issuer = (c) => JSON.stringify(c.passkey?.rpName || 'App')

const passkeyStubs = `
    // Passkeys: implemented by the passkey step of the auth pack (auth.mjs).
    func signInWithPasskey() async throws -> AuthUser { throw AuthError(code: .methodDisabled, raw: "passkeys_not_set_up") }
    func registerPasskey() async throws { throw AuthError(code: .methodDisabled, raw: "passkeys_not_set_up") }
`

/** Shared helpers: presenting view controller, nonce, Sign in with Apple as async/await. */
const appleFlow = `
/// Sign in with Apple as async/await (ASAuthorizationController + delegate).
final class AppleSignInFlow: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?

    @MainActor
    func run(nonce: String) async throws -> ASAuthorizationAppleIDCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        return try await withCheckedThrowingContinuation { c in
            continuation = c
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationAppleIDCredential { continuation?.resume(returning: credential) } else { continuation?.resume(throwing: AuthError(code: .unknown, raw: "no_apple_credential")) }
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        continuation?.resume(throwing: AuthError(code: cancelled ? .cancelled : .unknown, raw: String(describing: error)))
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor() }
    }
}

func randomNonce(_ length: Int = 32) -> String {
    let chars = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    return String((0..<length).map { _ in chars[Int.random(in: 0..<chars.count)] })
}
`
const presenter = `
@MainActor
func topViewController() -> UIViewController? {
    var top = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
}
`

// ---------------------------------------------------------------- iOS + Firebase
export function swiftFirebase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const methodOf = [email && 'case "password": .email', google && 'case "google.com": .google', apple && 'case "apple.com": .apple', phone && 'case "phone": .phone'].filter(Boolean)
  const idOf = [email && 'case .email: "password"', google && 'case .google: "google.com"', apple && 'case .apple: "apple.com"', phone && 'case .phone: "phone"'].filter(Boolean)
  return `// Firebase implementation of AuthService for iOS (DualCraft auth). Yours after creation: adapt freely.
// SPM: firebase-ios-sdk (FirebaseAuth)${on(google, ', GoogleSignIn-iOS (GoogleSignIn)')}. Enable the providers in Firebase Console → Authentication${on(google, '; add the REVERSED_CLIENT_ID URL scheme and call GIDSignIn.sharedInstance.handle(url) in .onOpenURL')}${on(apple, '; "Sign in with Apple" capability')}.
${on(apple, 'import AuthenticationServices\nimport CryptoKit\n')}import FirebaseAuth
import FirebaseCore
import Foundation
${on(google, 'import GoogleSignIn\n')}import UIKit

final class FirebaseAuthService: AuthService {
    private let api: Api
    private let auth: Auth
    private var current: AuthUser?
${on(mfa(c), '    private var pendingMfa: MultiFactorResolver?\n    private var pendingSmsId: String?\n')}${on(mf(c, 'totp'), '    private var pendingTotp: TOTPSecret?\n')}
    init(api: Api, auth: Auth = Auth.auth()) {
        self.api = api
        self.auth = auth
    }

    var currentUser: AuthUser? { current }

    func authStates() -> AsyncStream<AuthUser?> {
        AsyncStream { continuation in
            let handle = auth.addIDTokenDidChangeListener { [weak self] _, user in
                Task { @MainActor in
                    guard let self else { return }
                    if let user { self.current = try? await self.map(user) } else { self.current = nil }
                    continuation.yield(self.current)
                }
            }
            continuation.onTermination = { [auth] _ in auth.removeIDTokenDidChangeListener(handle) }
        }
    }

    private var user: User {
        get throws {
            guard let u = auth.currentUser else { throw AuthError(code: .unknown, raw: "no_user") }
            return u
        }
    }

    private func map(_ u: User, refresh: Bool = false) async throws -> AuthUser {
        let token = try await u.getIDTokenResult(forcingRefresh: refresh)
        return AuthUser(
            uid: u.uid, email: u.email, phone: u.phoneNumber, displayName: u.displayName, photoUrl: u.photoURL,
            isAnonymous: u.isAnonymous, emailVerified: u.isEmailVerified, role: roleFrom(token.claims["role"]),
            methods: ${on(c.guest, '(u.isAnonymous ? [.guest] : []) + ')}u.providerData.compactMap { methodOf($0.providerID) },
            mfaEnrolled: ${mfa(c) ? '!u.multiFactor.enrolledFactors.isEmpty' : 'false'}
        )
    }

    private func methodOf(_ providerID: String) -> AuthMethod? {
        switch providerID {
        ${[...methodOf, 'default: nil'].join('\n        ')}
        }
    }
${on(c.linking, `
    private func providerID(_ m: AuthMethod) throws -> String {
        switch m {
        ${[...idOf, 'default: throw AuthError(code: .methodDisabled, raw: "not_linkable")'].join('\n        ')}
        }
    }
`)}
    private func signedIn(_ r: AuthDataResult) async throws -> AuthUser {
        let u = try await map(r.user)
        current = u
        return u
    }

    /// Every SDK error becomes an AuthError with a normalized code (texts: AuthErrorCode.key).
    private func guarded<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch let e as AuthError {
            throw e
        } catch {
            let ns = error as NSError
${on(mfa(c), `            if let resolver = ns.userInfo[AuthErrorUserInfoMultiFactorResolverKey] as? MultiFactorResolver {
                pendingMfa = resolver
                if let hint = resolver.hints.first as? PhoneMultiFactorInfo {
                    pendingSmsId = try? await PhoneAuthProvider.provider().verifyPhoneNumber(with: hint, uiDelegate: nil, multiFactorSession: resolver.session)
                }
                throw AuthError(code: .mfaRequired, raw: "second_factor_required")
            }
`)}${on(google, '            if (error as? GIDSignInError)?.code == .canceled { throw AuthError(code: .cancelled, raw: "google_cancelled") }\n')}            let name = ns.userInfo["FIRAuthErrorUserInfoNameKey"] as? String // e.g. ERROR_EMAIL_ALREADY_IN_USE
            throw AuthError(code: authErrorFrom(name), raw: name ?? ns.localizedDescription)
        }
    }
${on(email, `
    func signUpWithEmail(_ email: String, password: String, displayName: String?) async throws -> AuthUser {
        try await guarded {
            let r = try await auth.createUser(withEmail: email, password: password)
            if let displayName {
                let change = r.user.createProfileChangeRequest()
                change.displayName = displayName
                try await change.commitChanges()
            }
            try await r.user.sendEmailVerification()
            return try await signedIn(r)
        }
    }

    func signInWithEmail(_ email: String, password: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await auth.signIn(withEmail: email, password: password)) }
    }

    func sendPasswordReset(_ email: String) async throws {
        try await guarded { try await auth.sendPasswordReset(withEmail: email) }
    }

    func sendEmailVerification() async throws {
        try await guarded { try await user.sendEmailVerification() }
    }
`)}${on(google, `
    private func googleCredential() async throws -> AuthCredential {
        guard let clientID = FirebaseApp.app()?.options.clientID else { throw AuthError(code: .unknown, raw: "no_client_id") }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        guard let presenter = topViewController() else { throw AuthError(code: .unknown, raw: "no_window") }
        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        guard let idToken = result.user.idToken?.tokenString else { throw AuthError(code: .unknown, raw: "no_id_token") }
        return GoogleAuthProvider.credential(withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
    }

    func signInWithGoogle() async throws -> AuthUser {
        try await guarded { try await signedIn(try await auth.signIn(with: try await googleCredential())) }
    }
`)}${on(apple, `
    private func appleCredential() async throws -> AuthCredential {
        let nonce = randomNonce()
        let apple = try await AppleSignInFlow().run(nonce: nonce)
        guard let data = apple.identityToken, let idToken = String(data: data, encoding: .utf8) else { throw AuthError(code: .unknown, raw: "no_id_token") }
        return OAuthProvider.appleCredential(withIDToken: idToken, rawNonce: nonce, fullName: apple.fullName) // Apple sends the name only once
    }

    func signInWithApple() async throws -> AuthUser {
        try await guarded { try await signedIn(try await auth.signIn(with: try await appleCredential())) }
    }
`)}${on(phone, `
    func startPhoneSignIn(_ phone: String) async throws -> String {
        try await guarded { try await PhoneAuthProvider.provider().verifyPhoneNumber(phone, uiDelegate: nil) }
    }

    func confirmPhoneCode(_ verificationId: String, code: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await auth.signIn(with: PhoneAuthProvider.provider().credential(withVerificationID: verificationId, verificationCode: code))) }
    }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
    func signInAsGuest() async throws -> AuthUser {
        try await guarded { try await signedIn(try await auth.signInAnonymously()) }
    }
`)}${on(c.linking && email, `
    func linkEmail(_ email: String, password: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await user.link(with: EmailAuthProvider.credential(withEmail: email, password: password))) }
    }
`)}${on(c.linking && google, `
    func linkGoogle() async throws -> AuthUser {
        try await guarded { try await signedIn(try await user.link(with: try await googleCredential())) }
    }
`)}${on(c.linking && apple, `
    func linkApple() async throws -> AuthUser {
        try await guarded { try await signedIn(try await user.link(with: try await appleCredential())) }
    }
`)}${on(c.linking, `
    func unlink(_ method: AuthMethod) async throws -> AuthUser {
        try await guarded {
            let u = try await map(try await user.unlink(fromProvider: try providerID(method)))
            current = u
            return u
        }
    }
`)}${on(mfa(c), `
    func mfaFactors() async throws -> [MfaFactor] {
        try await guarded { try user.multiFactor.enrolledFactors.map { MfaFactor(id: $0.uid, kind: $0.factorID == PhoneMultiFactorID ? "sms" : "totp", label: $0.displayName) } }
    }

    func completeMfaSignIn(_ code: String) async throws -> AuthUser {
        try await guarded {
            guard let resolver = pendingMfa, let hint = resolver.hints.first else { throw AuthError(code: .codeExpired, raw: "no_pending_mfa") }
            let assertion: MultiFactorAssertion
            if hint is PhoneMultiFactorInfo {
                assertion = PhoneMultiFactorGenerator.assertion(with: PhoneAuthProvider.provider().credential(withVerificationID: pendingSmsId ?? "", verificationCode: code))
            } else {
                ${mf(c, 'totp') ? 'assertion = TOTPMultiFactorGenerator.assertionForSignIn(withEnrollmentID: hint.uid, oneTimePassword: code)' : 'throw AuthError(code: .methodDisabled, raw: "totp")'}
            }
            let result = try await resolver.resolveSignIn(with: assertion)
            pendingMfa = nil
            return try await signedIn(result)
        }
    }

    func unenrollMfa(_ factorId: String) async throws {
        try await guarded { try await user.multiFactor.unenroll(withFactorUID: factorId) }
    }
`)}${on(mf(c, 'totp'), `
    func enrollTotpStart() async throws -> TotpEnrollment {
        try await guarded {
            let u = try user
            let secret = try await TOTPMultiFactorGenerator.generateSecret(with: try await u.multiFactor.session())
            pendingTotp = secret
            return TotpEnrollment(secret: secret.sharedSecretKey(), uri: secret.generateQRCodeURL(withAccountName: u.email ?? u.uid, issuer: ${issuer(c)}))
        }
    }

    func enrollTotpFinish(_ code: String) async throws {
        try await guarded {
            guard let secret = pendingTotp else { throw AuthError(code: .codeExpired, raw: "no_pending_totp") }
            try await user.multiFactor.enroll(with: TOTPMultiFactorGenerator.assertionForEnrollment(with: secret, oneTimePassword: code), displayName: "Authenticator")
            pendingTotp = nil
        }
    }
`)}${on(mf(c, 'sms'), `
    func enrollSmsStart(_ phone: String) async throws -> String {
        try await guarded { try await PhoneAuthProvider.provider().verifyPhoneNumber(phone, uiDelegate: nil, multiFactorSession: try await user.multiFactor.session()) }
    }

    func enrollSmsFinish(_ verificationId: String, code: String) async throws {
        try await guarded {
            let credential = PhoneAuthProvider.provider().credential(withVerificationID: verificationId, verificationCode: code)
            try await user.multiFactor.enroll(with: PhoneMultiFactorGenerator.assertion(with: credential), displayName: "SMS")
        }
    }
`)}
    func reauthenticate(_ password: String?) async throws {
        try await guarded {
            let u = try user
            let providers = u.providerData.map(\\.providerID)
            if let password, let email = u.email, providers.contains("password") {
                _ = try await u.reauthenticate(with: EmailAuthProvider.credential(withEmail: email, password: password))
                return
            }
${on(google, `            if providers.contains("google.com") {
                _ = try await u.reauthenticate(with: try await googleCredential())
                return
            }
`)}${on(apple, `            if providers.contains("apple.com") {
                _ = try await u.reauthenticate(with: try await appleCredential())
                return
            }
`)}            throw AuthError(code: .requiresRecentLogin, raw: "sign_in_again")
        }
    }

    func refreshUser() async throws -> AuthUser? {
        try await guarded {
            guard let u = auth.currentUser else {
                current = nil
                return nil
            }
            try await u.reload()
            let mapped = try await map(auth.currentUser ?? u, refresh: true) // new ID token: new role claim
            current = mapped
            return mapped
        }
    }

    func signOut() async throws {
${on(google, '        GIDSignIn.sharedInstance.signOut()\n')}        try auth.signOut()
        current = nil
    }

    func deleteAccount() async throws {
        try await guarded {
            do {
                _ = try await api.deleteAccount() // server: data cleanup + deletion
            } catch let e as ApiError where e.code == "failed-precondition" {
                throw AuthError(code: .requiresRecentLogin, raw: "requires_recent_login")
            }
            try await signOut()
        }
    }
}
${on(google, presenter)}${on(apple, appleFlow)}`
}

// ---------------------------------------------------------------- supabase-swift
export function swiftSupabase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const methodOf = [email && 'case "email": .email', google && 'case "google": .google', apple && 'case "apple": .apple', phone && 'case "phone": .phone'].filter(Boolean)
  const nameOf = [email && 'case .email: "email"', google && 'case .google: "google"', apple && 'case .apple: "apple"', phone && 'case .phone: "phone"'].filter(Boolean)
  return `// Supabase implementation of AuthService for iOS (supabase-swift) — DualCraft auth. Yours after creation.
// SPM: supabase-swift (Supabase)${on(google, ', GoogleSignIn-iOS (set GIDClientID in Info.plist; add the iOS client id to Supabase → Google → Client IDs)')}.
${on(apple, 'import AuthenticationServices\nimport CryptoKit\n')}import Foundation
${on(google, 'import GoogleSignIn\n')}import Supabase
import UIKit

final class SupabaseAuthService: AuthService {
    private let api: Api
    private let client: SupabaseClient
    private var current: AuthUser?
${on(mfa(c), '    private var pendingMfa: (factorId: String, challengeId: String)?\n')}${on(mf(c, 'totp'), '    private var pendingTotpFactor: String?\n')}
    init(api: Api, client: SupabaseClient) {
        self.api = api
        self.client = client
    }

    var currentUser: AuthUser? { current }

    func authStates() -> AsyncStream<AuthUser?> {
        AsyncStream { continuation in
            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                for await (_, session) in self.client.auth.authStateChanges {
                    self.current = session.map { self.map($0.user) }
                    continuation.yield(self.current)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func map(_ u: User) -> AuthUser {
        let providers = (u.identities ?? []).map(\\.provider)
        return AuthUser(
            uid: u.id.uuidString, email: u.email, phone: (u.phone ?? "").isEmpty ? nil : u.phone,
            displayName: u.userMetadata["display_name"]?.stringValue ?? u.userMetadata["full_name"]?.stringValue,
            photoUrl: u.userMetadata["avatar_url"]?.stringValue.flatMap(URL.init(string:)),
            isAnonymous: u.isAnonymous, emailVerified: u.emailConfirmedAt != nil, role: roleFrom(u.appMetadata["role"]?.stringValue),
            methods: ${on(c.guest, '(u.isAnonymous ? [.guest] : []) + ')}providers.compactMap(methodOf),
            mfaEnrolled: (u.factors ?? []).contains { $0.status == .verified }
        )
    }

    private func methodOf(_ provider: String) -> AuthMethod? {
        switch provider {
        ${[...methodOf, 'default: nil'].join('\n        ')}
        }
    }

    private func signedIn(_ u: User) async throws -> AuthUser {
${on(mfa(c), `        // a second factor is enrolled: the session stays at aal1 until completeMfaSignIn
        let aal = try await client.auth.mfa.getAuthenticatorAssuranceLevel()
        if aal.nextLevel == "aal2" && aal.currentLevel != "aal2", let factor = try await client.auth.mfa.listFactors().all.first(where: { $0.status == .verified }) {
            let challenge = try await client.auth.mfa.challenge(params: MFAChallengeParams(factorId: factor.id)) // SMS factors get the code now
            pendingMfa = (factor.id, challenge.id)
            throw AuthError(code: .mfaRequired, raw: "insufficient_aal")
        }
`)}        let mapped = map(u)
        current = mapped
        return mapped
    }

    /// Every SDK error becomes an AuthError with a normalized code (texts: AuthErrorCode.key).
    private func guarded<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch let e as AuthError {
            throw e
        } catch let e as Auth.AuthError {
            throw AuthError(code: authErrorFrom(e.errorCode.rawValue), raw: e.errorCode.rawValue)
        }${on(google, ` catch let e as GIDSignInError where e.code == .canceled {
            throw AuthError(code: .cancelled, raw: "google_cancelled")
        }`)}
    }
${on(email, `
    func signUpWithEmail(_ email: String, password: String, displayName: String?) async throws -> AuthUser {
        try await guarded {
            let r = try await client.auth.signUp(email: email, password: password, data: displayName.map { ["display_name": .string($0)] })
            let mapped = map(r.user) // no session until the email is confirmed (if confirmation is on)
            current = mapped
            return mapped
        }
    }

    func signInWithEmail(_ email: String, password: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await client.auth.signIn(email: email, password: password).user) }
    }

    func sendPasswordReset(_ email: String) async throws {
        try await guarded { try await client.auth.resetPasswordForEmail(email) }
    }

    func sendEmailVerification() async throws {
        try await guarded { try await client.auth.resend(email: try await client.auth.user().email ?? "", type: .signup) }
    }
`)}${on(google, `
    func signInWithGoogle() async throws -> AuthUser {
        try await guarded {
            guard let presenter = topViewController() else { throw AuthError(code: .unknown, raw: "no_window") }
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let idToken = result.user.idToken?.tokenString else { throw AuthError(code: .unknown, raw: "no_id_token") }
            let session = try await client.auth.signInWithIdToken(credentials: OpenIDConnectCredentials(provider: .google, idToken: idToken, accessToken: result.user.accessToken.tokenString))
            return try await signedIn(session.user)
        }
    }
`)}${on(apple, `
    func signInWithApple() async throws -> AuthUser {
        try await guarded {
            let nonce = randomNonce()
            let apple = try await AppleSignInFlow().run(nonce: nonce)
            guard let data = apple.identityToken, let idToken = String(data: data, encoding: .utf8) else { throw AuthError(code: .unknown, raw: "no_id_token") }
            let session = try await client.auth.signInWithIdToken(credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce))
            let name = [apple.fullName?.givenName, apple.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
            if !name.isEmpty { _ = try? await client.auth.update(user: UserAttributes(data: ["full_name": .string(name)])) } // Apple sends it only once
            return try await signedIn(session.user)
        }
    }
`)}${on(phone, `
    /// The "verification id" is the phone number itself (Supabase verifies phone + code).
    func startPhoneSignIn(_ phone: String) async throws -> String {
        try await guarded {
            try await client.auth.signInWithOTP(phone: phone)
            return phone
        }
    }

    func confirmPhoneCode(_ verificationId: String, code: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await client.auth.verifyOTP(phone: verificationId, token: code, type: .sms).user) }
    }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
    func signInAsGuest() async throws -> AuthUser {
        try await guarded { try await signedIn(try await client.auth.signInAnonymously().user) }
    }
`)}${on(c.linking && email, `
    /// Turns the guest (anonymous) account into an email account: same id, same data. Sends a confirmation email.
    func linkEmail(_ email: String, password: String) async throws -> AuthUser {
        try await guarded { try await signedIn(try await client.auth.update(user: UserAttributes(email: email, password: password))) }
    }
`)}${on(c.linking && google, `
    func linkGoogle() async throws -> AuthUser {
        try await guarded {
            try await client.auth.linkIdentity(provider: .google) // OAuth flow in the browser
            return try await signedIn(try await client.auth.user())
        }
    }
`)}${on(c.linking && apple, `
    func linkApple() async throws -> AuthUser {
        try await guarded {
            try await client.auth.linkIdentity(provider: .apple)
            return try await signedIn(try await client.auth.user())
        }
    }
`)}${on(c.linking, `
    func unlink(_ method: AuthMethod) async throws -> AuthUser {
        try await guarded {
            let name: String
            switch method {
            ${[...nameOf, 'default: throw AuthError(code: .methodDisabled, raw: "not_linkable")'].join('\n            ')}
            }
            guard let identity = try await client.auth.userIdentities().first(where: { $0.provider == name }) else { throw AuthError(code: .unknown, raw: "not_linked") }
            try await client.auth.unlinkIdentity(identity)
            return try await signedIn(try await client.auth.refreshSession().user)
        }
    }
`)}${on(mfa(c), `
    func mfaFactors() async throws -> [MfaFactor] {
        try await guarded { try await client.auth.mfa.listFactors().all.filter { $0.status == .verified }.map { MfaFactor(id: $0.id, kind: $0.factorType == "phone" ? "sms" : "totp", label: $0.friendlyName) } }
    }

    func completeMfaSignIn(_ code: String) async throws -> AuthUser {
        try await guarded {
            guard let p = pendingMfa else { throw AuthError(code: .codeExpired, raw: "no_pending_mfa") }
            _ = try await client.auth.mfa.verify(params: MFAVerifyParams(factorId: p.factorId, challengeId: p.challengeId, code: code))
            pendingMfa = nil
            let mapped = map(try await client.auth.user())
            current = mapped
            return mapped
        }
    }

    func unenrollMfa(_ factorId: String) async throws {
        try await guarded { _ = try await client.auth.mfa.unenroll(params: MFAUnenrollParams(factorId: factorId)) }
    }
`)}${on(mf(c, 'totp'), `
    func enrollTotpStart() async throws -> TotpEnrollment {
        try await guarded {
            let r = try await client.auth.mfa.enroll(params: MFATotpEnrollParams(issuer: ${issuer(c)}))
            pendingTotpFactor = r.id
            guard let totp = r.totp else { throw AuthError(code: .unknown, raw: "no_totp") }
            return TotpEnrollment(secret: totp.secret, uri: totp.uri)
        }
    }

    func enrollTotpFinish(_ code: String) async throws {
        try await guarded {
            guard let id = pendingTotpFactor else { throw AuthError(code: .codeExpired, raw: "no_pending_totp") }
            _ = try await client.auth.mfa.challengeAndVerify(params: MFAChallengeAndVerifyParams(factorId: id, code: code))
            pendingTotpFactor = nil
        }
    }
`)}${on(mf(c, 'sms'), `
    /// Returns "factorId:challengeId" — pass it back to enrollSmsFinish.
    func enrollSmsStart(_ phone: String) async throws -> String {
        try await guarded {
            let r = try await client.auth.mfa.enroll(params: MFAPhoneEnrollParams(phone: phone))
            let challenge = try await client.auth.mfa.challenge(params: MFAChallengeParams(factorId: r.id))
            return r.id + ":" + challenge.id
        }
    }

    func enrollSmsFinish(_ verificationId: String, code: String) async throws {
        try await guarded {
            let parts = verificationId.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { throw AuthError(code: .invalidCode, raw: "bad_verification_id") }
            _ = try await client.auth.mfa.verify(params: MFAVerifyParams(factorId: parts[0], challengeId: parts[1], code: code))
        }
    }
`)}
    /// Deletion checks that the last sign-in is recent: signing in again refreshes it.
    func reauthenticate(_ password: String?) async throws {
        try await guarded {
            let u = try await client.auth.user()
            let providers = (u.identities ?? []).map(\\.provider)
            if let password, let email = u.email, providers.contains("email") {
                _ = try await client.auth.signIn(email: email, password: password)
                return
            }
${on(google, `            if providers.contains("google") {
                _ = try await signInWithGoogle()
                return
            }
`)}${on(apple, `            if providers.contains("apple") {
                _ = try await signInWithApple()
                return
            }
`)}            throw AuthError(code: .requiresRecentLogin, raw: "sign_in_again")
        }
    }

    func refreshUser() async throws -> AuthUser? {
        try await guarded {
            guard client.auth.currentSession != nil else {
                current = nil
                return nil
            }
            let mapped = map(try await client.auth.refreshSession().user) // new JWT = new app_metadata.role
            current = mapped
            return mapped
        }
    }

    func signOut() async throws {
${on(google, '        GIDSignIn.sharedInstance.signOut()\n')}        try await client.auth.signOut()
        current = nil
    }

    func deleteAccount() async throws {
        try await guarded {
            do {
                _ = try await api.deleteAccount() // Edge Function: data cleanup + deletion
            } catch let e as ApiError where e.code == "failed-precondition" {
                throw AuthError(code: .requiresRecentLogin, raw: "requires_recent_login")
            }
            try await signOut()
        }
    }
}
${on(google, presenter)}${on(apple, appleFlow)}`
}
