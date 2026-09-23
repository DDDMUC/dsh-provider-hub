#!/usr/bin/env node
// dsh-provider-hub - catalog refresher.
//
// Rebuilds the model lists and per-model compat switches in core/providers.js
// from an authoritative provider catalog, so the hub does not drift behind the
// apps it serves. Input is the same catalog shape the agent apps embed
// (provider -> models, each model carrying api / baseUrl / contextWindow /
// maxTokens / input / thinkingLevelMap / compat):
//
//   node tools/refresh-catalog.mjs --catalog /path/to/catalog.json [--dry]
//
// Unmapped presets (channels no authoritative source describes) keep their
// hand-written model lists. Route-level compat keeps only switches EVERY model
// agrees on; a model that disagrees carries its own `compat` entry, which the
// pi-ai profile passes through per model.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const providersPath = path.join(here, '..', 'core', 'providers.js')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const catalogArg = args.indexOf('--catalog')
const catalogPath = catalogArg >= 0 ? args[catalogArg + 1] : '/tmp/wb-catalog.json'
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

// preset id -> { source: catalog provider, cap, api?, baseURL? }
const MAP = {
  openai: { source: 'openai', cap: 6 },
  openrouter: { source: 'openrouter', cap: 8 },
  anthropic: { source: 'anthropic', cap: 5 },
  gemini: { source: 'google', cap: 4 },
  xai: { source: 'xai', cap: 4 },
  mistral: { source: 'mistral', cap: 5 },
  groq: { source: 'groq', cap: 5 },
  together: { source: 'together', cap: 5 },
  fireworks: { source: 'fireworks', cap: 5 },
  moonshot: { source: 'moonshotai-cn', cap: 5 },
  'moonshot-global': { source: 'moonshotai', cap: 5 },
  zhipu: { source: 'zai-coding-cn', cap: 5 },
  zai: { source: 'zai', cap: 5 },
  minimax: { source: 'minimax-cn', cap: 4, api: 'anthropic-messages', baseURL: 'https://api.minimaxi.com/anthropic' },
  'vercel-ai-gateway': { source: 'vercel-ai-gateway', cap: 12 },
}

// Fields a pi-ai openai-completions route may carry.
const OAI_FIELDS = [
  'supportsStore',
  'supportsDeveloperRole',
  'supportsReasoningEffort',
  'supportsUsageInStreaming',
  'supportsFinishReason',
  'maxTokensField',
  'requiresToolResultName',
  'requiresAssistantAfterToolResult',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'thinkingFormat',
]
// Fields a pi-ai anthropic-messages route may carry.
const ANT_FIELDS = [
  'supportsEagerToolInputStreaming',
  'supportsLongCacheRetention',
  'supportsCacheControlOnTools',
  'supportsTemperature',
  'forceAdaptiveThinking',
  'allowEmptySignature',
  'supportsStrictTools',
]

const fieldsFor = (api) => (api === 'anthropic-messages' ? ANT_FIELDS : OAI_FIELDS)

const score = (model) => (model.reasoning ? 2 : 0) + (model.tool_call !== false ? 1 : 0) + (model.contextWindow ?? 0) / 1e7

const EXCLUDE = [
  /:(batch|free|extended|nitro|online|thinking)$/i,
  /(^|\/)auto($|-)/i,
  /multi-agent|router/i,
  /safeguard/i,
  /-chat-latest$/i,
]

/** First numeric version token in the id, as a float (5.6, 4.8, 2512, 3). */
function versionOf(id) {
  const match = /(\d+(?:[.-]\d+)*)/.exec(id)
  const value = match ? Number.parseFloat(match[1].replace(/-/g, '.')) : 0
  // Sizes (120b) and dates (2512) parse as numbers far above any model
  // version; they must not outrank real versions.
  return value > 10 ? 0 : value
}

/** Explicit picks for providers whose ids do not rank by version. */
const CURATED = {
  openrouter: [
    'anthropic/claude-opus-5',
    'openai/gpt-5.6-sol',
    'google/gemini-3-pro',
    'x-ai/grok-4.6',
    'deepseek/deepseek-v4.1-flash',
    'moonshotai/kimi-k3',
    'zai-org/glm-5.3',
    'qwen/qwen3.8-max',
  ],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'magistral-medium-latest',
    'devstral-medium-latest',
    'devstral-latest',
  ],
  google: ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-pro'],
  'vercel-ai-gateway': [
    'anthropic/claude-opus-5',
    'anthropic/claude-fable-5.1',
    'anthropic/claude-sonnet-5',
    'openai/gpt-5.6-sol',
    'openai/gpt-5.6-luna',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3.8-flash',
    'deepseek/deepseek-v4.1-flash',
    'deepseek/deepseek-v4-flash',
    'moonshotai/kimi-k3',
    'xiaomi/mimo-v2.5-pro',
    'spacexai/grok-4.20-reasoning',
    'alibaba/qwen3.8-max',
  ],
}

/** Pick the top `cap` models for one catalog provider. */
function pick(source, cap) {
  const all = Object.values(catalog[source] ?? {})
  const curated = CURATED[source]
  if (curated) {
    const present = curated.map((id) => all.find((model) => model.id === id)).filter(Boolean)
    if (present.length > 0) return present.slice(0, cap)
  }
  return all
    .filter((model) => !EXCLUDE.some((rule) => rule.test(model.id)))
    .sort((a, b) => {
      const version = versionOf(b.id) - versionOf(a.id)
      if (version !== 0) return version
      return score(b) - score(a)
    })
    .slice(0, cap)
}

