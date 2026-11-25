// Kotlin AuthService implementations (DualCraft auth): Android with Firebase Auth (+ Credential Manager for Google),
// and supabase-kt for Android or KMP commonMain. Written once; the developer owns them afterwards.
const on = (cond, text) => (cond ? text : '')
const has = (c, m) => c.methods.includes(m)
const mfa = (c) => (c.mfa?.factors || []).length > 0
const mf = (c, f) => (c.mfa?.factors || []).includes(f)
const issuer = (c) => JSON.stringify(c.passkey?.rpName || 'App')
const firebasePasskeys = `
    // Passkeys: Credential Manager on the device, verification in the passkey* Cloud Functions, then a custom token.
    // Needs .well-known/assetlinks.json on your domain (get_login_creds) and the app's origin in passkey.origins.
    override suspend fun signInWithPasskey(): AuthUser = guard {
        val o = passkeyCall { api.passkeySignInOptions() }
        val result = try {
            CredentialManager.create(context).getCredential(activity(), GetCredentialRequest(listOf(GetPublicKeyCredentialOption(o.options))))
        } catch (e: GetCredentialCancellationException) {
            throw AuthError(AuthErrorCode.CANCELLED, "passkey_cancelled")
        } catch (e: NoCredentialException) {
            throw AuthError(AuthErrorCode.INVALID_CREDENTIALS, "no_passkey")
        }
        val credential = result.credential as? PublicKeyCredential ?: throw AuthError(AuthErrorCode.UNKNOWN, "not_a_passkey")
        val token = passkeyCall { api.passkeySignInVerify(PasskeySignInVerifyInput(challengeId = o.challengeId, response = credential.authenticationResponseJson)) }.token
        signedIn(auth.signInWithCustomToken(token).await())
    }

    override suspend fun registerPasskey() = guard {
        val o = passkeyCall { api.passkeyRegisterOptions() }
        val created = try {
            CredentialManager.create(context).createCredential(activity(), CreatePublicKeyCredentialRequest(o.options))
        } catch (e: CreateCredentialCancellationException) {
            throw AuthError(AuthErrorCode.CANCELLED, "passkey_cancelled")
        }
        val json = (created as? CreatePublicKeyCredentialResponse)?.registrationResponseJson ?: throw AuthError(AuthErrorCode.UNKNOWN, "not_a_passkey")
        passkeyCall { api.passkeyRegisterVerify(PasskeyRegisterVerifyInput(response = json)) }
        current = map(user, refresh = true) // picks up the "passkey" claim
    }

    /** Server errors of the passkey functions → AuthError. */
    private suspend fun <T> passkeyCall(block: suspend () -> T): T = try {
        block()
    } catch (e: ApiError) {
        throw AuthError(
            when (e.code) {
                "failed-precondition" -> AuthErrorCode.CODE_EXPIRED
                "not-found", "permission-denied" -> AuthErrorCode.INVALID_CREDENTIALS
                "already-exists" -> AuthErrorCode.ALREADY_LINKED
                else -> AuthErrorCode.UNKNOWN
            },
            e.code,
        )
    }
`
const passkeyStubs = `
    // Passkeys: supabase-kt has no passkey support yet (supabase-js, supabase_flutter and supabase-swift do).
    override suspend fun signInWithPasskey(): AuthUser = throw AuthError(AuthErrorCode.METHOD_DISABLED, "passkeys_not_supported_in_supabase_kt")
    override suspend fun registerPasskey(): Unit = throw AuthError(AuthErrorCode.METHOD_DISABLED, "passkeys_not_supported_in_supabase_kt")
`

