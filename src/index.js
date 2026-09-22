// dsh-provider-hub - host half.
//
// Three loopback-only JSON routes the browser half calls:
//
//   GET  /dsh-provider-hub/state    -> presets + configured routes + key status
//   POST /dsh-provider-hub/enable   -> { presetId } or { route, displayName?, baseURL, api, modelIds }, plus { key }
//   POST /dsh-provider-hub/remove   -> { route, removeKey? }
//
// Every write goes through the official services, so nothing here touches
// settings.yaml or .credentials.yaml directly:
//
//   * `credentials.set(profile.apiKeyEnv, key)` stores the key in the
//     credentials service (the same ref a hand-written profile would use);
//   * `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` writes
//     the user layer of the official pi-ai namespace, which validates the
//     profile and re-registers the route live (no restart, no YAML editing).
//
// The adapter this plugin feeds is `@deepseek-ai/dsh-llm-pi-ai`; the profile
// shape is built and validated by ../core/profile.js, shared with any other
// shell that consumes the same core.

import { PRESETS, customEnvName, findPreset } from '../core/providers.js'
import { buildProfile, routeOf } from '../core/profile.js'
import { coverageOf } from '../core/coverage.js'

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
  if (key === '') throw new HttpError(400, 'key-required', '请填写 API Key')
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

  await credentials.set(profile.apiKeyEnv, key)
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
}

export { customEnvName }
