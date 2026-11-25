// TypeScript AuthService implementations (DualCraft auth): web with the Firebase modular SDK, and supabase-js for the
// web or React Native (native Google/Apple sign-in through ID tokens). Written once; the developer owns them afterwards.
const on = (cond, text) => (cond ? text : '')
const has = (c, m) => c.methods.includes(m)
const mfa = (c) => (c.mfa?.factors || []).length > 0
const mf = (c, f) => (c.mfa?.factors || []).includes(f)
const issuer = (c) => JSON.stringify(c.passkey?.rpName || 'App')
const passkeyStubs = `
  // Passkeys: implemented by the passkey step of the auth pack (auth.mjs).
  signInWithPasskey(): Promise<AuthUser> {
    return Promise.reject(new AuthError('methodDisabled', 'passkeys_not_set_up'))
  }

  registerPasskey(): Promise<void> {
    return Promise.reject(new AuthError('methodDisabled', 'passkeys_not_set_up'))
  }
`
const deleteAccount = `
  deleteAccount(): Promise<void> {
    return this.guard(async () => {
      try {
        await this.api.deleteAccount() // server: data cleanup + deletion
      } catch (e) {
        if (e instanceof ApiError && e.code === 'failed-precondition') throw new AuthError('requiresRecentLogin', 'requires_recent_login')
        throw e
      }
      await this.signOut()
    })
  }
}
`

// ---------------------------------------------------------------- Web + Firebase (modular JS SDK)
export function tsFirebase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email'), sms = mf(c, 'sms') || phone
  const methodOf = [email && "password: 'email'", google && "'google.com': 'google'", apple && "'apple.com': 'apple'", phone && "phone: 'phone'"].filter(Boolean)
  const idOf = [email && "email: 'password'", google && "google: 'google.com'", apple && "apple: 'apple.com'", phone && "phone: 'phone'"].filter(Boolean)
  const imports = ['getAuth', 'onIdTokenChanged', 'signOut', 'reauthenticateWithCredential', 'EmailAuthProvider', 'type Auth', 'type User', 'type UserCredential',
    ...(email ? ['createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'sendPasswordResetEmail', 'sendEmailVerification', 'updateProfile'] : []),
    ...(google ? ['GoogleAuthProvider'] : []), ...(apple ? ['OAuthProvider'] : []), ...(google || apple ? ['signInWithPopup', 'reauthenticateWithPopup'] : []),
    ...(sms ? ['RecaptchaVerifier', 'PhoneAuthProvider'] : []), ...(phone ? ['signInWithPhoneNumber', 'type ConfirmationResult'] : []),
    ...(c.guest ? ['signInAnonymously'] : []), ...(c.linking ? ['linkWithCredential', 'unlink'] : []), ...(c.linking && (google || apple) ? ['linkWithPopup'] : []),
    ...(mfa(c) ? ['multiFactor', 'getMultiFactorResolver', 'PhoneMultiFactorGenerator', 'type MultiFactorError', 'type MultiFactorResolver', 'type MultiFactorAssertion'] : []),
    ...(mf(c, 'totp') ? ['TotpMultiFactorGenerator', 'type TotpSecret'] : [])]
  return `// Firebase implementation of AuthService for the web (DualCraft auth). Yours after creation: adapt freely.
// npm i firebase · enable the providers in Firebase Console → Authentication${on(sms, ' · SMS needs an element with id "recaptcha-container" (invisible reCAPTCHA)')}.
import { FirebaseError } from 'firebase/app'
import { ${[...new Set(imports)].join(', ')} } from 'firebase/auth'
import { ApiError, type Api } from './api-client'
import { AuthError, authErrorFrom, roleFrom, type AuthMethod, type AuthService, type AuthUser${on(mfa(c), ', type MfaFactor')}${on(mf(c, 'totp'), ', type TotpEnrollment')} } from './auth-catalog'

const METHOD_OF: Record<string, AuthMethod> = { ${methodOf.join(', ')} }
${on(c.linking, `const PROVIDER_ID: Partial<Record<AuthMethod, string>> = { ${idOf.join(', ')} }\n`)}
export class FirebaseAuthService implements AuthService {
  private current: AuthUser | null = null
${on(mfa(c), '  private pendingMfa: MultiFactorResolver | null = null\n  private pendingSmsId: string | null = null\n')}${on(mf(c, 'totp'), '  private pendingTotp: TotpSecret | null = null\n')}${on(phone, '  private confirmation: ConfirmationResult | null = null\n')}${on(sms, '  private verifier: RecaptchaVerifier | null = null\n')}
  constructor(private readonly api: Api, private readonly auth: Auth = getAuth()${on(sms, ", private readonly recaptchaContainer = 'recaptcha-container'")}) {}

  get currentUser(): AuthUser | null {
    return this.current
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    return onIdTokenChanged(this.auth, async (u) => {
      this.current = u ? await this.map(u) : null
      listener(this.current)
    })
  }

  private get user(): User {
    const u = this.auth.currentUser
    if (!u) throw new AuthError('unknown', 'no_user')
    return u
  }

  private async map(u: User, refresh = false): Promise<AuthUser> {
    const token = await u.getIdTokenResult(refresh)
    const methods: AuthMethod[] = [${on(c.guest, "...(u.isAnonymous ? (['guest'] as const) : []), ")}...u.providerData.map((p) => METHOD_OF[p.providerId]).filter((m): m is AuthMethod => !!m)]
    return { uid: u.uid, email: u.email, phone: u.phoneNumber, displayName: u.displayName, photoUrl: u.photoURL, isAnonymous: u.isAnonymous, emailVerified: u.emailVerified, role: roleFrom(token.claims.role), methods, mfaEnrolled: ${mfa(c) ? 'multiFactor(u).enrolledFactors.length > 0' : 'false'} }
  }

  private async signedIn(c: UserCredential): Promise<AuthUser> {
    this.current = await this.map(c.user)
    return this.current
  }
${on(sms, `
  private recaptcha(): RecaptchaVerifier {
    this.verifier ??= new RecaptchaVerifier(this.auth, this.recaptchaContainer, { size: 'invisible' })
    return this.verifier
  }
`)}
  /** Every SDK error becomes an AuthError with a normalized code (texts: authErrorKey(code)). */
  private async guard<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body()
    } catch (e) {
      if (e instanceof AuthError) throw e
      if (e instanceof FirebaseError) {
${on(mfa(c), `        if (e.code === 'auth/multi-factor-auth-required') {
          const resolver = getMultiFactorResolver(this.auth, e as MultiFactorError)
          this.pendingMfa = resolver
          const hint = resolver.hints[0]
          if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) this.pendingSmsId = await new PhoneAuthProvider(this.auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, this.recaptcha())
          throw new AuthError('mfaRequired', e.code)
        }
`)}        throw new AuthError(authErrorFrom(e.code), e.code)
      }
      throw new AuthError('unknown', String(e))
    }
  }
${on(email, `
  signUpWithEmail(email: string, password: string, displayName?: string | null): Promise<AuthUser> {
    return this.guard(async () => {
      const c = await createUserWithEmailAndPassword(this.auth, email, password)
      if (displayName) await updateProfile(c.user, { displayName })
      await sendEmailVerification(c.user)
      return this.signedIn(c)
    })
  }

  signInWithEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithEmailAndPassword(this.auth, email, password)))
  }

  sendPasswordReset(email: string): Promise<void> {
    return this.guard(() => sendPasswordResetEmail(this.auth, email))
  }

  sendEmailVerification(): Promise<void> {
    return this.guard(() => sendEmailVerification(this.user))
  }
