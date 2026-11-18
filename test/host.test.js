// dsh-provider-hub - host-half integration (node:test, fake services).
//
// Exercises the real `apply()` wiring against stand-in `settings`, `llm` and
// `webServer` services: the presets DSH does not ship must reach the
// configurable-provider directory, an adopted preset route must leave that
// directory before pi-ai's own pass runs, its curated models/compat/headers must
// land in the profile exactly once - and hiding a route must take it out of the
// model picker while keeping everything needed to put it back.

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The journals live under the home directory; keep the suite out of the real one.
// os.homedir() reads USERPROFILE on Windows and HOME elsewhere, so both have to
// point at the scratch directory or the suite writes into the developer's own
// ~/.provider-hub.
const testHome = mkdtempSync(join(tmpdir(), 'provider-hub-test-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

const { apply } = await import('../src/index.js')
const { PRESETS, findPreset } = await import('../core/providers.js')
const { coverageOf } = await import('../core/coverage.js')

/** Routes the installed pi-ai catalog already owns, as the live runtime reports them. */
const NATIVE = ['openai', 'anthropic', 'deepseek', 'opencode', 'opencode-go', 'xai', 'zai']

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A loopback request that satisfies the plugin's guard, with its body preloaded. */
function request({ method = 'POST', body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  req.headers = { host: '127.0.0.1:3080' }
  req.socket = { remoteAddress: '127.0.0.1' }
  const payload = body === undefined ? '' : JSON.stringify(body)
  process.nextTick(() => {
    if (payload !== '') req.emit('data', payload)
    req.emit('end')
  })
  return req
}

function response() {
  const res = { status: 0, payload: null }
  res.writeHead = (status) => {
    res.status = status
  }
  res.end = (payload) => {
    res.payload = payload
  }
  return res
}

function harness(initialProviders = {}) {
  const users = { 'llm-pi-ai': { providers: { ...initialProviders } }, 'llm-deepseek': {} }
  const revisions = { 'llm-pi-ai': 1, 'llm-deepseek': 1 }
  // `declared: false` is how the runtime marks a route the installed catalog
  // ships; this plugin's own entries carry no `declared` at all.
  const directory = new Map(
    NATIVE.map((provider) => [provider, { provider, declared: false, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] }]),
  )
  // DeepSeek's API-key route: its own plugin registers the adapter
  // unconditionally and declares the namespace root as its settings path.
  directory.set('deepseek-official', { provider: 'deepseek-official', displayName: 'DeepSeek', declared: false, settingsNs: 'llm-deepseek', settingsPath: [] })
  const calls = { registered: [], replaced: [], mutated: [], unset: [] }
  let held = new Set()

  const settings = {
    describe: () => Object.entries(users).map(([ns, user]) => ({ ns, revision: revisions[ns], user })),
    mutate: async (ns, ops, expected) => {
      assert.ok(Object.hasOwn(users, ns), `unknown namespace ${ns}`)
      assert.equal(expected, revisions[ns])
      for (const op of ops) {
        let parent = users[ns]
        for (const key of op.path.slice(0, -1)) {
          if (parent[key] === null || typeof parent[key] !== 'object') parent[key] = {}
          parent = parent[key]
        }
        const last = op.path[op.path.length - 1]
        if (op.op === 'unset') {
          delete parent[last]
          calls.unset.push(`${ns}:${op.path.join('.')}`)
          continue
        }
        assert.equal(op.op, 'set')
        parent[last] = op.value
        calls.mutated.push({ ns, path: op.path, route: op.path[1] ?? op.path[0], value: op.value, profile: op.value })
      }
      revisions[ns] += 1
    },
  }

  const llm = {
    listConfigurableProviders: () => [...directory.values()],
    registerConfigurableProviders: (entries) => {
      assert.equal(entries.length > 0, true, 'a registration must declare at least one provider')
      calls.registered.push(entries)
      const release = () => {
        for (const provider of held) directory.delete(provider)
        held = new Set()
      }
      for (const entry of entries) {
        held.add(entry.provider)
        directory.set(entry.provider, entry)
      }
      return {
        replace: (next) => {
          release()
          for (const entry of next) {
            held.add(entry.provider)
            directory.set(entry.provider, entry)
          }
          calls.replaced.push(next)
        },
      }
    },
  }

  const handlers = new Map()
  const webServer = {
    register: ({ path, handler }) => {
      handlers.set(path, handler)
      return () => {}
    },
  }

  const listeners = new Map()
  const services = { settings, llm, credentials: undefined, webServer }
  const sub = {
    get: (name) => services[name],
    logger: { warn() {} },
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
  }
  const ctx = {
    get: (name) => services[name],
    logger: { warn() {} },
    effect: (fn) => fn(),
    on: () => () => {},
    inject: (_deps, callback) => callback(sub),
  }

  const drive = async (path, { method, body }) => {
    const handler = handlers.get(`/dsh-provider-hub/${path}`)
    assert.ok(handler, `route ${path} is registered`)
    const res = response()
    await handler(request({ method, body }), res)
    return { status: res.status, json: res.payload === null ? null : JSON.parse(res.payload) }
  }

  return {
    ctx,
    calls,
    users,
    user: users['llm-pi-ai'],
    directory,
    /** Drive one registered loopback route exactly as the browser half does. */
    post: (path, body) => drive(path, { method: 'POST', body }),
    get: (path) => drive(path, { method: 'GET' }),
    emit: async (event) => {
      for (const listener of listeners.get(event) ?? []) listener()
      await settle()
    },
  }
}

test('host: declares the presets DSH does not ship, and only those', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  assert.equal(h.calls.registered.length, 1)
  const declared = h.calls.registered[0].map((entry) => entry.provider)
  // A preset the app already serves under another route id stays out too:
  // `opencode-zen` is the plugin's name for the native `opencode`.
  const covered = new Set(coverageOf(PRESETS, NATIVE).covered.map((entry) => entry.id))
  const expected = PRESETS.map((preset) => preset.id).filter((id) => !NATIVE.includes(id) && !covered.has(id))
  assert.deepEqual([...declared].sort(), [...expected].sort())
  for (const native of NATIVE) assert.equal(declared.includes(native), false, `${native} belongs to the installed catalog`)
  assert.equal(declared.includes('opencode-zen'), false, 'the vendor is already offered as `opencode`')
  assert.equal(declared.includes('cline-pass'), true)
  assert.deepEqual(h.calls.mutated, [])
})

test('host: an adopted preset leaves the directory and gets curated once', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  // The official editor saves the row: a profile appears under the derived ref.
  h.user.providers['cline-pass'] = { apiKeyEnv: 'CLINE_PASS_API_KEY', api: 'openai-completions', models: [] }
  await h.emit('loader/volatile-update')

  const last = h.calls.replaced.at(-1)
  assert.equal(last.some((entry) => entry.provider === 'cline-pass'), false, 'the adopted route must be withdrawn')
  assert.equal(h.directory.has('cline-pass'), false, 'pi-ai would refuse a route another registration still holds')

  assert.equal(h.calls.mutated.length, 1)
  const curated = h.calls.mutated[0]
  assert.equal(curated.route, 'cline-pass')
  assert.equal(curated.profile.apiKeyEnv, 'CLINE_PASS_API_KEY', 'the row keeps the reference its key lives under')
  assert.deepEqual(curated.profile.models.map((model) => model.id), findPreset('cline-pass').models.map((model) => model.id))
  assert.equal(curated.profile.displayName, 'ClinePass')

  // A second pass must not write again: an edit made after curation stands.
  h.user.providers['cline-pass'].models = [{ id: 'trimmed', name: 'trimmed' }]
  await h.emit('loader/volatile-update')
  assert.equal(h.calls.mutated.length, 1, 'curation is once per preset version')
})

