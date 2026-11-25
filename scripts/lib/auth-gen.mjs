// Generated auth catalog for every stack (DualCraft auth): roles, sign-in methods, route access rules with
// decideAccess(), password policy, normalized error codes (Firebase + Supabase) and the AuthService interface the
// app implements. Pure code: no SDK imports, so it compiles anywhere.

export const METHODS = ['email', 'google', 'apple', 'passkey', 'phone']
export const ACCESS = ['public', 'guest', 'signedIn', 'verified']
export const MFA_FACTORS = ['totp', 'sms']
export const ERROR_CODES = ['invalidCredentials', 'invalidEmail', 'emailInUse', 'weakPassword', 'emailNotVerified', 'requiresRecentLogin', 'mfaRequired', 'invalidCode', 'codeExpired', 'accountExistsWithDifferentMethod', 'credentialInUse', 'alreadyLinked', 'userDisabled', 'tooManyRequests', 'network', 'cancelled', 'methodDisabled', 'unknown']
/** Raw provider codes, normalized (lowercase, no "auth/" or "error_" prefix, "_" → "-"), to our codes. */
export const ERROR_MAP = {
  // Firebase (web "auth/x", Android "ERROR_X", iOS/Flutter "x")
  'invalid-credential': 'invalidCredentials', 'invalid-login-credentials': 'invalidCredentials', 'wrong-password': 'invalidCredentials', 'user-not-found': 'invalidCredentials',
  'invalid-email': 'invalidEmail', 'email-already-in-use': 'emailInUse', 'weak-password': 'weakPassword', 'unverified-email': 'emailNotVerified',
  'requires-recent-login': 'requiresRecentLogin', 'multi-factor-auth-required': 'mfaRequired', 'second-factor-required': 'mfaRequired',
  'invalid-verification-code': 'invalidCode', 'invalid-verification-id': 'invalidCode', 'code-expired': 'codeExpired', 'session-expired': 'codeExpired',
  'account-exists-with-different-credential': 'accountExistsWithDifferentMethod', 'credential-already-in-use': 'credentialInUse', 'email-already-linked': 'credentialInUse',
  'provider-already-linked': 'alreadyLinked', 'user-disabled': 'userDisabled', 'too-many-requests': 'tooManyRequests', 'quota-exceeded': 'tooManyRequests',
  'network-request-failed': 'network', 'popup-closed-by-user': 'cancelled', 'cancelled-popup-request': 'cancelled', 'web-context-canceled': 'cancelled', 'web-context-cancelled': 'cancelled', 'canceled': 'cancelled', 'cancelled': 'cancelled',
  'operation-not-allowed': 'methodDisabled', 'admin-restricted-operation': 'methodDisabled',
  // Supabase (error.code)
  'invalid-credentials': 'invalidCredentials', 'email-address-invalid': 'invalidEmail', 'email-exists': 'emailInUse', 'user-already-exists': 'emailInUse', 'phone-exists': 'emailInUse',
  'email-not-confirmed': 'emailNotVerified', 'phone-not-confirmed': 'emailNotVerified', 'reauthentication-needed': 'requiresRecentLogin', 'reauthentication-not-valid': 'requiresRecentLogin',
  'insufficient-aal': 'mfaRequired', 'mfa-verification-failed': 'invalidCode', 'mfa-challenge-expired': 'codeExpired', 'otp-expired': 'codeExpired',
  'identity-already-exists': 'credentialInUse', 'user-banned': 'userDisabled', 'over-request-rate-limit': 'tooManyRequests', 'over-email-send-rate-limit': 'tooManyRequests', 'over-sms-send-rate-limit': 'tooManyRequests',
  'provider-disabled': 'methodDisabled', 'email-provider-disabled': 'methodDisabled', 'phone-provider-disabled': 'methodDisabled', 'anonymous-provider-disabled': 'methodDisabled', 'signup-disabled': 'methodDisabled',
}
export const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
const pascal = (s) => s[0].toUpperCase() + s.slice(1)
const q = (s) => JSON.stringify(s)
const upper = (s) => snake(s).toUpperCase()

