// Auth screens for SwiftUI (iOS 17+): AuthFlowView, AccountView and authRedirect().
import { features } from './auth-screens.mjs'

const on = (cond, s) => (cond ? s : '')
const pascal = (s) => s[0].toUpperCase() + s.slice(1)

export function swiftScreens(c) {
  const F = features(c)
  const L = (k) => `L("auth.ui.${k}")`
  const social = [F.google && ['signInWithGoogle', 'continue_google'], F.apple && ['signInWithApple', 'continue_apple'], F.passkey && ['signInWithPasskey', 'continue_passkey']].filter(Boolean)
  return `// Auth screens (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// AuthFlowView: sign in / sign up / forgot password / phone / second factor / verify email. AccountView: methods,
// linking, second factor, passkey, sign out, delete account. authRedirect(): decideAccess() as a redirect.
// Texts: DualCraft.xcstrings (table "DualCraft"). Colors: the app tint and system styles (set .tint from DsColor).
import SwiftUI

/// Localized text from the shared i18n (String Catalog table "DualCraft").
func L(_ key: String, _ args: CVarArg...) -> String {
    let s = String(localized: String.LocalizationValue(key), table: "DualCraft")
    return args.isEmpty ? s : String(format: s, arguments: args)
}
func authErrorText(_ error: Error) -> String { L((error as? AuthError)?.code.key ?? AuthErrorCode.unknown.key) }
private func passwordProblemText(_ p: PasswordProblem) -> String {
    switch p {
    case .tooShort: return L("auth.password.too_short", String(PasswordPolicy.minLength))
    case .noUpper: return L("auth.password.no_upper")
    case .noDigit: return L("auth.password.no_digit")
    case .noSymbol: return L("auth.password.no_symbol")
    }
}
private func methodText(_ m: AuthMethod) -> String { ${F.guest ? 'm == .guest ? L("auth.ui.continue_guest") : ' : ''}L("auth.ui.method_" + m.rawValue) }

/// Where to send \`location\` for \`user\` (nil = stay): navigate there when the user changes.
func authRedirect(_ location: String, user: AuthUser?) -> String? {
    let comps = URLComponents(string: location)
    let path = comps?.path ?? location
    switch decideAccess(path, user: user) {
    case .allow:
        guard let user, !user.isAnonymous, path == AuthRoutes.signIn else { return nil }
        return comps?.queryItems?.first(where: { $0.name == "next" })?.value ?? AuthRoutes.afterSignIn
    case .signIn:
        guard path != AuthRoutes.signIn else { return nil }
        var c = URLComponents()
        c.path = AuthRoutes.signIn
        c.queryItems = [URLQueryItem(name: "next", value: location)]
        return c.string
    case .verifyEmail: return path == AuthRoutes.verifyEmail ? nil : AuthRoutes.verifyEmail
    case .forbidden: return path == AuthRoutes.afterSignIn ? nil : AuthRoutes.afterSignIn
    }
}

enum AuthStep { case signIn, signUp, forgot, phone, mfa, verifyEmail }

/// The whole sign-in flow; \`onSignedIn\` runs when the user is in (and verified, if required).
struct AuthFlowView: View {
    let service: any AuthService
    var initialStep: AuthStep = .signIn
    let onSignedIn: (AuthUser) -> Void

    @State private var step: AuthStep?
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var phone = ""
    @State private var code = ""
    @State private var verificationId: String?
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    private var current: AuthStep { step ?? initialStep }
    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespaces) }

    private func go(_ s: AuthStep) { step = s; error = nil; info = nil; code = "" }
    private func done(_ u: AuthUser) {
        if ${F.verifyRequired} && u.email != nil && !u.emailVerified && !u.isAnonymous { go(.verifyEmail) } else { onSignedIn(u) }
    }
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            busy = true; error = nil; info = nil
            defer { busy = false }
            do { try await action() } catch let e as AuthError {
                switch e.code {
                case .mfaRequired: go(.mfa)
                case .emailNotVerified: go(.verifyEmail)
                case .cancelled: break
                default: error = authErrorText(e)
                }
            } catch { self.error = authErrorText(error) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                switch current {
                case .signIn: signIn
                case .signUp: signUp
                case .forgot: forgot
                case .phone: phoneStep
                case .mfa: mfa
                case .verifyEmail: verify
                }
                if busy { ProgressView() }
                if let error { Text(error).foregroundStyle(.red).multilineTextAlignment(.center) }
                if let info { Text(info).foregroundStyle(.secondary).multilineTextAlignment(.center) }
            }
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .disabled(busy)
    }

    private func title(_ key: String) -> some View {
        Text(L(key)).font(.title2.weight(.semibold)).multilineTextAlignment(.center).padding(.bottom, 12).accessibilityAddTraits(.isHeader)
    }
    private func primary(_ key: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(L(key)).frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).controlSize(.large)
    }
    private func secondary(_ key: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(L(key)).frame(maxWidth: .infinity) }.buttonStyle(.bordered).controlSize(.large)
    }

    @ViewBuilder private var signIn: some View {
        title("auth.ui.sign_in_title")
${on(F.email, `        TextField(${L('email')}, text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        SecureField(${L('password')}, text: $password).textContentType(.password)
        Button(${L('forgot')}) { go(.forgot) }.frame(maxWidth: .infinity, alignment: .trailing)
        primary("auth.ui.sign_in") { run { done(try await service.signInWithEmail(trimmed(email), password: password)) } }
        Button(${L('no_account')}) { go(.signUp) }
`)}${on(social.length || F.phone, `${on(F.email, `        Text(${L('or')}).foregroundStyle(.secondary)\n`)}${social.map(([fn, k]) => `        secondary("auth.ui.${k}") { run { done(try await service.${fn}()) } }`).join('\n')}
${on(F.phone, `        secondary("auth.ui.continue_phone") { go(.phone) }\n`)}`)}${on(F.guest, `        Button(${L('continue_guest')}) { run { onSignedIn(try await service.signInAsGuest()) } }\n`)}    }

    @ViewBuilder private var signUp: some View {
        title("auth.ui.sign_up_title")
${on(F.email, `        let problems = password.isEmpty ? [] : passwordProblems(password)
        TextField(${L('display_name')}, text: $name).textContentType(.name)
        TextField(${L('email')}, text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        SecureField(${L('password')}, text: $password).textContentType(.newPassword)
        ForEach(Array(problems.enumerated()), id: \\.offset) { _, p in
            Text("• " + passwordProblemText(p)).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
        }
        primary("auth.ui.sign_up") {
            let n = trimmed(name)
            run { done(try await service.signUpWithEmail(trimmed(email), password: password, displayName: n.isEmpty ? nil : n)) }
        }.disabled(!problems.isEmpty)
`)}        Button(${L('have_account')}) { go(.signIn) }
    }

    @ViewBuilder private var forgot: some View {
        title("auth.ui.forgot_title")
${on(F.email, `        TextField(${L('email')}, text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        primary("auth.ui.send_reset") {
            let e = trimmed(email)
            run { try await service.sendPasswordReset(e); info = L("auth.ui.reset_sent", e) }
        }
`)}        Button(${L('back')}) { go(.signIn) }
    }

    @ViewBuilder private var phoneStep: some View {
        title("auth.ui.continue_phone")
${on(F.phone, `        if let vid = verificationId {
            TextField(${L('code')}, text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad)
            primary("auth.ui.verify") { run { done(try await service.confirmPhoneCode(vid, code: trimmed(code))) } }
        } else {
            TextField(${L('phone')}, text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            primary("auth.ui.send_code") { run { verificationId = try await service.startPhoneSignIn(trimmed(phone)) } }
        }
`)}        Button(${L('back')}) { verificationId = nil; go(.signIn) }
    }

    @ViewBuilder private var mfa: some View {
        title("auth.ui.mfa_title")
        Text(${L('mfa_hint')}).multilineTextAlignment(.center).foregroundStyle(.secondary)
${on(F.mfa, `        TextField(${L('code')}, text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad)
        primary("auth.ui.verify") { run { done(try await service.completeMfaSignIn(trimmed(code))) } }
`)}        Button(${L('back')}) { go(.signIn) }
    }

    @ViewBuilder private var verify: some View {
        title("auth.ui.verify_email_title")
        Text(L("auth.ui.verify_email_body", service.currentUser?.email ?? email)).multilineTextAlignment(.center)
${on(F.email, `        secondary("auth.ui.resend") { run { try await service.sendEmailVerification(); info = ${L('email_sent')} } }\n`)}        primary("auth.ui.i_verified") {
            run {
                if let u = try await service.refreshUser(), u.emailVerified { onSignedIn(u) } else { info = ${L('not_verified_yet')} }
            }
        }
        Button(${L('sign_out')}) { run { try await service.signOut(); go(.signIn) } }
    }
}

private struct Ask: Identifiable {
    let id = UUID()
    let title: String
    var label: String? = nil
    var secure = false
    var message: String? = nil
    var danger = false
    let answer: (String?) -> Void
}

/// Account: who is signed in, sign-in methods${on(F.linking, ' and linking')}${on(F.mfa, ', second factor')}${on(F.passkey, ', passkey')}, sign out and account deletion.
struct AccountView: View {
    let service: any AuthService
    let onSignedOut: () -> Void

    @State private var user: AuthUser?
    @State private var busy = false
    @State private var notice: String?
    @State private var asking: Ask?
    @State private var answerText = ""
${on(F.mfa, `    @State private var factors: [MfaFactor] = []\n`)}
    private func ask(_ title: String, label: String? = nil, secure: Bool = false, message: String? = nil, danger: Bool = false) async -> String? {
        await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            answerText = ""
            asking = Ask(title: title, label: label, secure: secure, message: message, danger: danger) { cont.resume(returning: $0) }
        }
    }
    private func run(done: String? = nil, _ action: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            busy = true; notice = nil
            defer { busy = false }
            do {
                try await action()
                if let done { notice = done }
            } catch let e as AuthError {
                if e.code != .cancelled { notice = authErrorText(e) }
            } catch { notice = authErrorText(error) }
        }
    }
    /// Runs action; on requiresRecentLogin re-authenticates (password, or the provider again) and retries.
    private func sensitive(_ action: @MainActor () async throws -> Void) async throws {
        do { try await action() } catch let e as AuthError where e.code == .requiresRecentLogin {
            var password: String?
            if service.currentUser?.methods.contains(.email) == true {
                guard let p = await ask(${L('reauth_title')}, label: ${L('password')}, secure: true, message: ${L('reauth_body')}) else { return }
                password = p
            }
            try await service.reauthenticate(password)
            try await action()
        }
    }
${on(F.mfa, `    private func reloadFactors() async { factors = (try? await service.mfaFactors()) ?? [] }\n`)}
    var body: some View {
        List {
            if let u = user {
                Section {
                    LabeledContent(u.displayName ?? u.email ?? u.phone ?? "", value: u.role.rawValue)
${on(F.guest && F.linking, `                    if u.isAnonymous { Text(${L('guest_banner')}).foregroundStyle(.secondary) }\n`)}${on(F.email, `                    if u.email != nil && !u.emailVerified {
                        HStack {
                            Text(${L('verify_banner')})
                            Spacer()
                            Button(${L('resend')}) { run(done: ${L('email_sent')}) { try await service.sendEmailVerification() } }
                        }
                    }
`)}                }
${on(F.linkable.length, `                Section(${L('methods_title')}) {
                    ForEach([${F.linkable.map((m) => 'AuthMethod.' + m).join(', ')}], id: \\.self) { m in
                        HStack {
                            Text(methodText(m))
                            Spacer()
                            if u.methods.contains(m) {
                                if u.methods.count > 1 {
                                    Button(${L('unlink')}) { run { _ = try await service.unlink(m) } }
                                } else {
                                    Text(${L('linked')}).foregroundStyle(.secondary)
                                }
                            } else {
                                Button(${L('link')}) { run { try await link(m) } }
                            }
                        }
                    }
                }
`)}${on(F.mfa, `                Section(${L('mfa_section')}) {
                    if factors.isEmpty { Text(${L('mfa_none')}).foregroundStyle(.secondary) }
                    ForEach(factors, id: \\.id) { f in
                        HStack {
                            Text(f.label ?? f.kind)
                            Spacer()
                            Button(${L('mfa_remove')}, role: .destructive) { run { try await sensitive { try await service.unenrollMfa(f.id) }; await reloadFactors() } }
                        }
                    }
${on(F.totp, `                    Button(${L('mfa_add_totp')}) {
                        run {
                            let e = try await service.enrollTotpStart()
                            guard let code = await ask(${L('mfa_add_totp')}, label: ${L('code')}, message: L("auth.ui.mfa_secret", e.secret)) else { return }
                            try await service.enrollTotpFinish(code)
                            await reloadFactors()
                        }
                    }
`)}${on(F.sms, `                    Button(${L('mfa_add_sms')}) {
                        run {
                            guard let phone = await ask(${L('mfa_add_sms')}, label: ${L('phone')}) else { return }
                            let id = try await service.enrollSmsStart(phone)
                            guard let code = await ask(${L('mfa_add_sms')}, label: ${L('code')}) else { return }
                            try await service.enrollSmsFinish(id, code: code)
                            await reloadFactors()
                        }
                    }
`)}                }
`)}                Section {
${on(F.passkey, `                    Button(${L('passkey_add')}) { run(done: ${L('passkey_added')}) { try await service.registerPasskey() } }\n`)}                    Button(${L('sign_out')}) { run { try await service.signOut(); onSignedOut() } }
                    Button(${L('delete_account')}, role: .destructive) {
                        run {
                            guard await ask(${L('delete_title')}, message: ${L('delete_body')}, danger: true) != nil else { return }
                            try await sensitive { try await service.deleteAccount(); onSignedOut() }
                        }
                    }
                }
                if let notice { Text(notice).foregroundStyle(.secondary) }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(${L('account_title')})
        .disabled(busy)
        .task {
            user = service.currentUser
            for await u in service.authStates() {
                user = u
${on(F.mfa, `                if let u, !u.isAnonymous { await reloadFactors() }\n`)}            }
        }
        .alert(asking?.title ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0, let a = asking { asking = nil; a.answer(nil) } }), presenting: asking) { a in
            if let label = a.label {
                if a.secure { SecureField(label, text: $answerText) } else { TextField(label, text: $answerText) }
            }
            Button(${L('cancel')}, role: .cancel) { asking = nil; a.answer(nil) }
            Button(a.danger ? ${L('delete_confirm')} : ${L('confirm')}, role: a.danger ? .destructive : nil) {
                let v = answerText.trimmingCharacters(in: .whitespaces)
                asking = nil
                a.answer(a.label == nil ? "" : v)
            }
        } message: { a in
            if let m = a.message { Text(m) }
        }
    }
${on(F.linkable.length, `
    private func link(_ m: AuthMethod) async throws {
        switch m {
${F.linkable.map((m) => m === 'email' ? `        case .email:
            guard let e = await ask(${L('method_email')}, label: ${L('email')}) else { return }
            guard let p = await ask(${L('method_email')}, label: ${L('password')}, secure: true) else { return }
            _ = try await service.linkEmail(e, password: p)` : `        case .${m}: _ = try await service.link${pascal(m)}()`).join('\n')}
        default: break
        }
    }
`)}}
`
}
