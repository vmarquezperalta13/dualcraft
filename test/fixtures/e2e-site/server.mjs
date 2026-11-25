// Fixture web app for the generated Playwright specs: the DualCraft auth screens' texts (Spanish) and the
// route rules of the default auth.json (/login public, everything else needs a session → /login?next=).
import http from 'node:http'

const page = (title, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
const login = page('Inicia sesión', `<main id="app"></main>
<script>
const app = document.getElementById('app')
function signIn() {
  app.innerHTML = '<h1>Inicia sesión</h1><form id="f"><label>Email<input name="email" type="email"></label><label>Contraseña<input name="password" type="password"></label><button type="submit">Entrar</button></form><button id="up" type="button">¿No tienes cuenta? Regístrate</button><button id="guest" type="button">Continuar como invitado</button><p id="err" role="alert"></p>'
  document.getElementById('f').onsubmit = (e) => { e.preventDefault(); document.getElementById('err').textContent = 'Email o contraseña incorrectos' }
  document.getElementById('up').onclick = signUp
  document.getElementById('guest').onclick = () => { document.cookie = 'session=guest; path=/'; location.href = '/' }
}
function signUp() {
  app.innerHTML = '<h1>Crea tu cuenta</h1><label>Nombre<input name="name"></label><label>Email<input name="email" type="email"></label><label>Contraseña<input id="pw" name="password" type="password"></label><div id="problems"></div><button type="button">Crear cuenta</button>'
  document.getElementById('pw').oninput = (e) => { document.getElementById('problems').innerHTML = e.target.value.length < 8 ? '<small>Al menos 8 caracteres</small>' : '' }
}
signIn()
</script>`)
const home = page('Inicio', '<h1>Inicio</h1>')

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(login) }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (!/session=/.test(req.headers.cookie || '')) { res.writeHead(302, { location: '/login?next=' + encodeURIComponent(url.pathname) }); return res.end() }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(home)
}).listen(Number(process.env.PORT || 3000))
