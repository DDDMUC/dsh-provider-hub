// dsh-provider-hub - core profile building and validation.
//
// Pure functions over plain data: turn one preset (or one custom form) into
// the exact `llm-pi-ai` provider profile the official adapter accepts, and
// refuse drafts the adapter would refuse later. The rules mirror the adapter's
// own resolution: a route key is a dict key, an endpoint is http(s) root
// without credentials/query/fragment, a model id is a non-empty string, and a
// declared reasoning level other than `off` needs a non-empty wire value.

import { OPENAI_COMPAT, SUPPORTED_APIS, customEnvName, findPreset } from './providers.js'

/** Route keys the official loader and this UI agree on. */
export const ROUTE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * The compat switches each wire protocol actually takes, mirroring the
 * adapter's own `COMPAT_GATES` (`offer` dispositions only).
 *
 * This table is not documentation, it is a write fence. The adapter fails the
 * whole route when a *model* carries a switch its protocol does not take
 * (`model "claude-opus-5" sets compat "supportsTemperature", but its api is
 * "openai-completions", which does not take it`), and silently skips such a
 * switch at the *route* level. `supportsTemperature` is an
 * anthropic-messages switch: an OpenAI-compatible gateway serving a Claude
 * model must not inherit it just because the model is a Claude.
 */
export const OFFERED_COMPAT = {
  'openai-completions': [
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
    'chatTemplateKwargs',
    'chatTemplateArgs',
    'supportsThinkingTokenBudget',
    'thinkingTokenBudgetField',
    'vllmPriority',
    'supportsStrictMode',
    'cacheControlFormat',
    'supportsLongCacheRetention',
  ],
  'anthropic-messages': [
    'supportsEagerToolInputStreaming',
    'supportsLongCacheRetention',
    'supportsCacheControlOnTools',
    'supportsTemperature',
    'forceAdaptiveThinking',
    'allowEmptySignature',
    'supportsStrictTools',
  ],
  'openai-responses': [
    'supportsDeveloperRole',
    'supportsMaxOutputTokens',
    'supportsStrictMode',
    'supportsLongCacheRetention',
  ],
}

/** The compat fields one protocol takes; empty for a protocol with no compat. */
export function offeredCompat(api) {
  return OFFERED_COMPAT[api] ?? []
}

/**
 * Drop every switch the protocol does not take.
 * @param api - the route's wire protocol.
 * @param compat - switches from a preset, the custom form or a caller.
 * @returns the switches that survive, or undefined when none does.
 */
export function filterCompat(api, compat) {
  if (compat === undefined || compat === null || typeof compat !== 'object' || Array.isArray(compat)) return undefined
  // A protocol this table does not describe is left alone: guessing there would
  // strip switches the adapter may well take.
  if (OFFERED_COMPAT[api] === undefined) return Object.keys(compat).length === 0 ? undefined : { ...compat }
  const offered = offeredCompat(api)
  const kept = Object.entries(compat).filter(([field]) => offered.includes(field))
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
}

/**
 * Repair one already-stored profile: drop compat switches its protocol does not
 * take, at both levels, and change nothing else.
 *
 * This is the heal path, not the write path. A profile written by an older hub
 * (or edited by hand) can carry a model-level switch the adapter refuses — and
 * because that refusal is fatal for the whole route, the route never appears in
 * the picker and no later curation can reach it. Nothing here reorders models,
 * trims ids or touches credentials: a route someone shaped stays shaped.
 * @param profile - one `providers.<route>` value read from settings.
 * @returns the repaired profile, or the same reference when nothing is wrong.
 */
