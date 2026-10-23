// dsh-provider-hub - regenerate the models.dev catalog supplement.
//
//   node tools/sync-modelsdev.mjs [--check]
//
// Reads the models.dev catalog that OpenCode keeps at
// `~/.cache/opencode/models.json` and writes `core/catalog-models.js`: the models
// each EXISTING preset is missing. The curated presets in `core/providers.js` are
// never touched - they stay the hand-written source of truth - and this file only
// ever adds models a preset does not already list.
//
// Two things models.dev has that this catalog cannot carry:
//
//   * modalities beyond text and image - pi-ai's model schema accepts
//     `MODALITIES = ['text', 'image']`, so pdf / video / audio are dropped;
//   * models whose output is not text (image / audio / embedding generators) -
//     a chat route cannot use them, so they are dropped too.
//
// Thinking levels DO carry over: models.dev's `reasoning_options[].values` use
// the same names as pi-ai's `THINKING_LEVELS`, except `none`, which becomes
// `off` with a null wire value (sending nothing is how a route turns thinking
// off).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CURATED_PRESETS } from '../core/providers.js'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'core', 'catalog-models.js')
const SOURCE = process.env.MODELS_DEV_CACHE ?? join(process.env.HOME ?? '', '.cache', 'opencode', 'models.json')

/** pi-ai's own allow-lists, mirrored so a generated entry can never be rejected. */
const MODALITIES = ['text', 'image']
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * npm package → the protocol this plugin can write into a pi-ai profile. Used
 * only to judge a provider this catalog does NOT have yet; an existing preset
 * already states its own protocol, so its models are matched whatever SDK the
 * vendor ships (models.dev lists OpenRouter and xAI under their own AI SDK
 * packages even though both speak OpenAI-compatible HTTP).
 */
const PROTOCOLS = {
  '@ai-sdk/openai-compatible': 'openai-completions',
  '@ai-sdk/openai': 'openai-completions',
  '@ai-sdk/anthropic': 'anthropic-messages',
}

const normalise = (url) => String(url ?? '').replace(/\/+$/, '').toLowerCase()

/** One models.dev model → a pi-ai model entry, or undefined when unusable. */
function toEntry(model) {
  const contextWindow = Number(model?.limit?.context)
  const maxTokens = Number(model?.limit?.output)
  if (!Number.isInteger(contextWindow) || contextWindow < 1) return undefined
  if (!Number.isInteger(maxTokens) || maxTokens < 1) return undefined
  if (typeof model.id !== 'string' || model.id === '') return undefined

  // A chat route needs text output; image/audio/embedding generators cannot be
  // driven through this adapter.
  const outputs = Array.isArray(model.modalities?.output) ? model.modalities.output : ['text']
  if (!outputs.includes('text')) return undefined

  const inputs = (Array.isArray(model.modalities?.input) ? model.modalities.input : []).filter((one) => MODALITIES.includes(one))
  const entry = {
    id: model.id,
    name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
    contextWindow,
    maxTokens,
    input: inputs.length > 0 ? inputs : ['text'],
  }

  if (model.reasoning === true) {
    const efforts = {}
    for (const option of Array.isArray(model.reasoning_options) ? model.reasoning_options : []) {
      for (const value of Array.isArray(option?.values) ? option.values : []) {
        const level = value === 'none' ? 'off' : value
        if (!THINKING_LEVELS.includes(level)) continue
        efforts[level] = level === 'off' ? null : level
      }
    }
    if (Object.keys(efforts).length > 0) entry.reasoningEfforts = efforts
  }
  return entry
}

const catalog = JSON.parse(readFileSync(SOURCE, 'utf8'))
const byId = new Map(CURATED_PRESETS.map((preset) => [preset.id, preset]))
const byBase = new Map(CURATED_PRESETS.map((preset) => [normalise(preset.baseURL), preset]))

/**
 * Provider names, reduced to letters and digits, as the last matching step.
 *
 * A credential reference is deliberately NOT a matching key: vendors reuse one
 * env var across plans that are different endpoints (`STEPFUN_API_KEY` covers
 * both `api.stepfun.com/v1` and `/step_plan/v1`), and matching on it silently
 * grafted one plan's models onto another's preset. A name is only trusted when
 * it matches exactly, which is what links models.dev's `novita-ai` to the
 * `novita` preset while leaving `StepFun (China)` unmatched.
 */
const nameKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const byName = new Map()
for (const preset of CURATED_PRESETS) {
  const key = nameKey(preset.name)
  if (key.length >= 4 && !byName.has(key)) byName.set(key, preset)
}

/** models.dev model objects are a dict; keep their own order for stable output. */
function modelList(provider) {
  const models = provider.models
  if (Array.isArray(models)) return models
  return Object.values(models ?? {})
}

const supplement = {}
const matches = []
for (const [id, provider] of Object.entries(catalog)) {
  const preset = byId.get(id) ?? byBase.get(normalise(provider.api)) ?? byName.get(nameKey(provider.name))
  if (!preset) continue
  const how = byId.get(id) === preset ? 'id' : byBase.get(normalise(provider.api)) === preset ? 'baseURL' : 'name'
  matches.push({ from: id, to: preset.id, how, models: modelList(provider).length, protocol: PROTOCOLS[provider.npm] ?? null })

  // Several models.dev entries can describe the same preset (a vendor's global
  // and regional listings, say). They accumulate into one list rather than
  // overwriting each other.
  const bucket = (supplement[preset.id] ??= [])
  const have = new Set([...preset.models.map((model) => model.id), ...bucket.map((model) => model.id)])
  for (const model of modelList(provider)) {
    if (have.has(model.id)) continue
    const entry = toEntry(model)
    if (!entry) continue
    have.add(model.id)
    bucket.push(entry)
  }
}

const report = Object.entries(supplement)
  .filter(([, entries]) => entries.length > 0)
  .map(([id, entries]) => {
    const preset = byId.get(id)
    return { id, mine: preset.models.length, added: entries.length, total: preset.models.length + entries.length }
  })
for (const id of Object.keys(supplement)) {
  if (supplement[id].length === 0) delete supplement[id]
}

// --- output -------------------------------------------------------------------

const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const entryLine = (entry) => {
  const parts = [`id: ${JSON.stringify(entry.id)}`, `name: ${JSON.stringify(entry.name)}`, `contextWindow: ${entry.contextWindow}`, `maxTokens: ${entry.maxTokens}`]
  parts.push(`input: [${entry.input.map(quote).join(', ')}]`)
  if (entry.reasoningEfforts) parts.push(`reasoningEfforts: ${JSON.stringify(entry.reasoningEfforts)}`)
  return `    { ${parts.join(', ')} },`
}

const lines = []
lines.push('// dsh-provider-hub - models.dev catalog supplement (GENERATED).')
lines.push('//')
lines.push('// Do not edit by hand: run `node tools/sync-modelsdev.mjs` instead. This file')
lines.push('// only ever ADDS models to a preset that already exists in core/providers.js;')
lines.push('// the curated entries there stay untouched and always come first.')
lines.push('//')
lines.push('// Source: models.dev catalog cache (~/.cache/opencode/models.json), the same')
lines.push('// catalog OpenCode ships. Modalities are clipped to pi-ai\'s [text, image];')
lines.push('// `none` in a reasoning option becomes `off: null`.')
lines.push('')
lines.push('/** Models each preset is missing, keyed by preset id. */')
lines.push('export const CATALOG_MODELS = {')
for (const [id, entries] of Object.entries(supplement)) {
  lines.push(`  ${quote(id)}: [`)
  for (const entry of entries) lines.push(entryLine(entry))
  lines.push('  ],')
}
lines.push('}')
lines.push('')

const output = lines.join('\n')
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    current = ''
  }
  if (current !== output) {
    console.error('catalog-models.js is out of date; run: node tools/sync-modelsdev.mjs')
    process.exit(1)
  }
  console.log('catalog-models.js is up to date')
} else {
  writeFileSync(OUT, output)
  const total = report.reduce((sum, row) => sum + row.added, 0)
  console.log(`presets matched: ${matches.length} (of ${CURATED_PRESETS.length} curated)`)
  for (const m of matches.sort((a, b) => a.to.localeCompare(b.to))) {
    console.log(`  models.dev ${m.from.padEnd(24)} -> ${m.to.padEnd(24)} by ${m.how.padEnd(7)} (${m.models} models)`)
  }
  console.log()
  console.log(`presets with additions: ${report.length}`)
  console.log(`models added: ${total}`)
  for (const row of report.sort((a, b) => b.added - a.added)) console.log(`  ${row.id.padEnd(24)} ${row.mine} -> ${row.total} (+${row.added})`)
  console.log(`wrote ${OUT}`)
}
