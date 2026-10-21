// dsh-provider-hub - host half.
//
// The catalog reaches DSH's own Models page instead of a panel of its own: the
// presets are declared as configurable providers, so they appear in the official
// **Third-party model provider** select next to the ones DSH ships, and an
// adopted preset route is curated with the models, compat and headers a
// directory entry cannot carry. See `syncDirectory` below.
//
// One loopback-only JSON route is left for the browser half:
//
//   GET  /dsh-provider-hub/state    -> presets + configured routes + key status
//
// `POST /dsh-provider-hub/enable` and `POST /dsh-provider-hub/remove` stay for
// scripted use (they are what the curated write does, with a key attached).
//
// Every write goes through the official services, so nothing here touches
// settings.yaml or .credentials.yaml directly:
//
//   * `credentials.set(profile.apiKeyEnv, key)` stores the key in the
//     credentials service (the same ref a hand-written profile would use);
//   * `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` writes
//     the user layer of the official pi-ai namespace, which validates the
//     profile and re-registers the route live (no restart, no YAML editing);
//   * `llm.registerConfigurableProviders(entries)` declares the dormant presets
//     in the directory that page reads.
//
// The adapter this plugin feeds is `@deepseek-ai/dsh-llm-pi-ai`; the profile
// shape is built and validated by ../core/profile.js, shared with any other
// shell that consumes the same core.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { PRESETS, customEnvName } from '../core/providers.js'
import { buildProfile, routeOf } from '../core/profile.js'
import { coverageOf } from '../core/coverage.js'
import { curatedProfile, planSync, presetFingerprint, sameProfile } from '../core/directory.js'

export const name = 'dsh-provider-hub'

const ROUTE_PREFIX = '/dsh-provider-hub'
const PI_AI_NS = 'llm-pi-ai'

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

// --- http helpers (same fence as the other loopback plugins) -----------------

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function isLocalHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  const name = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('aborted')))
  })
}

// Credential-adjacent surface: loopback socket, loopback Host header, and a
// same-origin check when the browser sends Origin.
function guard(req, res) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'loopback only' })
    return false
  }
  const host = req.headers.host
  if (!isLocalHostHeader(host)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'unexpected host' })
    return false
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originHost = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (originHost !== host) {
      sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-origin request' })
      return false
    }
  }
  return true
}

function readJsonBody(body) {
  return body && typeof body === 'object' ? body : {}
}

// --- host facts --------------------------------------------------------------

function services(ctx) {
  return {
    settings: ctx.get('settings'),
    credentials: ctx.get('credentials'),
    llm: ctx.get('llm'),
  }
}

function piAiDescriptor(settings) {
  const descriptors = settings?.describe?.() ?? []
  return descriptors.find((descriptor) => descriptor.ns === PI_AI_NS)
}

function userProviders(descriptor) {
  const providers = descriptor?.user && typeof descriptor.user === 'object' ? descriptor.user.providers : undefined
  return providers && typeof providers === 'object' ? providers : {}
}

function isConflict(error) {
  if (error && error.name === 'SettingsConflictError') return true
  return /conflict|revision/i.test(String((error && error.message) || error))
}

/**
 * One state snapshot: the curated catalog joined with what the user layer
 * currently declares (configured route, stored key, live registration).
 */
