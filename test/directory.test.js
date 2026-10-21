// dsh-provider-hub - configurable-provider directory plan tests (node:test).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, findPreset } from '../core/providers.js'
import { curatedProfile, directoryEntry, planSync, presetFingerprint, sameProfile } from '../core/directory.js'

const NS = 'llm-pi-ai'

test('directory: an entry carries exactly the fields the runtime reads', () => {
  const preset = findPreset('cline-pass')
  const entry = directoryEntry(preset, NS)
  assert.deepEqual(Object.keys(entry).sort(), [
    'defaultBaseURL',
    'displayName',
    'nativeAuth',
    'provider',
    'settingsNs',
    'settingsPath',
  ])
  assert.equal(entry.provider, 'cline-pass')
  assert.equal(entry.displayName, 'ClinePass')
  assert.equal(entry.settingsNs, NS)
  assert.deepEqual(entry.settingsPath, ['providers', 'cline-pass'])
  assert.equal(entry.defaultBaseURL, preset.baseURL)
  assert.deepEqual(entry.nativeAuth, { env: ['CLINE_API_KEY'], oauth: false })
  // The runtime rejects an entry that names no model catalog, so the curated
  // models deliberately cannot ride the directory.
  assert.equal('models' in entry, false)
  assert.equal('api' in entry, false)
})

test('directory: every preset declares a well-formed entry', () => {
  for (const preset of PRESETS) {
    const entry = directoryEntry(preset, NS)
    assert.notEqual(entry.provider.length, 0)
    assert.notEqual(entry.displayName.length, 0)
    assert.notEqual(entry.settingsNs.length, 0)
    assert.equal(entry.settingsPath.some((segment) => segment.length === 0), false)
    assert.equal(typeof entry.defaultBaseURL, 'string')
    assert.equal(entry.nativeAuth.env.length, 1)
  }
})

test('directory: plan declares dormant presets and skips owned or configured ones', () => {
  const foreign = new Set(['opencode', 'deepseek', 'cline-pass'])
  const configured = new Set(['kilo-gateway', 'not-a-preset'])
  const { entries, enrich } = planSync({
    presets: PRESETS,
    foreign,
    catalog: foreign,
    configured,
    profiles: { 'kilo-gateway': { models: [] } },
    preExisting: new Set(['kilo-gateway']),
    journal: {},
    settingsNs: NS,
  })
  const ids = entries.map((entry) => entry.provider)
  assert.equal(ids.includes('cline-pass'), false, 'another registration owns it')
  assert.equal(ids.includes('opencode'), false, 'the installed catalog owns it')
  assert.equal(ids.includes('kilo-gateway'), false, 'already configured')
  assert.equal(ids.includes('nous-portal'), true)
  // Configured before the plugin looked, but with no models: the editor saved a
  // draft, so it still gets curated.
  assert.deepEqual(enrich.map((entry) => entry.id), ['kilo-gateway'])
})

test('directory: plan curates a configured preset once per preset version', () => {
  const preset = findPreset('cline-pass')
  const configured = new Set(['cline-pass'])
  const base = { presets: [preset], foreign: new Set(), catalog: new Set(), configured, profiles: { 'cline-pass': { models: [] } }, preExisting: new Set(), settingsNs: NS }
  const first = planSync({ ...base, journal: {} })
  assert.deepEqual(first.entries, [], 'a configured route is no longer dormant')
  assert.deepEqual(first.enrich.map((entry) => entry.id), ['cline-pass'])

  const journal = { 'cline-pass': { fingerprint: presetFingerprint(preset) } }
  const second = planSync({ ...base, journal })
  assert.deepEqual(second.enrich, [], 'an edit made after curation is never reverted')

  const stale = { 'cline-pass': { fingerprint: 'stale' } }
  const third = planSync({ ...base, journal: stale })
  assert.deepEqual(third.enrich.map((entry) => entry.id), ['cline-pass'], 'a changed preset re-curates')
})

test('directory: a preset the app already serves under another id is not declared', () => {
  const zen = findPreset('opencode-zen')
  assert.equal(zen.id, 'opencode-zen')
  assert.deepEqual(zen.nativeIds, ['opencode'])
  const { entries } = planSync({
    presets: [zen],
    foreign: new Set(['opencode']),
    covered: new Set(['opencode-zen']),
    catalog: new Set(['opencode']),
    configured: new Set(),
    profiles: {},
    preExisting: new Set(),
    journal: {},
    settingsNs: NS,
  })
  assert.deepEqual(entries, [], 'the app already offers this vendor as `opencode`')
})

