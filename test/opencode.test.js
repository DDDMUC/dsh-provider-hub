// dsh-provider-hub - OpenCode adapter tests (node:test).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  buildOpencodeProvider,
  installedPresets,
  mergeOpencodeConfig,
  pruneOpencodeConfig,
  providerError,
  removeOpencodeProvider,
} from '../core/adapters/opencode.js'

test('opencode: every preset builds a valid provider entry', () => {
  for (const preset of PRESETS) {
    const entry = buildOpencodeProvider(preset, { key: 'k', npm: '@ai-sdk/openai-compatible' })
    assert.equal(providerError(entry[preset.id]), undefined, preset.id)
    assert.equal(entry[preset.id].api, preset.baseURL)
    assert.equal(Object.keys(entry[preset.id].models).length, preset.models.length)
  }
})

test('opencode: model metadata maps from the catalog', () => {
  const preset = findPreset('stepfun-step-plan')
  const entry = buildOpencodeProvider(preset, { key: '  sk-x  ' })
  const model = entry[preset.id].models['step-5-preview']
  assert.equal(model.name, 'Step 5 Preview')
  assert.equal(model.attachment, true)
  assert.equal(model.reasoning, true)
  assert.equal(model.tool_call, true)
  assert.deepEqual(model.limit, { context: 1024000, input: 1024000, output: 65536 })
  assert.equal(entry[preset.id].options.apiKey, 'sk-x')
  assert.equal(entry[preset.id].npm, undefined)
})

test('opencode: modelIds narrows and unknown routes carry npm', () => {
  const preset = findPreset('stepfun-step-plan')
  const entry = buildOpencodeProvider(preset, { npm: '@ai-sdk/openai-compatible', modelIds: ['step-3.5-flash'] })
  assert.deepEqual(Object.keys(entry[preset.id].models), ['step-3.5-flash'])
  assert.equal(entry[preset.id].npm, '@ai-sdk/openai-compatible')
})

test('opencode: merge keeps foreign providers, config keys and user model edits', () => {
  const preset = findPreset('longcat')
  const base = {
    $schema: 'https://opencode.ai/config.json',
    theme: 'dark',
    provider: {
      other: { api: 'https://other.example/v1', models: { a: { name: 'A' } } },
      longcat: {
        name: 'LongCat（美团）',
        api: preset.baseURL,
        options: { apiKey: 'old' },
        models: { 'LongCat-2.0': { name: 'Keep me', interleaved: { field: 'reasoning' } } },
      },
    },
  }
  const next = mergeOpencodeConfig(base, buildOpencodeProvider(preset, { key: 'new' }))
  assert.equal(next.$schema, base.$schema)
  assert.equal(next.theme, 'dark')
  assert.equal(next.provider.other.models.a.name, 'A')
  assert.equal(next.provider.longcat.options.apiKey, 'new')
  assert.equal(next.provider.longcat.models['LongCat-2.0'].interleaved.field, 'reasoning')
  assert.equal(next.provider.longcat.models['LongCat-2.0'].tool_call, true)
  // originals untouched
  assert.equal(base.provider.longcat.options.apiKey, 'old')
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
})
