// Auth screens for React (web: Next.js / Vite / Astro islands) and React Native — same flow logic, two views.
import { features } from './auth-screens.mjs'

const on = (cond, s) => (cond ? s : '')
const pascal = (s) => s[0].toUpperCase() + s.slice(1)

const I18N = {
  'next-intl': `import { useTranslations } from 'next-intl'
type Vals = Record<string, string | number>
/** next-intl; keys are the shared i18n keys (auth.ui.*, auth.errors.*). */
function useT() { const t = useTranslations(); return (key: string, values?: Vals) => t(key, values) }`,
  'react-i18next': `import { useTranslation } from 'react-i18next'
type Vals = Record<string, string | number>
/** react-i18next (with i18next-icu); keys are the shared i18n keys (auth.ui.*, auth.errors.*). */
function useT() { const { t } = useTranslation(); return (key: string, values?: Vals): string => t(key, values ?? {}) }`,
}

/** Logic shared by the web and native views. */
function logic(c) {
  const F = features(c)
  return `export type AuthStep = 'signIn' | 'signUp' | 'forgot' | 'phone' | 'mfa' | 'verifyEmail'

/** Router redirect from the generated decideAccess(): where to send \`location\` for \`user\` (null = stay). */
export function authRedirect(location: string, user: AuthUser | null): string | null {
  const url = new URL(location, 'http://x')
  switch (decideAccess(url.pathname, user)) {
    case 'allow': return user && !user.isAnonymous && url.pathname === AUTH_ROUTES.signIn ? url.searchParams.get('next') ?? AUTH_ROUTES.afterSignIn : null
    case 'signIn': return url.pathname === AUTH_ROUTES.signIn ? null : \`\${AUTH_ROUTES.signIn}?next=\${encodeURIComponent(location)}\`
    case 'verifyEmail': return url.pathname === AUTH_ROUTES.verifyEmail ? null : AUTH_ROUTES.verifyEmail
    case 'forbidden': return url.pathname === AUTH_ROUTES.afterSignIn ? null : AUTH_ROUTES.afterSignIn
  }
}

/** The signed-in user, kept up to date. undefined = still loading. */
export function useAuthUser(service: AuthService): AuthUser | null | undefined {
  const [user, setUser] = useState<AuthUser | null | undefined>(service.currentUser ?? undefined)
  useEffect(() => service.onAuthStateChanged(setUser), [service])
  return user
}

const errorText = (t: ReturnType<typeof useT>, e: unknown) => t(authErrorKey(e instanceof AuthError ? e.code : 'unknown'))
const PASSWORD_TEXT: Record<PasswordProblem, string> = { tooShort: 'auth.password.too_short', noUpper: 'auth.password.no_upper', noDigit: 'auth.password.no_digit', noSymbol: 'auth.password.no_symbol' }
const METHOD_TEXT: Partial<Record<AuthMethod, string>> = { ${c.methods.map((m) => `${m}: 'auth.ui.method_${m}'`).join(', ')} }

type Ask = { title: string; label?: string; obscure?: boolean; message?: string; danger?: boolean; resolve: (v: string | null) => void }
/** Promise-based dialog state: \`await ask({ title, label })\` → the text, '' when there is no field, null if cancelled. */
function useAsk() {
  const [asking, setAsking] = useState<Ask | null>(null)
  const ask = (o: Omit<Ask, 'resolve'>) => new Promise<string | null>((resolve) => setAsking({ ...o, resolve }))
  const answer = (v: string | null) => { asking?.resolve(v); setAsking(null) }
  return { asking, ask, answer }
}

function useFlow(service: AuthService, onSignedIn: (u: AuthUser) => void, initial: AuthStep) {
  const t = useT()
  const [step, setStep] = useState<AuthStep>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [f, setF] = useState({ email: '', password: '', name: '', phone: '', code: '' })
  const [verificationId, setVerificationId] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const go = (s: AuthStep) => { setStep(s); setError(null); setInfo(null); setF((x) => ({ ...x, code: '' })) }
  const done = (u: AuthUser) => { if (${F.verifyRequired} && u.email && !u.emailVerified && !u.isAnonymous) go('verifyEmail'); else onSignedIn(u) }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setInfo(null)
    try { await action() } catch (e) {
      const code = e instanceof AuthError ? e.code : 'unknown'
      if (code === 'mfaRequired') go('mfa')
      else if (code === 'emailNotVerified') go('verifyEmail')
      else if (code !== 'cancelled') setError(errorText(t, e))
    } finally { setBusy(false) }
  }
  const problems = f.password ? passwordProblems(f.password) : []
  const a = {
${on(F.email, `    signIn: () => run(async () => done(await service.signInWithEmail(f.email.trim(), f.password))),
    signUp: () => run(async () => done(await service.signUpWithEmail(f.email.trim(), f.password, f.name.trim() || null))),
    reset: () => run(async () => { await service.sendPasswordReset(f.email.trim()); setInfo(t('auth.ui.reset_sent', { email: f.email.trim() })) }),
    resend: () => run(async () => { await service.sendEmailVerification(); setInfo(t('auth.ui.email_sent')) }),
`)}${on(F.google, `    google: () => run(async () => done(await service.signInWithGoogle())),\n`)}${on(F.apple, `    apple: () => run(async () => done(await service.signInWithApple())),\n`)}${on(F.passkey, `    passkey: () => run(async () => done(await service.signInWithPasskey())),\n`)}${on(F.guest, `    guest: () => run(async () => onSignedIn(await service.signInAsGuest())),\n`)}${on(F.phone, `    sendCode: () => run(async () => setVerificationId(await service.startPhoneSignIn(f.phone.trim()))),
    confirmCode: () => run(async () => done(await service.confirmPhoneCode(verificationId ?? '', f.code.trim()))),
`)}${on(F.mfa, `    mfa: () => run(async () => done(await service.completeMfaSignIn(f.code.trim()))),\n`)}    checkVerified: () => run(async () => { const u = await service.refreshUser(); if (u?.emailVerified) onSignedIn(u); else setInfo(t('auth.ui.not_verified_yet')) }),
    signOut: () => run(async () => { await service.signOut(); go('signIn') }),
  }
  return { t, step, go, busy, error, info, f, set, problems, verificationId, setVerificationId, a, email: service.currentUser?.email ?? f.email.trim() }
}

function useAccount(service: AuthService, onSignedOut: () => void) {
  const t = useT()
  const user = useAuthUser(service)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { asking, ask, answer } = useAsk()
${on(F.mfa, `  const [factors, setFactors] = useState<MfaFactor[]>([])
  const reloadFactors = () => service.mfaFactors().then(setFactors, () => setFactors([]))
  useEffect(() => { if (user && !user.isAnonymous) void reloadFactors() }, [user?.uid])
`)}  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true); setNotice(null)
    try { await action(); if (done) setNotice(done) } catch (e) {
      if (!(e instanceof AuthError && e.code === 'cancelled')) setNotice(errorText(t, e))
    } finally { setBusy(false) }
  }
  /** Runs action; on requiresRecentLogin re-authenticates (password, or the provider again) and retries. */
  async function sensitive(action: () => Promise<void>) {
    try { await action() } catch (e) {
      if (!(e instanceof AuthError && e.code === 'requiresRecentLogin')) throw e
      let password: string | null = null
      if (service.currentUser?.methods.includes('email' as AuthMethod)) {
        password = await ask({ title: t('auth.ui.reauth_title'), message: t('auth.ui.reauth_body'), label: t('auth.ui.password'), obscure: true })
        if (password === null) return
      }
      await service.reauthenticate(password)
      await action()
    }
  }
  const a = {
    signOut: () => run(async () => { await service.signOut(); onSignedOut() }),
    deleteAccount: async () => {
      const ok = await ask({ title: t('auth.ui.delete_title'), message: t('auth.ui.delete_body'), danger: true })
      if (ok === null) return
      await run(() => sensitive(async () => { await service.deleteAccount(); onSignedOut() }))
    },
${on(F.email, `    resend: () => run(() => service.sendEmailVerification(), t('auth.ui.email_sent')),\n`)}${on(F.linking, `    unlink: (m: AuthMethod) => run(async () => { await service.unlink(m) }),
    link: (m: AuthMethod) => run(async () => {
      switch (m) {
${F.linkable.map((m) => m === 'email' ? `        case 'email': {
          const email = await ask({ title: t('auth.ui.method_email'), label: t('auth.ui.email') }); if (!email) return
          const password = await ask({ title: t('auth.ui.method_email'), label: t('auth.ui.password'), obscure: true }); if (!password) return
          await service.linkEmail(email, password); return
        }` : `        case '${m}': await service.link${pascal(m)}(); return`).join('\n')}
      }
    }),
`)}${on(F.mfa, `    unenroll: (id: string) => run(async () => { await sensitive(() => service.unenrollMfa(id)); await reloadFactors() }),
`)}${on(F.totp, `    addTotp: () => run(async () => {
      const e = await service.enrollTotpStart()
      const code = await ask({ title: t('auth.ui.mfa_add_totp'), message: t('auth.ui.mfa_secret', { secret: e.secret }), label: t('auth.ui.code') }); if (!code) return
      await service.enrollTotpFinish(code); await reloadFactors()
    }),
`)}${on(F.sms, `    addSms: () => run(async () => {
      const phone = await ask({ title: t('auth.ui.mfa_add_sms'), label: t('auth.ui.phone') }); if (!phone) return
      const id = await service.enrollSmsStart(phone)
      const code = await ask({ title: t('auth.ui.mfa_add_sms'), label: t('auth.ui.code') }); if (!code) return
      await service.enrollSmsFinish(id, code); await reloadFactors()
    }),
`)}${on(F.passkey, `    addPasskey: () => run(() => service.registerPasskey(), t('auth.ui.passkey_added')),\n`)}  }
  return { t, user, busy, notice, asking, answer, a${on(F.mfa, ', factors')} }
}
`
}

