// Auth screens for Nuxt / Vue 3 (vue-i18n): AuthFlow.vue, AccountScreen.vue and auth-redirect.ts.
import { features } from './auth-screens.mjs'

const on = (cond, s) => (cond ? s : '')
const pascal = (s) => s[0].toUpperCase() + s.slice(1)

const STYLE = `<style scoped>
.page { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.card { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
h1 { font-size: 24px; font-weight: 600; text-align: center; margin: 0 0 12px; }
label { display: flex; flex-direction: column; gap: 4px; }
input { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--color-outline, var(--ds-color-outline, #9ca3af)); font: inherit; background: transparent; color: inherit; }
.primary { padding: 10px 16px; border-radius: 8px; border: none; background: var(--color-primary, var(--ds-color-primary, #2563eb)); color: var(--color-on-primary, var(--ds-color-on-primary, #fff)); font: inherit; font-weight: 600; cursor: pointer; }
.outline { padding: 10px 16px; border-radius: 8px; border: 1px solid var(--color-outline, var(--ds-color-outline, #9ca3af)); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.link { padding: 4px; border: none; background: none; color: var(--color-primary, var(--ds-color-primary, #2563eb)); font: inherit; cursor: pointer; }
.danger { color: var(--color-error, var(--ds-color-error, #dc2626)); }
.error { color: var(--color-error, var(--ds-color-error, #dc2626)); text-align: center; }
.note { text-align: center; opacity: 0.8; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
.banner { padding: 12px; border-radius: 8px; background: var(--color-secondary-container, var(--ds-color-secondary-container, #eef2ff)); }
.backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: grid; place-items: center; padding: 24px; }
.dialog { width: 100%; max-width: 380px; padding: 20px; border-radius: 12px; background: var(--color-surface, var(--ds-color-surface, #fff)); color: var(--color-on-surface, var(--ds-color-on-surface, #111)); display: flex; flex-direction: column; gap: 12px; }
</style>
`

export function vueRedirect(c, { catalog }) {
  return `// Auth redirect (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// Nuxt route middleware: export default defineNuxtRouteMiddleware((to) => { const r = authRedirect(to.fullPath, user); if (r) return navigateTo(r) })
import { decideAccess, AUTH_ROUTES, type AuthUser } from '${catalog}'

/** Where to send \`location\` for \`user\` (null = stay). */
export function authRedirect(location: string, user: AuthUser | null): string | null {
  const url = new URL(location, 'http://x')
  switch (decideAccess(url.pathname, user)) {
    case 'allow': return user && !user.isAnonymous && url.pathname === AUTH_ROUTES.signIn ? url.searchParams.get('next') ?? AUTH_ROUTES.afterSignIn : null
    case 'signIn': return url.pathname === AUTH_ROUTES.signIn ? null : \`\${AUTH_ROUTES.signIn}?next=\${encodeURIComponent(location)}\`
    case 'verifyEmail': return url.pathname === AUTH_ROUTES.verifyEmail ? null : AUTH_ROUTES.verifyEmail
    case 'forbidden': return url.pathname === AUTH_ROUTES.afterSignIn ? null : AUTH_ROUTES.afterSignIn
  }
}
`
}

