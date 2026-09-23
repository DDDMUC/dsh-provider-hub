// dsh-provider-hub - WorkBuddy adapter tests (node:test).

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  baseUrlError,
  buildWorkbuddyEntries,
  buildWorkbuddyEntry,
  installedPresets,
  isValidWorkbuddyEntry,
  removeWorkbuddyModels,
  upsertWorkbuddyModels,
} from '../core/adapters/workbuddy.js'

test('workbuddy: validator mirrors the app acceptance rules', () => {
  assert.equal(isValidWorkbuddyEntry(undefined), false)
  assert.equal(isValidWorkbuddyEntry([]), false)
  assert.equal(isValidWorkbuddyEntry({}), false)
  assert.equal(isValidWorkbuddyEntry({ id: '   ' }), false)
  assert.equal(isValidWorkbuddyEntry({ id: 'a' }), true)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', name: 'x', vendor: 'y', url: 'https://x.dev/v1', apiKey: 'k' }), true)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', url: 42 }), false)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', maxInputTokens: '131072' }), true)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', maxInputTokens: 'nope' }), false)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', supportsToolCall: 'yes' }), false)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', reasoning: [] }), false)
  assert.equal(isValidWorkbuddyEntry({ id: 'a', reasoning: { supportedEfforts: ['low'] } }), true)
})

test('workbuddy: every built preset entry passes the app validator', () => {
  for (const preset of PRESETS) {
    for (const entry of buildWorkbuddyEntries(preset, { key: 'test-key' })) {
      assert.equal(isValidWorkbuddyEntry(entry), true, `${preset.id}/${entry.id}`)
      assert.equal(entry.url, preset.baseURL)
      assert.equal(entry.apiKey, 'test-key')
      assert.equal(entry.useCustomProtocol, false)
      assert.equal(entry.supportsToolCall, true)
    }
  }
})

test('workbuddy: stepfun step plan entry carries the expected shape', () => {
  const preset = findPreset('stepfun-step-plan')
  const entry = buildWorkbuddyEntry(preset, preset.models[0], { key: '  sk-abc  ' })
  assert.equal(entry.id, 'step-5-preview')
  assert.equal(entry.url, 'https://api.stepfun.com/step_plan/v1')
  assert.equal(entry.apiKey, 'sk-abc')
  assert.equal(entry.supportsImages, true)
  assert.equal(entry.supportsReasoning, true)
  assert.deepEqual(entry.reasoning.supportedEfforts, ['low', 'medium', 'high'])
  assert.equal(entry.reasoning.defaultEffort, 'low')
  assert.equal(entry.maxInputTokens, 1024000)
  assert.equal(entry.maxOutputTokens, 65536)
  assert.match(entry.name, /StepFun/)
})

test('workbuddy: modelIds narrows the entry set', () => {
  const preset = findPreset('stepfun-step-plan')
  const entries = buildWorkbuddyEntries(preset, { key: 'k', modelIds: ['step-3.5-flash'] })
  assert.deepEqual(entries.map((entry) => entry.id), ['step-3.5-flash'])
})

test('workbuddy: upsert keys by id and preserves foreign entries', () => {
  const preset = findPreset('stepfun-step-plan')
  const foreign = { id: 'other', url: 'https://other.example/v1', apiKey: 'x' }
  const first = upsertWorkbuddyModels([foreign], buildWorkbuddyEntries(preset, { key: 'k1', modelIds: ['step-5-preview'] }))
  assert.equal(first.added, 1)
  assert.equal(first.updated, 0)
  assert.equal(first.models.length, 2)
  assert.equal(first.models[0].id, 'other')
  const second = upsertWorkbuddyModels(first.models, buildWorkbuddyEntries(preset, { key: 'k2', modelIds: ['step-5-preview'] }))
  assert.equal(second.added, 0)
  assert.equal(second.updated, 1)
  assert.equal(second.models.length, 2)
  assert.equal(second.models[1].apiKey, 'k2')
})

test('workbuddy: remove matches the preset endpoint and reports counts', () => {
  const preset = findPreset('stepfun-step-plan')
  const models = [
    { id: 'a', url: preset.baseURL },
    { id: 'b', url: preset.baseURL },
    { id: 'c', url: 'https://other.example/v1' },
  ]
  const { models: left, removed } = removeWorkbuddyModels(models, preset)
  assert.equal(removed, 2)
  assert.deepEqual(left.map((entry) => entry.id), ['c'])
})

test('workbuddy: installedPresets counts by endpoint', () => {
  const list = [{ id: 'a', url: 'https://api.stepfun.com/step_plan/v1' }, { id: 'b', url: 'https://api.openai.com/v1' }]
  const installed = installedPresets(list, PRESETS)
  assert.equal(installed.get('stepfun-step-plan'), 1)
  assert.equal(installed.get('openai'), 1)
  assert.equal(installed.get('openrouter'), undefined)
})

test('workbuddy: upsert refuses invalid entries', () => {
  assert.throws(() => upsertWorkbuddyModels([], [{ id: '' }]), /非法条目/)
  assert.throws(() => upsertWorkbuddyModels([], [{ id: 'a', supportsImages: 'yes' }]), /非法条目/)
})

test('workbuddy: baseUrlError mirrors the connectivity test', () => {
  assert.equal(baseUrlError('https://api.example.com/v1'), undefined)
  assert.match(baseUrlError(''), /不能为空/)
  assert.match(baseUrlError('not a url'), /格式不合法/)
  assert.match(baseUrlError('ftp://x.dev'), /HTTP/)
})

test('workbuddy: catalog adds never clobber a configured entry or an earlier duplicate', () => {
  const cn = findPreset('stepfun-step-plan')
  const global = findPreset('stepfun-step-plan-global')
  // keyed install of the CN preset, then a keyless add-all pass over both
  const first = upsertWorkbuddyModels([], buildWorkbuddyEntries(cn, { key: 'cn-key', modelIds: ['step-5-preview'] }))
  const second = upsertWorkbuddyModels(first.models, [
    ...buildWorkbuddyEntries(cn, { modelIds: ['step-5-preview'] }),
    ...buildWorkbuddyEntries(global, { modelIds: ['step-5-preview'] }),
  ])
  assert.equal(second.models.length, 1)
  assert.equal(second.models[0].url, 'https://api.stepfun.com/step_plan/v1')
  assert.equal(second.models[0].apiKey, 'cn-key')
  assert.equal(second.kept, 2)
  // a keyed add is an explicit install and wins
  const third = upsertWorkbuddyModels(second.models, buildWorkbuddyEntries(global, { key: 'global-key', modelIds: ['step-5-preview'] }))
  assert.equal(third.models[0].url, 'https://api.stepfun.ai/step_plan/v1')
  assert.equal(third.models[0].apiKey, 'global-key')
})
