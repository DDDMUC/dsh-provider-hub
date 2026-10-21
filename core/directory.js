// dsh-provider-hub - configurable-provider directory plan (pure).
//
// DSH's Models page fills its **第三方模型提供商 / Third-party model provider**
// select from `llm.listConfigurableProviders()`: the directory every adapter
// declares through `ctx.llm.registerConfigurableProviders()`. Declaring this
// catalog's presets there is what makes them selectable next to the providers
// DSH ships, so the plugin needs no panel of its own.
//
// Two runtime rules shape the plan:
//
//   * A route belongs to exactly one registration. Declaring one another
//     registration already holds fails the whole `replace()` with
//     DUPLICATE_DIRECTORY, so a preset the installed pi-ai catalog owns - or one
//     the user layer already configures - is never declared here.
//   * A directory entry carries no model catalog: `provider`, `displayName`,
//     `settingsNs`, `settingsPath`, `defaultBaseURL`, `baseURLEnv`, `nativeAuth`
//     and `error` are all the runtime reads. Adopting a preset through the
//     official editor therefore cannot bring the curated models, compat and
//     headers with it - those are written into the profile once the route
//     becomes configured, which is what {@link planSync}'s `enrich` reports.
//
// The journal keeps that second write once per preset version, so an edit the
// user makes afterwards - trimming a model list, for one - is never reverted.

import { buildProfile } from './profile.js'

/** Stable identity of one preset's curated shape, for the enrichment journal. */
export function presetFingerprint(preset) {
  const headers = preset && preset.headers && typeof preset.headers === 'object' ? Object.keys(preset.headers).sort() : []
  return [preset.api, preset.baseURL, preset.models.length, preset.name, ...headers].join('|')
}

/**
 * The directory entry one preset declares.
 * @param preset - catalog entry.
 * @param settingsNs - settings namespace its profile is written into.
 * @returns the entry `ctx.llm.registerConfigurableProviders()` accepts.
 */
export function directoryEntry(preset, settingsNs) {
  return {
    provider: preset.id,
    displayName: preset.name,
    settingsNs,
    settingsPath: ['providers', preset.id],
    defaultBaseURL: preset.baseURL,
    nativeAuth: { env: [preset.env], oauth: false },
  }
}

/**
 * One directory sync, as data.
 *
 * A configured preset route is curated only when the catalog can be sure it is
 * the one that wrote it:
 *
 *   * a route the installed pi-ai catalog owns is never touched - that catalog
 *     already supplies its models, and a native route the user merely put a key
 *     on must keep serving as DSH ships it;
 *   * a route that was already configured before this plugin first looked (and
 *     that carries models) is respected, because a working profile the user
 *     trimmed by hand is not a draft waiting to be filled in;
 *   * a route that appears afterwards is an adoption through the official
 *     editor, and gets the curated shape the directory entry cannot carry.
 *
 * @param options - `{ presets, foreign, covered, catalog, configured, profiles, preExisting, journal, settingsNs }`,
 *   where `foreign` holds every route another registration owns, `covered` the
 *   presets the target app already offers under any of their route ids
 *   (`gemini` -> `google`, `opencode-zen` -> `opencode`), `catalog` the routes
 *   the installed pi-ai catalog ships, `configured` the routes the user layer
 *   carries a profile for, `profiles` those profiles by route, and
 *   `preExisting` the routes that were already configured when this plugin first
 *   looked.
 * @returns `{ entries, enrich, respected }`: the entries to declare (dormant
 *   presets), the presets whose configured route still needs its curated shape,
 *   and the routes to record as deliberately left alone.
 */
export function planSync({ presets, foreign, covered, catalog, configured, profiles, preExisting, journal, settingsNs }) {
  const entries = []
  const enrich = []
  const respected = []
  for (const preset of presets) {
    const configuredHere = configured.has(preset.id)
    // A preset the app already serves under another route id stays out of the
    // directory: declaring it would offer the same vendor twice.
    if (!configuredHere && !foreign.has(preset.id) && !(covered && covered.has(preset.id))) {
      entries.push(directoryEntry(preset, settingsNs))
    }
    if (!configuredHere) continue
    const mark = journal ? journal[preset.id] : undefined
    if (mark && mark.fingerprint === presetFingerprint(preset)) continue
    if (catalog && catalog.has(preset.id)) {
      respected.push(preset)
      continue
    }
    const profile = profiles ? profiles[preset.id] : undefined
    const hasModels = Boolean(profile) && Array.isArray(profile.models) && profile.models.length > 0
    if (preExisting && preExisting.has(preset.id) && hasModels) {
      respected.push(preset)
      continue
    }
    enrich.push(preset)
  }
  return { entries, enrich, respected }
}

/**
 * The profile an adopted preset route carries: the curated shape, over the
 * fields the official editor already wrote, keeping the credential reference it
 * derived for that row.
 * @param preset - catalog entry.
 * @param existing - the profile the user layer currently holds, when any.
 * @returns the profile to write; equal to `existing` when nothing needs curating.
 */
export function curatedProfile(preset, existing) {
  const curated = buildProfile({ presetId: preset.id })
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const kept = typeof base.apiKeyEnv === 'string' && base.apiKeyEnv !== '' ? base.apiKeyEnv : curated.apiKeyEnv
  return { ...base, ...curated, apiKeyEnv: kept }
}

/** Structural JSON comparison, for deciding whether a write is needed at all. */
export function sameProfile(left, right) {
  return stable(left) === stable(right)
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}