/** The AuthService surface for a config: [name, params [[name, type]], returns 'user'|'void'|'string'|'totp'|'factors', doc]. */
export function serviceMembers(c) {
  const m = []
  const has = (x) => c.methods.includes(x)
  if (has('email')) m.push(['signUpWithEmail', [['email', 'string'], ['password', 'string'], ['displayName', 'string?']], 'user', 'Creates the account and sends the verification email'], ['signInWithEmail', [['email', 'string'], ['password', 'string']], 'user', ''], ['sendPasswordReset', [['email', 'string']], 'void', ''], ['sendEmailVerification', [], 'void', ''])
  if (has('google')) m.push(['signInWithGoogle', [], 'user', ''])
  if (has('apple')) m.push(['signInWithApple', [], 'user', ''])
  if (has('phone')) m.push(['startPhoneSignIn', [['phone', 'string']], 'string', 'Sends the SMS; returns the verification id'], ['confirmPhoneCode', [['verificationId', 'string'], ['code', 'string']], 'user', ''])
  if (has('passkey')) m.push(['signInWithPasskey', [], 'user', ''], ['registerPasskey', [], 'void', 'Adds a passkey to the signed-in account'])
  if (c.guest) m.push(['signInAsGuest', [], 'user', 'Anonymous session; link a method later to keep the data'])
  if (c.linking) {
    if (has('email')) m.push(['linkEmail', [['email', 'string'], ['password', 'string']], 'user', ''])
    if (has('google')) m.push(['linkGoogle', [], 'user', ''])
    if (has('apple')) m.push(['linkApple', [], 'user', ''])
    m.push(['unlink', [['method', 'method']], 'user', ''])
  }
  const f = c.mfa?.factors || []
  if (f.length) {
    m.push(['mfaFactors', [], 'factors', ''], ['completeMfaSignIn', [['code', 'string']], 'user', 'After an AuthError mfaRequired: verify the second factor'], ['unenrollMfa', [['factorId', 'string']], 'void', ''])
    if (f.includes('totp')) m.push(['enrollTotpStart', [], 'totp', 'Secret + otpauth:// URI for the authenticator app (show it as a QR)'], ['enrollTotpFinish', [['code', 'string']], 'void', ''])
    if (f.includes('sms')) m.push(['enrollSmsStart', [['phone', 'string']], 'string', ''], ['enrollSmsFinish', [['verificationId', 'string'], ['code', 'string']], 'void', ''])
  }
  m.push(['reauthenticate', [['password', 'string?']], 'void', 'Before sensitive actions (requiresRecentLogin): password, or the social provider again'], ['refreshUser', [], 'user?', 'Reloads the user and the role claim'], ['signOut', [], 'void', ''], ['deleteAccount', [], 'void', 'Server-side cleanup + deletion (needs a recent sign-in)'])
  return m
}

