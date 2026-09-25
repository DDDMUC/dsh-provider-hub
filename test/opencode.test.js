// dsh-provider-hub - OpenCode adapter tests (node:test).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  authEntryError,
  buildVariants,
  authRoutes,
  buildAuthEntry,
  buildOpencodeProvider,
  configKeys,
  installedPresets,
  mergeAuth,
  mergeOpencodeConfig,
  pruneOpencodeConfig,
  providerError,
  removeAuth,
  removeOpencodeProvider,
  stripConfigKeys,
} from '../core/adapters/opencode.js'

test('opencode: every preset builds a valid provider entry without a key', () => {
  for (const preset of PRESETS) {
    const entry = buildOpencodeProvider(preset, { npm: '@ai-sdk/openai-compatible' })
    assert.equal(providerError(entry[preset.id]), undefined, preset.id)
    assert.equal(entry[preset.id].api, preset.baseURL)
    assert.equal(entry[preset.id].options, undefined, preset.id)
    assert.equal(Object.keys(entry[preset.id].models).length, preset.models.length)
  }
})

test('opencode: model metadata maps from the catalog', () => {
  const preset = findPreset('stepfun-step-plan')
  const entry = buildOpencodeProvider(preset, {})
  const model = entry[preset.id].models['step-5-preview']
  assert.equal(model.name, 'Step 5 Preview')
  assert.equal(model.attachment, true)
  assert.deepEqual(model.modalities, { input: ['text', 'image'], output: ['text'] })
  assert.equal(model.reasoning, true)
  assert.equal(model.tool_call, true)
  assert.deepEqual(model.limit, { context: 1024000, input: 1024000, output: 65536 })
  assert.equal(entry[preset.id].npm, undefined)
})

test('opencode: modelIds narrows and unknown routes carry npm', () => {
  const preset = findPreset('stepfun-step-plan')
  const entry = buildOpencodeProvider(preset, { npm: '@ai-sdk/openai-compatible', modelIds: ['step-3.5-flash'] })
  assert.deepEqual(Object.keys(entry[preset.id].models), ['step-3.5-flash'])
  assert.equal(entry[preset.id].npm, '@ai-sdk/openai-compatible')
})

test('opencode: key-in-config is the only legacy path into the config', () => {
  const preset = findPreset('longcat')
  const legacy = buildOpencodeProvider(preset, { key: 'sk-x', keyInConfig: true })
  assert.equal(legacy[preset.id].options.apiKey, 'sk-x')
  const modern = buildOpencodeProvider(preset, { key: 'sk-x' })
  assert.equal(modern[preset.id].options, undefined)
})

test('opencode: merge keeps foreign providers, user model edits, drops empty options', () => {
  const preset = findPreset('longcat')
  const base = {
    $schema: 'https://opencode.ai/config.json',
    theme: 'dark',
    provider: {
      other: { api: 'https://other.example/v1', models: { a: { name: 'A' } } },
      longcat: {
        name: 'LongCat（美团）',
        api: preset.baseURL,
        models: { 'LongCat-2.0': { name: 'Keep me', interleaved: { field: 'reasoning' } } },
      },
    },
  }
  const next = mergeOpencodeConfig(base, buildOpencodeProvider(preset, {}))
  assert.equal(next.$schema, base.$schema)
  assert.equal(next.theme, 'dark')
  assert.equal(next.provider.other.models.a.name, 'A')
  assert.equal(next.provider.longcat.options, undefined)
  assert.equal(next.provider.longcat.models['LongCat-2.0'].interleaved.field, 'reasoning')
  assert.equal(next.provider.longcat.models['LongCat-2.0'].tool_call, true)
})

test('opencode: remove and prune only touch preset-owned routes', () => {
  const preset = findPreset('longcat')
  const config = {
    provider: {
      longcat: { api: preset.baseURL, models: { 'LongCat-2.0': {}, 'LongCat-1.0': {} } },
      other: { api: 'https://other.example/v1', models: { stale: {} } },
    },
  }
  const pruned = pruneOpencodeConfig(config, [preset])
  assert.equal(pruned.pruned, 1)
  assert.deepEqual(Object.keys(pruned.config.provider.longcat.models), ['LongCat-2.0'])
  assert.deepEqual(Object.keys(pruned.config.provider.other.models), ['stale'])
  const removed = removeOpencodeProvider(pruned.config, 'longcat')
  assert.equal(removed.provider.longcat, undefined)
  assert.ok(removed.provider.other)
})