test('host: a route the installed catalog owns is left exactly as DSH serves it', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  h.user.providers['opencode-go'] = { apiKeyEnv: 'OPENCODE_GO_API_KEY' }
  await h.emit('loader/volatile-update')

  assert.deepEqual(h.calls.mutated, [], 'the native catalog already supplies its models')
  assert.equal(h.directory.has('opencode-go'), true, 'a native route stays declared by the catalog')
})

test('host: a profile that predates the plugin is respected when it carries models', async () => {
  const trimmed = { apiKeyEnv: 'CLINE_API_KEY', displayName: 'ClinePass', models: [{ id: 'kimi-k3', name: 'Kimi K3' }] }
  const h = harness({ 'cline-pass': trimmed })
  apply(h.ctx)
  await settle()
  await h.emit('loader/volatile-update')

  assert.deepEqual(h.calls.mutated, [], 'a hand-trimmed working profile is not a draft to fill in')
  assert.equal(h.user.providers['cline-pass'], trimmed)
})

test('host: a pre-existing profile with no models still gets curated', async () => {
  const h = harness({ 'cline-free': { apiKeyEnv: 'CLINE_API_KEY', models: [] } })
  apply(h.ctx)
  await settle()
  await h.emit('loader/volatile-update')

  assert.equal(h.calls.mutated.length, 1)
  assert.equal(h.calls.mutated[0].route, 'cline-free')
  assert.deepEqual(h.calls.mutated[0].profile.models.map((model) => model.id), findPreset('cline-free').models.map((model) => model.id))
})

