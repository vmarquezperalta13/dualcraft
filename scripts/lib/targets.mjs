// Where each DualCraft generator writes for each stack of the project.
import fs from 'node:fs'
import path from 'node:path'

const KINDS = { nextjs: 'web', 'react-vite': 'web', astro: 'web', nuxt: 'web', flutter: 'mobile', 'react-native': 'mobile', kmp: 'mobile', android: 'mobile', ios: 'mobile' }
export const LANG = { nextjs: 'ts', 'react-vite': 'ts', astro: 'ts', nuxt: 'ts', 'react-native': 'ts', flutter: 'dart', kmp: 'kotlin', android: 'kotlin', ios: 'swift' }

/** [{ id, kind, dir }] for every stack in config.stacks (stacks.mobile may be "android,ios" or an array). */
export function projectStacks(root, config) {
  const out = []
  for (const kind of ['web', 'mobile']) {
    const ids = [].concat(config.stacks?.[kind] || []).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter((s) => s && s !== 'null')
    for (const id of ids) {
      if (!KINDS[id]) continue
      const rel = config.paths?.[id] ?? (ids.length === 1 ? config.paths?.[kind] : null) ?? ''
      out.push({ id, kind, dir: path.join(root, rel || '') })
    }
  }
  return out
}

const read = (...p) => { try { return fs.readFileSync(path.join(...p), 'utf8') } catch { return '' } }