const header = (stackNote) => `// Auth screens (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// AuthFlow: sign in / sign up / forgot password / phone / second factor / verify email. AccountScreen: methods,
// linking, second factor, passkey, sign out, delete account. authRedirect(): decideAccess() as a redirect.
// ${stackNote}`

// ================================================================ React web
export function reactWebScreens(c, { catalog, i18n = 'react-i18next', next = false }) {
  const F = features(c)
  const social = [F.google && ['google', 'continue_google'], F.apple && ['apple', 'continue_apple'], F.passkey && ['passkey', 'continue_passkey']].filter(Boolean)
  return `${next ? "'use client'\n" : ''}${header(next ? "Next.js: render them in client pages; protect routes with <AuthGate> in a client layout (or middleware with the session cookie)." : 'Use them inside your router; protect routes with <AuthGate>.')}
// Styles: CSS variables from the DS tokens (ds-tokens.css), with fallbacks.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AuthError, authErrorKey, decideAccess, passwordProblems, AUTH_ROUTES, type AuthMethod, type AuthService, type AuthUser, type MfaFactor, type PasswordProblem } from '${catalog}'
${I18N[i18n]}

${logic(c)}
// ---------------------------------------------------------------- view
const v = (name: string, fallback: string) => \`var(--color-\${name}, var(--ds-color-\${name}, \${fallback}))\`
const S = {
  page: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: v('background', 'transparent'), color: v('on-background', 'inherit') },
  card: { width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 },
  title: { fontSize: 24, fontWeight: 600, textAlign: 'center', margin: '0 0 12px' },
  input: { padding: '10px 12px', borderRadius: 8, border: \`1px solid \${v('outline', '#9ca3af')}\`, font: 'inherit', background: 'transparent', color: 'inherit' },
  primary: { padding: '10px 16px', borderRadius: 8, border: 'none', background: v('primary', '#2563eb'), color: v('on-primary', '#fff'), font: 'inherit', fontWeight: 600, cursor: 'pointer' },
  outline: { padding: '10px 16px', borderRadius: 8, border: \`1px solid \${v('outline', '#9ca3af')}\`, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
  link: { padding: 4, border: 'none', background: 'none', color: v('primary', '#2563eb'), font: 'inherit', cursor: 'pointer' },
  error: { color: v('error', '#dc2626'), textAlign: 'center' },
  note: { textAlign: 'center', opacity: 0.8 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0' },
  banner: { padding: 12, borderRadius: 8, background: v('secondary-container', '#eef2ff') },
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, padding: 20, borderRadius: 12, background: v('surface', '#fff'), color: v('on-surface', '#111'), display: 'flex', flexDirection: 'column', gap: 12 },
} satisfies Record<string, CSSProperties>

function Field({ label, value, onChange, type = 'text', autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label}<input style={S.input} type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} /></label>
}

export function AuthFlow({ service, onSignedIn, initialStep = 'signIn' }: { service: AuthService; onSignedIn: (user: AuthUser) => void; initialStep?: AuthStep }) {
  const { t, step, go, busy, error, info, f, set, problems, verificationId, setVerificationId, a, email } = useFlow(service, onSignedIn, initialStep)
  const submit = (fn: () => void) => (e: { preventDefault(): void }) => { e.preventDefault(); fn() }
  let body: ReactNode = null
  switch (step) {
    case 'signIn': body = <>
      <h1 style={S.title}>{t('auth.ui.sign_in_title')}</h1>
${on(F.email, `      <form style={S.card} onSubmit={submit(a.signIn)}>
        <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} type="email" autoComplete="email" />
        <Field label={t('auth.ui.password')} value={f.password} onChange={set('password')} type="password" autoComplete="current-password" />
        <button type="button" style={{ ...S.link, alignSelf: 'flex-end' }} onClick={() => go('forgot')}>{t('auth.ui.forgot')}</button>
        <button type="submit" style={S.primary} disabled={busy}>{t('auth.ui.sign_in')}</button>
        <button type="button" style={S.link} onClick={() => go('signUp')}>{t('auth.ui.no_account')}</button>
      </form>