export function repairProfileCompat(profile) {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) return profile
  const api = profile.api
  if (typeof api !== 'string' || OFFERED_COMPAT[api] === undefined) return profile
  let changed = false
  const next = { ...profile }
  if (profile.compat !== undefined) {
    const compat = filterCompat(api, profile.compat)
    if (compat === undefined) {
      delete next.compat
      changed = true
    } else if (Object.keys(compat).length !== Object.keys(profile.compat).length) {
      next.compat = compat
      changed = true
    }
  }
  if (Array.isArray(profile.models)) {
    next.models = profile.models.map((model) => {
      if (model === null || typeof model !== 'object' || Array.isArray(model) || model.compat === undefined) return model
      const compat = filterCompat(api, model.compat)
      if (compat === undefined) {
        const { compat: _dropped, ...rest } = model
        changed = true
        return rest
      }
      if (Object.keys(compat).length !== Object.keys(model.compat).length) {
        changed = true
        return { ...model, compat }
      }
      return model
    })
  }
  return changed ? next : profile
}

/** Whether a string is a usable route key. */
export function isRouteKey(value) {
  return typeof value === 'string' && ROUTE_RE.test(value)
}

/**
 * Validate one http(s) base URL the way the adapter does.
 * @param value - candidate endpoint root.
 * @returns an error message, or undefined when acceptable.
 */
export function baseUrlError(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'base URL 不能为空'
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return 'base URL 不是合法 URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'base URL 必须是 http(s)'
  if (url.username || url.password) return 'base URL 不能带账号密码'
  if (url.search || url.hash) return 'base URL 不能带查询参数或片段'
  return undefined
}

/** Validate a reasoning-efforts dict the way the adapter resolves it. */
export function effortsError(efforts) {
  if (efforts === undefined || efforts === false) return undefined
  if (typeof efforts !== 'object' || efforts === null) return 'reasoningEfforts 必须是对象或 false'
  const entries = Object.entries(efforts)
  if (!entries.some(([level]) => level !== 'off')) return 'reasoningEfforts 至少要声明一个 off 以外的档位'
  for (const [level, wire] of entries) {
    if (wire === null) {
      if (level !== 'off') return `档位 ${level} 需要发送值`
      continue
    }
    if (typeof wire !== 'string' || wire.length === 0) return `档位 ${level} 的发送值不能为空`
  }
  return undefined
}

/** Strip undefined fields so the persisted profile stays clean. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

/**
 * Sanitize preset-owned request headers the adapter merges into every call
 * (e.g. OpenCode Go's required x-opencode-session). String names to string
 * values only; the custom form has no header field, so drafts never carry one.
 */