// ---------------------------------------------------------------- Android + Firebase
export function kotlinFirebase(c, { pkg, apiPkg }) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email'), sms = phone || mf(c, 'sms'), passkey = has(c, 'passkey')
  const methodOf = [email && '"password" -> AuthMethod.EMAIL', google && '"google.com" -> AuthMethod.GOOGLE', apple && '"apple.com" -> AuthMethod.APPLE', phone && '"phone" -> AuthMethod.PHONE'].filter(Boolean)
  const idOf = [email && 'AuthMethod.EMAIL -> "password"', google && 'AuthMethod.GOOGLE -> "google.com"', apple && 'AuthMethod.APPLE -> "apple.com"', phone && 'AuthMethod.PHONE -> "phone"'].filter(Boolean)
  return `// Firebase implementation of AuthService for Android (DualCraft auth). Yours after creation: adapt freely.
// Gradle: firebase-auth (Firebase BoM), kotlinx-coroutines-play-services${on(google || passkey, ', androidx.credentials:credentials + credentials-play-services-auth')}${on(google, ', com.google.android.libraries.identity.googleid:googleid')}.
// Setup: enable the providers in Firebase Console → Authentication${on(google, '; SHA-1/SHA-256 of your signing keys in the Firebase Android app')}${on(apple, '; Apple: Services ID + key in the Apple provider')}.
package ${pkg}

import android.app.Activity
import android.content.Context
${on(google, 'import androidx.credentials.ClearCredentialStateRequest\n')}${on(google || passkey, `import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
`)}${on(passkey, `import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import ${apiPkg}.PasskeyRegisterVerifyInput
import ${apiPkg}.PasskeySignInVerifyInput
`)}${on(google, `import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
`)}import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
${on(google, 'import com.google.firebase.auth.GoogleAuthProvider\n')}${on(apple, 'import com.google.firebase.auth.OAuthProvider\n')}${on(mfa(c), 'import com.google.firebase.auth.FirebaseAuthMultiFactorException\nimport com.google.firebase.auth.MultiFactorAssertion\nimport com.google.firebase.auth.MultiFactorResolver\nimport com.google.firebase.auth.PhoneMultiFactorGenerator\nimport com.google.firebase.auth.PhoneMultiFactorInfo\n')}${on(sms, 'import com.google.firebase.auth.MultiFactorSession\nimport com.google.firebase.auth.PhoneAuthCredential\nimport com.google.firebase.auth.PhoneAuthOptions\nimport com.google.firebase.auth.PhoneAuthProvider\nimport java.util.concurrent.TimeUnit\nimport kotlin.coroutines.resume\nimport kotlin.coroutines.resumeWithException\nimport kotlinx.coroutines.suspendCancellableCoroutine\n')}${on(mf(c, 'totp'), 'import com.google.firebase.auth.TotpMultiFactorGenerator\nimport com.google.firebase.auth.TotpSecret\n')}import ${apiPkg}.Api
import ${apiPkg}.ApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class FirebaseAuthService(
    private val api: Api,
    private val context: Context,
    /** The current Activity (Credential Manager, Apple and phone flows need one). */
    private val activity: () -> Activity,
${on(google, '    /** The Web client id of your Firebase project (R.string.default_web_client_id). */\n    private val webClientId: String,\n')}    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : AuthService {
    @Volatile private var current: AuthUser? = null
${on(mfa(c), '    private var pendingMfa: MultiFactorResolver? = null\n    private var pendingSmsId: String? = null\n')}${on(mf(c, 'totp'), '    private var pendingTotp: TotpSecret? = null\n')}
    override val currentUser: AuthUser? get() = current

    override val authState: Flow<AuthUser?> = callbackFlow {
        val listener = FirebaseAuth.IdTokenListener { a ->
            launch {
                current = a.currentUser?.let { map(it) }
                trySend(current)
            }
        }
        auth.addIdTokenListener(listener)
        awaitClose { auth.removeIdTokenListener(listener) }
    }

    private val user: FirebaseUser get() = auth.currentUser ?: throw AuthError(AuthErrorCode.UNKNOWN, "no_user")

    private suspend fun map(u: FirebaseUser, refresh: Boolean = false): AuthUser {
        val token = u.getIdToken(refresh).await()
        return AuthUser(
            uid = u.uid,
            email = u.email,
            phone = u.phoneNumber,
            displayName = u.displayName,
            photoUrl = u.photoUrl?.toString(),
            isAnonymous = u.isAnonymous,
            emailVerified = u.isEmailVerified,
            role = roleFrom(token.claims["role"]),
            methods = ${on(c.guest, 'listOfNotNull(if (u.isAnonymous) AuthMethod.GUEST else null) + ')}u.providerData.mapNotNull { methodOf(it.providerId) }${on(passkey, ' + listOfNotNull(if (token.claims["passkey"] == true) AuthMethod.PASSKEY else null)')},
            mfaEnrolled = ${mfa(c) ? 'u.multiFactor.enrolledFactors.isNotEmpty()' : 'false'},
        )
    }

    private fun methodOf(providerId: String): AuthMethod? = when (providerId) {
        ${[...methodOf, 'else -> null'].join('\n        ')}
    }
${on(c.linking, `
    private fun providerId(m: AuthMethod): String = when (m) {
        ${[...idOf, 'else -> throw AuthError(AuthErrorCode.METHOD_DISABLED, "not_linkable")'].join('\n        ')}
    }