export function vueAuthFlow(c, { catalog }) {
  const F = features(c)
  const social = [F.google && ['signInWithGoogle', 'continue_google'], F.apple && ['signInWithApple', 'continue_apple'], F.passkey && ['signInWithPasskey', 'continue_passkey']].filter(Boolean)
  return `<script setup lang="ts">
// Auth flow (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// Sign in / sign up / forgot password / phone / second factor / verify email. <AuthFlow :service="auth" @signed-in="…" />
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AuthError, authErrorKey, passwordProblems, PASSWORD_POLICY, type AuthService, type AuthUser, type PasswordProblem } from '${catalog}'

type Step = 'signIn' | 'signUp' | 'forgot' | 'phone' | 'mfa' | 'verifyEmail'
const props = withDefaults(defineProps<{ service: AuthService; initialStep?: Step }>(), { initialStep: 'signIn' })
const emit = defineEmits<{ signedIn: [user: AuthUser] }>()
const { t } = useI18n()

const step = ref<Step>(props.initialStep)
const busy = ref(false)
const error = ref<string | null>(null)
const info = ref<string | null>(null)
const f = reactive({ email: '', password: '', name: '', phone: '', code: '' })
const verificationId = ref<string | null>(null)
const problems = computed(() => (f.password ? passwordProblems(f.password) : []))
const PASSWORD_TEXT: Record<PasswordProblem, string> = { tooShort: 'auth.password.too_short', noUpper: 'auth.password.no_upper', noDigit: 'auth.password.no_digit', noSymbol: 'auth.password.no_symbol' }
const email = computed(() => props.service.currentUser?.email ?? f.email.trim())

function go(s: Step) { step.value = s; error.value = null; info.value = null; f.code = '' }
function done(u: AuthUser) { if (${F.verifyRequired} && u.email && !u.emailVerified && !u.isAnonymous) go('verifyEmail'); else emit('signedIn', u) }
async function run(action: () => Promise<void>) {
  busy.value = true; error.value = null; info.value = null
  try { await action() } catch (e) {
    const code = e instanceof AuthError ? e.code : 'unknown'
    if (code === 'mfaRequired') go('mfa')
    else if (code === 'emailNotVerified') go('verifyEmail')
    else if (code !== 'cancelled') error.value = t(authErrorKey(code))
  } finally { busy.value = false }
}
const s = props.service
const a = {
${on(F.email, `  signIn: () => run(async () => done(await s.signInWithEmail(f.email.trim(), f.password))),
  signUp: () => run(async () => done(await s.signUpWithEmail(f.email.trim(), f.password, f.name.trim() || null))),
  reset: () => run(async () => { await s.sendPasswordReset(f.email.trim()); info.value = t('auth.ui.reset_sent', { email: f.email.trim() }) }),
  resend: () => run(async () => { await s.sendEmailVerification(); info.value = t('auth.ui.email_sent') }),
`)}${social.map(([fn]) => `  ${fn}: () => run(async () => done(await s.${fn}())),\n`).join('')}${on(F.guest, `  guest: () => run(async () => emit('signedIn', await s.signInAsGuest())),\n`)}${on(F.phone, `  sendCode: () => run(async () => { verificationId.value = await s.startPhoneSignIn(f.phone.trim()) }),
  confirmCode: () => run(async () => done(await s.confirmPhoneCode(verificationId.value ?? '', f.code.trim()))),
`)}${on(F.mfa, `  mfa: () => run(async () => done(await s.completeMfaSignIn(f.code.trim()))),\n`)}  checkVerified: () => run(async () => { const u = await s.refreshUser(); if (u?.emailVerified) emit('signedIn', u); else info.value = t('auth.ui.not_verified_yet') }),
  signOut: () => run(async () => { await s.signOut(); go('signIn') }),
}
</script>

<template>
  <main class="page">
    <div class="card">
      <template v-if="step === 'signIn'">
        <h1>{{ t('auth.ui.sign_in_title') }}</h1>
${on(F.email, `        <form class="card" @submit.prevent="a.signIn">
          <label>{{ t('auth.ui.email') }}<input v-model="f.email" type="email" autocomplete="email"></label>
          <label>{{ t('auth.ui.password') }}<input v-model="f.password" type="password" autocomplete="current-password"></label>
          <button type="button" class="link" style="align-self: flex-end" @click="go('forgot')">{{ t('auth.ui.forgot') }}</button>
          <button type="submit" class="primary" :disabled="busy">{{ t('auth.ui.sign_in') }}</button>
          <button type="button" class="link" @click="go('signUp')">{{ t('auth.ui.no_account') }}</button>
        </form>
`)}${on(social.length || F.phone, `${on(F.email, `        <p class="note">{{ t('auth.ui.or') }}</p>\n`)}${social.map(([fn, k]) => `        <button class="outline" :disabled="busy" @click="a.${fn}">{{ t('auth.ui.${k}') }}</button>`).join('\n')}
${on(F.phone, `        <button class="outline" :disabled="busy" @click="go('phone')">{{ t('auth.ui.continue_phone') }}</button>\n`)}`)}${on(F.guest, `        <button class="link" :disabled="busy" @click="a.guest">{{ t('auth.ui.continue_guest') }}</button>\n`)}      </template>
      <template v-else-if="step === 'signUp'">
        <h1>{{ t('auth.ui.sign_up_title') }}</h1>
${on(F.email, `        <form class="card" @submit.prevent="a.signUp">
          <label>{{ t('auth.ui.display_name') }}<input v-model="f.name" autocomplete="name"></label>
          <label>{{ t('auth.ui.email') }}<input v-model="f.email" type="email" autocomplete="email"></label>
          <label>{{ t('auth.ui.password') }}<input v-model="f.password" type="password" autocomplete="new-password"></label>
          <small v-for="p in problems" :key="p">• {{ t(PASSWORD_TEXT[p], { min: String(PASSWORD_POLICY.minLength) }) }}</small>
          <button type="submit" class="primary" :disabled="busy || problems.length > 0">{{ t('auth.ui.sign_up') }}</button>
        </form>
`)}        <button class="link" @click="go('signIn')">{{ t('auth.ui.have_account') }}</button>
      </template>
      <template v-else-if="step === 'forgot'">
        <h1>{{ t('auth.ui.forgot_title') }}</h1>
${on(F.email, `        <form class="card" @submit.prevent="a.reset">
          <label>{{ t('auth.ui.email') }}<input v-model="f.email" type="email" autocomplete="email"></label>
          <button type="submit" class="primary" :disabled="busy">{{ t('auth.ui.send_reset') }}</button>
        </form>
`)}        <button class="link" @click="go('signIn')">{{ t('auth.ui.back') }}</button>
      </template>
      <template v-else-if="step === 'phone'">
        <h1>{{ t('auth.ui.continue_phone') }}</h1>
${on(F.phone, `        <form v-if="verificationId === null" class="card" @submit.prevent="a.sendCode">
          <label>{{ t('auth.ui.phone') }}<input v-model="f.phone" type="tel" autocomplete="tel"></label>
          <button type="submit" class="primary" :disabled="busy">{{ t('auth.ui.send_code') }}</button>
        </form>
        <form v-else class="card" @submit.prevent="a.confirmCode">
          <label>{{ t('auth.ui.code') }}<input v-model="f.code" autocomplete="one-time-code"></label>
          <button type="submit" class="primary" :disabled="busy">{{ t('auth.ui.verify') }}</button>
        </form>
        <!-- Firebase web: the invisible reCAPTCHA needs this element -->
        <div id="recaptcha-container" />
`)}        <button class="link" @click="verificationId = null; go('signIn')">{{ t('auth.ui.back') }}</button>
      </template>
      <template v-else-if="step === 'mfa'">
        <h1>{{ t('auth.ui.mfa_title') }}</h1>
        <p class="note">{{ t('auth.ui.mfa_hint') }}</p>
${on(F.mfa, `        <form class="card" @submit.prevent="a.mfa">
          <label>{{ t('auth.ui.code') }}<input v-model="f.code" autocomplete="one-time-code"></label>
          <button type="submit" class="primary" :disabled="busy">{{ t('auth.ui.verify') }}</button>
        </form>
`)}        <button class="link" @click="go('signIn')">{{ t('auth.ui.back') }}</button>
      </template>
      <template v-else>
        <h1>{{ t('auth.ui.verify_email_title') }}</h1>
        <p class="note">{{ t('auth.ui.verify_email_body', { email }) }}</p>
${on(F.email, `        <button class="outline" :disabled="busy" @click="a.resend">{{ t('auth.ui.resend') }}</button>\n`)}        <button class="primary" :disabled="busy" @click="a.checkVerified">{{ t('auth.ui.i_verified') }}</button>
        <button class="link" :disabled="busy" @click="a.signOut">{{ t('auth.ui.sign_out') }}</button>
      </template>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="info" role="status" class="note">{{ info }}</p>
    </div>
  </main>
</template>

${STYLE}`
}