`)}${on(social.length || F.phone, `${on(F.email, `      <p style={S.note}>{t('auth.ui.or')}</p>\n`)}${social.map(([fn, k]) => `      <button style={S.outline} disabled={busy} onClick={a.${fn}}>{t('auth.ui.${k}')}</button>`).join('\n')}
${on(F.phone, `      <button style={S.outline} disabled={busy} onClick={() => go('phone')}>{t('auth.ui.continue_phone')}</button>\n`)}`)}${on(F.guest, `      <button style={S.link} disabled={busy} onClick={a.guest}>{t('auth.ui.continue_guest')}</button>\n`)}    </>; break
    case 'signUp': body = <>
      <h1 style={S.title}>{t('auth.ui.sign_up_title')}</h1>
${F.email ? `      <form style={S.card} onSubmit={submit(a.signUp)}>
        <Field label={t('auth.ui.display_name')} value={f.name} onChange={set('name')} autoComplete="name" />
        <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} type="email" autoComplete="email" />
        <Field label={t('auth.ui.password')} value={f.password} onChange={set('password')} type="password" autoComplete="new-password" />
        {problems.map((p) => <small key={p}>• {t(PASSWORD_TEXT[p], { min: PASSWORD_MIN })}</small>)}
        <button type="submit" style={S.primary} disabled={busy || problems.length > 0}>{t('auth.ui.sign_up')}</button>
      </form>