`)}${on(google, `
  signInWithGoogle(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithPopup(this.auth, new GoogleAuthProvider())))
  }
`)}${on(apple, `
  private appleProvider(): OAuthProvider {
    const p = new OAuthProvider('apple.com')
    p.addScope('email')
    p.addScope('name')
    return p
  }

  signInWithApple(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithPopup(this.auth, this.appleProvider())))
  }
`)}${on(phone, `
  startPhoneSignIn(phone: string): Promise<string> {
    return this.guard(async () => {
      this.confirmation = await signInWithPhoneNumber(this.auth, phone, this.recaptcha())
      return this.confirmation.verificationId
    })
  }

  confirmPhoneCode(_verificationId: string, code: string): Promise<AuthUser> {
    return this.guard(async () => {
      if (!this.confirmation) throw new AuthError('codeExpired', 'no_pending_code')
      return this.signedIn(await this.confirmation.confirm(code))
    })
  }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
  signInAsGuest(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInAnonymously(this.auth)))
  }
`)}${on(c.linking && email, `
  linkEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithCredential(this.user, EmailAuthProvider.credential(email, password))))
  }
`)}${on(c.linking && google, `
  linkGoogle(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithPopup(this.user, new GoogleAuthProvider())))
  }
`)}${on(c.linking && apple, `
  linkApple(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithPopup(this.user, this.appleProvider())))
  }
`)}${on(c.linking, `
  unlink(method: AuthMethod): Promise<AuthUser> {
    return this.guard(async () => {
      const id = PROVIDER_ID[method]
      if (!id) throw new AuthError('methodDisabled', 'not_linkable')
      this.current = await this.map(await unlink(this.user, id))
      return this.current
    })
  }