`)}
    private suspend fun signedIn(r: AuthResult): AuthUser = map(r.user ?: throw AuthError(AuthErrorCode.UNKNOWN, "no_user")).also { current = it }

    /** Every SDK error becomes an AuthError with a normalized code (texts: AuthErrorCode.key). */
    private suspend fun <T> guard(body: suspend () -> T): T = try {
        body()
    } catch (e: CancellationException) {
        throw e
    } catch (e: AuthError) {
        throw e
    }${on(mfa(c), ` catch (e: FirebaseAuthMultiFactorException) {
        pendingMfa = e.resolver
        val hint = e.resolver.hints.first()
        if (hint is PhoneMultiFactorInfo) pendingSmsId = sendSms(session = e.resolver.session, hint = hint)
        throw AuthError(AuthErrorCode.MFA_REQUIRED, e.errorCode)
    }`)} catch (e: FirebaseAuthException) {
        throw AuthError(authErrorFrom(e.errorCode), e.errorCode)
    } catch (e: FirebaseNetworkException) {
        throw AuthError(AuthErrorCode.NETWORK, e.message)
    } catch (e: FirebaseTooManyRequestsException) {
        throw AuthError(AuthErrorCode.TOO_MANY_REQUESTS, e.message)
    }${on(google, ` catch (e: GetCredentialCancellationException) {
        throw AuthError(AuthErrorCode.CANCELLED, e.message)
    }`)}
${on(email, `
    override suspend fun signUpWithEmail(email: String, password: String, displayName: String?): AuthUser = guard {
        val r = auth.createUserWithEmailAndPassword(email, password).await()
        val u = r.user ?: throw AuthError(AuthErrorCode.UNKNOWN, "no_user")
        if (displayName != null) u.updateProfile(com.google.firebase.auth.UserProfileChangeRequest.Builder().setDisplayName(displayName).build()).await()
        u.sendEmailVerification().await()
        signedIn(r)
    }

    override suspend fun signInWithEmail(email: String, password: String): AuthUser = guard { signedIn(auth.signInWithEmailAndPassword(email, password).await()) }

    override suspend fun sendPasswordReset(email: String) = guard { auth.sendPasswordResetEmail(email).await(); Unit }

    override suspend fun sendEmailVerification() = guard { user.sendEmailVerification().await(); Unit }
`)}${on(google, `
    private suspend fun googleCredential(): AuthCredential {
        val request = GetCredentialRequest.Builder().addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).build()).build()
        val result = CredentialManager.create(context).getCredential(activity(), request)
        return GoogleAuthProvider.getCredential(GoogleIdTokenCredential.createFrom(result.credential.data).idToken, null)
    }

    override suspend fun signInWithGoogle(): AuthUser = guard { signedIn(auth.signInWithCredential(googleCredential()).await()) }
`)}${on(apple, `
    private fun appleProvider() = OAuthProvider.newBuilder("apple.com").setScopes(listOf("email", "name")).build()

    override suspend fun signInWithApple(): AuthUser = guard {
        val pending = auth.pendingAuthResult // the browser flow may have finished while the app was in the background
        signedIn(pending?.await() ?: auth.startActivityForSignInWithProvider(activity(), appleProvider()).await())
    }
`)}${on(sms, `
    private suspend fun sendSms(phone: String? = null, session: MultiFactorSession? = null, hint: PhoneMultiFactorInfo? = null): String = suspendCancellableCoroutine { cont ->
        val options = PhoneAuthOptions.newBuilder(auth).setActivity(activity()).setTimeout(60L, TimeUnit.SECONDS)
            .setCallbacks(object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                override fun onVerificationCompleted(credential: PhoneAuthCredential) {} // auto-retrieval: we still confirm with the typed code
                override fun onVerificationFailed(e: FirebaseException) { if (cont.isActive) cont.resumeWithException(e) }
                override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) { if (cont.isActive) cont.resume(id) }
            })
        if (phone != null) options.setPhoneNumber(phone)
        if (session != null) options.setMultiFactorSession(session)
        if (hint != null) options.setMultiFactorHint(hint)
        PhoneAuthProvider.verifyPhoneNumber(options.build())
    }
