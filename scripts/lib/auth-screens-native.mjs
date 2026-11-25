// Auth screens for Jetpack Compose (Android: R.string, KMP: Compose Multiplatform Res.string) and SwiftUI.
import { ERROR_CODES, snake } from './auth-gen.mjs'
import { features } from './auth-screens.mjs'

const on = (cond, s) => (cond ? s : '')
const pascal = (s) => s[0].toUpperCase() + s.slice(1)
const upper = (s) => snake(s).toUpperCase()

// ================================================================ Compose (Material 3)
/** opts: { pkg (screens package), catalogPkg, kmp, rPkg (Android namespace for R) | resPkg (KMP generated resources package) } */
export function composeScreens(c, { pkg, catalogPkg, kmp = false, rPkg, resPkg }) {
  const F = features(c)
  const R = kmp ? 'Res.string' : 'R.string'
  const r = (k) => `${R}.auth_ui_${k}`
  const tx = (k, ...args) => `tx(${r(k)}${args.map((a) => ', ' + a).join('')})`
  const social = [F.google && ['signInWithGoogle', 'continue_google'], F.apple && ['signInWithApple', 'continue_apple'], F.passkey && ['signInWithPasskey', 'continue_passkey']].filter(Boolean)
  return `// Auth screens (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// AuthFlow: sign in / sign up / forgot password / phone / second factor / verify email. AccountScreen: methods,
// linking, second factor, passkey, sign out, delete account. authRedirect(): decideAccess() as a redirect for your nav.
// Colors and type: MaterialTheme (DsTheme feeds it from the DS tokens). Texts: ${kmp ? 'composeResources ds_strings.xml (Res.string)' : 'res/values*/ds_strings.xml (R.string)'}.
package ${pkg}

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
${kmp ? `import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import ${resPkg}.Res
import ${resPkg}.*` : `import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource
import ${rPkg}.R`}
import ${catalogPkg}.*

${kmp ? 'private typealias Txt = StringResource' : 'private typealias Txt = Int'}
@Composable
private fun tx(${kmp ? 'id: Txt' : '@StringRes id: Txt'}, vararg args: Any): String = stringResource(id, *args)

/** Where to send \`location\` for \`user\` (null = stay): navigate there from your NavHost when the user changes. */
fun authRedirect(location: String, user: AuthUser?): String? {
    val path = location.substringBefore('#').substringBefore('?')
    return when (decideAccess(path, user)) {
        AccessDecision.ALLOW -> if (user != null && !user.isAnonymous && path == AuthRoutes.SIGN_IN) queryParam(location, "next") ?: AuthRoutes.AFTER_SIGN_IN else null
        AccessDecision.SIGN_IN -> if (path == AuthRoutes.SIGN_IN) null else AuthRoutes.SIGN_IN + "?next=" + percentEncode(location)
        AccessDecision.VERIFY_EMAIL -> if (path == AuthRoutes.VERIFY_EMAIL) null else AuthRoutes.VERIFY_EMAIL
        AccessDecision.FORBIDDEN -> if (path == AuthRoutes.AFTER_SIGN_IN) null else AuthRoutes.AFTER_SIGN_IN
    }
}
private fun percentEncode(s: String) = s.encodeToByteArray().joinToString("") { b ->
    val c = b.toInt() and 0xFF
    if (c.toChar().isLetterOrDigit() && c < 128 || c.toChar() in "-._~/") c.toChar().toString() else "%" + c.toString(16).uppercase().padStart(2, '0')
}
private fun percentDecode(s: String): String {
    val out = mutableListOf<Byte>(); var i = 0
    while (i < s.length) { if (s[i] == '%' && i + 2 < s.length) { out += s.substring(i + 1, i + 3).toInt(16).toByte(); i += 3 } else { out += s[i].toString().encodeToByteArray().toList(); i++ } }
    return out.toByteArray().decodeToString()
}
private fun queryParam(location: String, name: String): String? =
    location.substringAfter('?', "").substringBefore('#').split('&').firstOrNull { it.substringBefore('=') == name }?.substringAfter('=')?.let(::percentDecode)

/** Text resource of an auth error. */
fun authErrorText(code: AuthErrorCode): Txt = when (code) {
${ERROR_CODES.map((e) => `    AuthErrorCode.${upper(e)} -> ${R}.auth_errors_${snake(e)}`).join('\n')}
}
private fun passwordProblemText(p: PasswordProblem): Txt = when (p) {
    PasswordProblem.TOO_SHORT -> ${R}.auth_password_too_short
    PasswordProblem.NO_UPPER -> ${R}.auth_password_no_upper
    PasswordProblem.NO_DIGIT -> ${R}.auth_password_no_digit
    PasswordProblem.NO_SYMBOL -> ${R}.auth_password_no_symbol
}
private fun methodText(m: AuthMethod): Txt = when (m) {
${c.methods.map((m) => `    AuthMethod.${upper(m)} -> ${r('method_' + m)}`).join('\n')}
${on(F.guest, `    AuthMethod.GUEST -> ${r('continue_guest')}\n`)}}

enum class AuthStep { SIGN_IN, SIGN_UP, FORGOT, PHONE, MFA, VERIFY_EMAIL }

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, password: Boolean = false, type: KeyboardType = KeyboardType.Text) =
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else type),
    )

@Composable
private fun Title(text: String) = Text(text, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).semantics { heading() })

/** The whole sign-in flow; [onSignedIn] runs when the user is in (and verified, if required). */
@Composable
fun AuthFlow(service: AuthService, onSignedIn: (AuthUser) -> Unit, modifier: Modifier = Modifier, initialStep: AuthStep = AuthStep.SIGN_IN) {
    var step by rememberSaveable { mutableStateOf(initialStep) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var verificationId by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<AuthErrorCode?>(null) }
    var info by remember { mutableStateOf<Txt?>(null) }
    val scope = rememberCoroutineScope()
    fun go(s: AuthStep) { step = s; error = null; info = null; code = "" }
    fun done(u: AuthUser) { if (${F.verifyRequired} && u.email != null && !u.emailVerified && !u.isAnonymous) go(AuthStep.VERIFY_EMAIL) else onSignedIn(u) }
    fun run(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null; info = null
            try { block() } catch (e: AuthError) {
                when (e.code) {
                    AuthErrorCode.MFA_REQUIRED -> go(AuthStep.MFA)
                    AuthErrorCode.EMAIL_NOT_VERIFIED -> go(AuthStep.VERIFY_EMAIL)
                    AuthErrorCode.CANCELLED -> Unit
                    else -> error = e.code
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { error = AuthErrorCode.UNKNOWN } finally { busy = false }
        }
    }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (step) {
                AuthStep.SIGN_IN -> {
                    Title(${tx('sign_in_title')})
${on(F.email, `                    Field(email, { email = it }, ${tx('email')}, type = KeyboardType.Email)
                    Field(password, { password = it }, ${tx('password')}, password = true)
                    TextButton(onClick = { go(AuthStep.FORGOT) }, modifier = Modifier.align(Alignment.End)) { Text(${tx('forgot')}) }
                    Button(onClick = { run { done(service.signInWithEmail(email.trim(), password)) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('sign_in')}) }
                    TextButton(onClick = { go(AuthStep.SIGN_UP) }, modifier = Modifier.fillMaxWidth()) { Text(${tx('no_account')}) }
`)}${on(social.length || F.phone, `${on(F.email, `                    Text(${tx('or')}, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)\n`)}${social.map(([fn, k]) => `                    OutlinedButton(onClick = { run { done(service.${fn}()) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx(k)}) }`).join('\n')}
${on(F.phone, `                    OutlinedButton(onClick = { go(AuthStep.PHONE) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('continue_phone')}) }\n`)}`)}${on(F.guest, `                    TextButton(onClick = { run { onSignedIn(service.signInAsGuest()) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('continue_guest')}) }\n`)}                }
                AuthStep.SIGN_UP -> {
                    Title(${tx('sign_up_title')})
${on(F.email, `                    val problems = if (password.isEmpty()) emptyList() else passwordProblems(password)
                    Field(name, { name = it }, ${tx('display_name')})
                    Field(email, { email = it }, ${tx('email')}, type = KeyboardType.Email)
                    Field(password, { password = it }, ${tx('password')}, password = true)
                    problems.forEach { Text("• " + tx(passwordProblemText(it), PasswordPolicy.MIN_LENGTH.toString()), style = MaterialTheme.typography.bodySmall) }
                    Button(onClick = { run { done(service.signUpWithEmail(email.trim(), password, name.trim().ifEmpty { null })) } }, enabled = !busy && problems.isEmpty(), modifier = Modifier.fillMaxWidth()) { Text(${tx('sign_up')}) }
`)}                    TextButton(onClick = { go(AuthStep.SIGN_IN) }, modifier = Modifier.fillMaxWidth()) { Text(${tx('have_account')}) }
                }
                AuthStep.FORGOT -> {
                    Title(${tx('forgot_title')})
${on(F.email, `                    Field(email, { email = it }, ${tx('email')}, type = KeyboardType.Email)
                    Button(onClick = { run { service.sendPasswordReset(email.trim()); info = ${r('reset_sent')} } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('send_reset')}) }