`)}${on(mfa(c), `
  mfaFactors(): Promise<MfaFactor[]> {
    return this.guard(async () => multiFactor(this.user).enrolledFactors.map((f) => ({ id: f.uid, kind: f.factorId === 'phone' ? ('sms' as const) : ('totp' as const), label: f.displayName ?? null })))
  }

  completeMfaSignIn(code: string): Promise<AuthUser> {
    return this.guard(async () => {
      const resolver = this.pendingMfa
      if (!resolver) throw new AuthError('codeExpired', 'no_pending_mfa')
      const hint = resolver.hints[0]
      let assertion: MultiFactorAssertion
      if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) assertion = PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(this.pendingSmsId ?? '', code))
      else ${mf(c, 'totp') ? 'assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code)' : "throw new AuthError('methodDisabled', 'totp')"}
      const result = await resolver.resolveSignIn(assertion)
      this.pendingMfa = null
      return this.signedIn(result)
    })
  }

  unenrollMfa(factorId: string): Promise<void> {
    return this.guard(() => multiFactor(this.user).unenroll(factorId))
  }
`)}${on(mf(c, 'totp'), `
  enrollTotpStart(): Promise<TotpEnrollment> {
    return this.guard(async () => {
      const secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(this.user).getSession())
      this.pendingTotp = secret
      return { secret: secret.secretKey, uri: secret.generateQrCodeUrl(this.user.email ?? this.user.uid, ${issuer(c)}) }
    })
  }

  enrollTotpFinish(code: string): Promise<void> {
    return this.guard(async () => {
      if (!this.pendingTotp) throw new AuthError('codeExpired', 'no_pending_totp')
      await multiFactor(this.user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(this.pendingTotp, code), 'Authenticator')
      this.pendingTotp = null
    })
  }
`)}${on(mf(c, 'sms'), `
  enrollSmsStart(phone: string): Promise<string> {
    return this.guard(async () => new PhoneAuthProvider(this.auth).verifyPhoneNumber({ phoneNumber: phone, session: await multiFactor(this.user).getSession() }, this.recaptcha()))
  }

  enrollSmsFinish(verificationId: string, code: string): Promise<void> {
    return this.guard(() => multiFactor(this.user).enroll(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code)), 'SMS'))
  }
`)}
  reauthenticate(password?: string | null): Promise<void> {
    return this.guard(async () => {
      const u = this.user
      const providers = u.providerData.map((p) => p.providerId)
      if (password && u.email && providers.includes('password')) {
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password))
        return
      }
${on(google, `      if (providers.includes('google.com')) {
        await reauthenticateWithPopup(u, new GoogleAuthProvider())
        return
      }
`)}${on(apple, `      if (providers.includes('apple.com')) {
        await reauthenticateWithPopup(u, this.appleProvider())
        return
      }
`)}      throw new AuthError('requiresRecentLogin', 'sign_in_again')
    })
  }

  refreshUser(): Promise<AuthUser | null> {
    return this.guard(async () => {
      const u = this.auth.currentUser
      if (!u) return (this.current = null)
      await u.reload()
      this.current = await this.map(u, true) // forces a new ID token: new role claim
      return this.current
    })
  }

  async signOut(): Promise<void> {
    await signOut(this.auth)
    this.current = null
  }
${deleteAccount}`
}