` : ''}      <button style={S.link} onClick={() => go('signIn')}>{t('auth.ui.have_account')}</button>
    </>; break
    case 'forgot': body = <>
      <h1 style={S.title}>{t('auth.ui.forgot_title')}</h1>
${on(F.email, `      <form style={S.card} onSubmit={submit(a.reset)}>
        <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} type="email" autoComplete="email" />
        <button type="submit" style={S.primary} disabled={busy}>{t('auth.ui.send_reset')}</button>
      </form>
`)}      <button style={S.link} onClick={() => go('signIn')}>{t('auth.ui.back')}</button>
    </>; break
    case 'phone': body = <>
      <h1 style={S.title}>{t('auth.ui.continue_phone')}</h1>
${on(F.phone, `      {verificationId === null
        ? <form style={S.card} onSubmit={submit(a.sendCode)}><Field label={t('auth.ui.phone')} value={f.phone} onChange={set('phone')} type="tel" autoComplete="tel" /><button type="submit" style={S.primary} disabled={busy}>{t('auth.ui.send_code')}</button></form>
        : <form style={S.card} onSubmit={submit(a.confirmCode)}><Field label={t('auth.ui.code')} value={f.code} onChange={set('code')} autoComplete="one-time-code" /><button type="submit" style={S.primary} disabled={busy}>{t('auth.ui.verify')}</button></form>}
      {/* Firebase web: the invisible reCAPTCHA needs <div id="recaptcha-container" /> on the page */}
      <div id="recaptcha-container" />
