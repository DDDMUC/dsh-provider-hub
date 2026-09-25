// dsh-provider-hub - WorkBuddy adapter core (pure).
//
// Tencent WorkBuddy (com.tencent.workbuddy.mac) reads local custom models from
// `<configDir>/models.json` -- a plain JSON array, no field encryption, only a
// file lock and atomic write around it. The app validates every entry with the
// equivalent of `isValidLocalCustomModel` and DROPS invalid entries with a
// warning, so the builders here emit exactly that shape:
//
//   * `id` is required (the model id sent to the endpoint);
//   * `name` / `vendor` / `url` / `apiKey` are strings;
//   * `maxInputTokens` / `maxOutputTokens` / `temperature` are numbers;
//   * `supportsToolCall` / `supportsImages` / `supportsReasoning` /
//     `onlyReasoning` / `useCustomProtocol` are booleans;
//   * `reasoning` is an object (`{ defaultEffort, supportedEfforts, canDisableThinking }`).
//
// `useCustomProtocol: false` means the app appends `/chat/completions` to the
// URL (the normal OpenAI-compatible case); `true` sends the URL verbatim.
// Entries are addressed by their URL for install/removal bookkeeping: the app
// keys by id (one entry per id globally), so a preset owns exactly the entries
// whose `url` equals its base URL.

/** The separator between a preset's display name and a model name in `name`. */
const NAME_SEPARATOR = ' · '

/**
 * Mirror of the app's `isValidLocalCustomModel`: would WorkBuddy keep this entry?
 * @param entry - candidate entry.
 * @returns true when the app would load it.
 */
export function isValidWorkbuddyEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (typeof entry.id !== 'string' || entry.id.trim() === '') return false
  const stringOrAbsent = (value) => value === undefined || typeof value === 'string'
  const numberOrAbsent = (value) => {
    if (value === undefined) return true
    if (typeof value === 'number') return Number.isFinite(value)
    // The app coerces numeric strings (`coerceOptionalNumber`), so a numeric
    // string is accepted here too -- kept for validator fidelity only.
    if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
    return false
  }
  const booleanOrAbsent = (value) => value === undefined || typeof value === 'boolean'
  if (!['name', 'vendor', 'url', 'apiKey'].every((field) => stringOrAbsent(entry[field]))) return false
  if (!['maxInputTokens', 'maxOutputTokens', 'temperature'].every((field) => numberOrAbsent(entry[field]))) return false
  if (!['supportsToolCall', 'supportsImages', 'supportsReasoning', 'onlyReasoning', 'useCustomProtocol'].every((field) => booleanOrAbsent(entry[field]))) return false
  if (entry.reasoning !== undefined && (typeof entry.reasoning !== 'object' || entry.reasoning === null || Array.isArray(entry.reasoning))) return false
  return true
}

/** Normalize one http(s) base URL the way the app's connectivity test does. */
export function baseUrlError(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'url 不能为空'
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return 'url 格式不合法'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'url 仅支持 HTTP 或 HTTPS'
  return undefined
}

/**
 * Build the WorkBuddy entry for one catalog model.
 * @param preset - catalog preset (`id`, `name`, `baseURL`, `models`).
 * @param model - one model entry from the preset.
 * @param options - `{ key?, apiKey? }`.
 * @returns a models.json entry.
 */
export function buildWorkbuddyEntry(preset, model, options = {}) {
  const apiKey = typeof options.key === 'string' && options.key.trim() !== '' ? options.key.trim() : options.apiKey
  const efforts = model.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : []
  const reasoning = {}
  if (efforts.length > 0) {
    reasoning.supportedEfforts = efforts
    if (efforts.includes('low')) reasoning.defaultEffort = 'low'
    if (efforts.includes('medium') && reasoning.defaultEffort === undefined) reasoning.defaultEffort = 'medium'
  }
  const entry = {
    id: model.id,
    name: `${preset.name}${NAME_SEPARATOR}${model.name ?? model.id}`,
    vendor: preset.name,
    url: preset.baseURL,
    apiKey,
    supportsToolCall: true,
    supportsImages: Array.isArray(model.input) && model.input.includes('image'),
    supportsReasoning: Boolean(model.reasoningEfforts),
    useCustomProtocol: false,
  }
  if (typeof model.contextWindow === 'number') entry.maxInputTokens = model.contextWindow
  if (typeof model.maxTokens === 'number') entry.maxOutputTokens = model.maxTokens
  if (Object.keys(reasoning).length > 0) entry.reasoning = reasoning
  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key]
  return entry
}