test('host: a route that is not a preset is never curated', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  h.user.providers['my-gateway'] = { apiKeyEnv: 'MY_GATEWAY_API_KEY', api: 'openai-completions' }
  await h.emit('loader/volatile-update')
  assert.deepEqual(h.calls.mutated, [])
})

test('host: a preset this plugin declares is not covered by itself', async () => {
  // 插件把自己的预设注册进 pi-ai 的 configurable-provider 目录，于是
  // `listConfigurableProviders()` 里就有 `apigoto`。如果把它也算作"宿主原生提供"，
  // coverage 会得出 `apigoto -> apigoto`，客户端据此把这条预设从"可添加"列表里
  // 滤掉（`covered !== true`）——预设就这样在自己的入口里消失了，而官方编辑器又
  // 补不上目录项带不了的模型列表，等于彻底加不进来。
  const h = harness()
  apply(h.ctx)
  await settle()

  const state = await h.get('state')
  const presets = state.json.presets
  assert.ok(presets.length > 0, '目录里有预设')

  // 宿主原生提供的路由（openai、deepseek 这些）自己覆盖自己是正常的，跳过；
  // 其余任何"自己覆盖自己"都是本插件把自己的声明当成了宿主原生提供。
  const NATIVE_IDS = new Set([...NATIVE, 'deepseek-official'])
  for (const preset of presets) {
    if (NATIVE_IDS.has(preset.id)) continue
    assert.notEqual(preset.coveredBy, preset.id, `${preset.id} 不能覆盖它自己`)
  }

  const apigoto = presets.find((preset) => preset.id === 'apigoto')
  assert.ok(apigoto, 'apigoto 在目录里')
  assert.equal(apigoto.covered, false, 'apigoto 必须留在"可添加"列表里')

  // 真正的跨家覆盖仍然要保留：opencode-zen 由宿主自带的 opencode 提供。
  const zen = presets.find((preset) => preset.id === 'opencode-zen')
  assert.equal(zen.covered, true, 'opencode-zen 仍应被宿主原生覆盖')
  assert.equal(zen.coveredBy, 'opencode')
})

test('host: hide takes a route out of the picker and show puts it back unchanged', async () => {
  const profile = { apiKeyEnv: 'CLINE_API_KEY', displayName: 'ClinePass', api: 'openai-completions', models: [{ id: 'kimi-k3', name: 'Kimi K3' }] }
  const h = harness({ 'cline-pass': profile })
  apply(h.ctx)
  await settle()

  const before = await h.get('state')
  assert.deepEqual(before.json.hidden, {}, 'nothing hidden yet')

  const hidden = await h.post('hide', { route: 'cline-pass' })
  assert.equal(hidden.status, 200)
  assert.equal(hidden.json.ok, true)
  // The user layer loses the profile, so `llm.listProviders()` drops the route
  // and the composer stops listing it. The credential is never touched.
  assert.equal(Object.hasOwn(h.user.providers, 'cline-pass'), false)
  assert.deepEqual(h.calls.unset, ['llm-pi-ai:providers.cline-pass'])

  const mid = await h.get('state')
  assert.deepEqual(Object.keys(mid.json.hidden), ['cline-pass'])
  assert.equal(mid.json.hidden['cline-pass'].displayName, 'ClinePass')
  assert.equal(mid.json.hidden['cline-pass'].modelCount, 1)

  const shown = await h.post('show', { route: 'cline-pass' })
  assert.equal(shown.status, 200)
  assert.deepEqual(h.user.providers['cline-pass'], profile, 'restored byte for byte')

  const after = await h.get('state')
  assert.deepEqual(after.json.hidden, {}, 'the stash is cleared once shown')
})

