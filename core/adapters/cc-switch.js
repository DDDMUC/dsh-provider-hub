// dsh-provider-hub - cc-switch adapter core (pure).
//
// cc-switch (farion1231/cc-switch, the popular multi-app provider switcher)
// keeps its whole state in one plain JSON file: `~/.cc-switch/config.json`,
// shape `{ version: 2, <app>: { providers: { <id>: Provider }, current } }`,
// where `<app>` is one of claude / claude-desktop / codex / gemini / grokbuild
// / opencode / openclaw. A Provider is `{ id, name, settingsConfig, ... }` and
// `settingsConfig` is the app's own live config - the shapes below are read off
// cc-switch's Rust source (src-tauri/src/provider.rs):
//
//   opencode          { npm, name, options: { baseURL, apiKey }, models }
//   claude            { env: { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN }, model }
//   claude-desktop    same env map as claude
//   codex             { auth: { OPENAI_API_KEY }, config: "<config.toml text>" }
//   gemini            { env: { GOOGLE_GEMINI_BASE_URL, GEMINI_API_KEY } }
//   openclaw          { baseUrl, apiKey }
//
// Keys live in cc-switch's own config (its design: it writes the live app
// config when the user switches), NOT in OpenCode's auth.json. Merging never
// touches `current` and keeps every other app section intact.

/** Default cc-switch config location (`~/.cc-switch/config.json`). */
export const CCSWITCH_RELATIVE_PATH = ['.cc-switch', 'config.json']

/** App sections this adapter can write, with the protocols they accept. */
export const CCSWITCH_APPS = {
  opencode: ['openai-completions', 'openai-responses', 'anthropic-messages'],
  codex: ['openai-completions', 'openai-responses'],
  claude: ['anthropic-messages'],
  'claude-desktop': ['anthropic-messages'],
  gemini: ['openai-completions'],
  openclaw: ['openai-completions', 'openai-responses', 'anthropic-messages'],
}

/** npm SDK per wire protocol for the opencode section. */
const NPM_BY_PROTOCOL = {
  'openai-completions': '@ai-sdk/openai-compatible',
  'openai-responses': '@ai-sdk/openai',
  'anthropic-messages': '@ai-sdk/anthropic',
}

