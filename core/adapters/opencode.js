// dsh-provider-hub - OpenCode adapter core (pure).
//
// OpenCode (sst/opencode, desktop app + CLI) reads `~/.config/opencode/opencode.json`
// (or `.jsonc`) and keeps provider keys either in `options.apiKey` or in its
// auth store (`~/.local/share/opencode/auth.json`, keyed by provider id).
// A custom provider entry is:
//
//   "provider": {
//     "<route>": {
//       "npm": "@ai-sdk/openai-compatible",   // only when OpenCode does not
//       "api": "https://…",                    // know the route from models.dev
//       "options": { "apiKey": "…" },
//       "models": {
//         "<model id>": { "name", "attachment", "reasoning", "tool_call",
//                         "temperature", "limit": { context, input, output },
//                         "cost", "interleaved", "modalities", "variants" }
//       }
//     }
//   }
//
// The builders here are pure; the CLI decides `npm` (from the local models.dev
// cache) and performs the file I/O.

/** Validate the pieces OpenCode needs from a provider entry. */
export function providerError(entry) {
  if (!entry || typeof entry !== 'object') return 'provider entry 必须是对象'
  if (typeof entry.api !== 'string' || entry.api.trim() === '') return 'api（Base URL）不能为空'
  try {
    const url = new URL(entry.api)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'api 必须是 http(s)'
  } catch {
    return 'api 不是合法 URL'
  }
  if (!entry.models || typeof entry.models !== 'object' || Object.keys(entry.models).length === 0) return '至少需要一个模型'
  return undefined
}

/**
 * Build the OpenCode provider entry for one preset.
 * @param preset - catalog preset (`id`, `name`, `baseURL`, `models`).
 * @param options - `{ key?, apiKey?, npm?, modelIds? }`; `npm` is set by the
 *   caller when OpenCode does not ship the route in its models.dev catalog.
 * @returns a `{ [route]: provider }` object ready to merge into the config.
 */
export function buildOpencodeProvider(preset, options = {}) {
  const apiKey = typeof options.key === 'string' && options.key.trim() !== '' ? options.key.trim() : options.apiKey
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
    models[model.id] = config
  }
  const provider = { name: preset.name }
  if (options.npm) provider.npm = options.npm
  provider.api = preset.baseURL
  if (apiKey !== undefined) provider.options = { apiKey }
  provider.models = models
  return { [preset.id]: provider }
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
    merged.options = { ...(existing.options ?? {}), ...(provider.options ?? {}) }
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
    if (!provider || provider.api !== preset.baseURL || !provider.models) continue
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