`)}${on(phone, `
    override suspend fun startPhoneSignIn(phone: String): String = guard { sendSms(phone = phone) }

    override suspend fun confirmPhoneCode(verificationId: String, code: String): AuthUser = guard { signedIn(auth.signInWithCredential(PhoneAuthProvider.getCredential(verificationId, code)).await()) }
`)}${on(has(c, 'passkey'), firebasePasskeys)}${on(c.guest, `
    override suspend fun signInAsGuest(): AuthUser = guard { signedIn(auth.signInAnonymously().await()) }
`)}${on(c.linking && email, `
    override suspend fun linkEmail(email: String, password: String): AuthUser = guard { signedIn(user.linkWithCredential(EmailAuthProvider.getCredential(email, password)).await()) }
`)}${on(c.linking && google, `
    override suspend fun linkGoogle(): AuthUser = guard { signedIn(user.linkWithCredential(googleCredential()).await()) }
`)}${on(c.linking && apple, `
    override suspend fun linkApple(): AuthUser = guard { signedIn(user.startActivityForLinkWithProvider(activity(), appleProvider()).await()) }
`)}${on(c.linking, `
    override suspend fun unlink(method: AuthMethod): AuthUser = guard { signedIn(user.unlink(providerId(method)).await()) }
`)}${on(mfa(c), `
    override suspend fun mfaFactors(): List<MfaFactor> = guard {
        user.multiFactor.enrolledFactors.map { MfaFactor(it.uid, if (it.factorId == PhoneMultiFactorGenerator.FACTOR_ID) "sms" else "totp", it.displayName) }
    }

    override suspend fun completeMfaSignIn(code: String): AuthUser = guard {
        val resolver = pendingMfa ?: throw AuthError(AuthErrorCode.CODE_EXPIRED, "no_pending_mfa")
        val hint = resolver.hints.first()
        val assertion: MultiFactorAssertion = if (hint is PhoneMultiFactorInfo) {
            PhoneMultiFactorGenerator.getAssertion(PhoneAuthProvider.getCredential(pendingSmsId ?: "", code))
        } else {
            ${mf(c, 'totp') ? 'TotpMultiFactorGenerator.getAssertionForSignIn(hint.uid, code)' : 'throw AuthError(AuthErrorCode.METHOD_DISABLED, "totp")'}
        }
        signedIn(resolver.resolveSignIn(assertion).await()).also { pendingMfa = null }
    }

    override suspend fun unenrollMfa(factorId: String) = guard { user.multiFactor.unenroll(factorId).await(); Unit }
`)}${on(mf(c, 'totp'), `
    override suspend fun enrollTotpStart(): TotpEnrollment = guard {
        val secret = TotpMultiFactorGenerator.generateSecret(user.multiFactor.session.await()).await()
        pendingTotp = secret
        TotpEnrollment(secret.sharedSecretKey, secret.generateQrCodeUrl(user.email ?: user.uid, ${issuer(c)}))
    }

    override suspend fun enrollTotpFinish(code: String) = guard {
        val secret = pendingTotp ?: throw AuthError(AuthErrorCode.CODE_EXPIRED, "no_pending_totp")
        user.multiFactor.enroll(TotpMultiFactorGenerator.getAssertionForEnrollment(secret, code), "Authenticator").await()
        pendingTotp = null
    }
`)}${on(mf(c, 'sms'), `
    override suspend fun enrollSmsStart(phone: String): String = guard { sendSms(phone = phone, session = user.multiFactor.session.await()) }

    override suspend fun enrollSmsFinish(verificationId: String, code: String) = guard {
        user.multiFactor.enroll(PhoneMultiFactorGenerator.getAssertion(PhoneAuthProvider.getCredential(verificationId, code)), "SMS").await()
        Unit
    }