// ---------------------------------------------------------------- TypeScript
export function genTs(c) {
  const roles = c.roles.map(q).join(' | ')
  const methods = [...c.methods, ...(c.guest ? ['guest'] : [])]
  const T = { string: 'string', 'string?': 'string | null', method: 'AuthMethod' }
  const R = { user: 'Promise<AuthUser>', 'user?': 'Promise<AuthUser | null>', void: 'Promise<void>', string: 'Promise<string>', totp: 'Promise<TotpEnrollment>', factors: 'Promise<MfaFactor[]>' }
  const access = (r) => (r.roles ? `{ kind: 'roles', roles: [${r.roles.map(q).join(', ')}] }` : `{ kind: ${q(r.access)} }`)
  return `// Auth catalog (DualCraft auth) — generated from .dualcraft/auth/auth.json. Do not edit: run auth.mjs gen.
export type AuthRole = ${roles}
export const AUTH_ROLES: readonly AuthRole[] = [${c.roles.map(q).join(', ')}]
export const DEFAULT_ROLE: AuthRole = ${q(c.defaultRole)}
export const ADMIN_ROLE: AuthRole = ${q(c.adminRole)}
/** Role claim → role (missing or unknown = default role). */
export const roleFrom = (v: unknown): AuthRole => (AUTH_ROLES as readonly unknown[]).includes(v) ? (v as AuthRole) : DEFAULT_ROLE

export type AuthMethod = ${methods.map(q).join(' | ')}
export const AUTH_METHODS: readonly AuthMethod[] = [${methods.map(q).join(', ')}]
export const AUTH_FEATURES = { guest: ${!!c.guest}, linking: ${!!c.linking}, emailVerification: ${q(c.email?.verification || 'optional')}, mfa: [${(c.mfa?.factors || []).map(q).join(', ')}] as const, mfaEnforce: ${q(c.mfa?.enforce || 'optional')} } as const

export interface AuthUser {
  uid: string
  email: string | null
  phone: string | null
  displayName: string | null
  photoUrl: string | null
  isAnonymous: boolean
  emailVerified: boolean
  role: AuthRole
  methods: AuthMethod[]
  mfaEnrolled: boolean
}

// ---- route access
export type RouteAccess = { kind: 'public' } | { kind: 'guest' } | { kind: 'signedIn' } | { kind: 'verified' } | { kind: 'roles'; roles: AuthRole[] }
export type AccessDecision = 'allow' | 'signIn' | 'verifyEmail' | 'forbidden'
export const AUTH_ROUTES = { signIn: ${q(c.routes.signIn)}, afterSignIn: ${q(c.routes.afterSignIn)}, verifyEmail: ${q(c.routes.verifyEmail)} } as const
export const ROUTE_RULES: readonly { pattern: string; access: RouteAccess }[] = [
${c.routes.rules.map((r) => `  { pattern: ${q(r.path)}, access: ${access(r)} },`).join('\n')}
]
const segs = (p: string) => p.split(/[?#]/)[0].split('/').filter(Boolean)
function matchSegs(p: string[], s: string[], i = 0, j = 0): boolean {
  if (i === p.length) return j === s.length
  if (p[i] === '**') { for (let k = j; k <= s.length; k++) if (matchSegs(p, s, i + 1, k)) return true; return false }
  if (j === s.length) return false
  return (p[i] === '*' || p[i].startsWith(':') || p[i] === s[j]) && matchSegs(p, s, i + 1, j + 1)
}
/** First matching rule wins; no match = signed-in users only. */
export const accessFor = (path: string): RouteAccess => ROUTE_RULES.find((r) => matchSegs(segs(r.pattern), segs(path)))?.access ?? { kind: 'signedIn' }
export function decideAccess(path: string, user: AuthUser | null): AccessDecision {
  const a = accessFor(path)
  if (a.kind === 'public') return 'allow'
  if (!user) return 'signIn'
  if (a.kind === 'guest') return 'allow'
  if (user.isAnonymous) return 'signIn'
  if (a.kind === 'signedIn') return 'allow'
  if (a.kind === 'verified') return user.email && !user.emailVerified ? 'verifyEmail' : 'allow'
  return a.roles.includes(user.role) ? 'allow' : 'forbidden'
}

// ---- passwords
export const PASSWORD_POLICY = { minLength: ${c.password.minLength}, upper: ${!!c.password.upper}, digit: ${!!c.password.digit}, symbol: ${!!c.password.symbol} } as const
export type PasswordProblem = 'tooShort' | 'noUpper' | 'noDigit' | 'noSymbol'
export function passwordProblems(pw: string): PasswordProblem[] {
  const out: PasswordProblem[] = []
  if (pw.length < PASSWORD_POLICY.minLength) out.push('tooShort')
  if (PASSWORD_POLICY.upper && !/[A-Z]/.test(pw)) out.push('noUpper')
  if (PASSWORD_POLICY.digit && !/[0-9]/.test(pw)) out.push('noDigit')
  if (PASSWORD_POLICY.symbol && !/[^A-Za-z0-9]/.test(pw)) out.push('noSymbol')
  return out
}

// ---- errors (texts: i18n auth.errors.<snake_case code>)
export type AuthErrorCode = ${ERROR_CODES.map(q).join(' | ')}
const ERROR_MAP: Record<string, AuthErrorCode> = ${JSON.stringify(ERROR_MAP)}
/** Firebase / Supabase error code → AuthErrorCode. */
export const authErrorFrom = (raw: string | null | undefined): AuthErrorCode => ERROR_MAP[String(raw ?? '').toLowerCase().replace(/^auth\\//, '').replace(/^error_/, '').replace(/_/g, '-')] ?? 'unknown'
export const authErrorKey = (code: AuthErrorCode) => 'auth.errors.' + code.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly raw?: string) { super(code); this.name = 'AuthError' }
}

// ---- the service the app implements (lib/auth-service.ts)
export interface TotpEnrollment { secret: string; uri: string }
export interface MfaFactor { id: string; kind: 'totp' | 'sms'; label: string | null }
export interface AuthService {
  readonly currentUser: AuthUser | null
  /** Calls back on sign-in, sign-out and token refresh; returns the unsubscribe function. */
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void
${serviceMembers(c).map(([n, ps, r, d]) => `${d ? `  /** ${d} */\n` : ''}  ${n}(${ps.map(([p, t]) => `${p}${t.endsWith('?') ? '?' : ''}: ${T[t]}`).join(', ')}): ${R[r]}`).join('\n')}
}
`
}

