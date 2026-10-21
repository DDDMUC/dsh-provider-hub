// dsh-provider-hub - host-half directory integration (node:test, fake services).
//
// Exercises the real `apply()` wiring against stand-in `settings` and `llm`
// services: the presets DSH does not ship must reach the configurable-provider
// directory, an adopted preset route must leave that directory before pi-ai's
// own pass runs, and the curated models/compat/headers must land in its profile
// exactly once - without touching a route the installed catalog owns or a
// profile the user shaped before this plugin ever looked.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The journal lives under the home directory; keep the suite out of the real one.
process.env.HOME = mkdtempSync(join(tmpdir(), 'provider-hub-test-'))

const { apply } = await import('../src/index.js')
const { PRESETS, findPreset } = await import('../core/providers.js')
const { coverageOf } = await import('../core/coverage.js')

/** Routes the installed pi-ai catalog already owns, as the live runtime reports them. */
const NATIVE = ['openai', 'anthropic', 'deepseek', 'opencode', 'opencode-go', 'xai', 'zai']

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(initialProviders = {}) {
  const user = { providers: { ...initialProviders } }
  let revision = 1
  // `declared: false` is how the runtime marks a route the installed catalog
  // ships; this plugin's own entries carry no `declared` at all.
  const directory = new Map(NATIVE.map((provider) => [provider, { provider, declared: false }]))
  const calls = { registered: [], replaced: [], mutated: [] }
  let held = new Set()

  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision, user }],
    mutate: async (ns, ops, expected) => {
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(expected, revision)
      for (const op of ops) {
        assert.equal(op.op, 'set')
        assert.deepEqual(op.path.slice(0, 1), ['providers'])
        user.providers[op.path[1]] = op.value
        calls.mutated.push({ route: op.path[1], profile: op.value })
      }
      revision += 1
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

  const listeners = new Map()
  const services = { settings, llm, credentials: undefined, webServer: undefined }
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
    inject: (deps, callback) => {
      // The web-server injection is optional and unexercised here.
      if (deps.includes('webServer')) return
      callback(sub)
    },
  }

  return {
    ctx,
    calls,
    user,
    directory,
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

test('host: a route the catalog already owns is never declared, even when configured', async () => {
  const h = harness()
  apply(h.ctx)
  await settle()

  const declared = h.calls.registered[0].map((entry) => entry.provider)
  assert.equal(declared.includes('opencode-go'), false)
  assert.equal(declared.includes('deepseek'), false)
})