`)}      <button style={S.link} onClick={() => { setVerificationId(null); go('signIn') }}>{t('auth.ui.back')}</button>
    </>; break
    case 'mfa': body = <>
      <h1 style={S.title}>{t('auth.ui.mfa_title')}</h1>
      <p style={S.note}>{t('auth.ui.mfa_hint')}</p>
${on(F.mfa, `      <form style={S.card} onSubmit={submit(a.mfa)}><Field label={t('auth.ui.code')} value={f.code} onChange={set('code')} autoComplete="one-time-code" /><button type="submit" style={S.primary} disabled={busy}>{t('auth.ui.verify')}</button></form>\n`)}      <button style={S.link} onClick={() => go('signIn')}>{t('auth.ui.back')}</button>
    </>; break
    case 'verifyEmail': body = <>
      <h1 style={S.title}>{t('auth.ui.verify_email_title')}</h1>
      <p style={S.note}>{t('auth.ui.verify_email_body', { email })}</p>
${on(F.email, `      <button style={S.outline} disabled={busy} onClick={a.resend}>{t('auth.ui.resend')}</button>\n`)}      <button style={S.primary} disabled={busy} onClick={a.checkVerified}>{t('auth.ui.i_verified')}</button>
      <button style={S.link} disabled={busy} onClick={a.signOut}>{t('auth.ui.sign_out')}</button>
    </>; break
  }
  return (
    <main style={S.page}>
      <div style={S.card}>
        {body}
        {error && <p role="alert" style={S.error}>{error}</p>}
        {info && <p role="status" style={S.note}>{info}</p>}
      </div>
    </main>
  )
}
const PASSWORD_MIN = String(${c.password.minLength})

function AskDialog({ asking, answer, t }: { asking: Ask | null; answer: (v: string | null) => void; t: ReturnType<typeof useT> }) {
  const [value, setValue] = useState('')
  useEffect(() => setValue(''), [asking])
  if (!asking) return null
  return (
    <div style={S.backdrop} role="dialog" aria-modal="true" aria-label={asking.title}>
      <form style={S.dialog} onSubmit={(e) => { e.preventDefault(); answer(asking.label ? value.trim() : '') }}>
        <strong>{asking.title}</strong>
        {asking.message && <p style={{ margin: 0, wordBreak: 'break-all' }}>{asking.message}</p>}
        {asking.label && <Field label={asking.label} value={value} onChange={setValue} type={asking.obscure ? 'password' : 'text'} />}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={S.outline} onClick={() => answer(null)}>{t('auth.ui.cancel')}</button>
          <button type="submit" style={asking.danger ? { ...S.primary, background: v('error', '#dc2626') } : S.primary}>{t(asking.danger ? 'auth.ui.delete_confirm' : 'auth.ui.confirm')}</button>
        </div>
      </form>
    </div>
  )
}

export function AccountScreen({ service, onSignedOut }: { service: AuthService; onSignedOut: () => void }) {
  const { t, user, busy, notice, asking, answer, a${on(F.mfa, ', factors')} } = useAccount(service, onSignedOut)
  if (!user) return null
  return (
    <main style={{ ...S.page, placeItems: 'start center' }}>
      <section style={S.card} aria-busy={busy}>
        <h1 style={S.title}>{t('auth.ui.account_title')}</h1>
        <div style={S.row}><span>{user.displayName ?? user.email ?? user.phone}</span><small>{user.role}</small></div>
${on(F.guest && F.linking, `        {user.isAnonymous && <p style={S.banner}>{t('auth.ui.guest_banner')}</p>}\n`)}${on(F.email, `        {user.email && !user.emailVerified && <div style={{ ...S.banner, ...S.row }}><span>{t('auth.ui.verify_banner')}</span><button style={S.link} onClick={a.resend}>{t('auth.ui.resend')}</button></div>}\n`)}${on(F.linkable.length, `        <h2>{t('auth.ui.methods_title')}</h2>
        {(${JSON.stringify(F.linkable)} as AuthMethod[]).map((m) => {
          const linked = user.methods.includes(m)
          return <div key={m} style={S.row}>
            <span>{t(METHOD_TEXT[m] ?? m)}{linked && <small> · {t('auth.ui.linked')}</small>}</span>
            {linked ? user.methods.length > 1 && <button style={S.link} onClick={() => a.unlink(m)}>{t('auth.ui.unlink')}</button> : <button style={S.outline} onClick={() => a.link(m)}>{t('auth.ui.link')}</button>}
          </div>
        })}
`)}${on(F.mfa, `        <h2>{t('auth.ui.mfa_section')}</h2>
        {factors.length === 0 && <p style={S.note}>{t('auth.ui.mfa_none')}</p>}
        {factors.map((x) => <div key={x.id} style={S.row}><span>{x.label ?? x.kind}</span><button style={S.link} onClick={() => a.unenroll(x.id)}>{t('auth.ui.mfa_remove')}</button></div>)}
${on(F.totp, `        <button style={S.outline} disabled={busy} onClick={a.addTotp}>{t('auth.ui.mfa_add_totp')}</button>\n`)}${on(F.sms, `        <button style={S.outline} disabled={busy} onClick={a.addSms}>{t('auth.ui.mfa_add_sms')}</button>\n`)}`)}${on(F.passkey, `        <button style={S.outline} disabled={busy} onClick={a.addPasskey}>{t('auth.ui.passkey_add')}</button>\n`)}        <hr style={{ width: '100%' }} />
        <button style={S.outline} disabled={busy} onClick={a.signOut}>{t('auth.ui.sign_out')}</button>
        <button style={{ ...S.link, color: v('error', '#dc2626') }} disabled={busy} onClick={a.deleteAccount}>{t('auth.ui.delete_account')}</button>
        {notice && <p role="status" style={S.note}>{notice}</p>}
      </section>
      <AskDialog asking={asking} answer={answer} t={t} />
    </main>
  )
}

/** Renders children only when decideAccess() allows \`path\`; otherwise calls navigate() with the redirect. */
export function AuthGate({ service, path, navigate, children, fallback = null }: { service: AuthService; path: string; navigate: (to: string) => void; children: ReactNode; fallback?: ReactNode }) {
  const user = useAuthUser(service)
  const t = useT()
  const to = user === undefined ? null : authRedirect(path, user)
  useEffect(() => { if (to) navigate(to) }, [to])
  if (user === undefined || to) return <>{fallback}</>
  if (decideAccess(new URL(path, 'http://x').pathname, user) === 'forbidden') return <p role="alert" style={S.error}>{t('auth.ui.forbidden')}</p>
  return <>{children}</>
}
`
}