// ---------------------------------------------------------------- Dart
export function genDart(c) {
  const methods = [...c.methods, ...(c.guest ? ['guest'] : [])]
  const T = { string: 'String', 'string?': 'String?', method: 'AuthMethod' }
  const R = { user: 'Future<AuthUser>', 'user?': 'Future<AuthUser?>', void: 'Future<void>', string: 'Future<String>', totp: 'Future<TotpEnrollment>', factors: 'Future<List<MfaFactor>>' }
  const access = (r) => (r.roles ? `RouteAccess.roles([${r.roles.map((x) => 'AuthRole.' + x).join(', ')}])` : `RouteAccess.${r.access}()`)
  const sig = ([n, ps, r]) => {
    const req = ps.filter(([, t]) => !t.endsWith('?')); const opt = ps.filter(([, t]) => t.endsWith('?'))
    return `${R[r]} ${n}(${[...req.map(([p, t]) => `${T[t]} ${p}`), ...(opt.length ? [`{${opt.map(([p, t]) => `${T[t]} ${p}`).join(', ')}}`] : [])].join(', ')});`
  }
  return `// Auth catalog (DualCraft auth) — generated from .dualcraft/auth/auth.json. Do not edit: run auth.mjs gen.
// ignore_for_file: constant_identifier_names

enum AuthRole { ${c.roles.join(', ')} }
const defaultRole = AuthRole.${c.defaultRole};
const adminRole = AuthRole.${c.adminRole};
/// Role claim → role (missing or unknown = default role).
AuthRole roleFrom(Object? v) => AuthRole.values.where((r) => r.name == v).firstOrNull ?? defaultRole;

enum AuthMethod { ${methods.join(', ')} }
abstract final class AuthFeatures {
  static const guest = ${!!c.guest};
  static const linking = ${!!c.linking};
  static const emailVerificationRequired = ${(c.email?.verification || 'optional') === 'required'};
  static const mfa = <String>[${(c.mfa?.factors || []).map(q).join(', ')}];
  static const mfaEnforce = ${q(c.mfa?.enforce || 'optional')};
}

class AuthUser {
  const AuthUser({required this.uid, this.email, this.phone, this.displayName, this.photoUrl, this.isAnonymous = false, this.emailVerified = false, this.role = defaultRole, this.methods = const [], this.mfaEnrolled = false});
  final String uid;
  final String? email;
  final String? phone;
  final String? displayName;
  final String? photoUrl;
  final bool isAnonymous;
  final bool emailVerified;
  final AuthRole role;
  final List<AuthMethod> methods;
  final bool mfaEnrolled;
}

// ---- route access
sealed class RouteAccess {
  const RouteAccess();
  const factory RouteAccess.public() = PublicAccess;
  const factory RouteAccess.guest() = GuestAccess;
  const factory RouteAccess.signedIn() = SignedInAccess;
  const factory RouteAccess.verified() = VerifiedAccess;
  const factory RouteAccess.roles(List<AuthRole> roles) = RolesAccess;
}
class PublicAccess extends RouteAccess { const PublicAccess(); }
class GuestAccess extends RouteAccess { const GuestAccess(); }
class SignedInAccess extends RouteAccess { const SignedInAccess(); }
class VerifiedAccess extends RouteAccess { const VerifiedAccess(); }
class RolesAccess extends RouteAccess {
  const RolesAccess(this.roles);
  final List<AuthRole> roles;
}
enum AccessDecision { allow, signIn, verifyEmail, forbidden }
abstract final class AuthRoutes {
  static const signIn = ${q(c.routes.signIn)};
  static const afterSignIn = ${q(c.routes.afterSignIn)};
  static const verifyEmail = ${q(c.routes.verifyEmail)};
}
const routeRules = <(String, RouteAccess)>[
${c.routes.rules.map((r) => `  (${q(r.path)}, ${access(r)}),`).join('\n')}
];
List<String> _segs(String p) => p.split(RegExp(r'[?#]')).first.split('/').where((s) => s.isNotEmpty).toList();
bool _match(List<String> p, List<String> s, [int i = 0, int j = 0]) {
  if (i == p.length) return j == s.length;
  if (p[i] == '**') {
    for (var k = j; k <= s.length; k++) {
      if (_match(p, s, i + 1, k)) return true;
    }
    return false;
  }
  if (j == s.length) return false;
  return (p[i] == '*' || p[i].startsWith(':') || p[i] == s[j]) && _match(p, s, i + 1, j + 1);
}
/// First matching rule wins; no match = signed-in users only.
RouteAccess accessFor(String path) {
  for (final (pattern, access) in routeRules) {
    if (_match(_segs(pattern), _segs(path))) return access;
  }
  return const RouteAccess.signedIn();
}
AccessDecision decideAccess(String path, AuthUser? user) {
  final a = accessFor(path);
  if (a is PublicAccess) return AccessDecision.allow;
  if (user == null) return AccessDecision.signIn;
  if (a is GuestAccess) return AccessDecision.allow;
  if (user.isAnonymous) return AccessDecision.signIn;
  return switch (a) {
    VerifiedAccess() => user.email != null && !user.emailVerified ? AccessDecision.verifyEmail : AccessDecision.allow,
    RolesAccess(:final roles) => roles.contains(user.role) ? AccessDecision.allow : AccessDecision.forbidden,
    _ => AccessDecision.allow,
  };
}

// ---- passwords
abstract final class PasswordPolicy {
  static const minLength = ${c.password.minLength};
  static const upper = ${!!c.password.upper};
  static const digit = ${!!c.password.digit};
  static const symbol = ${!!c.password.symbol};
}
enum PasswordProblem { tooShort, noUpper, noDigit, noSymbol }
List<PasswordProblem> passwordProblems(String pw) => [
      if (pw.length < PasswordPolicy.minLength) PasswordProblem.tooShort,
      if (PasswordPolicy.upper && !pw.contains(RegExp('[A-Z]'))) PasswordProblem.noUpper,
      if (PasswordPolicy.digit && !pw.contains(RegExp('[0-9]'))) PasswordProblem.noDigit,
      if (PasswordPolicy.symbol && !pw.contains(RegExp('[^A-Za-z0-9]'))) PasswordProblem.noSymbol,
    ];

// ---- errors (texts: i18n auth.errors.<snake_case code>)
enum AuthErrorCode { ${ERROR_CODES.join(', ')} }
const _errorMap = <String, AuthErrorCode>{
${Object.entries(ERROR_MAP).map(([k, v]) => `  ${q(k)}: AuthErrorCode.${v},`).join('\n')}
};
/// Firebase / Supabase error code → AuthErrorCode.
AuthErrorCode authErrorFrom(String? raw) => _errorMap[(raw ?? '').toLowerCase().replaceFirst(RegExp('^auth/'), '').replaceFirst(RegExp('^error_'), '').replaceAll('_', '-')] ?? AuthErrorCode.unknown;
String authErrorKey(AuthErrorCode code) => 'auth.errors.\${code.name.replaceAllMapped(RegExp('([a-z0-9])([A-Z])'), (m) => '\${m[1]}_\${m[2]}').toLowerCase()}';
class AuthError implements Exception {
  const AuthError(this.code, [this.raw]);
  final AuthErrorCode code;
  final String? raw;
  @override
  String toString() => 'AuthError(\${code.name}\${raw == null ? '' : ', \$raw'})';
}

// ---- the service the app implements (lib/services/auth_service.dart)
class TotpEnrollment {
  const TotpEnrollment(this.secret, this.uri);
  final String secret;
  final String uri;
}
class MfaFactor {
  const MfaFactor(this.id, this.kind, [this.label]);
  final String id;
  final String kind; // 'totp' | 'sms'
  final String? label;
}
abstract interface class AuthService {
  AuthUser? get currentUser;
  /// Emits on sign-in, sign-out and token refresh.
  Stream<AuthUser?> authStateChanges();
${serviceMembers(c).map((m) => `${m[3] ? `  /// ${m[3]}\n` : ''}  ${sig(m)}`).join('\n')}
}
`
}