test('opencode: installedPresets counts configured routes', () => {
  const installed = installedPresets({ provider: { longcat: { models: { a: {}, b: {} } } } }, PRESETS)
  assert.equal(installed.get('longcat'), 2)
  assert.equal(installed.get('openai'), undefined)
})

test('opencode: providerError refuses unusable entries', () => {
  assert.match(providerError(undefined), /对象/)
  assert.match(providerError({ api: 'ftp://x', models: { a: {} } }), /http/)
  assert.match(providerError({ api: 'https://x.dev/v1', models: {} }), /模型/)
  assert.equal(providerError({ options: { baseURL: 'https://x.dev/v1' }, models: { a: {} } }), undefined)
})

test('opencode: auth entries match the /connect shape and merge safely', () => {
  const entry = buildAuthEntry('volcengine-agent-plan', '  ark-x  ')
  assert.deepEqual(entry, { 'volcengine-agent-plan': { type: 'api', key: 'ark-x' } })
  assert.equal(authEntryError('volcengine-agent-plan', entry['volcengine-agent-plan']), undefined)
  assert.throws(() => buildAuthEntry('x', '  '), /Key 不能为空/)
  assert.match(authEntryError('x', { type: 'oauth' }), /type=api/)

  const merged = mergeAuth({ deepseek: { type: 'api', key: 'old' } }, entry)
  assert.equal(merged.deepseek.key, 'old')
  assert.equal(merged['volcengine-agent-plan'].key, 'ark-x')
  const removed = removeAuth(merged, 'volcengine-agent-plan')
  assert.equal(removed['volcengine-agent-plan'], undefined)
  assert.equal(removed.deepseek.key, 'old')

  const routes = authRoutes({ a: { type: 'api', key: 'k' }, b: { type: 'api', key: '' }, c: { type: 'oauth' } })
  assert.deepEqual([...routes].sort(), ['a'])
})

test('opencode: inline config keys can be listed and stripped', () => {
  const config = {
    provider: {
      commandcode: { api: 'https://api.commandcode.ai/provider/v1', options: { apiKey: 'user_x' }, models: { a: {} } },
      volcengine: { api: 'https://x/v1', models: { a: {} } },
    },
  }
  assert.deepEqual(configKeys(config, ['commandcode', 'volcengine']), { commandcode: 'user_x' })
  const stripped = stripConfigKeys(config, ['commandcode'])
  assert.equal(stripped.provider.commandcode.options, undefined)
  assert.equal(config.provider.commandcode.options.apiKey, 'user_x')
})

test('opencode: buildVariants turns catalog levels into selector variants', () => {
  // 方舟 deepseek-v4.1-flash: off 是字面 none，官方档位 none/low/high/max
  const variants = buildVariants({ off: 'none', low: 'low', high: 'high', max: 'max' })
  assert.deepEqual(variants, {
    none: { reasoningEffort: 'none' },
    low: { reasoningEffort: 'low' },
    high: { reasoningEffort: 'high' },
    max: { reasoningEffort: 'max' },
    minimal: { disabled: true },
    medium: { disabled: true },
    xhigh: { disabled: true },
  })
  // off:null（不发送参数）= Default 变体已覆盖，不单列；无其它档位则不产出 variants
  assert.deepEqual(buildVariants({ off: null }), undefined)
  assert.deepEqual(buildVariants(undefined), undefined)
  const ark = buildVariants({ low: 'low', medium: 'medium', high: 'high' })
  assert.deepEqual(Object.keys(ark).filter((k) => !ark[k].disabled), ['low', 'medium', 'high'])
  assert.deepEqual(ark.none, { disabled: true })
})

test('opencode: every preset entry carries variants only when levels exist', () => {
  for (const preset of PRESETS) {
    const entry = buildOpencodeProvider(preset, {})
    for (const [id, model] of Object.entries(entry[preset.id].models)) {
      const source = preset.models.find((m) => m.id === id)
      const declared = Object.entries(source.reasoningEfforts ?? {}).filter(([level, wire]) => level !== 'off' && wire !== null && wire !== undefined)
      if (declared.length === 0) assert.equal(model.variants, undefined, `${preset.id}/${id}`)
      else assert.ok(model.variants && Object.keys(model.variants).length > 0, `${preset.id}/${id}`)
    }
  }
})