async function stateOf(ctx) {
  const { settings, credentials, llm } = services(ctx)
  if (!settings) throw new HttpError(503, 'service-missing', 'DSH 设置服务不可用')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册（pi-ai 适配器未加载）')
  const providers = userProviders(descriptor)
  const live = new Set((llm?.listProviders?.() ?? []).map((provider) => provider.id))

  // Per-app de-duplication: presets the target app already covers natively
  // (its built-in pi-ai catalog) stay in the catalog but are marked so the UI
  // can hide them behind a reveal toggle. Nothing is deleted.
  const nativeIds = (llm?.listConfigurableProviders?.() ?? []).map((entry) => entry.provider)
  const coverage = coverageOf(PRESETS, nativeIds)
  const coveredBy = new Map(coverage.covered.map((entry) => [entry.id, entry.as]))

  // One credential probe per referenced env; presets whose ref is already
  // configured elsewhere (process env, credentials service, another route)
  // can be enabled without pasting the key again.
  const credentialConfigured = new Map()
  if (credentials) {
    const refs = new Set(PRESETS.map((preset) => preset.env))
    for (const profile of Object.values(providers)) {
      if (typeof profile?.apiKeyEnv === 'string') refs.add(profile.apiKeyEnv)
    }
    for (const ref of refs) {
      try {
        credentialConfigured.set(ref, (await credentials.describe(ref))?.configured === true)
      } catch {
        credentialConfigured.set(ref, false)
      }
    }
  }

  const routes = {}
  for (const [route, profile] of Object.entries(providers)) {
    const env = profile && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
    let keyConfigured = false
    if (env && credentials) {
      try {
        keyConfigured = (await credentials.describe(env))?.configured === true
      } catch {
        keyConfigured = false
      }
    }
    routes[route] = {
      env,
      keyConfigured,
      live: live.has(route),
      modelCount: Array.isArray(profile?.models) ? profile.models.length : 0,
      displayName: typeof profile?.displayName === 'string' ? profile.displayName : route,
    }
  }

  return {
    revision: descriptor.revision,
    routes,
    coverage: {
      native: nativeIds.length,
      visible: coverage.visible.length,
      covered: coverage.covered.length,
    },
    presets: PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      docs: preset.docs,
      keyUrl: preset.keyUrl,
      env: preset.env,
      baseURL: preset.baseURL,
      api: preset.api,
      models: preset.models.map((model) => model.id),
      configured: Object.hasOwn(providers, preset.id),
      keyConfigured: routes[preset.id]?.keyConfigured === true,
      envConfigured: credentialConfigured.get(preset.env) === true,
      live: live.has(preset.id),
      covered: coveredBy.has(preset.id),
      coveredBy: coveredBy.get(preset.id),
    })),
  }
}

// --- writes ------------------------------------------------------------------

async function enable(ctx, body) {
  const { settings, credentials } = services(ctx)
  if (!settings || !credentials) throw new HttpError(503, 'service-missing', 'DSH 设置或凭据服务不可用')
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  let route
  let profile
  try {
    route = routeOf(body)
    profile = buildProfile(body)
  } catch (error) {
    throw new HttpError(400, 'invalid-draft', String((error && error.message) || error))
  }
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册')

  if (key === '') {
    // An empty key is allowed when the referenced credential already resolves
    // (process env, credentials service, another route): the profile then just
    // references the existing ref.
    const existing = await credentials.describe(profile.apiKeyEnv).catch(() => undefined)
    if (existing?.configured !== true) {
      throw new HttpError(400, 'key-required', `请填写 API Key（${profile.apiKeyEnv} 尚未配置）`)
    }
  } else {
    try {
      await credentials.set(profile.apiKeyEnv, key)
    } catch (error) {
      throw new HttpError(
        409,
        'credential-not-writable',
        `无法写入凭据 ${profile.apiKeyEnv}：${String((error && error.message) || error)}。若该 Key 来自环境变量，请留空输入框、直接用已有 Key 启用。`,
      )
    }
  }
  try {
    await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', route], value: profile }], descriptor.revision)
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'conflict', '设置已被其他界面修改，请刷新后重试')
    throw new HttpError(500, 'write-failed', `写入 llm-pi-ai 失败：${String((error && error.message) || error)}`)
  }
  return { route, env: profile.apiKeyEnv, models: profile.models.length }
}

