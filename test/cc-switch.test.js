// dsh-provider-hub - cc-switch adapter tests (node:test).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  CCSWITCH_APPS,
  appsFor,
  buildCcSwitchEntry,
  installedCcSwitch,
  mergeCcSwitchConfig,
  removeCcSwitchProvider,
} from '../core/adapters/cc-switch.js'

test('cc-switch: opencode settingsConfig matches the SDK entry shape', () => {
  const preset = findPreset('volcengine-agent-plan')
  const entry = buildCcSwitchEntry(preset, 'opencode', { key: 'ark-x' })
  assert.equal(entry.id, preset.id)
  assert.equal(entry.settingsConfig.npm, '@ai-sdk/openai')
  assert.equal(entry.settingsConfig.options.baseURL, preset.baseURL)
  assert.equal(entry.settingsConfig.options.apiKey, 'ark-x')
  assert.deepEqual(entry.settingsConfig.models['deepseek-v4.1-flash'].limit, { context: 1048576, input: 1048576, output: 384000 })
  // 未提供 Key 时绝不能写空 apiKey
  const bare = buildCcSwitchEntry(preset, 'opencode', {})
  assert.equal(bare.settingsConfig.options.apiKey, undefined)
})

test('cc-switch: codex settingsConfig is auth + config.toml text', () => {
  const preset = findPreset('volcengine-agent-plan')
  const entry = buildCcSwitchEntry(preset, 'codex', { key: 'ark-x' })
  assert.deepEqual(entry.settingsConfig.auth, { OPENAI_API_KEY: 'ark-x' })
  const toml = entry.settingsConfig.config
  assert.match(toml, /model_provider = "custom"/)
  assert.match(toml, /model = "ark-code-latest"/)
  assert.match(toml, /base_url = "https:\/\/ark\.cn-beijing\.volces\.com\/api\/plan\/v3"/)
  assert.match(toml, /wire_api = "responses"/) // openai-responses preset → responses
  assert.match(toml, /requires_openai_auth = true/)
  // openai-completions 预设 → wire_api = "chat"
  const chat = buildCcSwitchEntry(findPreset('302ai'), 'codex', { key: 'k' })
  assert.match(chat.settingsConfig.config, /wire_api = "chat"/)
})

test('cc-switch: claude settingsConfig is the Anthropic env map', () => {
  const preset = findPreset('minimax-coding-plan')
  const entry = buildCcSwitchEntry(preset, 'claude', { key: 'sk-mm' })
  assert.equal(entry.settingsConfig.env.ANTHROPIC_BASE_URL, preset.baseURL)
  assert.equal(entry.settingsConfig.env.ANTHROPIC_AUTH_TOKEN, 'sk-mm')
  assert.equal(entry.settingsConfig.model, preset.models[0].id)
  const desktop = buildCcSwitchEntry(preset, 'claude-desktop', { key: 'sk-mm' })
  assert.equal(desktop.settingsConfig.env.ANTHROPIC_BASE_URL, preset.baseURL)
})

test('cc-switch: gemini only accepts Google endpoints, openclaw is flat', () => {
  assert.deepEqual(appsFor(findPreset('gemini')).includes('gemini'), true)
  assert.deepEqual(appsFor(findPreset('302ai')).includes('gemini'), false)
  const g = buildCcSwitchEntry(findPreset('gemini'), 'gemini', { key: 'gk' })
  assert.equal(g.settingsConfig.env.GOOGLE_GEMINI_BASE_URL, findPreset('gemini').baseURL)
  assert.equal(g.settingsConfig.env.GEMINI_API_KEY, 'gk')
  const oc = buildCcSwitchEntry(findPreset('longcat'), 'openclaw', { key: 'lk' })
  assert.deepEqual(oc.settingsConfig, { baseUrl: findPreset('longcat').baseURL, apiKey: 'lk' })
})

test('cc-switch: every preset maps to at least one section', () => {
  for (const preset of PRESETS) {
    const apps = appsFor(preset)
    assert.ok(apps.length > 0, `${preset.id} has no cc-switch section`)
    for (const app of apps) {
      assert.ok(CCSWITCH_APPS[app].includes(preset.api), `${preset.id}/${app} protocol mismatch`)
      const entry = buildCcSwitchEntry(preset, app, {})
      assert.ok(entry.settingsConfig && Object.keys(entry.settingsConfig).length > 0, `${preset.id}/${app} empty settingsConfig`)
    }
  }
})

test('cc-switch: merge keeps other sections, user edits and never touches current', () => {
  const preset = findPreset('minimax-coding-plan')
  const base = {
    version: 2,
    claude: { providers: { mine: { id: 'mine', settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'keep' } } } }, current: 'mine' },
    codex: { providers: {}, current: 'codex-official' },
  }
  const next = mergeCcSwitchConfig(base, 'claude', { [preset.id]: buildCcSwitchEntry(preset, 'claude', { key: 'k' }) })
  assert.equal(next.version, 2)
  assert.equal(next.claude.current, 'mine')
  assert.equal(next.codex.current, 'codex-official')
  assert.equal(next.claude.providers.mine.settingsConfig.env.ANTHROPIC_AUTH_TOKEN, 'keep')
  assert.equal(next.claude.providers[preset.id].settingsConfig.env.ANTHROPIC_AUTH_TOKEN, 'k')
  assert.equal(base.claude.providers[preset.id], undefined)
})

test('cc-switch: unset-key style merge drops only the key fields', () => {
  const preset = findPreset('longcat')
  const withKey = mergeCcSwitchConfig({}, 'openclaw', { [preset.id]: buildCcSwitchEntry(preset, 'openclaw', { key: 'lk' }) })
  const bare = mergeCcSwitchConfig(withKey, 'openclaw', { [preset.id]: buildCcSwitchEntry(preset, 'openclaw', {}) })
  assert.equal(bare.openclaw.providers[preset.id].settingsConfig.apiKey, 'lk') // 旧 Key 保留（合并语义）
  const removed = removeCcSwitchProvider(bare, 'openclaw', preset.id)
  assert.equal(removed.openclaw.providers[preset.id], undefined)
})

test('cc-switch: installed reports per-section model counts', () => {
  const preset = findPreset('volcengine-agent-plan')
  const config = mergeCcSwitchConfig({}, 'opencode', { [preset.id]: buildCcSwitchEntry(preset, 'opencode', {}) })
  const installed = installedCcSwitch(config, preset.id)
  assert.equal(installed.get('opencode'), preset.models.length)
  assert.equal(installed.get('codex'), undefined)
  assert.equal(installedCcSwitch(config, 'nope').size, 0)
})