// ---------------------------------------------------------------- Kotlin
export function genKotlin(c, pkg) {
  const methods = [...c.methods, ...(c.guest ? ['guest'] : [])]
  const T = { string: 'String', 'string?': 'String? = null', method: 'AuthMethod' }
  const R = { user: 'AuthUser', 'user?': 'AuthUser?', void: 'Unit', string: 'String', totp: 'TotpEnrollment', factors: 'List<MfaFactor>' }
  const access = (r) => (r.roles ? `RouteAccess.Roles(listOf(${r.roles.map((x) => 'AuthRole.' + upper(x)).join(', ')}))` : `RouteAccess.${pascal(r.access)}`)
  return `// Auth catalog (DualCraft auth) — generated from .dualcraft/auth/auth.json. Do not edit: run auth.mjs gen.
package ${pkg}

import kotlinx.coroutines.flow.Flow

enum class AuthRole(val claim: String) { ${c.roles.map((r) => `${upper(r)}(${q(r)})`).join(', ')} }
val DEFAULT_ROLE = AuthRole.${upper(c.defaultRole)}
val ADMIN_ROLE = AuthRole.${upper(c.adminRole)}
/** Role claim → role (missing or unknown = default role). */
fun roleFrom(v: Any?): AuthRole = AuthRole.entries.firstOrNull { it.claim == v } ?: DEFAULT_ROLE

enum class AuthMethod { ${methods.map(upper).join(', ')} }
object AuthFeatures {
    const val GUEST = ${!!c.guest}
    const val LINKING = ${!!c.linking}
    const val EMAIL_VERIFICATION_REQUIRED = ${(c.email?.verification || 'optional') === 'required'}
    val MFA: List<String> = listOf(${(c.mfa?.factors || []).map(q).join(', ')})
    const val MFA_ENFORCE = ${q(c.mfa?.enforce || 'optional')}
}

data class AuthUser(
    val uid: String,
    val email: String? = null,
    val phone: String? = null,
    val displayName: String? = null,
    val photoUrl: String? = null,
    val isAnonymous: Boolean = false,
    val emailVerified: Boolean = false,
    val role: AuthRole = DEFAULT_ROLE,
    val methods: List<AuthMethod> = emptyList(),
    val mfaEnrolled: Boolean = false,
)

// ---- route access
sealed interface RouteAccess {
    data object Public : RouteAccess
    data object Guest : RouteAccess
    data object SignedIn : RouteAccess
    data object Verified : RouteAccess
    data class Roles(val roles: List<AuthRole>) : RouteAccess
}
enum class AccessDecision { ALLOW, SIGN_IN, VERIFY_EMAIL, FORBIDDEN }
object AuthRoutes {
    const val SIGN_IN = ${q(c.routes.signIn)}
    const val AFTER_SIGN_IN = ${q(c.routes.afterSignIn)}
    const val VERIFY_EMAIL = ${q(c.routes.verifyEmail)}
}
val ROUTE_RULES: List<Pair<String, RouteAccess>> = listOf(
${c.routes.rules.map((r) => `    ${q(r.path)} to ${access(r)},`).join('\n')}
)
private fun segs(p: String) = p.split('?', '#').first().split('/').filter { it.isNotEmpty() }
private fun match(p: List<String>, s: List<String>, i: Int = 0, j: Int = 0): Boolean {
    if (i == p.size) return j == s.size
    if (p[i] == "**") return (j..s.size).any { match(p, s, i + 1, it) }
    if (j == s.size) return false
    return (p[i] == "*" || p[i].startsWith(":") || p[i] == s[j]) && match(p, s, i + 1, j + 1)
}
/** First matching rule wins; no match = signed-in users only. */
fun accessFor(path: String): RouteAccess = ROUTE_RULES.firstOrNull { match(segs(it.first), segs(path)) }?.second ?: RouteAccess.SignedIn
fun decideAccess(path: String, user: AuthUser?): AccessDecision {
    val a = accessFor(path)
    if (a == RouteAccess.Public) return AccessDecision.ALLOW
    if (user == null) return AccessDecision.SIGN_IN
    if (a == RouteAccess.Guest) return AccessDecision.ALLOW
    if (user.isAnonymous) return AccessDecision.SIGN_IN
    return when (a) {
        RouteAccess.Verified -> if (user.email != null && !user.emailVerified) AccessDecision.VERIFY_EMAIL else AccessDecision.ALLOW
        is RouteAccess.Roles -> if (user.role in a.roles) AccessDecision.ALLOW else AccessDecision.FORBIDDEN
        else -> AccessDecision.ALLOW
    }
}

// ---- passwords
object PasswordPolicy {
    const val MIN_LENGTH = ${c.password.minLength}
    const val UPPER = ${!!c.password.upper}
    const val DIGIT = ${!!c.password.digit}
    const val SYMBOL = ${!!c.password.symbol}
}
enum class PasswordProblem { TOO_SHORT, NO_UPPER, NO_DIGIT, NO_SYMBOL }
fun passwordProblems(pw: String): List<PasswordProblem> = buildList {
    if (pw.length < PasswordPolicy.MIN_LENGTH) add(PasswordProblem.TOO_SHORT)
    if (PasswordPolicy.UPPER && pw.none { it.isUpperCase() }) add(PasswordProblem.NO_UPPER)
    if (PasswordPolicy.DIGIT && pw.none { it.isDigit() }) add(PasswordProblem.NO_DIGIT)
    if (PasswordPolicy.SYMBOL && pw.all { it.isLetterOrDigit() }) add(PasswordProblem.NO_SYMBOL)
}

// ---- errors (texts: i18n auth.errors.<snake_case code>)
enum class AuthErrorCode(val key: String) { ${ERROR_CODES.map((e) => `${upper(e)}("auth.errors.${snake(e)}")`).join(', ')} }
private val ERROR_MAP: Map<String, AuthErrorCode> = mapOf(
${Object.entries(ERROR_MAP).map(([k, v]) => `    ${q(k)} to AuthErrorCode.${upper(v)},`).join('\n')}
)
/** Firebase / Supabase error code → AuthErrorCode. */
fun authErrorFrom(raw: String?): AuthErrorCode = ERROR_MAP[(raw ?: "").lowercase().removePrefix("auth/").removePrefix("error_").replace('_', '-')] ?: AuthErrorCode.UNKNOWN
class AuthError(val code: AuthErrorCode, val raw: String? = null) : Exception(code.name)

// ---- the service the app implements
data class TotpEnrollment(val secret: String, val uri: String)
data class MfaFactor(val id: String, val kind: String, val label: String? = null)
interface AuthService {
    val currentUser: AuthUser?
    /** Emits on sign-in, sign-out and token refresh. */
    val authState: Flow<AuthUser?>
${serviceMembers(c).map(([n, ps, r, d]) => `${d ? `    /** ${d} */\n` : ''}    suspend fun ${n}(${ps.map(([p, t]) => `${p}: ${T[t]}`).join(', ')})${R[r] === 'Unit' ? '' : ': ' + R[r]}`).join('\n')}
}
`
}