/** wire_api per protocol for the codex config.toml. */
const WIRE_API_BY_PROTOCOL = {
  'openai-completions': 'chat',
  'openai-responses': 'responses',
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sectionOf(config, app) {
  const root = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const section = root[app]
  return section && typeof section === 'object' ? section : { providers: {}, current: '' }
}

/** First model id of a preset (cc-switch's live config names one model). */
function firstModel(preset, modelIds) {
  if (Array.isArray(modelIds) && modelIds.length > 0) return modelIds[0]
  return preset.models[0]?.id ?? ''
}

/** Effort for the codex config: the model's first declared level, else medium. */
function firstEffort(preset, modelIds) {
  const id = firstModel(preset, modelIds)
  const model = preset.models.find((m) => m.id === id)
  const levels = Object.keys(model?.reasoningEfforts ?? {}).filter((level) => level !== 'off')
  return levels[0] ?? 'medium'
}

/** Per-app settingsConfig builders (shapes from cc-switch's Rust source). */
const SETTINGS_BUILDERS = {
  opencode(preset, key, options) {
    const wanted = Array.isArray(options.modelIds) && options.modelIds.length > 0 ? new Set(options.modelIds) : undefined
    const models = {}
    for (const model of preset.models) {
      if (wanted !== undefined && !wanted.has(model.id)) continue
      models[model.id] = {
        name: model.name ?? model.id,
        attachment: Array.isArray(model.input) && model.input.includes('image'),
        reasoning: Boolean(model.reasoningEfforts),
        temperature: true,
        tool_call: true,
      }
      if (typeof model.contextWindow === 'number') {
        models[model.id].limit = { context: model.contextWindow, input: model.contextWindow }
        if (typeof model.maxTokens === 'number') models[model.id].limit.output = model.maxTokens
      }
      if (models[model.id].attachment) models[model.id].modalities = { input: ['text', 'image'], output: ['text'] }
    }
    return {
      npm: options.npm ?? NPM_BY_PROTOCOL[preset.api],
      name: preset.name,
      options: { baseURL: preset.baseURL, ...(key !== undefined ? { apiKey: key } : {}) },
      models,
    }
  },
  claude(preset, key, options) {
    return {
      env: {
        ANTHROPIC_BASE_URL: preset.baseURL,
        ...(key !== undefined ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
      },
      model: firstModel(preset, options.modelIds),
    }
  },
  'claude-desktop'(preset, key, options) {
    return SETTINGS_BUILDERS.claude(preset, key, options)
  },
  codex(preset, key, options) {
    const model = firstModel(preset, options.modelIds)
    const toml = [
      'model_provider = "custom"',
      `model = "${model}"`,
      `model_reasoning_effort = "${firstEffort(preset, options.modelIds)}"`,
      'disable_response_storage = true',
      '',
      '[model_providers.custom]',
      `name = ${JSON.stringify(preset.name)}`,
      `base_url = "${preset.baseURL}"`,
      `wire_api = "${WIRE_API_BY_PROTOCOL[preset.api] ?? 'chat'}"`,
      'requires_openai_auth = true',
    ].join('\n')
    return {
      auth: { ...(key !== undefined ? { OPENAI_API_KEY: key } : {}) },
      config: toml,
    }
  },
  gemini(preset, key) {
    return {
      env: {
        GOOGLE_GEMINI_BASE_URL: preset.baseURL,
        ...(key !== undefined ? { GEMINI_API_KEY: key } : {}),
      },
    }
  },
  openclaw(preset, key) {
    return { baseUrl: preset.baseURL, ...(key !== undefined ? { apiKey: key } : {}) }
  },
}

/** Which app sections a preset can be written to (by protocol and vendor). */
export function appsFor(preset) {
  const apps = []
  for (const [app, protocols] of Object.entries(CCSWITCH_APPS)) {
    if (!protocols.includes(preset.api)) continue
    // gemini 段只收 Google 自家端点（Gemini CLI 不通用兼容 OpenAI 协议）
    if (app === 'gemini' && !/googleapis\.com|generativelanguage/.test(preset.baseURL)) continue
    apps.push(app)
  }
  return apps
}

/**
 * Build one cc-switch provider entry for one app section.
 * @param preset - catalog preset.
 * @param app - target section (`opencode`, `codex`, ...).
 * @param options - `{ key?, npm?, modelIds? }`.
 * @returns the provider entry (without the map wrapper).
 */
export function buildCcSwitchEntry(preset, app, options = {}) {
  const builder = SETTINGS_BUILDERS[app]
  if (!builder) throw new Error(`未知的 cc-switch 段: ${app}`)
  if (!CCSWITCH_APPS[app].includes(preset.api)) throw new Error(`${app} 段不接受 ${preset.api} 协议`)
  const apiKey = typeof options.key === 'string' && options.key.trim() !== '' ? options.key.trim() : undefined
  const provider = {
    id: preset.id,
    name: preset.name,
    settingsConfig: builder(preset, apiKey, options),
  }
  if (preset.keyUrl) provider.websiteUrl = preset.keyUrl
  provider.category = 'hub'
  return provider
}

/** Merge provider entries into one app section (idempotent, keeps user edits). */
export function mergeCcSwitchConfig(config, app, entries) {
  const next = config && typeof config === 'object' && !Array.isArray(config) ? clone(config) : {}
  if (typeof next.version !== 'number') next.version = 2
  const section = sectionOf(next, app)
  const providers = { ...(section.providers ?? {}) }
  for (const [id, provider] of Object.entries(entries)) {
    const existing = providers[id] && typeof providers[id] === 'object' ? providers[id] : {}
    const merged = { ...existing, ...provider }
    merged.settingsConfig = { ...(existing.settingsConfig ?? {}), ...(provider.settingsConfig ?? {}) }
    const options = { ...(existing.settingsConfig?.options ?? {}), ...(provider.settingsConfig?.options ?? {}) }
    if (Object.keys(options).length > 0) merged.settingsConfig.options = options
    providers[id] = merged
  }
  next[app] = { ...section, providers }
  return next
}

/** Remove one provider route from one app section; returns a new config. */
export function removeCcSwitchProvider(config, app, id) {
  const next = config && typeof config === 'object' && !Array.isArray(config) ? clone(config) : {}
  const section = sectionOf(next, app)
  const providers = { ...(section.providers ?? {}) }
  delete providers[id]
  next[app] = { ...section, providers }
  return next
}

/** Which app sections already hold a route, with model counts. */
export function installedCcSwitch(config, id, apps) {
  const list = Array.isArray(apps) ? apps : Object.keys(CCSWITCH_APPS)
  const out = new Map()
  for (const app of list) {
    const provider = sectionOf(config, app).providers?.[id]
    if (!provider) continue
    const models = Object.keys(provider.settingsConfig?.models ?? {})
    out.set(app, models.length > 0 ? models.length : 1)
  }
  return out
}