/**
 * Build every entry one preset contributes.
 * @param preset - catalog preset.
 * @param options - `{ key?, apiKey?, modelIds? }` (`modelIds` limits the set).
 * @returns entries, in catalog order.
 */
export function buildWorkbuddyEntries(preset, options = {}) {
  const wanted = Array.isArray(options.modelIds) && options.modelIds.length > 0 ? new Set(options.modelIds) : undefined
  return preset.models
    .filter((model) => wanted === undefined || wanted.has(model.id))
    .map((model) => buildWorkbuddyEntry(preset, model, options))
}

/**
 * Upsert entries into a WorkBuddy models list, by entry id (the app's own key).
 * An existing entry for the same id is replaced -- exactly what the app's
 * `configSaveLocalCustomModel` does -- so a re-add updates in place.
 * @param list - current models.json array.
 * @param entries - entries to write.
 * @returns `{ models, added, updated }`.
 */
export function upsertWorkbuddyModels(list, entries) {
  const models = Array.isArray(list) ? list.map((entry) => ({ ...entry })) : []
  let added = 0
  let updated = 0
  let kept = 0
  for (const entry of entries) {
    if (!isValidWorkbuddyEntry(entry)) throw new Error(`拒绝写入非法条目：${JSON.stringify(entry).slice(0, 120)}`)
    const index = models.findIndex((candidate) => candidate.id === entry.id)
    if (index < 0) {
      models.push(entry)
      added += 1
      continue
    }
    const existing = models[index]
    const incomingHasKey = typeof entry.apiKey === 'string' && entry.apiKey !== ''
    const existingHasKey = typeof existing.apiKey === 'string' && existing.apiKey !== ''
    // WorkBuddy keys models by id globally, so a catalog pass can meet an id
    // twice (CN vs global presets share model ids) or meet an entry the user
    // already configured. Rules: a keyless add never displaces a configured
    // entry; among keyless duplicates the first catalog entry wins; a keyed
    // add always wins (that is an explicit per-provider install).
    if (!incomingHasKey && existingHasKey) {
      kept += 1
      continue
    }
    if (!incomingHasKey && existing.url !== entry.url) {
      kept += 1
      continue
    }
    models[index] = { ...existing, ...entry }
    updated += 1
  }
  return { models, added, updated, kept }
}

/**
 * Remove every entry that a preset owns (matched by base URL).
 * @param list - current models.json array.
 * @param preset - catalog preset.
 * @returns `{ models, removed }`.
 */
export function removeWorkbuddyModels(list, preset) {  const models = Array.isArray(list) ? list : []
  const kept = models.filter((entry) => entry?.url !== preset.baseURL)
  return { models: kept, removed: models.length - kept.length }
}

/**
 * Strip `apiKey` from entries so the key can be (re)entered in the app's own
 * Models panel - WorkBuddy has no separate credential store, its panel edits
 * this very file. `urls` limits which endpoints are touched; omit for all.
 * @param list - current models.json array.
 * @param urls - optional Set/array of base URLs to touch.
 * @returns `{ models, cleared }`.
 */
export function stripEntryKeys(list, urls) {
  const wanted = urls ? new Set(urls) : null
  const models = Array.isArray(list) ? list.map((entry) => ({ ...entry })) : []
  let cleared = 0
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue
    if (wanted && !wanted.has(entry.url)) continue
    if (typeof entry.apiKey === 'string' && entry.apiKey !== '') {
      delete entry.apiKey
      cleared += 1
    }
  }
  return { models, cleared }
}

/**
 * Which presets already have entries in the WorkBuddy models list.
 * @param list - current models.json array.
 * @param presets - catalog presets.
 * @returns Map presetId -> model count.
 */
export function installedPresets(list, presets) {
  const models = Array.isArray(list) ? list : []
  const counts = new Map()
  for (const preset of presets) {
    const count = models.filter((entry) => entry?.url === preset.baseURL).length
    if (count > 0) counts.set(preset.id, count)
  }
  return counts
}