// ---------------------------------------------------------------- React Native + Firebase (@react-native-firebase, modular API)
export function rnFirebase(c) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const methodOf = [email && "password: 'email'", google && "'google.com': 'google'", apple && "'apple.com': 'apple'", phone && "phone: 'phone'"].filter(Boolean)
  const idOf = [email && "email: 'password'", google && "google: 'google.com'", apple && "apple: 'apple.com'", phone && "phone: 'phone'"].filter(Boolean)
  const imports = ['getAuth', 'onIdTokenChanged', 'getIdTokenResult', 'reload', 'signOut', 'signInWithCredential', 'reauthenticateWithCredential', 'EmailAuthProvider', 'type FirebaseAuthTypes',
    ...(email ? ['createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'sendPasswordResetEmail', 'sendEmailVerification', 'updateProfile'] : []),
    ...(google ? ['GoogleAuthProvider'] : []), ...(apple ? ['AppleAuthProvider'] : []), ...(phone ? ['signInWithPhoneNumber'] : []),
    ...(c.guest ? ['signInAnonymously'] : []), ...(c.linking ? ['linkWithCredential', 'unlink'] : []),
    ...(mfa(c) ? ['multiFactor', 'getMultiFactorResolver', 'PhoneAuthProvider', 'PhoneMultiFactorGenerator'] : [])]
  return `// Firebase implementation of AuthService for React Native (@react-native-firebase/auth, modular API) — DualCraft auth.
// Yours after creation. npm i @react-native-firebase/app @react-native-firebase/auth${on(google, ' @react-native-google-signin/google-signin')}${on(apple, ' expo-apple-authentication expo-crypto')}
// Note: @react-native-firebase has no TOTP second factor yet — SMS is the available factor on React Native.
import { ${[...new Set(imports)].join(', ')} } from '@react-native-firebase/auth'
${on(google, "import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin'\n")}${on(apple, "import * as AppleAuthentication from 'expo-apple-authentication'\nimport * as Crypto from 'expo-crypto'\n")}import { ApiError, type Api } from './api-client'
import { AuthError, authErrorFrom, roleFrom, type AuthMethod, type AuthService, type AuthUser${on(mfa(c), ', type MfaFactor')}${on(mf(c, 'totp'), ', type TotpEnrollment')} } from './auth-catalog'

type User = FirebaseAuthTypes.User
const METHOD_OF: Record<string, AuthMethod> = { ${methodOf.join(', ')} }
${on(c.linking, `const PROVIDER_ID: Partial<Record<AuthMethod, string>> = { ${idOf.join(', ')} }\n`)}
export class FirebaseAuthService implements AuthService {
  private current: AuthUser | null = null
  private readonly auth = getAuth()
${on(mfa(c), '  private pendingMfa: FirebaseAuthTypes.MultiFactorResolver | null = null\n  private pendingSmsId: string | null = null\n')}${on(phone, '  private confirmation: FirebaseAuthTypes.ConfirmationResult | null = null\n')}
  constructor(private readonly api: Api) {}

  get currentUser(): AuthUser | null {
    return this.current
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    return onIdTokenChanged(this.auth, async (u) => {
      this.current = u ? await this.map(u) : null
      listener(this.current)
    })
  }

  private get user(): User {
    const u = this.auth.currentUser
    if (!u) throw new AuthError('unknown', 'no_user')
    return u
  }

  private async map(u: User, refresh = false): Promise<AuthUser> {
    const token = await getIdTokenResult(u, refresh)
    const methods: AuthMethod[] = [${on(c.guest, "...(u.isAnonymous ? (['guest'] as const) : []), ")}...u.providerData.map((p) => METHOD_OF[p.providerId]).filter((m): m is AuthMethod => !!m)]
    return { uid: u.uid, email: u.email, phone: u.phoneNumber, displayName: u.displayName, photoUrl: u.photoURL, isAnonymous: u.isAnonymous, emailVerified: u.emailVerified, role: roleFrom(token.claims.role), methods, mfaEnrolled: ${mfa(c) ? 'multiFactor(u).enrolledFactors.length > 0' : 'false'} }
  }

  private async signedIn(c: FirebaseAuthTypes.UserCredential): Promise<AuthUser> {
    this.current = await this.map(c.user)
    return this.current
  }

  /** Every SDK error becomes an AuthError with a normalized code (texts: authErrorKey(code)). */
  private async guard<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body()
    } catch (e) {
      if (e instanceof AuthError) throw e
${on(google, "      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) throw new AuthError('cancelled', e.code)\n")}${on(apple, "      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthError('cancelled', 'ERR_REQUEST_CANCELED')\n")}      const code = (e as { code?: unknown }).code
      if (typeof code === 'string') {
${on(mfa(c), `        if (code === 'auth/multi-factor-auth-required') {
          const resolver = getMultiFactorResolver(this.auth, e as Parameters<typeof getMultiFactorResolver>[1])
          this.pendingMfa = resolver
          this.pendingSmsId = await this.auth.verifyPhoneNumberWithMultiFactorInfo(resolver.hints[0], resolver.session)
          throw new AuthError('mfaRequired', code)
        }
`)}        throw new AuthError(authErrorFrom(code), code)
      }
      throw new AuthError('unknown', String(e))
    }
  }
${on(email, `
  signUpWithEmail(email: string, password: string, displayName?: string | null): Promise<AuthUser> {
    return this.guard(async () => {
      const c = await createUserWithEmailAndPassword(this.auth, email, password)
      if (displayName) await updateProfile(c.user, { displayName })
      await sendEmailVerification(c.user)
      return this.signedIn(c)
    })
  }

  signInWithEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithEmailAndPassword(this.auth, email, password)))
  }

  sendPasswordReset(email: string): Promise<void> {
    return this.guard(() => sendPasswordResetEmail(this.auth, email))
  }

  sendEmailVerification(): Promise<void> {
    return this.guard(() => sendEmailVerification(this.user))
  }