function sanitizeHeaders(headers) {
  if (headers === undefined || typeof headers !== 'object' || headers === null || Array.isArray(headers)) return undefined
  const entries = Object.entries(headers).filter(([name, value]) => typeof name === 'string' && name !== '' && typeof value === 'string')
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

/** Sanitize one model entry from a preset or the custom form. */
export function sanitizeModel(entry) {
  if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') throw new Error('模型 ID 不能为空')
  const model = compact({
    id: entry.id.trim(),
    name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : undefined,
    contextWindow: Number.isFinite(entry.contextWindow) && entry.contextWindow > 0 ? Math.floor(entry.contextWindow) : undefined,
    maxTokens: Number.isFinite(entry.maxTokens) && entry.maxTokens > 0 ? Math.floor(entry.maxTokens) : undefined,
    input: Array.isArray(entry.input) && entry.input.length > 0 ? [...entry.input] : undefined,
    reasoningEfforts: entry.reasoningEfforts,
    // Per-model wire switches: when models on one route disagree (Kimi's k3 vs
    // k2.x thinking formats), the model entry carries its own compat and wins
    // over the route consensus.
    compat: entry.compat && typeof entry.compat === 'object' && !Array.isArray(entry.compat) ? { ...entry.compat } : undefined,
  })
  return model
}

/**
 * The dict key one request targets: a known preset id, or a validated custom route.
 * @param input - `{ presetId }` or `{ route }`.
 * @returns the `llm-pi-ai.providers.<route>` key.
 * @throws {Error} when the route cannot be a dict key.
 */
export function routeOf(input) {
  if (input && input.presetId !== undefined) {
    const preset = findPreset(input.presetId)
    if (!preset) throw new Error(`未知的预设：${input.presetId}`)
    return preset.id
  }
  const route = String(input?.route ?? '').trim()
  if (!isRouteKey(route)) throw new Error('路由 ID 只能用小写字母、数字和连字符，且以字母或数字开头')
  return route
}

/**
 * Build the provider profile for one request shape.
 * @param input - `{ presetId }` or `{ route, displayName?, baseURL, api, modelIds }`.
 * @returns the `llm-pi-ai.providers.<route>` value.
 * @throws {Error} when the draft cannot be served.
 */
export function buildProfile(input) {
  const preset = input && input.presetId !== undefined ? findPreset(input.presetId) : undefined
  if (input && input.presetId !== undefined && !preset) throw new Error(`未知的预设：${input.presetId}`)

  const route = routeOf(input)
  const baseURL = String((preset ? preset.baseURL : input.baseURL) ?? '').trim()
  const urlError = baseUrlError(baseURL)
  if (urlError) throw new Error(urlError)
  const api = preset ? preset.api : input.api
  if (!SUPPORTED_APIS.includes(api)) throw new Error(`协议必须是 ${SUPPORTED_APIS.join(' 或 ')}`)

  let models
  if (preset) {
    models = preset.models.map((entry) => sanitizeModel(entry))
  } else {
    const ids = String(input.modelIds ?? '')
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter((part) => part !== '')
    if (ids.length === 0) throw new Error('至少填一个模型 ID')
    const seen = new Set()
    models = ids.map((id) => {
      if (seen.has(id)) throw new Error(`模型 ID 重复：${id}`)
      seen.add(id)
      return sanitizeModel({ id, name: id, contextWindow: 131072, maxTokens: 32768, input: ['text'] })
    })
  }
  for (const model of models) {
    const error = effortsError(model.reasoningEfforts)
    if (error) throw new Error(`${model.id}: ${error}`)
  }
  // A model switch the route's protocol does not take is fatal in the adapter
  // (it refuses the whole route, not just that model), so the hub never writes
  // one: the preset is corrected at its source, and this pass makes sure a
  // stale entry - or a hand edit on a route already adopted - cannot smuggle
  // one back in.
  models = models.map((model) => {
    const compat = filterCompat(api, model.compat)
    if (compat === undefined) {
      const { compat: _dropped, ...rest } = model
      return rest
    }
    return { ...model, compat }
  })

  const displayName = preset
    ? preset.name
    : typeof input.displayName === 'string' && input.displayName.trim() !== ''
      ? input.displayName.trim()
      : route
  const env = preset ? preset.env : customEnvName(route)

  // Route-level compat: the hub's safe defaults for OpenAI-compatible
  // endpoints, overridden by the preset's own authoritative switches (learned
  // from the served catalogs, e.g. thinkingFormat qwen/zai/deepseek/ant-ling),
  // then by any explicit caller override. anthropic-messages routes carry their
  // own switch set and no OpenAI defaults; openai-responses carries none here.
  const presetCompat = preset && preset.compat && typeof preset.compat === 'object' ? preset.compat : undefined
  const callerCompat = input && input.compat && typeof input.compat === 'object' ? input.compat : undefined
  let compat
  if (api === 'openai-completions') compat = { ...OPENAI_COMPAT, ...(presetCompat ?? {}), ...(callerCompat ?? {}) }
  else if (api === 'anthropic-messages') compat = { ...(presetCompat ?? {}), ...(callerCompat ?? {}) }
  // The adapter skips a route-level switch the protocol does not take instead
  // of failing, so a stale one would sit in the profile looking applied while
  // doing nothing. Keep the route honest about what it actually sets.
  compat = filterCompat(api, compat)

  return compact({
    displayName,
    api,
    baseURL,
    apiKeyEnv: env,
    headers: sanitizeHeaders(preset?.headers),
    compat,
    models,
  })
}
