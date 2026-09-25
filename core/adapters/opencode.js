// dsh-provider-hub - OpenCode adapter core (pure).
//
// OpenCode (sst/opencode, desktop app + CLI) reads `~/.config/opencode/opencode.json`
// (or `.jsonc`) for provider definitions and keeps credentials in its own auth
// store (`~/.local/share/opencode/auth.json`, keyed by provider id) - the very
// file the in-app `/connect` flow writes. A custom provider entry is:
//
//   "provider": {
//     "<route>": {
//       "npm": "@ai-sdk/openai-compatible",   // only when OpenCode does not
//       "api": "https://…",                    // know the route from models.dev
//       "models": {
//         "<model id>": { "name", "attachment", "reasoning", "tool_call",
//                         "temperature", "limit": { context, input, output },
//                         "cost", "interleaved", "modalities", "variants" }
//       }
//     }
//   }
//
// Keys are NOT written into the config by default: the hub writes definitions,
// OpenCode's own 连接提供商 / `/connect` flow stores the key in auth.json, so
// the provider behaves exactly like a natively supported one. The builders here
// are pure; the CLI decides `npm` (from the local models.dev cache) and performs
// the file I/O.

/** OpenCode's auth store keeps `type: "api"` credentials for provider ids. */
export const AUTH_TYPE_API = 'api'

/** Validate the pieces OpenCode needs from a provider entry. */
export function providerError(entry) {
  if (!entry || typeof entry !== 'object') return 'provider entry 必须是对象'
  const endpoint =
    typeof entry.api === 'string' && entry.api.trim() !== '' ? entry.api : entry.options?.baseURL
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return 'api（Base URL）不能为空'
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'api 必须是 http(s)'
  } catch {
    return 'api 不是合法 URL'
  }
  if (!entry.models || typeof entry.models !== 'object' || Object.keys(entry.models).length === 0) return '至少需要一个模型'
  return undefined
}