`)}${on(google, `
  /** Configure once at startup: GoogleSignin.configure({ webClientId }) (the Firebase Web client id). */
  private async googleCredential(): Promise<FirebaseAuthTypes.AuthCredential> {
    await GoogleSignin.hasPlayServices()
    const r = await GoogleSignin.signIn()
    if (r.type !== 'success' || !r.data.idToken) throw new AuthError('cancelled', r.type)
    return GoogleAuthProvider.credential(r.data.idToken)
  }

  signInWithGoogle(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithCredential(this.auth, await this.googleCredential())))
  }
`)}${on(apple, `
  private async appleCredential(): Promise<FirebaseAuthTypes.AuthCredential> {
    const rawNonce = Crypto.randomUUID()
    const apple = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce),
    })
    if (!apple.identityToken) throw new AuthError('unknown', 'no_id_token')
    return AppleAuthProvider.credential(apple.identityToken, rawNonce)
  }

  signInWithApple(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInWithCredential(this.auth, await this.appleCredential())))
  }
`)}${on(phone, `
  startPhoneSignIn(phone: string): Promise<string> {
    return this.guard(async () => {
      this.confirmation = await signInWithPhoneNumber(this.auth, phone)
      return this.confirmation.verificationId ?? ''
    })
  }

  confirmPhoneCode(_verificationId: string, code: string): Promise<AuthUser> {
    return this.guard(async () => {
      const result = this.confirmation ? await this.confirmation.confirm(code) : null
      if (!result) throw new AuthError('codeExpired', 'no_pending_code')
      return this.signedIn(result)
    })
  }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
  signInAsGuest(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await signInAnonymously(this.auth)))
  }
`)}${on(c.linking && email, `
  linkEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithCredential(this.user, EmailAuthProvider.credential(email, password))))
  }
`)}${on(c.linking && google, `
  linkGoogle(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithCredential(this.user, await this.googleCredential())))
  }
`)}${on(c.linking && apple, `
  linkApple(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(await linkWithCredential(this.user, await this.appleCredential())))
  }
`)}${on(c.linking, `
  unlink(method: AuthMethod): Promise<AuthUser> {
    return this.guard(async () => {
      const id = PROVIDER_ID[method]
      if (!id) throw new AuthError('methodDisabled', 'not_linkable')
      this.current = await this.map(await unlink(this.user, id))
      return this.current
    })
  }
`)}${on(mfa(c), `
  mfaFactors(): Promise<MfaFactor[]> {
    return this.guard(async () => multiFactor(this.user).enrolledFactors.map((f) => ({ id: f.uid, kind: f.factorId === 'phone' ? ('sms' as const) : ('totp' as const), label: f.displayName ?? null })))
  }

  completeMfaSignIn(code: string): Promise<AuthUser> {
    return this.guard(async () => {
      const resolver = this.pendingMfa
      if (!resolver) throw new AuthError('codeExpired', 'no_pending_mfa')
      const result = await resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(this.pendingSmsId ?? '', code)))
      this.pendingMfa = null
      return this.signedIn(result)
    })
  }

  /** @react-native-firebase cannot remove a factor yet: do it from the web app or the Admin SDK. */
  unenrollMfa(_factorId: string): Promise<void> {
    return Promise.reject(new AuthError('methodDisabled', 'unenroll_not_in_react_native_firebase'))
  }
`)}${on(mf(c, 'totp'), `
  enrollTotpStart(): Promise<TotpEnrollment> {
    return Promise.reject(new AuthError('methodDisabled', 'totp_not_in_react_native_firebase'))
  }

  enrollTotpFinish(_code: string): Promise<void> {
    return Promise.reject(new AuthError('methodDisabled', 'totp_not_in_react_native_firebase'))
  }
`)}${on(mf(c, 'sms'), `
  enrollSmsStart(phone: string): Promise<string> {
    return this.guard(async () => this.auth.verifyPhoneNumberForMultiFactor({ phoneNumber: phone, session: await multiFactor(this.user).getSession() }))
  }

  enrollSmsFinish(verificationId: string, code: string): Promise<void> {
    return this.guard(() => multiFactor(this.user).enroll(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code)), 'SMS'))
  }
`)}
  reauthenticate(password?: string | null): Promise<void> {
    return this.guard(async () => {
      const u = this.user
      const providers = u.providerData.map((p) => p.providerId)
      if (password && u.email && providers.includes('password')) {
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password))
        return
      }
${on(google, `      if (providers.includes('google.com')) {
        await reauthenticateWithCredential(u, await this.googleCredential())
        return
      }