`)}                    TextButton(onClick = { go(AuthStep.SIGN_IN) }, modifier = Modifier.fillMaxWidth()) { Text(${tx('back')}) }
                }
                AuthStep.PHONE -> {
                    Title(${tx('continue_phone')})
${on(F.phone, `                    val vid = verificationId
                    if (vid == null) {
                        Field(phone, { phone = it }, ${tx('phone')}, type = KeyboardType.Phone)
                        Button(onClick = { run { verificationId = service.startPhoneSignIn(phone.trim()) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('send_code')}) }
                    } else {
                        Field(code, { code = it }, ${tx('code')}, type = KeyboardType.Number)
                        Button(onClick = { run { done(service.confirmPhoneCode(vid, code.trim())) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('verify')}) }
                    }
`)}                    TextButton(onClick = { verificationId = null; go(AuthStep.SIGN_IN) }, modifier = Modifier.fillMaxWidth()) { Text(${tx('back')}) }
                }
                AuthStep.MFA -> {
                    Title(${tx('mfa_title')})
                    Text(${tx('mfa_hint')}, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
${on(F.mfa, `                    Field(code, { code = it }, ${tx('code')}, type = KeyboardType.Number)
                    Button(onClick = { run { done(service.completeMfaSignIn(code.trim())) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('verify')}) }