/** The OpenAI-style ladder models.dev (and OpenCode's defaults) may attach to a model id. */
const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Variant map for one model entry. The catalog's effort levels become the
 * variants OpenCode's selector shows; every ladder level the catalog does NOT
 * declare is explicitly disabled so an inherited models.dev entry cannot leak
 * a level the endpoint does not accept (Volcengine DeepSeek rejects `medium`,
 * Ark's `ark-code-latest` alias tops out at `high`).
 * @param reasoningEfforts - `{ level: wireValue }` from the catalog preset.
 * @returns the variants object, or undefined when the model has no levels.
 */
export function buildVariants(reasoningEfforts) {
  if (!reasoningEfforts || typeof reasoningEfforts !== 'object') return undefined
  const real = Object.entries(reasoningEfforts).filter(([level, wire]) => level !== 'off' && wire !== null && wire !== undefined)
  if (real.length === 0) return undefined
  const variants = {}
  for (const [level, wire] of Object.entries(reasoningEfforts)) {
    if (level === 'off') {
      // `off: null` means "supported, send nothing" - the Default variant
      // already does that, so no separate entry is needed.
      if (wire === null || wire === undefined) continue
      variants.none = { reasoningEffort: wire }
      continue
    }
    variants[level] = { reasoningEffort: wire }
  }
  for (const level of EFFORT_LADDER) {
    if (!(level in variants)) variants[level] = { disabled: true }
  }
  return variants
}

/**
 * Build the OpenCode provider entry for one preset. Definitions only - no key.
 * @param preset - catalog preset (`id`, `name`, `baseURL`, `models`).
 * @param options - `{ npm?, modelIds?, reasoning?, keyInConfig? }`; `npm` is set
 *   by the caller when OpenCode does not ship the route in its models.dev
 *   catalog. `keyInConfig: true` is the legacy opt-in that puts the key back
 *   into `options.apiKey` (self-contained config, but invisible to the app's
 *   credential UI).
 * @returns a `{ [route]: provider }` object ready to merge into the config.
 */
export function buildOpencodeProvider(preset, options = {}) {
  const wanted = Array.isArray(options.modelIds) && options.modelIds.length > 0 ? new Set(options.modelIds) : undefined
  const models = {}
  for (const model of preset.models) {
    if (wanted !== undefined && !wanted.has(model.id)) continue
    const config = {
      name: model.name ?? model.id,
      attachment: Array.isArray(model.input) && model.input.includes('image'),
      reasoning: options.reasoning ?? Boolean(model.reasoningEfforts),
      temperature: true,
      tool_call: true,
    }
    if (typeof model.contextWindow === 'number') {
      config.limit = { context: model.contextWindow, input: model.contextWindow }
      if (typeof model.maxTokens === 'number') config.limit.output = model.maxTokens
    }
    if (config.attachment) config.modalities = { input: ['text', 'image'], output: ['text'] }
    const variants = buildVariants(model.reasoningEfforts)
    if (variants) config.variants = variants
    models[model.id] = config
  }
  const provider = { name: preset.name }
  if (options.npm) provider.npm = options.npm
  provider.api = preset.baseURL
  if (options.keyInConfig === true) {
    const apiKey = typeof options.key === 'string' && options.key.trim() !== '' ? options.key.trim() : options.apiKey
    if (apiKey !== undefined) provider.options = { apiKey }
  }
  provider.models = models
  return { [preset.id]: provider }
}

/** One auth.json entry - byte-for-byte what `/connect` writes for a provider. */
export function buildAuthEntry(route, key) {
  const trimmed = String(key ?? '').trim()
  if (trimmed === '') throw new Error(`Key 不能为空：${route}`)
  return { [route]: { type: AUTH_TYPE_API, key: trimmed } }
}

/** Merge auth entries into an existing store; returns a new object. */
export function mergeAuth(auth, entries) {
  const next = auth && typeof auth === 'object' ? JSON.parse(JSON.stringify(auth)) : {}
  for (const [route, entry] of Object.entries(entries)) next[route] = entry
  return next
}

/** Drop one route's credential; returns a new object. */
export function removeAuth(auth, route) {
  const next = auth && typeof auth === 'object' ? JSON.parse(JSON.stringify(auth)) : {}
  delete next[route]
  return next
}

/** Routes that carry a usable api credential in the store. */
export function authRoutes(auth) {
  const routes = new Set()
  for (const [route, entry] of Object.entries(auth ?? {})) {
    if (entry && typeof entry === 'object' && entry.type === AUTH_TYPE_API && typeof entry.key === 'string' && entry.key.trim() !== '') {
      routes.add(route)
    }
  }
  return routes
}

/** Validate one auth entry before it is written. */
export function authEntryError(route, entry) {
  if (!entry || typeof entry !== 'object') return `${route}: auth 条目必须是对象`
  if (entry.type !== AUTH_TYPE_API) return `${route}: 只支持 type=api`
  if (typeof entry.key !== 'string' || entry.key.trim() === '') return `${route}: key 不能为空`
  return undefined
}

/** API keys that still sit inline in the config for the given routes. */
export function configKeys(config, routes) {
  const out = {}
  for (const route of routes) {
    const key = config?.provider?.[route]?.options?.apiKey
    if (typeof key === 'string' && key.trim() !== '') out[route] = key
  }
  return out
}

/** Strip inline apiKeys for the given routes; returns a new config. */
export function stripConfigKeys(config, routes) {
  const next = config && typeof config === 'object' ? JSON.parse(JSON.stringify(config)) : {}
  for (const route of routes) {
    const provider = next.provider?.[route]
    const options = provider?.options
    if (options && typeof options.apiKey === 'string') delete options.apiKey
    if (options && typeof options === 'object' && Object.keys(options).length === 0) delete provider.options
  }
  return next
}

/**
 * Merge provider entries into an OpenCode config, replacing same-route models
 * in place while keeping every other key (including user edits on fields this
 * hub does not own).
 * @param config - parsed OpenCode config.
 * @param entries - `{ [route]: provider }` from {@link buildOpencodeProvider}.
 * @returns a new config object.
 */
export function mergeOpencodeConfig(config, entries) {
  const next = config && typeof config === 'object' ? JSON.parse(JSON.stringify(config)) : {}
  next.provider = next.provider && typeof next.provider === 'object' ? next.provider : {}
  for (const [route, provider] of Object.entries(entries)) {
    const existing = next.provider[route] && typeof next.provider[route] === 'object' ? next.provider[route] : {}
    const merged = { ...existing, ...provider }
    const options = { ...(existing.options ?? {}), ...(provider.options ?? {}) }
    if (Object.keys(options).length > 0) merged.options = options
    else delete merged.options
    if (existing.models || provider.models) {
      merged.models = { ...(existing.models ?? {}) }
      for (const [id, model] of Object.entries(provider.models ?? {})) {
        merged.models[id] = { ...(existing.models?.[id] ?? {}), ...model }
      }
    }
    next.provider[route] = merged
  }
  return next
}

/** Remove one provider route; returns a new config. */
export function removeOpencodeProvider(config, route) {
  const next = config && typeof config === 'object' ? JSON.parse(JSON.stringify(config)) : {}
  if (next.provider && typeof next.provider === 'object') delete next.provider[route]
  return next
}

/**
 * Drop model ids that left the catalog for every preset the config already
 * has (matched by api URL), keeping routes and models this hub does not own.
 * @returns `{ config, pruned }`.
 */
export function pruneOpencodeConfig(config, presets) {
  const next = config && typeof config === 'object' ? JSON.parse(JSON.stringify(config)) : {}
  let pruned = 0
  for (const preset of presets) {
    const provider = next.provider?.[preset.id]
    if (!provider || !provider.models) continue
    const endpoint = provider.api ?? provider.options?.baseURL
    if (endpoint !== preset.baseURL) continue
    const ids = new Set(preset.models.map((model) => model.id))
    for (const id of Object.keys(provider.models)) {
      if (!ids.has(id)) {
        delete provider.models[id]
        pruned += 1
      }
    }
  }
  return { config: next, pruned }
}

/** Which catalog presets already exist in an OpenCode config (by route id). */
export function installedPresets(config, presets) {
  const routes = new Map()
  for (const preset of presets) {
    const provider = config?.provider?.[preset.id]
    if (provider && typeof provider === 'object') {
      routes.set(preset.id, Object.keys(provider.models ?? {}).length)
    }
  }
  return routes
}