// ---------------------------------------------------------------- Swift
export function genSwift(c) {
  const methods = [...c.methods, ...(c.guest ? ['guest'] : [])]
  const T = { string: 'String', 'string?': 'String?', method: 'AuthMethod' }
  const R = { user: 'AuthUser', 'user?': 'AuthUser?', void: '', string: 'String', totp: 'TotpEnrollment', factors: '[MfaFactor]' }
  const access = (r) => (r.roles ? `.roles([${r.roles.map((x) => '.' + x).join(', ')}])` : `.${r.access}`)
  const params = (ps) => ps.map(([p, t], i) => `${i === 0 ? '_ ' : ''}${p}: ${T[t]}`).join(', ')
  return `// Auth catalog (DualCraft auth) — generated from .dualcraft/auth/auth.json. Do not edit: run auth.mjs gen.
import Foundation

enum AuthRole: String, CaseIterable, Codable, Sendable { ${c.roles.map((r) => `case ${r}`).join('; ')} }
let defaultRole = AuthRole.${c.defaultRole}
let adminRole = AuthRole.${c.adminRole}
/// Role claim → role (missing or unknown = default role).
func roleFrom(_ v: Any?) -> AuthRole { (v as? String).flatMap(AuthRole.init(rawValue:)) ?? defaultRole }

enum AuthMethod: String, CaseIterable, Sendable { ${methods.map((m) => `case ${m}`).join('; ')} }
enum AuthFeatures {
    static let guest = ${!!c.guest}
    static let linking = ${!!c.linking}
    static let emailVerificationRequired = ${(c.email?.verification || 'optional') === 'required'}
    static let mfa: [String] = [${(c.mfa?.factors || []).map(q).join(', ')}]
    static let mfaEnforce = ${q(c.mfa?.enforce || 'optional')}
}

struct AuthUser: Equatable, Sendable {
    var uid: String
    var email: String? = nil
    var phone: String? = nil
    var displayName: String? = nil
    var photoUrl: URL? = nil
    var isAnonymous = false
    var emailVerified = false
    var role: AuthRole = defaultRole
    var methods: [AuthMethod] = []
    var mfaEnrolled = false
}

// ---- route access
enum RouteAccess: Equatable, Sendable { case \`public\`, guest, signedIn, verified, roles([AuthRole]) }
enum AccessDecision: Sendable { case allow, signIn, verifyEmail, forbidden }
enum AuthRoutes {
    static let signIn = ${q(c.routes.signIn)}
    static let afterSignIn = ${q(c.routes.afterSignIn)}
    static let verifyEmail = ${q(c.routes.verifyEmail)}
}
let routeRules: [(pattern: String, access: RouteAccess)] = [
${c.routes.rules.map((r) => `    (${q(r.path)}, ${access(r)}),`).join('\n')}
]
private func segs(_ p: String) -> [String] { (p.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map(String.init) ?? "").split(separator: "/").map(String.init) }
private func match(_ p: [String], _ s: [String], _ i: Int = 0, _ j: Int = 0) -> Bool {
    if i == p.count { return j == s.count }
    if p[i] == "**" { return (j...s.count).contains { match(p, s, i + 1, $0) } }
    if j == s.count { return false }
    return (p[i] == "*" || p[i].hasPrefix(":") || p[i] == s[j]) && match(p, s, i + 1, j + 1)
}
/// First matching rule wins; no match = signed-in users only.
func accessFor(_ path: String) -> RouteAccess { routeRules.first { match(segs($0.pattern), segs(path)) }?.access ?? .signedIn }
func decideAccess(_ path: String, user: AuthUser?) -> AccessDecision {
    let a = accessFor(path)
    if a == .public { return .allow }
    guard let user else { return .signIn }
    if a == .guest { return .allow }
    if user.isAnonymous { return .signIn }
    switch a {
    case .verified: return user.email != nil && !user.emailVerified ? .verifyEmail : .allow
    case .roles(let roles): return roles.contains(user.role) ? .allow : .forbidden
    default: return .allow
    }
}

// ---- passwords
enum PasswordPolicy {
    static let minLength = ${c.password.minLength}
    static let upper = ${!!c.password.upper}
    static let digit = ${!!c.password.digit}
    static let symbol = ${!!c.password.symbol}
}
enum PasswordProblem: Sendable { case tooShort, noUpper, noDigit, noSymbol }
func passwordProblems(_ pw: String) -> [PasswordProblem] {
    var out: [PasswordProblem] = []
    if pw.count < PasswordPolicy.minLength { out.append(.tooShort) }
    if PasswordPolicy.upper && !pw.contains(where: { $0.isUppercase }) { out.append(.noUpper) }
    if PasswordPolicy.digit && !pw.contains(where: { $0.isNumber }) { out.append(.noDigit) }
    if PasswordPolicy.symbol && pw.allSatisfy({ $0.isLetter || $0.isNumber }) { out.append(.noSymbol) }
    return out
}

// ---- errors (texts: i18n auth.errors.<snake_case code>)
enum AuthErrorCode: String, Sendable { ${ERROR_CODES.map((e) => `case ${e}`).join('; ')}
    var key: String { "auth.errors." + rawValue.replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1_$2", options: .regularExpression).lowercased() }
}
private let errorMap: [String: AuthErrorCode] = [
${Object.entries(ERROR_MAP).map(([k, v]) => `    ${q(k)}: .${v},`).join('\n')}
]
/// Firebase / Supabase error code → AuthErrorCode.
func authErrorFrom(_ raw: String?) -> AuthErrorCode {
    var k = (raw ?? "").lowercased()
    for p in ["auth/", "error_"] where k.hasPrefix(p) { k.removeFirst(p.count) }
    return errorMap[k.replacingOccurrences(of: "_", with: "-")] ?? .unknown
}
struct AuthError: Error, Equatable { let code: AuthErrorCode; var raw: String? = nil }

// ---- the service the app implements
struct TotpEnrollment: Sendable { let secret: String; let uri: String }
struct MfaFactor: Sendable { let id: String; let kind: String; var label: String? = nil }
@MainActor
protocol AuthService: AnyObject {
    var currentUser: AuthUser? { get }
    /// Emits on sign-in, sign-out and token refresh.
    func authStates() -> AsyncStream<AuthUser?>
${serviceMembers(c).map(([n, ps, r, d]) => `${d ? `    /// ${d}\n` : ''}    func ${n}(${params(ps)}) async throws${R[r] ? ' -> ' + R[r] : ''}`).join('\n')}
}
`
}

