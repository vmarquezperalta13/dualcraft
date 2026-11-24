// Push pack: catalog + i18n texts, device registration on the backend contract, typed senders/parsers, client checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { run, makeProject, makeMultiProject, write, read, exists, FIXTURES } from './helpers.mjs'

const push = (p, ...a) => run('push.mjs', a, p)
const be = (p, ...a) => run('backend.mjs', a, p)
const catalog = (p, c) => write(path.join(p, '.dualcraft', 'push', 'notifications.json'), JSON.stringify(c))
const fixture = () => JSON.parse(read(path.join(FIXTURES, 'notifications.json')))
function addTexts(p, texts = JSON.parse(read(path.join(FIXTURES, 'push-texts.json')))) {
  for (const [loc, t] of Object.entries(texts)) { const f = path.join(p, '.dualcraft', 'i18n', loc + '.json'); write(f, JSON.stringify({ ...JSON.parse(read(f)), push: t })) }
}
function firebaseProject(multi = false) {
  const p = multi ? makeMultiProject('firestore') : makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  write(path.join(p, 'firestore.indexes.json'), '{"indexes":[]}')
  return p
}

test('init: device callables on the contract, sender, index and Flutter service', () => {
  const p = makeProject({ mobile: 'flutter', paths: { mobile: 'app' } })
  assert.equal(push(p, 'init').code, 1, 'needs a backend')
  be(p, 'init', '--provider', 'firebase', '--region', 'europe-west1')
  write(path.join(p, 'firestore.indexes.json'), '{"indexes":[]}')
  const r = push(p, 'init')
  assert.equal(r.code, 0, r.err)
  for (const f of ['functions/src/push/send.ts', 'functions/src/registerDevice.ts', 'functions/src/unregisterDevice.ts', 'app/lib/services/push_service.dart', '.dualcraft/push/notifications.json']) assert.ok(exists(path.join(p, f)), f)
  const api = JSON.parse(read(path.join(p, '.dualcraft/backend/api.json')))
  const reg = api.functions.find((f) => f.name === 'registerDevice')
  assert.deepEqual(reg.input.pushIdType.values, ['fid', 'token'])
  assert.match(read(path.join(p, 'functions/src/index.ts')), /export \{ registerDevice \}/)
  assert.equal(JSON.parse(read(path.join(p, 'firestore.indexes.json'))).fieldOverrides[0].fieldPath, 'pushId')
  assert.match(read(path.join(p, 'app/lib/services/push_service.dart')), /onRegistered\.listen/)
  assert.match(read(path.join(p, 'functions/src/push/send.ts')), /fids: ids/)
  assert.equal(be(p, 'check').code, 0, be(p, 'check').out)
})

test('catalog validation: channels, params, routes and texts in every locale', () => {
  const p = firebaseProject()
  push(p, 'init')
  const c = fixture()
  c.notifications.push(
    { id: 'bad', channel: 'nope', params: { type: { type: 'string' } }, route: 'matches/{id}', ttl: 0 },
    { id: 'orphan', channel: 'matches', params: { n: { type: 'number' } } })
  catalog(p, c)
  addTexts(p, { es: { ...JSON.parse(read(path.join(FIXTURES, 'push-texts.json'))).es, bad: { title: 'x', body: '{who}' } }, en: JSON.parse(read(path.join(FIXTURES, 'push-texts.json'))).en })
  const r = push(p, 'check')
  assert.equal(r.code, 1)
  for (const m of [/channel "nope" is not declared/, /param "type" must be lowerCamelCase and not a reserved/, /route uses \{id\}, which is not a param/, /route is an app path/, /ttl in seconds/, /push\.bad\.body \(es\) uses \{who\}/, /missing text push\.bad\.title in i18n\/en\.json/, /param "n" type must be/, /missing text push\.orphan\.title in i18n\/es\.json/]) assert.match(r.out, m)
  assert.equal(push(p, 'gen').code, 1)
})

test('gen: localized server senders and typed parsers for every stack', () => {
  const p = firebaseProject(true)
  catalog(p, fixture()); addTexts(p)
  assert.equal(push(p, 'init').code, 0)
  const server = read(path.join(p, 'functions/src/generated/push.ts'))
  assert.match(server, /matchStarted: \(p: MatchStartedParams\): PushPayload => \(\{ type: "match_started", channel: "matches", priority: "high", ttlSeconds: 3600, collapseKey: "match_" \+ String\(p\.matchId \?\? ''\), route: "\/matches\/" \+ String\(p\.matchId \?\? ''\)/)
  assert.match(server, /weeklyOffer: \(p: WeeklyOfferParams = \{\}\)/)
  assert.match(server, /"en": \{\s*"title": "Kick-off!"/)
  assert.match(server, /export const LOCALES: string\[\] = \["en","es"\]|export const LOCALES: string\[\] = \["es","en"\]/)
  const ts = read(path.join(p, 'rn/src/lib/push-messages.ts'))
  assert.match(ts, /\| \{ type: "match_started"; route: string \| null; matchId: string; home\?: string; minute\?: number; live\?: boolean \}/)
  const kt = read(path.join(p, 'kmp/composeApp/src/commonMain/kotlin/com/test/app/push/PushMessages.kt'))
  assert.match(kt, /"weekly_offer" -> WeeklyOfferPush\n/)
  assert.match(kt, /data object WeeklyOfferPush : PushMessage\(\)/)
  assert.match(kt, /MATCHES\("matches", "Partidos", "Inicio y resultado de tus partidos", PushImportance.HIGH\)/)
  const sw = read(path.join(p, 'iosapp/Demo/Core/Push/PushMessages.swift'))
  assert.match(sw, /guard let count = s\("count"\)\.flatMap\(\{ Int\(\$0\) \}\) else \{ return nil \}/)
  assert.match(sw, /case let \.matchStarted\(matchId, _, _, _\): return "\/matches\/" \+ String\(describing: matchId\)/)
  // a text change is picked up by gen (server texts come from i18n)
  addTexts(p, { es: { ...JSON.parse(read(path.join(FIXTURES, 'push-texts.json'))).es, weekly_offer: { title: 'Nueva oferta', body: 'Ya' } }, en: JSON.parse(read(path.join(FIXTURES, 'push-texts.json'))).en })
  assert.equal(push(p, 'gen').code, 0)
  assert.match(read(path.join(p, 'functions/src/generated/push.ts')), /"Nueva oferta"/)
})

test('check: permission, id changes, cold start, registration, iOS entitlements, unused notifications', () => {
  const p = firebaseProject()
  catalog(p, fixture()); addTexts(p)
  push(p, 'init')
  write(path.join(p, 'app/lib/services/push_service.dart'), "import 'package:firebase_messaging/firebase_messaging.dart';\nvoid x() { FirebaseMessaging.instance.getToken(); db.collection('devices').doc('a').set({}); }\n")
  write(path.join(p, 'app/ios/Runner/Runner.entitlements'), '<plist><dict></dict></plist>')
  const r = push(p, 'check')
  assert.equal(r.code, 1)
  for (const m of [/never asks for notification permission/, /push id changes not handled/, /getInitialMessage\(\) not used/, /push ids are not sent through registerDevice/, /writes push ids directly/, /no aps-environment/, /getToken\/onTokenRefresh are deprecated/, /"match_started" is declared but never sent/]) assert.match(r.out, m)
})