/** Build one model entry plus its per-model compat, given the route consensus. */
function buildModel(model, api, routeCompat) {
  const efforts = {}
  for (const [level, wire] of Object.entries(model.thinkingLevelMap ?? {})) {
    if (typeof wire === 'string' && wire !== '') efforts[level] = wire
  }
  const input = (model.input ?? ['text']).filter((value) => value === 'text' || value === 'image')
  const entry = {
    id: model.id,
    name: model.name ?? model.id,
    contextWindow: model.contextWindow ?? 131072,
    maxTokens: model.maxTokens ?? 32768,
    input,
  }
  if (Object.keys(efforts).length > 0) entry.reasoningEfforts = efforts
  const own = {}
  for (const field of fieldsFor(api)) {
    const value = model.compat?.[field]
    if (value !== undefined && routeCompat[field] !== value) own[field] = value
  }
  if (Object.keys(own).length > 0) entry.compat = own
  return entry
}

/** Route consensus: switches every model defines with the same value. */
function routeCompatFor(models, api) {
  const out = {}
  for (const field of fieldsFor(api)) {
    const values = models.map((model) => model.compat?.[field])
    if (values.every((value) => value !== undefined) && values.every((value) => value === values[0])) out[field] = values[0]
  }
  return out
}

/** Serialize one preset object to the file's style. */
function serializePreset(preset) {
  const lines = ['  {']
  lines.push(`    id: ${JSON.stringify(preset.id)},`)
  lines.push(`    name: ${JSON.stringify(preset.name)},`)
  lines.push(`    docs: ${JSON.stringify(preset.docs)},`)
  lines.push(`    keyUrl: ${JSON.stringify(preset.keyUrl)},`)
  lines.push(`    env: ${JSON.stringify(preset.env)},`)
  lines.push(`    baseURL: ${JSON.stringify(preset.baseURL)},`)
  lines.push(`    api: ${JSON.stringify(preset.api)},`)
  if (preset.nativeIds) lines.push(`    nativeIds: ${JSON.stringify(preset.nativeIds)},`)
  if (preset.compat) lines.push(`    compat: ${JSON.stringify(preset.compat)},`)
  lines.push('    models: [')
  for (const model of preset.models) {
    const parts = [
      `id: ${JSON.stringify(model.id)}`,
      `name: ${JSON.stringify(model.name)}`,
      `contextWindow: ${model.contextWindow}`,
      `maxTokens: ${model.maxTokens}`,
      `input: [${model.input.map((value) => `'${value}'`).join(', ')}]`,
    ]
    if (model.reasoningEfforts) parts.push(`reasoningEfforts: ${JSON.stringify(model.reasoningEfforts)}`)
    if (model.compat) parts.push(`compat: ${JSON.stringify(model.compat)}`)
    lines.push(`      { ${parts.join(', ')} },`)
  }
  lines.push('    ],')
  lines.push('  },')
  return lines.join('\n')
}

const { PRESETS } = await import(`${providersPath}?t=${Date.now()}`)

const summary = []
const refreshed = PRESETS.map((preset) => {
  const mapping = MAP[preset.id]
  if (!mapping || !catalog[mapping.source]) return preset
  const models = pick(mapping.source, mapping.cap)
  const api = mapping.api ?? preset.api
  const baseURL = mapping.baseURL ?? preset.baseURL
  const routeCompat = routeCompatFor(models, api)
  const built = models.map((model) => buildModel(model, api, routeCompat))
  summary.push({
    id: preset.id,
    source: mapping.source,
    before: preset.models.map((model) => model.id).join(', '),
    after: built.map((model) => model.id).join(', '),
    routeCompat,
    perModelCompat: built.filter((model) => model.compat).map((model) => `${model.id}:${JSON.stringify(model.compat)}`),
    apiChanged: api !== preset.api ? `${preset.api} -> ${api}` : undefined,
    urlChanged: baseURL !== preset.baseURL ? `${preset.baseURL} -> ${baseURL}` : undefined,
  })
  // Keep a preset-level compat when the preset declared one (channels whose
  // authoritative switches were already curated), merged under the consensus.
  const compat = { ...(preset.compat ?? {}), ...routeCompat }
  return { ...preset, api, baseURL, ...(Object.keys(compat).length > 0 ? { compat } : {}), models: built }
})

if (dry) {
  for (const row of summary) {
    console.log(`\n=== ${row.id} (source ${row.source})`)
    if (row.apiChanged) console.log('  api:', row.apiChanged)
    if (row.urlChanged) console.log('  baseURL:', row.urlChanged)
    console.log('  models before:', row.before)
    console.log('  models after :', row.after)
    console.log('  route compat :', JSON.stringify(row.routeCompat))
    for (const line of row.perModelCompat) console.log('  per-model    :', line)
  }
  console.log(`\nrefreshed ${summary.length} presets of ${PRESETS.length}`)
  process.exit(0)
}

// Regenerate the PRESETS region between markers.
const source = fs.readFileSync(providersPath, 'utf8')
const startMarker = '// --- preset catalog (generated by tools/refresh-catalog.mjs) ---'
const endMarker = '// --- end preset catalog ---'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)
if (start < 0 || end < 0) {
  console.error(`markers not found in ${providersPath}`)
  process.exit(1)
}
const body = refreshed.map(serializePreset).join('\n')
const next = `${source.slice(0, start + startMarker.length)}\nexport const PRESETS = [\n${body}\n]\n${source.slice(end)}`
fs.writeFileSync(providersPath, next)
console.log(`refreshed ${summary.length} presets; file written`)