// ================================================================ React Native
export function reactNativeScreens(c, { catalog }) {
  const F = features(c)
  const social = [F.google && ['google', 'continue_google'], F.apple && ['apple', 'continue_apple'], F.passkey && ['passkey', 'continue_passkey']].filter(Boolean)
  return `${header('Navigation: call authRedirect() from your navigator (or render AuthFlow while there is no user).')}
// Colors: pass your DS theme (src/theme/ds-tokens) as \`colors\`; the defaults are neutral.
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { AuthError, authErrorKey, decideAccess, passwordProblems, AUTH_ROUTES, type AuthMethod, type AuthService, type AuthUser, type MfaFactor, type PasswordProblem } from '${catalog}'
${I18N['react-i18next']}

${logic(c)}
// ---------------------------------------------------------------- view
export type AuthColors = { primary: string; onPrimary: string; text: string; muted: string; outline: string; error: string; surface: string; banner: string }
const DEFAULT_COLORS: AuthColors = { primary: '#2563eb', onPrimary: '#ffffff', text: '#111827', muted: '#6b7280', outline: '#d1d5db', error: '#dc2626', surface: '#ffffff', banner: '#eef2ff' }

function Btn({ title, onPress, kind = 'primary', disabled, colors }: { title: string; onPress: () => void; kind?: 'primary' | 'outline' | 'link' | 'danger'; disabled?: boolean; colors: AuthColors }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.error : 'transparent'
  const fg = kind === 'primary' || kind === 'danger' ? colors.onPrimary : kind === 'link' ? colors.primary : colors.text
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === 'outline' ? colors.outline : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={{ color: fg, fontWeight: kind === 'link' ? '400' : '600' }}>{title}</Text>
    </Pressable>
  )
}
function Field({ label, value, onChange, secure, keyboard, autoComplete, colors }: { label: string; value: string; onChange: (v: string) => void; secure?: boolean; keyboard?: 'email-address' | 'phone-pad' | 'number-pad'; autoComplete?: 'email' | 'password' | 'new-password' | 'name' | 'tel' | 'sms-otp'; colors: AuthColors }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.text }}>{label}</Text>
      <TextInput style={[s.input, { borderColor: colors.outline, color: colors.text }]} value={value} onChangeText={onChange} secureTextEntry={secure} keyboardType={keyboard} autoComplete={autoComplete} autoCapitalize="none" />
    </View>
  )
}

export function AuthFlow({ service, onSignedIn, initialStep = 'signIn', colors = DEFAULT_COLORS }: { service: AuthService; onSignedIn: (user: AuthUser) => void; initialStep?: AuthStep; colors?: AuthColors }) {
  const { t, step, go, busy, error, info, f, set, problems, verificationId, setVerificationId, a, email } = useFlow(service, onSignedIn, initialStep)
  const C = colors
  const title = (k: string) => <Text accessibilityRole="header" style={[s.title, { color: C.text }]}>{t(k)}</Text>
  let body: ReactNode = null
  switch (step) {
    case 'signIn': body = <>
      {title('auth.ui.sign_in_title')}
${on(F.email, `      <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} keyboard="email-address" autoComplete="email" colors={C} />
      <Field label={t('auth.ui.password')} value={f.password} onChange={set('password')} secure autoComplete="password" colors={C} />
      <Btn kind="link" title={t('auth.ui.forgot')} onPress={() => go('forgot')} colors={C} />
      <Btn title={t('auth.ui.sign_in')} onPress={a.signIn} disabled={busy} colors={C} />
      <Btn kind="link" title={t('auth.ui.no_account')} onPress={() => go('signUp')} colors={C} />