`)}                    TextButton(onClick = { go(AuthStep.SIGN_IN) }, modifier = Modifier.fillMaxWidth()) { Text(${tx('back')}) }
                }
                AuthStep.VERIFY_EMAIL -> {
                    Title(${tx('verify_email_title')})
                    Text(${tx('verify_email_body', '(service.currentUser?.email ?: email.trim())')}, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
${on(F.email, `                    OutlinedButton(onClick = { run { service.sendEmailVerification(); info = ${r('email_sent')} } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('resend')}) }\n`)}                    Button(onClick = { run { val u = service.refreshUser(); if (u != null && u.emailVerified) onSignedIn(u) else info = ${r('not_verified_yet')} } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('i_verified')}) }
                    TextButton(onClick = { run { service.signOut(); go(AuthStep.SIGN_IN) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('sign_out')}) }
                }
            }
            if (busy) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
            error?.let { Text(tx(authErrorText(it)), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
            info?.let { Text(tx(it, email.trim()), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        }
    }
}

private class Ask(val title: Txt, val label: Txt? = null, val password: Boolean = false, val message: Txt? = null, val messageArg: String = "", val danger: Boolean = false) {
    val answer = CompletableDeferred<String?>()
}

/** Account: who is signed in, sign-in methods${on(F.linking, ' and linking')}${on(F.mfa, ', second factor')}${on(F.passkey, ', passkey')}, sign out and account deletion. */
@Composable
fun AccountScreen(service: AuthService, onSignedOut: () -> Unit, modifier: Modifier = Modifier) {
    val user by service.authState.collectAsState(initial = service.currentUser)
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Txt?>(null) }
    var asking by remember { mutableStateOf<Ask?>(null) }
    val scope = rememberCoroutineScope()
${on(F.mfa, `    var factors by remember { mutableStateOf<List<MfaFactor>>(emptyList()) }
    suspend fun reloadFactors() { factors = try { service.mfaFactors() } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() } }
    LaunchedEffect(user?.uid) { if (user?.isAnonymous == false) reloadFactors() }
`)}    suspend fun ask(a: Ask): String? { asking = a; return a.answer.await().also { asking = null } }
    fun run(done: Txt? = null, block: suspend () -> Unit) {
        scope.launch {
            busy = true; notice = null
            try { block(); if (done != null) notice = done } catch (e: AuthError) { if (e.code != AuthErrorCode.CANCELLED) notice = authErrorText(e.code) } catch (e: CancellationException) { throw e } catch (e: Exception) { notice = authErrorText(AuthErrorCode.UNKNOWN) } finally { busy = false }
        }
    }
    /** Runs block; on requiresRecentLogin re-authenticates (password, or the provider again) and retries. */
    suspend fun sensitive(block: suspend () -> Unit) {
        try { block() } catch (e: AuthError) {
            if (e.code != AuthErrorCode.REQUIRES_RECENT_LOGIN) throw e
            var password: String? = null
            if (service.currentUser?.methods?.contains(AuthMethod.EMAIL) == true) {
                password = ask(Ask(${r('reauth_title')}, ${r('password')}, password = true, message = ${r('reauth_body')})) ?: return
            }
            service.reauthenticate(password)
            block()
        }
    }
    val u = user ?: return Column(modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator() }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Title(${tx('account_title')})
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(u.displayName ?: u.email ?: u.phone ?: "", style = MaterialTheme.typography.titleMedium)
            Text(u.role.claim, style = MaterialTheme.typography.labelMedium)
        }
${on(F.guest && F.linking, `        if (u.isAnonymous) Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) { Text(${tx('guest_banner')}, Modifier.padding(16.dp)) }\n`)}${on(F.email, `        if (u.email != null && !u.emailVerified) Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(${tx('verify_banner')}, Modifier.weight(1f).padding(8.dp))
                TextButton(onClick = { run(${r('email_sent')}) { service.sendEmailVerification() } }) { Text(${tx('resend')}) }
            }
        }
