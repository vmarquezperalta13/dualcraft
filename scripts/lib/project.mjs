// Shared helpers for DualCraft scripts.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const die = (msg, code = 1) => { console.error(`dualcraft: ${msg}`); process.exit(code) }

export function findRoot(start = process.cwd()) {
  let d = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(d, '.dualcraft', 'config.json'))) return d
    const p = path.dirname(d)
    if (p === d) return null
    d = p
  }
}

export function project() {
  const root = findRoot() || die('no DualCraft project here (no .dualcraft/config.json). Run /dualcraft:start first.')
  const dir = path.join(root, '.dualcraft')
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
  return { root, dir, config }
}

/** .dualcraft/out/ — generated views, never committed. */
export function outDir(dir) {
  const out = path.join(dir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const gi = path.join(dir, '.gitignore')
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
  if (!/^out\/?$/m.test(cur)) fs.writeFileSync(gi, cur.replace(/\s*$/, '\n') + 'out/\n')
  return out
}

export function parseArgs(argv) {
  const pos = []; const opt = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s)
      if (v !== undefined) opt[k] = v
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]
      else opt[k] = true
    } else pos.push(a)
  }
  return { pos, opt }
}

export function openInBrowser(file) {
  const p = process.platform
  const [cmd, args] = p === 'win32' ? ['cmd', ['/c', 'start', '""', `"${file}"`]]
    : p === 'darwin' ? ['open', [file]] : ['xdg-open', [file]]
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', shell: p === 'win32', windowsVerbatimArguments: p === 'win32' }).unref() } catch { /* ignore */ }
}

/** Safe embedding of JSON inside a <script> tag. */
const BS = String.fromCharCode(92), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029)
export const embedJson = (v) => JSON.stringify(v).split('<').join(BS + 'u003c').split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029')

export const posix = (p) => p.replace(/\\/g, '/')