`)}${on(social.length || F.phone, `${on(F.email, `      <Text style={[s.center, { color: C.muted }]}>{t('auth.ui.or')}</Text>\n`)}${social.map(([fn, k]) => `      <Btn kind="outline" title={t('auth.ui.${k}')} onPress={a.${fn}} disabled={busy} colors={C} />`).join('\n')}
${on(F.phone, `      <Btn kind="outline" title={t('auth.ui.continue_phone')} onPress={() => go('phone')} disabled={busy} colors={C} />\n`)}`)}${on(F.guest, `      <Btn kind="link" title={t('auth.ui.continue_guest')} onPress={a.guest} disabled={busy} colors={C} />\n`)}    </>; break
    case 'signUp': body = <>
      {title('auth.ui.sign_up_title')}
${on(F.email, `      <Field label={t('auth.ui.display_name')} value={f.name} onChange={set('name')} autoComplete="name" colors={C} />
      <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} keyboard="email-address" autoComplete="email" colors={C} />
      <Field label={t('auth.ui.password')} value={f.password} onChange={set('password')} secure autoComplete="new-password" colors={C} />
      {problems.map((p) => <Text key={p} style={{ color: C.muted }}>• {t(PASSWORD_TEXT[p], { min: PASSWORD_MIN })}</Text>)}
      <Btn title={t('auth.ui.sign_up')} onPress={a.signUp} disabled={busy || problems.length > 0} colors={C} />
`)}      <Btn kind="link" title={t('auth.ui.have_account')} onPress={() => go('signIn')} colors={C} />
    </>; break
    case 'forgot': body = <>
      {title('auth.ui.forgot_title')}
${on(F.email, `      <Field label={t('auth.ui.email')} value={f.email} onChange={set('email')} keyboard="email-address" autoComplete="email" colors={C} />
      <Btn title={t('auth.ui.send_reset')} onPress={a.reset} disabled={busy} colors={C} />
`)}      <Btn kind="link" title={t('auth.ui.back')} onPress={() => go('signIn')} colors={C} />
    </>; break
    case 'phone': body = <>
      {title('auth.ui.continue_phone')}
${on(F.phone, `      {verificationId === null ? <>
        <Field label={t('auth.ui.phone')} value={f.phone} onChange={set('phone')} keyboard="phone-pad" autoComplete="tel" colors={C} />
        <Btn title={t('auth.ui.send_code')} onPress={a.sendCode} disabled={busy} colors={C} />
      </> : <>
        <Field label={t('auth.ui.code')} value={f.code} onChange={set('code')} keyboard="number-pad" autoComplete="sms-otp" colors={C} />
        <Btn title={t('auth.ui.verify')} onPress={a.confirmCode} disabled={busy} colors={C} />
      </>}
`)}      <Btn kind="link" title={t('auth.ui.back')} onPress={() => { setVerificationId(null); go('signIn') }} colors={C} />
    </>; break
    case 'mfa': body = <>
      {title('auth.ui.mfa_title')}
      <Text style={[s.center, { color: C.muted }]}>{t('auth.ui.mfa_hint')}</Text>
${on(F.mfa, `      <Field label={t('auth.ui.code')} value={f.code} onChange={set('code')} keyboard="number-pad" autoComplete="sms-otp" colors={C} />
      <Btn title={t('auth.ui.verify')} onPress={a.mfa} disabled={busy} colors={C} />