`)}
    override suspend fun reauthenticate(password: String?) = guard {
        val u = user
        val providers = u.providerData.map { it.providerId }
        when {
            password != null && u.email != null && "password" in providers -> u.reauthenticate(EmailAuthProvider.getCredential(u.email!!, password)).await()
${on(google, '            "google.com" in providers -> u.reauthenticate(googleCredential()).await()\n')}${on(apple, '            "apple.com" in providers -> u.startActivityForReauthenticateWithProvider(activity(), appleProvider()).await()\n')}            else -> throw AuthError(AuthErrorCode.REQUIRES_RECENT_LOGIN, "sign_in_again")
        }
        Unit
    }

    override suspend fun refreshUser(): AuthUser? = guard {
        val u = auth.currentUser
        if (u == null) {
            current = null
            null
        } else {
            u.reload().await()
            map(auth.currentUser ?: u, refresh = true).also { current = it } // new ID token: new role claim
        }
    }

    override suspend fun signOut() {
        auth.signOut()
${on(google, '        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }\n')}        current = null
    }

    override suspend fun deleteAccount() = guard {
        try {
            api.deleteAccount() // server: data cleanup + deletion
        } catch (e: ApiError) {
            if (e.code == "failed-precondition") throw AuthError(AuthErrorCode.REQUIRES_RECENT_LOGIN, "requires_recent_login")
            throw e
        }
        signOut()
    }
}
`
}