`)}${on(apple, `      if (providers.includes('apple.com')) {
        await reauthenticateWithCredential(u, await this.appleCredential())
        return
      }
`)}      throw new AuthError('requiresRecentLogin', 'sign_in_again')
    })
  }

  refreshUser(): Promise<AuthUser | null> {
    return this.guard(async () => {
      const u = this.auth.currentUser
      if (!u) return (this.current = null)
      await reload(u)
      this.current = await this.map(this.auth.currentUser ?? u, true) // new ID token: new role claim
      return this.current
    })
  }

  async signOut(): Promise<void> {
${on(google, '    await GoogleSignin.signOut().catch(() => undefined)\n')}    await signOut(this.auth)
    this.current = null
  }
${deleteAccount}`
}

// ---------------------------------------------------------------- supabase-js (web, or React Native with native: true)
export function tsSupabase(c, { native = false } = {}) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const methodOf = [email && "email: 'email'", google && "google: 'google'", apple && "apple: 'apple'", phone && "phone: 'phone'"].filter(Boolean)
  const nameOf = [email && "email: 'email'", google && "google: 'google'", apple && "apple: 'apple'", phone && "phone: 'phone'"].filter(Boolean)
  return `// Supabase implementation of AuthService${native ? ' for React Native' : ' for the web'} (DualCraft auth). Yours after creation: adapt freely.
// npm i @supabase/supabase-js${on(native && google, ' @react-native-google-signin/google-signin')}${on(native && apple, ' expo-apple-authentication expo-crypto')} · enable the providers in Supabase → Authentication → Providers${on(c.guest, ' (and anonymous sign-ins)')}${on(c.linking, ' (and manual linking)')}.
import { AuthError as SupabaseAuthError, type SupabaseClient, type User } from '@supabase/supabase-js'
${on(native && google, "import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin'\n")}${on(native && apple, "import * as AppleAuthentication from 'expo-apple-authentication'\nimport * as Crypto from 'expo-crypto'\n")}import { ApiError, type Api } from './api-client'
import { AuthError, authErrorFrom, roleFrom, type AuthMethod, type AuthService, type AuthUser${on(mfa(c), ', type MfaFactor')}${on(mf(c, 'totp'), ', type TotpEnrollment')} } from './auth-catalog'

const METHOD_OF: Record<string, AuthMethod> = { ${methodOf.join(', ')} }
${on(c.linking, `const PROVIDER_NAME: Partial<Record<AuthMethod, string>> = { ${nameOf.join(', ')} }\n`)}/** supabase-js returns { data, error } (often a union of the success and failure shapes): unwrap or throw. */
type Ok<R extends { data: unknown }> = [Extract<R, { error: null }>] extends [never] ? NonNullable<R['data']> : NonNullable<Extract<R, { error: null }>['data']>
function must<R extends { data: unknown; error: unknown }>(r: R): Ok<R> {
  if (r.error) throw r.error
  return r.data as Ok<R>
}

export class SupabaseAuthService implements AuthService {
  private current: AuthUser | null = null
${on(mfa(c), '  private pendingMfa: { factorId: string; challengeId: string } | null = null\n')}${on(mf(c, 'totp'), '  private pendingTotpFactor: string | null = null\n')}
  constructor(private readonly api: Api, private readonly supabase: SupabaseClient) {}

  get currentUser(): AuthUser | null {
    return this.current
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((_event, session) => {
      this.current = session ? this.map(session.user) : null
      listener(this.current)
    })
    return () => data.subscription.unsubscribe()
  }

  private map(u: User): AuthUser {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>
    const methods: AuthMethod[] = [${on(c.guest, "...(u.is_anonymous ? (['guest'] as const) : []), ")}...(u.identities ?? []).map((i) => METHOD_OF[i.provider]).filter((m): m is AuthMethod => !!m)]
    return { uid: u.id, email: u.email ?? null, phone: u.phone || null, displayName: (meta.display_name ?? meta.full_name ?? null) as string | null, photoUrl: (meta.avatar_url ?? null) as string | null, isAnonymous: !!u.is_anonymous, emailVerified: !!u.email_confirmed_at, role: roleFrom(u.app_metadata?.role), methods, mfaEnrolled: (u.factors ?? []).some((f) => f.status === 'verified') }
  }

  private async user(): Promise<User> {
    const { data } = await this.supabase.auth.getUser()
    if (!data.user) throw new AuthError('unknown', 'no_user')
    return data.user
  }

  private async signedIn(u: User | null): Promise<AuthUser> {
    if (!u) throw new AuthError('unknown', 'no_user')
${on(mfa(c), `    // a second factor is enrolled: the session stays at aal1 until completeMfaSignIn
    const aal = must(await this.supabase.auth.mfa.getAuthenticatorAssuranceLevel())
    if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const factor = must(await this.supabase.auth.mfa.listFactors()).all.find((f) => f.status === 'verified')
      if (factor) {
        const challenge = must(await this.supabase.auth.mfa.challenge({ factorId: factor.id })) // SMS factors get the code now
        this.pendingMfa = { factorId: factor.id, challengeId: challenge.id }
        throw new AuthError('mfaRequired', 'insufficient_aal')
      }
    }