test('host: hide refuses a route that is not configured', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  const res = await h.post('hide', { route: 'nous-portal' })
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'not-configured')
})

test('host: hiding a catalog route empties its model catalog and keeps its card', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  // The route's own plugin registers the adapter unconditionally, so dropping a
  // settings value cannot unregister it - emptying the catalog is the lever.
  const hidden = await h.post('hide', { route: 'deepseek-official' })
  assert.equal(hidden.status, 200)
  assert.equal(hidden.json.mode, 'catalog')
  assert.deepEqual(h.users['llm-deepseek'].models, [])
  assert.deepEqual(h.calls.mutated.at(-1).path, ['models'], 'written at the namespace root')

  const mid = await h.get('state')
  assert.equal(mid.json.hidden['deepseek-official'].mode, 'catalog')
  // A catalog route's name lives only in its directory entry, so the footer
  // shows the product name rather than the route id.
  assert.equal(mid.json.hidden['deepseek-official'].displayName, 'DeepSeek')

  const shown = await h.post('show', { route: 'deepseek-official' })
  assert.equal(shown.status, 200)
  // Nothing had overridden the catalog, so dropping the empty list restores the
  // namespace's own default instead of pinning an empty one.
  assert.equal(Object.hasOwn(h.users['llm-deepseek'], 'models'), false)
  assert.deepEqual(h.calls.unset, ['llm-deepseek:models'])
  assert.deepEqual((await h.get('state')).json.hidden, {})
})

test('host: a catalog route restores the catalog the user had overridden', async () => {
  const mine = [{ id: 'deepseek-flash', name: 'Mine' }]
  const h = harness()
  h.users['llm-deepseek'].models = mine
  apply(h.ctx)
  await settle()

  await h.post('hide', { route: 'deepseek-official' })
  assert.deepEqual(h.users['llm-deepseek'].models, [])

  await h.post('show', { route: 'deepseek-official' })
  assert.deepEqual(h.users['llm-deepseek'].models, mine, 'the overridden catalog comes back as it was')
})

test('host: state reports which lever each route hides with', async () => {
  const h = harness({ 'cline-pass': { apiKeyEnv: 'CLINE_API_KEY', displayName: 'ClinePass', models: [] } })
  apply(h.ctx)
  await settle()

  const state = await h.get('state')
  assert.equal(state.json.routes['cline-pass'].hideMode, 'profile')
  // A catalog route has no profile, so it is absent from `routes` and the client
  // reads the mode from the directory-wide map instead.
  assert.equal(state.json.routes['deepseek-official'], undefined)
  assert.equal(state.json.hideModes['deepseek-official'], 'catalog')
  assert.equal(state.json.hideModes['cline-pass'], 'profile')
})

test('host: show refuses a route that is not hidden', async () => {
  const h = harness({ 'cline-pass': { apiKeyEnv: 'CLINE_API_KEY' } })
  apply(h.ctx)
  await settle()

  const res = await h.post('show', { route: 'cline-pass' })
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'not-hidden')
})

test('host: a hidden preset is declared as dormant again, so the dropdown offers it', async () => {
  const h = harness({ 'nous-portal': { apiKeyEnv: 'NOUS_API_KEY', displayName: 'Nous Portal', models: [] } })
  apply(h.ctx)
  await settle()

  await h.post('hide', { route: 'nous-portal' })
  await h.emit('loader/volatile-update')

  const declared = h.calls.replaced.at(-1) ?? h.calls.registered.at(-1)
  assert.equal(declared.some((entry) => entry.provider === 'nous-portal'), true, 'hiding returns it to the directory')
  assert.equal(h.directory.has('nous-portal'), true)
})

test('host: a route the catalog already owns is never declared, even when configured', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  const declared = h.calls.registered[0].map((entry) => entry.provider)
  assert.equal(declared.includes('opencode-go'), false)
  assert.equal(declared.includes('deepseek'), false)
})