export function vueAccount(c, { catalog }) {
  const F = features(c)
  return `<script setup lang="ts">
// Account (DualCraft auth) — written once by auth.mjs gen; yours to edit.
// Methods${on(F.linking, ' and linking')}${on(F.mfa, ', second factor')}${on(F.passkey, ', passkey')}, sign out, delete account. <AccountScreen :service="auth" @signed-out="…" />
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AuthError, authErrorKey, type AuthMethod, type AuthService, type AuthUser${on(F.mfa, ', type MfaFactor')} } from '${catalog}'

const props = defineProps<{ service: AuthService }>()
const emit = defineEmits<{ signedOut: [] }>()
const { t } = useI18n()
const s = props.service

const user = shallowRef<AuthUser | null>(s.currentUser)
const busy = ref(false)
const notice = ref<string | null>(null)
${on(F.mfa, `const factors = ref<MfaFactor[]>([])
const reloadFactors = async () => { factors.value = await s.mfaFactors().catch(() => []) }
`)}let stop = () => {}
onMounted(() => { stop = s.onAuthStateChanged((u) => { user.value = u${on(F.mfa, '; if (u && !u.isAnonymous) void reloadFactors()')} }) })
onUnmounted(() => stop())

type Ask = { title: string; label?: string; obscure?: boolean; message?: string; danger?: boolean; resolve: (v: string | null) => void }
const asking = shallowRef<Ask | null>(null)
const answerText = ref('')
const ask = (o: Omit<Ask, 'resolve'>) => new Promise<string | null>((resolve) => { answerText.value = ''; asking.value = { ...o, resolve } })
function answer(v: string | null) { asking.value?.resolve(v); asking.value = null }

async function run(action: () => Promise<void>, done?: string) {
  busy.value = true; notice.value = null
  try { await action(); if (done) notice.value = done } catch (e) {
    if (!(e instanceof AuthError && e.code === 'cancelled')) notice.value = t(authErrorKey(e instanceof AuthError ? e.code : 'unknown'))
  } finally { busy.value = false }
}
/** Runs action; on requiresRecentLogin re-authenticates (password, or the provider again) and retries. */
async function sensitive(action: () => Promise<void>) {
  try { await action() } catch (e) {
    if (!(e instanceof AuthError && e.code === 'requiresRecentLogin')) throw e
    let password: string | null = null
    if (s.currentUser?.methods.includes('email' as AuthMethod)) {
      password = await ask({ title: t('auth.ui.reauth_title'), message: t('auth.ui.reauth_body'), label: t('auth.ui.password'), obscure: true })
      if (password === null) return
    }
    await s.reauthenticate(password)
    await action()
  }
}
const LINKABLE = ${JSON.stringify(F.linkable)} as AuthMethod[]
const a = {
  signOut: () => run(async () => { await s.signOut(); emit('signedOut') }),
  deleteAccount: async () => {
    if ((await ask({ title: t('auth.ui.delete_title'), message: t('auth.ui.delete_body'), danger: true })) === null) return
    await run(() => sensitive(async () => { await s.deleteAccount(); emit('signedOut') }))
  },
${on(F.email, `  resend: () => run(() => s.sendEmailVerification(), t('auth.ui.email_sent')),\n`)}${on(F.linking, `  unlink: (m: AuthMethod) => run(async () => { await s.unlink(m) }),
  link: (m: AuthMethod) => run(async () => {
    switch (m) {
${F.linkable.map((m) => m === 'email' ? `      case 'email': {
        const email = await ask({ title: t('auth.ui.method_email'), label: t('auth.ui.email') }); if (!email) return
        const password = await ask({ title: t('auth.ui.method_email'), label: t('auth.ui.password'), obscure: true }); if (!password) return
        await s.linkEmail(email, password); return
      }` : `      case '${m}': await s.link${pascal(m)}(); return`).join('\n')}
    }
  }),
`)}${on(F.mfa, `  unenroll: (id: string) => run(async () => { await sensitive(() => s.unenrollMfa(id)); await reloadFactors() }),\n`)}${on(F.totp, `  addTotp: () => run(async () => {
    const e = await s.enrollTotpStart()
    const code = await ask({ title: t('auth.ui.mfa_add_totp'), message: t('auth.ui.mfa_secret', { secret: e.secret }), label: t('auth.ui.code') }); if (!code) return
    await s.enrollTotpFinish(code); await reloadFactors()
  }),
`)}${on(F.sms, `  addSms: () => run(async () => {
    const phone = await ask({ title: t('auth.ui.mfa_add_sms'), label: t('auth.ui.phone') }); if (!phone) return
    const id = await s.enrollSmsStart(phone)
    const code = await ask({ title: t('auth.ui.mfa_add_sms'), label: t('auth.ui.code') }); if (!code) return
    await s.enrollSmsFinish(id, code); await reloadFactors()
  }),
`)}${on(F.passkey, `  addPasskey: () => run(() => s.registerPasskey(), t('auth.ui.passkey_added')),\n`)}}
</script>

<template>
  <main v-if="user" class="page" style="place-items: start center">
    <section class="card" :aria-busy="busy">
      <h1>{{ t('auth.ui.account_title') }}</h1>
      <div class="row"><span>{{ user.displayName ?? user.email ?? user.phone }}</span><small>{{ user.role }}</small></div>
${on(F.guest && F.linking, `      <p v-if="user.isAnonymous" class="banner">{{ t('auth.ui.guest_banner') }}</p>\n`)}${on(F.email, `      <div v-if="user.email && !user.emailVerified" class="banner row"><span>{{ t('auth.ui.verify_banner') }}</span><button class="link" @click="a.resend">{{ t('auth.ui.resend') }}</button></div>\n`)}${on(F.linkable.length, `      <h2>{{ t('auth.ui.methods_title') }}</h2>
      <div v-for="m in LINKABLE" :key="m" class="row">
        <span>{{ t('auth.ui.method_' + m) }}<small v-if="user.methods.includes(m)"> · {{ t('auth.ui.linked') }}</small></span>
        <template v-if="user.methods.includes(m)"><button v-if="user.methods.length > 1" class="link" @click="a.unlink(m)">{{ t('auth.ui.unlink') }}</button></template>
        <button v-else class="outline" @click="a.link(m)">{{ t('auth.ui.link') }}</button>
      </div>
`)}${on(F.mfa, `      <h2>{{ t('auth.ui.mfa_section') }}</h2>
      <p v-if="factors.length === 0" class="note">{{ t('auth.ui.mfa_none') }}</p>
      <div v-for="x in factors" :key="x.id" class="row"><span>{{ x.label ?? x.kind }}</span><button class="link" @click="a.unenroll(x.id)">{{ t('auth.ui.mfa_remove') }}</button></div>
${on(F.totp, `      <button class="outline" :disabled="busy" @click="a.addTotp">{{ t('auth.ui.mfa_add_totp') }}</button>\n`)}${on(F.sms, `      <button class="outline" :disabled="busy" @click="a.addSms">{{ t('auth.ui.mfa_add_sms') }}</button>\n`)}`)}${on(F.passkey, `      <button class="outline" :disabled="busy" @click="a.addPasskey">{{ t('auth.ui.passkey_add') }}</button>\n`)}      <hr style="width: 100%">
      <button class="outline" :disabled="busy" @click="a.signOut">{{ t('auth.ui.sign_out') }}</button>
      <button class="link danger" :disabled="busy" @click="a.deleteAccount">{{ t('auth.ui.delete_account') }}</button>
      <p v-if="notice" role="status" class="note">{{ notice }}</p>
    </section>
    <div v-if="asking" class="backdrop" role="dialog" aria-modal="true" :aria-label="asking.title">
      <form class="dialog" @submit.prevent="answer(asking.label ? answerText.trim() : '')">
        <strong>{{ asking.title }}</strong>
        <p v-if="asking.message" style="margin: 0; word-break: break-all">{{ asking.message }}</p>
        <label v-if="asking.label">{{ asking.label }}<input v-model="answerText" :type="asking.obscure ? 'password' : 'text'"></label>
        <div style="display: flex; gap: 8px; justify-content: flex-end">
          <button type="button" class="outline" @click="answer(null)">{{ t('auth.ui.cancel') }}</button>
          <button type="submit" class="primary" :style="asking.danger ? 'background: var(--color-error, var(--ds-color-error, #dc2626))' : ''">{{ t(asking.danger ? 'auth.ui.delete_confirm' : 'auth.ui.confirm') }}</button>
        </div>
      </form>
    </div>
  </main>
</template>

${STYLE}`
}