`)}${on(F.linkable.length, `        Section(${tx('methods_title')})
        listOf(${F.linkable.map((m) => 'AuthMethod.' + upper(m)).join(', ')}).forEach { m ->
            val linked = m in u.methods
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(tx(methodText(m)) + if (linked) " · " + ${tx('linked')} else "")
                if (linked) {
                    if (u.methods.size > 1) TextButton(onClick = { run { service.unlink(m) } }, enabled = !busy) { Text(${tx('unlink')}) }
                } else OutlinedButton(onClick = {
                    run {
                        when (m) {
${F.linkable.map((m) => m === 'email' ? `                            AuthMethod.EMAIL -> {
                                val e = ask(Ask(${r('method_email')}, ${r('email')})) ?: return@run
                                val p = ask(Ask(${r('method_email')}, ${r('password')}, password = true)) ?: return@run
                                service.linkEmail(e, p)
                            }` : `                            AuthMethod.${upper(m)} -> service.link${pascal(m)}()`).join('\n')}
                            else -> Unit
                        }
                    }
                }, enabled = !busy) { Text(${tx('link')}) }
            }
        }
`)}${on(F.mfa, `        Section(${tx('mfa_section')})
        if (factors.isEmpty()) Text(${tx('mfa_none')})
        factors.forEach { f ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(f.label ?: f.kind)
                TextButton(onClick = { run { sensitive { service.unenrollMfa(f.id) }; reloadFactors() } }, enabled = !busy) { Text(${tx('mfa_remove')}) }
            }
        }
${on(F.totp, `        OutlinedButton(onClick = {
            run {
                val e = service.enrollTotpStart()
                val c = ask(Ask(${r('mfa_add_totp')}, ${r('code')}, message = ${r('mfa_secret')}, messageArg = e.secret)) ?: return@run
                service.enrollTotpFinish(c); reloadFactors()
            }
        }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('mfa_add_totp')}) }
`)}${on(F.sms, `        OutlinedButton(onClick = {
            run {
                val p = ask(Ask(${r('mfa_add_sms')}, ${r('phone')})) ?: return@run
                val id = service.enrollSmsStart(p)
                val c = ask(Ask(${r('mfa_add_sms')}, ${r('code')})) ?: return@run
                service.enrollSmsFinish(id, c); reloadFactors()
            }
        }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('mfa_add_sms')}) }
`)}`)}${on(F.passkey, `        OutlinedButton(onClick = { run(${r('passkey_added')}) { service.registerPasskey() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('passkey_add')}) }\n`)}        HorizontalDivider(Modifier.padding(vertical = 16.dp))
        OutlinedButton(onClick = { run { service.signOut(); onSignedOut() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(${tx('sign_out')}) }
        TextButton(
            onClick = {
                run {
                    ask(Ask(${r('delete_title')}, message = ${r('delete_body')}, danger = true)) ?: return@run
                    sensitive { service.deleteAccount(); onSignedOut() }
                }
            },
            enabled = !busy, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text(${tx('delete_account')}) }
        if (busy) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
        notice?.let { Text(tx(it), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        Spacer(Modifier.height(24.dp))
    }
    asking?.let { a -> AskDialog(a) }
}

@Composable
private fun Section(title: String) = Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp).semantics { heading() })

@Composable
private fun AskDialog(a: Ask) {
    var value by remember(a) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { a.answer.complete(null) },
        title = { Text(tx(a.title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                a.message?.let { Text(tx(it, a.messageArg)) }
                a.label?.let { Field(value, { value = it }, tx(it), password = a.password) }
            }
        },
        confirmButton = {
            Button(
                onClick = { a.answer.complete(if (a.label != null) value.trim() else "") },
                colors = if (a.danger) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
            ) { Text(tx(if (a.danger) ${r('delete_confirm')} else ${r('confirm')})) }
        },
        dismissButton = { TextButton(onClick = { a.answer.complete(null) }) { Text(${tx('cancel')}) } },
    )
}
`
}