async function remove(ctx, body) {
  const { settings, credentials } = services(ctx)
  if (!settings) throw new HttpError(503, 'service-missing', 'DSH 设置服务不可用')
  const route = typeof body.route === 'string' ? body.route.trim() : ''
  if (route === '') throw new HttpError(400, 'invalid', 'route required')
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) throw new HttpError(503, 'namespace-missing', 'llm-pi-ai 设置命名空间未注册')
  const providers = userProviders(descriptor)
  if (!Object.hasOwn(providers, route)) throw new HttpError(404, 'not-configured', `路由 ${route} 未配置`)
  const env = typeof providers[route]?.apiKeyEnv === 'string' ? providers[route].apiKeyEnv : undefined

  try {
    await settings.mutate(PI_AI_NS, [{ op: 'unset', path: ['providers', route] }], descriptor.revision)
  } catch (error) {
    if (isConflict(error)) throw new HttpError(409, 'conflict', '设置已被其他界面修改，请刷新后重试')
    throw new HttpError(500, 'write-failed', `移除失败：${String((error && error.message) || error)}`)
  }
  if (body.removeKey === true && env && credentials) {
    try {
      await credentials.unset(env)
    } catch {
      // The route is gone; a leftover key is harmless and reported by /state.
    }
  }
  return { route }
}

// --- configurable-provider directory -----------------------------------------

/**
 * What the catalog already curated, keyed by route.
 *
 * The journal is what keeps curation a one-time write per preset version: a
 * model list the user trims afterwards is never reverted, while a preset whose
 * own shape changes re-curates. Losing the file costs nothing worse than one
 * extra pass.
 */
function journalPath() {
  return join(homedir(), '.provider-hub', 'directory.json')
}