// ---------------------------------------------------------------- server (Cloud Functions / Edge Functions)
export function genServer(c, prov) {
  const cleanup = (c.deletion?.cleanup || []).map((x) => ({ collection: x.collection || x.table, field: x.field || null }))
  return `// Auth catalog for the server (DualCraft auth) — generated from .dualcraft/auth/auth.json. Do not edit: run auth.mjs gen.
export const ROLES = [${c.roles.map(q).join(', ')}] as const
export type Role = (typeof ROLES)[number]
export const DEFAULT_ROLE: Role = ${q(c.defaultRole)}
export const ADMIN_ROLE: Role = ${q(c.adminRole)}
export const roleFrom = (v: unknown): Role => ((ROLES as readonly unknown[]).includes(v) ? (v as Role) : DEFAULT_ROLE)
/** Seconds since the last sign-in allowed for sensitive actions (account deletion). */
export const RECENT_LOGIN_SECONDS = ${c.deletion?.recentLoginSeconds ?? 300}
/** What deleteAccount removes. ${prov === 'supabase' ? 'collection = table; field = column with the user id (null: the "id" column)' : 'field = field holding the uid (null: the document with id = uid, with its subcollections)'} */
export const CLEANUP: readonly { collection: string; field: string | null }[] = ${JSON.stringify(cleanup)}
/** Storage prefixes removed on deletion ({uid} is replaced${prov === 'supabase' ? '; first segment = bucket' : ''}). */
export const STORAGE_PREFIXES: readonly string[] = ${JSON.stringify(c.deletion?.storage || [])}
${c.methods.includes('passkey') && prov === 'firebase' ? `/** Passkeys (WebAuthn): relying party = your domain; origins = the web origin(s) + android:apk-key-hash:<base64url SHA-256 of the signing cert>. */
export const PASSKEY_RP_ID = ${q(c.passkey?.rpId || '')}
export const PASSKEY_RP_NAME = ${q(c.passkey?.rpName || 'App')}
export const PASSKEY_ORIGINS: readonly string[] = ${JSON.stringify(passkeyOrigins(c))}
` : ''}`
}

/** Allowed WebAuthn origins: passkey.origins, else https://<rpId>. */
export const passkeyOrigins = (c) => (c.passkey?.origins?.length ? c.passkey.origins : c.passkey?.rpId ? [`https://${c.passkey.rpId}`] : [])
