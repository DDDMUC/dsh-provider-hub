// dsh-provider-hub - browser half.
//
// One job: the `Hub` chip inside a provider row on the official Models page.
// The catalog itself needs no panel - it is declared as configurable providers,
// so it shows up in the page's own **Third-party model provider** select, and
// the host half curates an adopted route with the models, compat and headers a
// directory entry cannot carry.
//
// The chip exists because DSH records no origin for a route: its own `declared`
// tag only means "not in the installed pi-ai catalog", which a preset route
// shares with one the user declared by hand.
//
// The module is a classic client bundle (client-modules protocol): it registers
// a factory with window.__ModuleLoader__ and returns apply().
window.__ModuleLoader__.load({
  id: 'dsh-provider-hub',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const { jsx } = jsxRuntime

    const NS = 'dsh-provider-hub'
    const ROUTE_PREFIX = '/dsh-provider-hub'

    /** Tiny element helper: children ride props.children like the jsx runtime expects. */
    const h = (type, props, ...children) =>
      jsx(type, {
        ...(props || {}),
        ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
      })

    // --- copy -----------------------------------------------------------------

    const zh = {
      'badge.hub': 'Hub',
      'badge.hubHint': '这条路由来自 dsh-provider-hub 的预设目录（模型清单与兼容开关由插件维护）。移除用本行的删除按钮。',
    }
    const en = {
      'badge.hub': 'Hub',
      'badge.hubHint': 'This route comes from the dsh-provider-hub preset catalog, which maintains its models and compat switches. Remove it with this row’s delete button.',
    }

    // --- host calls -----------------------------------------------------------

    async function call(path) {
      const response = await fetch(`${ROUTE_PREFIX}${path}`, { headers: { 'content-type': 'application/json' } })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!payload || payload.ok !== true) throw new Error((payload && (payload.error || payload.code)) || `HTTP ${response.status}`)
      return payload
    }

    // --- styles ---------------------------------------------------------------

    const S = {
      hubMark: { display: 'inline-block', fontSize: 11, lineHeight: 1.4, padding: '1px 7px', borderRadius: 999, border: '1px solid currentColor', color: 'var(--dsw-alias-link, #2f6fec)', whiteSpace: 'nowrap', opacity: 0.9, cursor: 'help' },
    }

    // --- per-row badge --------------------------------------------------------

    // The Models page renders `settings.models.provider-card` once per provider
    // row, keyed by the row's settings namespace (`llm-pi-ai` for this adapter),
    // so the chip below mounts inside every pi-ai row. The catalog's own writes
    // use the preset's display name, and the official editor prefills that name
    // from the directory entry this plugin declares, while a key-only override of
    // a native route keeps the route id as its display name and is not claimed.
    // Model counts are deliberately not compared - pruning a route's models is an
    // ordinary edit and must not drop the chip.
    let ownedCache = { at: 0, routes: null }
    let ownedPending = null

    async function ownedRoutes() {
      if (ownedCache.routes !== null && Date.now() - ownedCache.at < 5000) return ownedCache.routes
      if (ownedPending === null) {
        ownedPending = call('/state')
          .then((state) => {
            const routes = (state && state.routes) || {}
            const owned = new Set()
            for (const preset of (state && state.presets) || []) {
              const route = routes[preset.id]
              if (!route || route.displayName !== preset.name) continue
              owned.add(preset.id)
            }
            return owned
          })
          .catch(() => new Set())
          .then((owned) => {
            ownedCache = { at: Date.now(), routes: owned }
            return owned
          })
          .finally(() => {
            ownedPending = null
          })
      }
      return ownedPending
    }

    /** The `Hub` chip on a provider row this catalog wrote into the user layer. */
    function HubMark({ t, provider }) {
      const route = provider && provider.provider
      const [owned, setOwned] = react.useState(false)
      react.useEffect(() => {
        let alive = true
        ownedRoutes().then((routes) => {
          if (alive) setOwned(routes.has(route))
        })
        return () => {
          alive = false
        }
      }, [route])
      if (!owned) return null
      return h('span', { style: S.hubMark, title: t('badge.hubHint') }, t('badge.hub'))
    }

    // --- plugin ---------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-provider-hub: dictionaries')
      ctx.slots.inject('settings.models.provider-card', () =>
        ctx.slots.register(
          {
            name: 'settings.models.provider-card',
            key: 'llm-pi-ai',
            locale: NS,
          },
          HubMark,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
