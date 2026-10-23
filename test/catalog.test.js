// dsh-provider-hub - catalog invariants (node:test).
//
// The curated presets in `core/providers.js` are hand-written, but
// `core/catalog-models.js` is generated from the models.dev catalog. These
// checks are what keeps a regenerated supplement inside the shape the pi-ai
// profile schema actually accepts, so a bad sync fails here instead of on a
// user's save:
//
//   * `MODALITIES = ['text', 'image']` - models.dev's pdf / video / audio
//     entries cannot be carried, and the generator clips them;
//   * `THINKING_LEVELS = off/minimal/low/medium/high/xhigh/max` - reasoning keys
//     outside that set are rejected outright;
//   * `contextWindow` and `maxTokens` are positive integers.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CURATED_PRESETS, PRESETS, SUPPORTED_APIS } from '../core/providers.js'
import { CATALOG_MODELS } from '../core/catalog-models.js'

const MODALITIES = ['text', 'image']
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

test('catalog: every preset is addressable and uses a supported protocol', () => {
  const ids = new Set()
  for (const preset of PRESETS) {
    assert.equal(typeof preset.id, 'string', 'preset id')
    assert.ok(preset.id.length > 0, 'preset id must not be empty')
    assert.equal(ids.has(preset.id), false, `duplicate preset id ${preset.id}`)
    ids.add(preset.id)
    assert.ok(SUPPORTED_APIS.includes(preset.api), `${preset.id}: unsupported api ${preset.api}`)
    assert.equal(typeof preset.env, 'string', `${preset.id}: env`)
    assert.equal(typeof preset.name, 'string', `${preset.id}: name`)
    assert.match(preset.baseURL, /^https:\/\//, `${preset.id}: baseURL must be https`)
    assert.ok(preset.models.length > 0, `${preset.id}: needs at least one model`)
  }
})

test('catalog: every model fits the pi-ai model schema', () => {
  for (const preset of PRESETS) {
    const seen = new Set()
    for (const model of preset.models) {
      const where = `${preset.id}/${model.id}`
      assert.equal(typeof model.id, 'string', `${where}: id`)
      assert.ok(model.id.length > 0, `${where}: id must not be empty`)
      assert.equal(seen.has(model.id), false, `${where}: duplicate model id`)
      seen.add(model.id)
      assert.equal(typeof model.name, 'string', `${where}: name`)
      assert.ok(model.name.length > 0, `${where}: name must not be empty`)
      assert.ok(Number.isInteger(model.contextWindow) && model.contextWindow >= 1, `${where}: contextWindow`)
      assert.ok(Number.isInteger(model.maxTokens) && model.maxTokens >= 1, `${where}: maxTokens`)
      assert.ok(Array.isArray(model.input) && model.input.length > 0, `${where}: input`)
      for (const modality of model.input) {
        assert.ok(MODALITIES.includes(modality), `${where}: modality ${modality} is not accepted by pi-ai`)
      }
      if (model.reasoningEfforts !== undefined && model.reasoningEfforts !== false) {
        for (const [level, wire] of Object.entries(model.reasoningEfforts)) {
          assert.ok(THINKING_LEVELS.includes(level), `${where}: thinking level ${level} is not accepted by pi-ai`)
          assert.ok(wire === null || typeof wire === 'string', `${where}: thinking wire value for ${level}`)
        }
      }
    }
  }
})

test('catalog: the generated supplement only adds, and keeps curated entries first', () => {
  for (const preset of CURATED_PRESETS) {
    const merged = PRESETS.find((candidate) => candidate.id === preset.id)
    assert.ok(merged, `${preset.id} survived the merge`)
    assert.deepEqual(merged.models.slice(0, preset.models.length), preset.models, `${preset.id}: curated models stay, in order`)
    const extra = CATALOG_MODELS[preset.id]
    if (Array.isArray(extra) && extra.length > 0) {
      assert.equal(merged.curatedModels, preset.models, `${preset.id}: the curated list stays addressable for fingerprinting`)
    } else {
      assert.equal(merged.curatedModels, undefined, `${preset.id}: untouched presets keep their original shape`)
    }
  }
})

test('catalog: the supplement never repeats a curated model id', () => {
  for (const [id, entries] of Object.entries(CATALOG_MODELS)) {
    const preset = CURATED_PRESETS.find((candidate) => candidate.id === id)
    assert.ok(preset, `supplement key ${id} names a real preset`)
    const have = new Set(preset.models.map((model) => model.id))
    for (const entry of entries) {
      assert.equal(have.has(entry.id), false, `${id}: supplement repeats curated model ${entry.id}`)
    }
  }
})

test('catalog: a route already adopted is not re-curated by a growing supplement', async () => {
  const { presetFingerprint } = await import('../core/directory.js')
  for (const preset of CURATED_PRESETS) {
    const merged = PRESETS.find((candidate) => candidate.id === preset.id)
    assert.equal(presetFingerprint(merged), presetFingerprint(preset), `${preset.id}: fingerprint ignores the supplement`)
  }
})