`)}    this.current = this.map(u)
    return this.current
  }

  /** Every SDK error becomes an AuthError with a normalized code (texts: authErrorKey(code)). */
  private async guard<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body()
    } catch (e) {
      if (e instanceof AuthError) throw e
      if (e instanceof SupabaseAuthError) throw new AuthError(authErrorFrom(e.code ?? e.message), e.code ?? e.message)
${on(native && google, "      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) throw new AuthError('cancelled', e.code)\n")}${on(native && apple, "      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthError('cancelled', 'ERR_REQUEST_CANCELED')\n")}      throw new AuthError('unknown', String(e))
    }
  }
${on(email, `
  signUpWithEmail(email: string, password: string, displayName?: string | null): Promise<AuthUser> {
    return this.guard(async () => {
      const data = must(await this.supabase.auth.signUp({ email, password, options: { data: displayName ? { display_name: displayName } : {} } }))
      if (!data.user) throw new AuthError('unknown', 'no_user')
      this.current = this.map(data.user) // no session until the email is confirmed (if confirmation is on)
      return this.current
    })
  }

  signInWithEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(must(await this.supabase.auth.signInWithPassword({ email, password })).user))
  }

  sendPasswordReset(email: string): Promise<void> {
    return this.guard(async () => void must(await this.supabase.auth.resetPasswordForEmail(email)))
  }

  sendEmailVerification(): Promise<void> {
    return this.guard(async () => void must(await this.supabase.auth.resend({ type: 'signup', email: (await this.user()).email ?? '' })))
  }
`)}${on(google, native ? `
  /** Configure once at startup: GoogleSignin.configure({ webClientId, iosClientId }). */
  signInWithGoogle(): Promise<AuthUser> {
    return this.guard(async () => {
      await GoogleSignin.hasPlayServices()
      const r = await GoogleSignin.signIn()
      if (r.type !== 'success' || !r.data.idToken) throw new AuthError('cancelled', r.type)
      return this.signedIn(must(await this.supabase.auth.signInWithIdToken({ provider: 'google', token: r.data.idToken })).user)
    })
  }
` : `
  /** OAuth redirect: the session arrives through onAuthStateChanged after coming back. */
  signInWithGoogle(): Promise<AuthUser> {
    return this.guard(async () => {
      must(await this.supabase.auth.signInWithOAuth({ provider: 'google' }))
      throw new AuthError('cancelled', 'redirect')
    })
  }
`)}${on(apple, native ? `
  signInWithApple(): Promise<AuthUser> {
    return this.guard(async () => {
      const rawNonce = Crypto.randomUUID()
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce),
      })
      if (!credential.identityToken) throw new AuthError('unknown', 'no_id_token')
      const data = must(await this.supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce }))
      const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ')
      if (name) await this.supabase.auth.updateUser({ data: { full_name: name } }) // Apple sends it only once
      return this.signedIn(data.user)
    })
  }
` : `
  signInWithApple(): Promise<AuthUser> {
    return this.guard(async () => {
      must(await this.supabase.auth.signInWithOAuth({ provider: 'apple' }))
      throw new AuthError('cancelled', 'redirect')
    })
  }
`)}${on(phone, `
  /** The "verification id" is the phone number itself (Supabase verifies phone + code). */
  startPhoneSignIn(phone: string): Promise<string> {
    return this.guard(async () => {
      must(await this.supabase.auth.signInWithOtp({ phone }))
      return phone
    })
  }

  confirmPhoneCode(verificationId: string, code: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(must(await this.supabase.auth.verifyOtp({ phone: verificationId, token: code, type: 'sms' })).user))
  }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
  signInAsGuest(): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(must(await this.supabase.auth.signInAnonymously()).user))
  }
`)}${on(c.linking && email, `
  /** Turns the guest (anonymous) account into an email account: same id, same data. Sends a confirmation email. */
  linkEmail(email: string, password: string): Promise<AuthUser> {
    return this.guard(async () => this.signedIn(must(await this.supabase.auth.updateUser({ email, password })).user))
  }