test('directory: a route the installed catalog owns is respected, never curated', () => {
  const preset = findPreset('opencode-go')
  const { enrich, respected } = planSync({
    presets: [preset],
    foreign: new Set(),
    catalog: new Set(['opencode-go']),
    configured: new Set(['opencode-go']),
    profiles: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } },
    preExisting: new Set(),
    journal: {},
    settingsNs: NS,
  })
  assert.deepEqual(enrich, [], 'the native catalog already supplies its models')
  assert.deepEqual(respected.map((entry) => entry.id), ['opencode-go'])
})

test('directory: a profile that predates the plugin is respected when it carries models', () => {
  const preset = findPreset('cline-pass')
  const trimmed = { apiKeyEnv: 'CLINE_API_KEY', models: [{ id: 'kimi-k3', name: 'Kimi K3' }] }
  const { enrich, respected } = planSync({
    presets: [preset],
    foreign: new Set(),
    catalog: new Set(),
    configured: new Set(['cline-pass']),
    profiles: { 'cline-pass': trimmed },
    preExisting: new Set(['cline-pass']),
    journal: {},
    settingsNs: NS,
  })
  assert.deepEqual(enrich, [], 'a hand-trimmed working profile is not a draft')
  assert.deepEqual(respected.map((entry) => entry.id), ['cline-pass'])
})

test('directory: a route adopted after the plugin started is always curated', () => {
  const preset = findPreset('cline-pass')
  const { enrich } = planSync({
    presets: [preset],
    foreign: new Set(),
    catalog: new Set(),
    configured: new Set(['cline-pass']),
    profiles: { 'cline-pass': { apiKeyEnv: 'CLINE_PASS_API_KEY', models: [{ id: 'discovered', name: 'discovered' }] } },
    preExisting: new Set(),
    journal: {},
    settingsNs: NS,
  })
  assert.deepEqual(enrich.map((entry) => entry.id), ['cline-pass'], 'models the endpoint disclosed still lack the curated metadata')
})

test('directory: fingerprint follows the curated shape', () => {
  const preset = findPreset('cline-pass')
  const base = presetFingerprint(preset)
  assert.equal(presetFingerprint({ ...preset, baseURL: 'https://example.test/v1' }) === base, false)
  assert.equal(presetFingerprint({ ...preset, models: preset.models.slice(1) }) === base, false)
  assert.equal(presetFingerprint({ ...preset, name: preset.name + ' X' }) === base, false)
  assert.equal(presetFingerprint({ ...preset }) === base, true)
})

test('directory: curation keeps the derived credential and the editor extras', () => {
  const preset = findPreset('cline-pass')
  const existing = {
    apiKeyEnv: 'CLINE_PASS_API_KEY',
    api: 'openai-completions',
    baseURL: 'https://api.cline.bot/api/v1',
    models: [],
    timeoutMs: 90000,
  }
  const profile = curatedProfile(preset, existing)
  assert.equal(profile.apiKeyEnv, 'CLINE_PASS_API_KEY', 'the row keeps the reference its key lives under')
  assert.equal(profile.timeoutMs, 90000, 'an editor field the catalog does not own survives')
  assert.equal(profile.displayName, preset.name)
  assert.equal(profile.api, preset.api)
  assert.deepEqual(profile.models.map((model) => model.id), preset.models.map((model) => model.id))
  assert.deepEqual(profile.models[0].reasoningEfforts, preset.models[0].reasoningEfforts)
  assert.equal(sameProfile(existing, profile), false)
})

test('directory: curation keeps the preset credential when the row names none', () => {
  const preset = findPreset('cline-pass')
  const profile = curatedProfile(preset, { api: 'openai-completions' })
  assert.equal(profile.apiKeyEnv, preset.env)
})

test('directory: curation carries headers and compat from the preset', () => {
  const go = curatedProfile(findPreset('opencode-go'), { apiKeyEnv: 'OPENCODE_GO_API_KEY' })
  assert.deepEqual(go.headers, { 'x-opencode-session': 'dsh-provider-hub-opencode-go' })
  assert.equal(go.api, 'openai-responses')
  assert.equal(go.apiKeyEnv, 'OPENCODE_GO_API_KEY')
})

test('directory: curation is idempotent', () => {
  const preset = findPreset('nous-portal')
  const once = curatedProfile(preset, { apiKeyEnv: 'NOUS_API_KEY' })
  const twice = curatedProfile(preset, once)
  assert.equal(sameProfile(once, twice), true, 'a second pass writes nothing')
})

test('directory: sameProfile ignores key order but not values', () => {
  assert.equal(sameProfile({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true)
  assert.equal(sameProfile({ a: 1 }, { a: 2 }), false)
  assert.equal(sameProfile({ a: [1, 2] }, { a: [2, 1] }), false)
})