/** Kotlin package of the app: config override, else the Gradle namespace / applicationId. */
export function kotlinPackage(dir, config, stackId) {
  if (config.design?.kotlinPackage) return config.design.kotlinPackage
  const mods = stackId === 'kmp' ? ['composeApp', 'shared', 'app'] : ['app']
  for (const m of mods) {
    const g = read(dir, m, 'build.gradle.kts') + read(dir, m, 'build.gradle')
    const ns = g.match(/namespace\s*=?\s*["']([\w.]+)["']/) || g.match(/applicationId\s*=?\s*["']([\w.]+)["']/)
    if (ns) return ns[1]
  }
  return 'app'
}
export const kotlinModule = (dir, stackId) => (stackId === 'kmp' ? (['composeApp', 'shared'].find((m) => fs.existsSync(path.join(dir, m))) || 'composeApp') : 'app')

/** Folder of the iOS app sources: the one holding the @main App, else <dir>/App. */
export function iosAppDir(dir, config) {
  if (config.paths?.iosSources) return path.join(dir, config.paths.iosSources)
  const walk = (d, depth) => {
    if (depth > 3 || !fs.existsSync(d)) return null
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || /^(Pods|build|DerivedData|.*Tests|.*\.xcodeproj)$/.test(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isFile() && e.name.endsWith('.swift') && /@main/.test(read(p))) return d
      if (e.isDirectory()) { const r = walk(p, depth + 1); if (r) return r }
    }
    return null
  }
  return walk(dir, 0) || path.join(dir, 'App')
}

const kt = (dir, config, id, sub, file) => {
  const pkg = kotlinPackage(dir, config, id)
  const mod = kotlinModule(dir, id)
  const set = id === 'kmp' ? 'commonMain' : 'main'
  const base = id === 'kmp' ? path.join(dir, mod, 'src', set, 'kotlin') : path.join(dir, mod, 'src', set, 'java')
  return { file: path.join(base, ...pkg.split('.'), ...sub.split('/').filter(Boolean), file), pkg: [pkg, ...sub.split('/').filter(Boolean)].join('.') }
}
const exists = (...p) => fs.existsSync(path.join(...p))

/** Default output path for a generator ('tokens' | 'models' | 'analytics' | 'api' | 'payments' | 'push' | 'auth') on a stack. Returns { file, pkg? }. */
export function outputFor(gen, stack, root, config) {
  const { id, dir } = stack
  const override = config[{ tokens: 'design', models: 'db', analytics: 'analytics', api: 'backend', payments: 'payments', push: 'push', auth: 'auth' }[gen]]?.out?.[id]
  if (override) return { file: path.join(root, override), pkg: config.design?.kotlinPackage }
  const src = exists(dir, 'src') ? 'src' : ''
  const T = {
    tokens: {
      nextjs: () => ({ file: path.join(dir, ['src/app', 'app', 'src/styles', 'styles'].find((d) => exists(dir, d)) || 'styles', 'ds-tokens.css') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'styles', 'ds-tokens.css') }),
      astro: () => ({ file: path.join(dir, 'src', 'styles', 'ds-tokens.css') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'assets', 'css', 'ds-tokens.css') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'design_tokens.dart') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'theme', 'ds-tokens.ts') }),
      kmp: () => kt(dir, config, id, 'theme', 'DsTokens.kt'),
      android: () => kt(dir, config, id, 'ui/theme', 'DsTokens.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'DesignSystem', 'DsTokens.swift') }),
    },
    models: {
      nextjs: () => ({ file: path.join(dir, src, 'types', 'db.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'types', 'db.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'types', 'db.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'types', 'db.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'types', 'db.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'db_models.dart') }),
      kmp: () => kt(dir, config, id, 'model', 'DbModels.kt'),
      android: () => kt(dir, config, id, 'data/model', 'DbModels.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Models', 'DbModels.swift') }),
    },
    analytics: {
      nextjs: () => ({ file: path.join(dir, src, 'lib', 'analytics-events.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'lib', 'analytics-events.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'lib', 'analytics-events.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'utils', 'analytics-events.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'lib', 'analytics-events.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'analytics_events.dart') }),
      kmp: () => kt(dir, config, id, 'analytics', 'AnalyticsEvents.kt'),
      android: () => kt(dir, config, id, 'analytics', 'AnalyticsEvents.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Analytics', 'AnalyticsEvents.swift') }),
    },
    api: {
      nextjs: () => ({ file: path.join(dir, src, 'lib', 'api-client.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'lib', 'api-client.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'lib', 'api-client.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'utils', 'api-client.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'lib', 'api-client.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'api_client.dart') }),
      kmp: () => kt(dir, config, id, 'api', 'ApiClient.kt'),
      android: () => kt(dir, config, id, 'data/api', 'ApiClient.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Api', 'ApiClient.swift') }),
    },
    payments: {
      nextjs: () => ({ file: path.join(dir, src, 'lib', 'payments-catalog.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'lib', 'payments-catalog.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'lib', 'payments-catalog.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'utils', 'payments-catalog.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'lib', 'payments-catalog.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'payments_catalog.dart') }),
      kmp: () => kt(dir, config, id, 'payments', 'PaymentsCatalog.kt'),
      android: () => kt(dir, config, id, 'data/payments', 'PaymentsCatalog.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Payments', 'PaymentsCatalog.swift') }),
    },
    push: {
      nextjs: () => ({ file: path.join(dir, src, 'lib', 'push-messages.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'lib', 'push-messages.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'lib', 'push-messages.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'utils', 'push-messages.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'lib', 'push-messages.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'push_catalog.dart') }),
      kmp: () => kt(dir, config, id, 'push', 'PushMessages.kt'),
      android: () => kt(dir, config, id, 'push', 'PushMessages.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Push', 'PushMessages.swift') }),
    },
    auth: {
      nextjs: () => ({ file: path.join(dir, src, 'lib', 'auth-catalog.ts') }),
      'react-vite': () => ({ file: path.join(dir, 'src', 'lib', 'auth-catalog.ts') }),
      astro: () => ({ file: path.join(dir, 'src', 'lib', 'auth-catalog.ts') }),
      nuxt: () => ({ file: path.join(dir, exists(dir, 'app') ? 'app' : '', 'utils', 'auth-catalog.ts') }),
      'react-native': () => ({ file: path.join(dir, 'src', 'lib', 'auth-catalog.ts') }),
      flutter: () => ({ file: path.join(dir, 'lib', 'generated', 'auth_catalog.dart') }),
      kmp: () => kt(dir, config, id, 'auth', 'AuthCatalog.kt'),
      android: () => kt(dir, config, id, 'data/auth', 'AuthCatalog.kt'),
      ios: () => ({ file: path.join(iosAppDir(dir, config), 'Core', 'Auth', 'AuthCatalog.swift') }),
    },
  }
  return T[gen][id]()
}