`)}${on(c.linking && google, `
  linkGoogle(): Promise<AuthUser> {
    return this.guard(async () => {
      must(await this.supabase.auth.linkIdentity({ provider: 'google' })) // OAuth flow; the identity appears after coming back
      return this.signedIn(await this.user())
    })
  }
`)}${on(c.linking && apple, `
  linkApple(): Promise<AuthUser> {
    return this.guard(async () => {
      must(await this.supabase.auth.linkIdentity({ provider: 'apple' }))
      return this.signedIn(await this.user())
    })
  }
`)}${on(c.linking, `
  unlink(method: AuthMethod): Promise<AuthUser> {
    return this.guard(async () => {
      const identity = must(await this.supabase.auth.getUserIdentities()).identities.find((i) => i.provider === PROVIDER_NAME[method])
      if (!identity) throw new AuthError('unknown', 'not_linked')
      must(await this.supabase.auth.unlinkIdentity(identity))
      return this.signedIn(must(await this.supabase.auth.refreshSession()).user)
    })
  }
`)}${on(mfa(c), `
  mfaFactors(): Promise<MfaFactor[]> {
    return this.guard(async () => must(await this.supabase.auth.mfa.listFactors()).all.filter((f) => f.status === 'verified').map((f) => ({ id: f.id, kind: f.factor_type === 'phone' ? ('sms' as const) : ('totp' as const), label: f.friendly_name ?? null })))
  }

  completeMfaSignIn(code: string): Promise<AuthUser> {
    return this.guard(async () => {
      const p = this.pendingMfa
      if (!p) throw new AuthError('codeExpired', 'no_pending_mfa')
      must(await this.supabase.auth.mfa.verify({ factorId: p.factorId, challengeId: p.challengeId, code }))
      this.pendingMfa = null
      this.current = this.map(await this.user())
      return this.current
    })
  }

  unenrollMfa(factorId: string): Promise<void> {
    return this.guard(async () => void must(await this.supabase.auth.mfa.unenroll({ factorId })))
  }
`)}${on(mf(c, 'totp'), `
  enrollTotpStart(): Promise<TotpEnrollment> {
    return this.guard(async () => {
      const data = must(await this.supabase.auth.mfa.enroll({ factorType: 'totp', issuer: ${issuer(c)} }))
      this.pendingTotpFactor = data.id
      return { secret: data.totp.secret, uri: data.totp.uri }
    })
  }

  enrollTotpFinish(code: string): Promise<void> {
    return this.guard(async () => {
      if (!this.pendingTotpFactor) throw new AuthError('codeExpired', 'no_pending_totp')
      must(await this.supabase.auth.mfa.challengeAndVerify({ factorId: this.pendingTotpFactor, code }))
      this.pendingTotpFactor = null
    })
  }
`)}${on(mf(c, 'sms'), `
  /** Returns "factorId:challengeId" — pass it back to enrollSmsFinish. */
  enrollSmsStart(phone: string): Promise<string> {
    return this.guard(async () => {
      const factor = must(await this.supabase.auth.mfa.enroll({ factorType: 'phone', phone }))
      const challenge = must(await this.supabase.auth.mfa.challenge({ factorId: factor.id }))
      return factor.id + ':' + challenge.id
    })
  }

  enrollSmsFinish(verificationId: string, code: string): Promise<void> {
    return this.guard(async () => {
      const [factorId, challengeId] = verificationId.split(':')
      must(await this.supabase.auth.mfa.verify({ factorId, challengeId, code }))
    })
  }
`)}
  /** Deletion checks that the last sign-in is recent: signing in again refreshes it. */
  reauthenticate(password?: string | null): Promise<void> {
    return this.guard(async () => {
      const u = await this.user()
      const providers = (u.identities ?? []).map((i) => i.provider)
      if (password && u.email && providers.includes('email')) {
        must(await this.supabase.auth.signInWithPassword({ email: u.email, password }))
        return
      }
${on(google, `      if (providers.includes('google')) {
        await this.signInWithGoogle()
        return
      }
`)}${on(apple, `      if (providers.includes('apple')) {
        await this.signInWithApple()
        return
      }
`)}      throw new AuthError('requiresRecentLogin', 'sign_in_again')
    })
  }

  refreshUser(): Promise<AuthUser | null> {
    return this.guard(async () => {
      const { data } = await this.supabase.auth.getSession()
      if (!data.session) return (this.current = null)
      const user = must(await this.supabase.auth.refreshSession()).user // new JWT = new app_metadata.role
      this.current = user ? this.map(user) : null
      return this.current
    })
  }

  async signOut(): Promise<void> {
${on(native && google, '    await GoogleSignin.signOut().catch(() => undefined)\n')}    await this.supabase.auth.signOut()
    this.current = null
  }
${deleteAccount}`
}