function readJournal() {
  try {
    const parsed = JSON.parse(readFileSync(journalPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJournal(journal) {
  try {
    const file = journalPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(journal, null, 2)}\n`)
  } catch {
    // Best effort: without the journal the next pass simply curates again.
  }
}

function sameRouteSet(held, entries) {
  if (held.size !== entries.length) return false
  return entries.every((entry) => held.has(entry.provider))
}

/**
 * One directory pass.
 *
 * Declares every preset DSH does not already offer, withdraws the ones just
 * adopted, then gives an adopted preset route the curated shape a directory
 * entry cannot carry (a directory entry has no model catalog - see
 * ../core/directory.js).
 *
 * The order matters: pi-ai recomputes its own directory from the profiles and
 * refuses a route another registration still declares, so an adopted route has
 * to leave this registration before pi-ai's next pass. That is why the listener
 * runs prepended, and why this pass is called synchronously from it.
 */
async function syncDirectory(ctx, state) {
  const { settings, llm } = services(ctx)
  if (!settings || !llm || typeof llm.registerConfigurableProviders !== 'function') return
  const descriptor = piAiDescriptor(settings)
  if (!descriptor) return

  const profiles = userProviders(descriptor)
  const configured = new Set(Object.keys(profiles))
  // What was already configured the first time this plugin looked. A route that
  // predates it and carries models is a profile someone shaped by hand, not a
  // draft to fill in, so curation leaves it alone.
  if (state.bootConfigured === undefined) state.bootConfigured = new Set(configured)

  const readDirectory = () => {
    const listed = llm.listConfigurableProviders?.() ?? []
    // Routes another registration owns. `declared: false` marks the ones the
    // installed pi-ai catalog ships; its own declared routes carry `true`, and
    // this plugin's entries carry neither. This plugin's own entries are left
    // out, or a preset would look covered by itself and be withdrawn.
    const foreign = new Set(listed.map((entry) => entry.provider).filter((provider) => !state.held.has(provider)))
    return {
      foreign,
      // Presets the app already serves under another route id (`gemini` is
      // `google`, `opencode-zen` is `opencode`): declaring those would offer the
      // same vendor twice in the select.
      covered: new Set(coverageOf(PRESETS, foreign).covered.map((entry) => entry.id)),
      catalog: new Set(listed.filter((entry) => entry.declared === false).map((entry) => entry.provider)),
    }
  }

  const journal = readJournal()
  const plan = (taken) =>
    planSync({
      presets: PRESETS,
      foreign: taken.foreign,
      covered: taken.covered,
      catalog: taken.catalog,
      configured,
      profiles,
      preExisting: state.bootConfigured,
      journal,
      settingsNs: PI_AI_NS,
    })
  const { entries, enrich, respected } = plan(readDirectory())

  const applyEntries = (next) => {
    if (state.handle === undefined) {
      // A registration must declare at least one provider; with none to declare
      // there is nothing to withdraw either.
      if (next.length === 0) return
      state.handle = llm.registerConfigurableProviders(next)
    } else {
      state.handle.replace(next)
    }
    state.held = new Set(next.map((entry) => entry.provider))
  }

  const needed = state.handle === undefined ? entries.length > 0 : !sameRouteSet(state.held, entries)
  if (needed) {
    try {
      applyEntries(entries)
    } catch (error) {
      // A pass that raced pi-ai's own directory update read a stale foreign set.
      // Recompute against the directory as it stands now and retry once; a
      // second failure is left to the next event.
      const retry = plan(readDirectory())
      if (!sameRouteSet(state.held, retry.entries)) applyEntries(retry.entries)
    }
  }

  // Record the routes curation deliberately leaves alone, so a later pass does
  // not reconsider them.
  let recorded = false
  for (const preset of respected) {
    journal[preset.id] = { fingerprint: presetFingerprint(preset), curatedAt: null, respected: true }
    recorded = true
  }
  if (recorded) writeJournal(journal)

  for (const preset of enrich) {
    // Re-read per route: an earlier write in this loop moves the revision.
    const current = piAiDescriptor(settings)
    const existing = userProviders(current)[preset.id]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) continue
    const profile = curatedProfile(preset, existing)
    try {
      if (!sameProfile(existing, profile)) {
        await settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', preset.id], value: profile }], current.revision)
      }
      journal[preset.id] = { fingerprint: presetFingerprint(preset), curatedAt: new Date().toISOString() }
      writeJournal(journal)
    } catch (error) {
      // A conflicting revision retries on the next pass. The route keeps
      // serving meanwhile; it just carries what the official editor wrote.
      const reason = String((error && error.message) || error)
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(`dsh-provider-hub: could not curate "${preset.id}": ${reason}`)
    }
  }
}

// --- plugin ------------------------------------------------------------------

export function apply(ctx) {
  const registerRoutes = (webServer, fiber) => {
    fiber.effect(() =>
      webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/state`,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' })
            return
          }
          try {
            sendJson(res, 200, { ok: true, ...(await stateOf(ctx)) })
          } catch (error) {
            const status = error instanceof HttpError ? error.status : 500
            const code = error instanceof HttpError ? error.code : 'internal'
            sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
          }
        },
      }),
    )

    const postRoute = (suffix, run) => {
      fiber.effect(() =>
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/${suffix}`,
          handler: async (req, res) => {
            if (!guard(req, res)) return
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
              return
            }
            let body = {}
            try {
              const raw = await readBody(req)
              if (raw) body = JSON.parse(raw)
            } catch {
              sendJson(res, 400, { ok: false, code: 'invalid', error: 'malformed JSON body' })
              return
            }
            try {
              sendJson(res, 200, { ok: true, ...(await run(readJsonBody(body))) })
            } catch (error) {
              const status = error instanceof HttpError ? error.status : 500
              const code = error instanceof HttpError ? error.code : 'internal'
              sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
            }
          },
        }),
      )
    }

    postRoute('enable', (body) => enable(ctx, body))
    postRoute('remove', (body) => remove(ctx, body))
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    registerRoutes(webServer, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub))
  }

  // The presets reach DSH's own Models page through the configurable-provider
  // directory, so this plugin owns no panel of its own.
  const directory = { handle: undefined, held: new Set() }
  ctx.inject(['settings', 'llm'], (sub) => {
    const run = () => {
      syncDirectory(sub, directory).catch((error) => {
        const reason = String((error && error.message) || error)
        if (sub.logger && typeof sub.logger.warn === 'function') sub.logger.warn(`dsh-provider-hub: directory sync failed: ${reason}`)
      })
    }
    run()
    // Prepended: this pass has to withdraw an adopted route before pi-ai
    // recomputes its own directory from the profiles.
    sub.on('loader/volatile-update', run, { prepend: true })
  })
}

export { customEnvName }