`)}      <Btn kind="link" title={t('auth.ui.back')} onPress={() => go('signIn')} colors={C} />
    </>; break
    case 'verifyEmail': body = <>
      {title('auth.ui.verify_email_title')}
      <Text style={[s.center, { color: C.text }]}>{t('auth.ui.verify_email_body', { email })}</Text>
${on(F.email, `      <Btn kind="outline" title={t('auth.ui.resend')} onPress={a.resend} disabled={busy} colors={C} />\n`)}      <Btn title={t('auth.ui.i_verified')} onPress={a.checkVerified} disabled={busy} colors={C} />
      <Btn kind="link" title={t('auth.ui.sign_out')} onPress={a.signOut} disabled={busy} colors={C} />
    </>; break
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        {body}
        {busy && <ActivityIndicator color={C.primary} />}
        {error && <Text accessibilityRole="alert" style={[s.center, { color: C.error }]}>{error}</Text>}
        {info && <Text style={[s.center, { color: C.muted }]}>{info}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
const PASSWORD_MIN = String(${c.password.minLength})

function AskModal({ asking, answer, t, colors: C }: { asking: Ask | null; answer: (v: string | null) => void; t: ReturnType<typeof useT>; colors: AuthColors }) {
  const [value, setValue] = useState('')
  useEffect(() => setValue(''), [asking])
  return (
    <Modal transparent visible={asking !== null} animationType="fade" onRequestClose={() => answer(null)}>
      <View style={s.backdrop}>
        <View style={[s.dialog, { backgroundColor: C.surface }]}>
          <Text style={{ color: C.text, fontWeight: '600', fontSize: 17 }}>{asking?.title}</Text>
          {asking?.message && <Text selectable style={{ color: C.text }}>{asking.message}</Text>}
          {asking?.label && <Field label={asking.label} value={value} onChange={setValue} secure={asking.obscure} colors={C} />}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Btn kind="link" title={t('auth.ui.cancel')} onPress={() => answer(null)} colors={C} />
            <Btn kind={asking?.danger ? 'danger' : 'primary'} title={t(asking?.danger ? 'auth.ui.delete_confirm' : 'auth.ui.confirm')} onPress={() => answer(asking?.label ? value.trim() : '')} colors={C} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

export function AccountScreen({ service, onSignedOut, colors = DEFAULT_COLORS }: { service: AuthService; onSignedOut: () => void; colors?: AuthColors }) {
  const { t, user, busy, notice, asking, answer, a${on(F.mfa, ', factors')} } = useAccount(service, onSignedOut)
  const C = colors
  if (!user) return <ActivityIndicator style={{ flex: 1 }} color={C.primary} />
  const h2 = (k: string) => <Text accessibilityRole="header" style={[s.h2, { color: C.text }]}>{t(k)}</Text>
  return (
    <ScrollView contentContainerStyle={[s.page, { justifyContent: 'flex-start' }]}>
      <View style={s.row}><Text style={{ color: C.text, fontSize: 17 }}>{user.displayName ?? user.email ?? user.phone}</Text><Text style={{ color: C.muted }}>{user.role}</Text></View>
${on(F.guest && F.linking, `      {user.isAnonymous && <Text style={[s.banner, { backgroundColor: C.banner, color: C.text }]}>{t('auth.ui.guest_banner')}</Text>}\n`)}${on(F.email, `      {user.email && !user.emailVerified && <View style={[s.banner, s.row, { backgroundColor: C.banner }]}><Text style={{ color: C.text, flex: 1 }}>{t('auth.ui.verify_banner')}</Text><Btn kind="link" title={t('auth.ui.resend')} onPress={a.resend} colors={C} /></View>}\n`)}${on(F.linkable.length, `      {h2('auth.ui.methods_title')}
      {(${JSON.stringify(F.linkable)} as AuthMethod[]).map((m) => {
        const linked = user.methods.includes(m)
        return <View key={m} style={s.row}>
          <Text style={{ color: C.text }}>{t(METHOD_TEXT[m] ?? m)}{linked ? ' · ' + t('auth.ui.linked') : ''}</Text>
          {linked ? (user.methods.length > 1 ? <Btn kind="link" title={t('auth.ui.unlink')} onPress={() => a.unlink(m)} colors={C} /> : null) : <Btn kind="outline" title={t('auth.ui.link')} onPress={() => a.link(m)} colors={C} />}
        </View>
      })}
`)}${on(F.mfa, `      {h2('auth.ui.mfa_section')}
      {factors.length === 0 && <Text style={{ color: C.muted }}>{t('auth.ui.mfa_none')}</Text>}
      {factors.map((x) => <View key={x.id} style={s.row}><Text style={{ color: C.text }}>{x.label ?? x.kind}</Text><Btn kind="link" title={t('auth.ui.mfa_remove')} onPress={() => a.unenroll(x.id)} colors={C} /></View>)}
${on(F.totp, `      <Btn kind="outline" title={t('auth.ui.mfa_add_totp')} onPress={a.addTotp} disabled={busy} colors={C} />\n`)}${on(F.sms, `      <Btn kind="outline" title={t('auth.ui.mfa_add_sms')} onPress={a.addSms} disabled={busy} colors={C} />\n`)}`)}${on(F.passkey, `      <Btn kind="outline" title={t('auth.ui.passkey_add')} onPress={a.addPasskey} disabled={busy} colors={C} />\n`)}      <View style={{ height: 24 }} />
      <Btn kind="outline" title={t('auth.ui.sign_out')} onPress={a.signOut} disabled={busy} colors={C} />
      <Btn kind="link" title={t('auth.ui.delete_account')} onPress={a.deleteAccount} disabled={busy} colors={{ ...C, primary: C.error }} />
      {notice && <Text style={[s.center, { color: C.muted }]}>{notice}</Text>}
      <AskModal asking={asking} answer={answer} t={t} colors={C} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  h2: { fontSize: 15, fontWeight: '600', marginTop: 16 },
  center: { textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { borderWidth: 1, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  banner: { padding: 12, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 12, padding: 20, gap: 12 },
})
`
}