// ---------------------------------------------------------------- supabase-kt (Android or KMP commonMain)
export function kotlinSupabase(c, { pkg, apiPkg }) {
  const google = has(c, 'google'), apple = has(c, 'apple'), phone = has(c, 'phone'), email = has(c, 'email')
  const methodOf = [email && '"email" -> AuthMethod.EMAIL', google && '"google" -> AuthMethod.GOOGLE', apple && '"apple" -> AuthMethod.APPLE', phone && '"phone" -> AuthMethod.PHONE'].filter(Boolean)
  const nameOf = [email && 'AuthMethod.EMAIL -> "email"', google && 'AuthMethod.GOOGLE -> "google"', apple && 'AuthMethod.APPLE -> "apple"', phone && 'AuthMethod.PHONE -> "phone"'].filter(Boolean)
  return `// Supabase implementation of AuthService (supabase-kt; Android or KMP commonMain) — DualCraft auth. Yours after creation.
// Gradle: io.github.jan-tennert.supabase:auth-kt (Supabase BoM) + a Ktor engine.
// Native Google/Apple sign-in: get the ID token on each platform (Credential Manager / AuthenticationServices, or the
// compose-auth plugin) and pass it to signInWithIdToken; the OAuth flows below open the browser.
@file:OptIn(kotlin.time.ExperimentalTime::class)

package ${pkg}

import ${apiPkg}.Api
import ${apiPkg}.ApiError
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
${on(email, 'import io.github.jan.supabase.auth.OtpType\nimport io.github.jan.supabase.auth.providers.builtin.Email\n')}${on(phone, 'import io.github.jan.supabase.auth.providers.builtin.OTP\n')}${on(google, 'import io.github.jan.supabase.auth.providers.Google\n')}${on(apple, 'import io.github.jan.supabase.auth.providers.Apple\n')}${on(google || apple, 'import io.github.jan.supabase.auth.providers.IDTokenProvider\nimport io.github.jan.supabase.auth.providers.builtin.IDToken\n')}${on(mfa(c), 'import io.github.jan.supabase.auth.mfa.AuthenticatorAssuranceLevel\nimport io.github.jan.supabase.auth.mfa.FactorType\n')}import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
${on(email, 'import kotlinx.serialization.json.put\n')}
class SupabaseAuthService(private val api: Api, private val supabase: SupabaseClient) : AuthService {
    private val auth get() = supabase.auth
    private var current: AuthUser? = null
${on(mfa(c), '    private var pendingMfa: Pair<String, String>? = null // factorId to challengeId\n')}${on(mf(c, 'totp'), '    private var pendingTotpFactor: String? = null\n')}
    override val currentUser: AuthUser? get() = current

    override val authState: Flow<AuthUser?> = auth.sessionStatus.map { s ->
        current = (s as? SessionStatus.Authenticated)?.session?.user?.let(::map)
        current
    }

    private fun map(u: UserInfo): AuthUser {
        fun meta(k: String) = u.userMetadata?.get(k)?.let { (it as? JsonPrimitive)?.contentOrNull }
        return AuthUser(
            uid = u.id,
            email = u.email,
            phone = u.phone?.ifEmpty { null },
            displayName = meta("display_name") ?: meta("full_name"),
            photoUrl = meta("avatar_url"),
            isAnonymous = u.identities.isNullOrEmpty() && u.email.isNullOrEmpty() && u.phone.isNullOrEmpty(),
            emailVerified = u.emailConfirmedAt != null,
            role = roleFrom(u.appMetadata?.get("role")?.jsonPrimitive?.contentOrNull),
            methods = ${on(c.guest, 'listOfNotNull(if (u.identities.isNullOrEmpty()) AuthMethod.GUEST else null) + ')}(u.identities ?: emptyList()).mapNotNull { methodOf(it.provider) },
            mfaEnrolled = (u.factors ?: emptyList()).any { it.isVerified },
        )
    }

    private fun methodOf(provider: String): AuthMethod? = when (provider) {
        ${[...methodOf, 'else -> null'].join('\n        ')}
    }

    private fun user(): UserInfo = auth.currentUserOrNull() ?: throw AuthError(AuthErrorCode.UNKNOWN, "no_user")

    private suspend fun signedIn(): AuthUser {
        val u = user()
${on(mfa(c), `        // a second factor is enrolled: the session stays at aal1 until completeMfaSignIn
        val (level, next) = auth.mfa.getAuthenticatorAssuranceLevel()
        if (next == AuthenticatorAssuranceLevel.AAL2 && level != AuthenticatorAssuranceLevel.AAL2) {
            val factor = auth.mfa.retrieveFactorsForCurrentUser().first { it.isVerified }
            pendingMfa = factor.id to auth.mfa.createChallenge(factor.id).id // SMS factors get the code now
            throw AuthError(AuthErrorCode.MFA_REQUIRED, "insufficient_aal")
        }
`)}        return map(u).also { current = it }
    }

    /** Every SDK error becomes an AuthError with a normalized code (texts: AuthErrorCode.key). */
    private suspend fun <T> guard(body: suspend () -> T): T = try {
        body()
    } catch (e: CancellationException) {
        throw e
    } catch (e: AuthError) {
        throw e
    } catch (e: AuthRestException) {
        val raw = e.errorCode?.value ?: e.error
        throw AuthError(authErrorFrom(raw), raw)
    }
${on(email, `
    override suspend fun signUpWithEmail(email: String, password: String, displayName: String?): AuthUser = guard {
        auth.signUpWith(Email) {
            this.email = email
            this.password = password
            if (displayName != null) data = buildJsonObject { put("display_name", displayName) }
        }
        auth.currentUserOrNull()?.let { map(it).also { u -> current = u } } ?: AuthUser(uid = "", email = email) // no session until confirmed
    }

    override suspend fun signInWithEmail(email: String, password: String): AuthUser = guard {
        auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
        signedIn()
    }

    override suspend fun sendPasswordReset(email: String) = guard { auth.resetPasswordForEmail(email) }

    override suspend fun sendEmailVerification() = guard { auth.resendEmail(OtpType.Email.SIGNUP, user().email ?: "") }
`)}${on(google || apple, `
    /** Native sign-in: pass the ID token (and the raw nonce for Apple) obtained on each platform. */
    suspend fun signInWithIdToken(provider: IDTokenProvider, token: String, rawNonce: String? = null): AuthUser = guard {
        auth.signInWith(IDToken) {
            idToken = token
            this.provider = provider
            nonce = rawNonce
        }
        signedIn()
    }
`)}${on(google, `
    /** Browser OAuth flow (the session arrives through authState). For a native sheet use signInWithIdToken. */
    override suspend fun signInWithGoogle(): AuthUser = guard {
        auth.signInWith(Google)
        signedIn()
    }
`)}${on(apple, `
    override suspend fun signInWithApple(): AuthUser = guard {
        auth.signInWith(Apple)
        signedIn()
    }
`)}${on(phone, `
    /** The "verification id" is the phone number itself (Supabase verifies phone + code). */
    override suspend fun startPhoneSignIn(phone: String): String = guard {
        auth.signInWith(OTP) { this.phone = phone }
        phone
    }

    override suspend fun confirmPhoneCode(verificationId: String, code: String): AuthUser = guard {
        auth.verifyPhoneOtp(io.github.jan.supabase.auth.OtpType.Phone.SMS, verificationId, code)
        signedIn()
    }
`)}${on(has(c, 'passkey'), passkeyStubs)}${on(c.guest, `
    override suspend fun signInAsGuest(): AuthUser = guard {
        auth.signInAnonymously()
        signedIn()
    }
`)}${on(c.linking && email, `
    /** Turns the guest (anonymous) account into an email account: same id, same data. Sends a confirmation email. */
    override suspend fun linkEmail(email: String, password: String): AuthUser = guard {
        auth.updateUser {
            this.email = email
            this.password = password
        }
        signedIn()
    }
`)}${on(c.linking && google, `
    override suspend fun linkGoogle(): AuthUser = guard {
        auth.linkIdentity(Google)
        signedIn()
    }
`)}${on(c.linking && apple, `
    override suspend fun linkApple(): AuthUser = guard {
        auth.linkIdentity(Apple)
        signedIn()
    }
`)}${on(c.linking, `
    override suspend fun unlink(method: AuthMethod): AuthUser = guard {
        val name = when (method) {
            ${[...nameOf, 'else -> throw AuthError(AuthErrorCode.METHOD_DISABLED, "not_linkable")'].join('\n            ')}
        }
        val identity = auth.currentIdentitiesOrNull()?.firstOrNull { it.provider == name } ?: throw AuthError(AuthErrorCode.UNKNOWN, "not_linked")
        auth.unlinkIdentity(identity.identityId ?: identity.id)
        auth.refreshCurrentSession()
        signedIn()
    }
`)}${on(mfa(c), `
    override suspend fun mfaFactors(): List<MfaFactor> = guard {
        auth.mfa.retrieveFactorsForCurrentUser().filter { it.isVerified }.map { MfaFactor(it.id, if (it.factorType == "phone") "sms" else "totp", it.friendlyName) }
    }

    override suspend fun completeMfaSignIn(code: String): AuthUser = guard {
        val (factorId, challengeId) = pendingMfa ?: throw AuthError(AuthErrorCode.CODE_EXPIRED, "no_pending_mfa")
        auth.mfa.verifyChallenge(factorId, challengeId, code)
        pendingMfa = null
        map(user()).also { current = it }
    }

    override suspend fun unenrollMfa(factorId: String) = guard { auth.mfa.unenroll(factorId) }
`)}${on(mf(c, 'totp'), `
    override suspend fun enrollTotpStart(): TotpEnrollment = guard {
        val factor = auth.mfa.enroll(FactorType.TOTP) { issuer = ${issuer(c)} }
        pendingTotpFactor = factor.id
        TotpEnrollment(factor.data.secret, factor.data.uri)
    }

    override suspend fun enrollTotpFinish(code: String) = guard {
        val id = pendingTotpFactor ?: throw AuthError(AuthErrorCode.CODE_EXPIRED, "no_pending_totp")
        auth.mfa.createChallengeAndVerify(id, code)
        pendingTotpFactor = null
    }
`)}${on(mf(c, 'sms'), `
    /** Returns "factorId:challengeId" — pass it back to enrollSmsFinish. */
    override suspend fun enrollSmsStart(phone: String): String = guard {
        val factor = auth.mfa.enroll(FactorType.Phone) { this.phone = phone }
        factor.id + ":" + auth.mfa.createChallenge(factor.id).id
    }

    override suspend fun enrollSmsFinish(verificationId: String, code: String) = guard {
        val (factorId, challengeId) = verificationId.split(":", limit = 2)
        auth.mfa.verifyChallenge(factorId, challengeId, code)
        Unit
    }
`)}
    /** Deletion checks that the last sign-in is recent: signing in again refreshes it. */
    override suspend fun reauthenticate(password: String?) = guard {
        val u = user()
        val providers = (u.identities ?: emptyList()).map { it.provider }
        when {
            password != null && u.email != null && "email" in providers -> auth.signInWith(Email) {
                this.email = u.email!!
                this.password = password
            }
${on(google, '            "google" in providers -> auth.signInWith(Google)\n')}${on(apple, '            "apple" in providers -> auth.signInWith(Apple)\n')}            else -> throw AuthError(AuthErrorCode.REQUIRES_RECENT_LOGIN, "sign_in_again")
        }
    }

    override suspend fun refreshUser(): AuthUser? = guard {
        if (auth.currentSessionOrNull() == null) {
            current = null
            null
        } else {
            auth.refreshCurrentSession() // new JWT = new app_metadata.role
            map(user()).also { current = it }
        }
    }

    override suspend fun signOut() {
        auth.signOut()
        current = null
    }

    override suspend fun deleteAccount() = guard {
        try {
            api.deleteAccount() // Edge Function: data cleanup + deletion
        } catch (e: ApiError) {
            if (e.code == "failed-precondition") throw AuthError(AuthErrorCode.REQUIRES_RECENT_LOGIN, "requires_recent_login")
            throw e
        }
        signOut()
    }
}
`
}
