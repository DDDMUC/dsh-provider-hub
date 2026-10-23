// dsh-provider-hub - browser half.
//
// Two seats on the official Models page, and no panel of its own:
//
//   * `settings.models.provider-card` - inside every pi-ai provider row: the
//     `Hub` chip for a route this catalog wrote, and a 隐藏 button that takes
//     the route out of the composer's model picker while keeping its profile and
//     key (the host stashes the profile; the credential never moves);
//   * `settings.models.footer` - one line listing the hidden routes, each a
//     button that writes its profile straight back.
//
// The catalog itself is declared as configurable providers, so it appears in the
// page's own **Third-party model provider** select; an adopted route is curated
// with the models, compat and headers a directory entry cannot carry.
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
      'badge.hubHint': '这条路由来自 dsh-provider-hub 的预设目录（模型清单与兼容开关由插件维护）。',
      'hide': '隐藏',
      'hide.busy': '隐藏中…',
      'hide.hint': '从模型选择器里隐藏这条路由：Key 与配置都保留，随时可恢复',
      'hide.confirm': '隐藏 {route}？它会从模型选择器里消失；Key 与配置保留，页脚「已隐藏」里点一下就能恢复。',
      'hide.catalogHint': '从模型选择器与设置页里隐藏这条路由（Key 与配置都保留，随时可恢复）',
      'hide.catalogConfirm': '隐藏 {route}？它会从模型选择器和设置页里一起消失；Key 与配置已存档，页脚「已隐藏」里点一下就能恢复。',
      'hidden.title': '已隐藏 {n} 个提供商（点名字恢复）：',
      'show': '显示',
      'show.busy': '恢复中…',
      'show.rowHint': '把这条路由放回模型选择器：配置原样写回，不用重填',
      'show.hint': '恢复这条路由：Key 与配置原样写回，不用重填',
    }
    const en = {
      'badge.hub': 'Hub',
      'badge.hubHint': 'This route comes from the dsh-provider-hub preset catalog, which maintains its models and compat switches.',
      'hide': 'Hide',
      'hide.busy': 'Hiding…',
      'hide.hint': 'Hide this route from the model picker; the key and configuration stay, and you can restore it any time',
      'hide.confirm': 'Hide {route}? It leaves the model picker. The key and configuration stay, and one click in the footer restores it.',
      'hide.catalogHint': 'Hide this route from the model picker and the settings page; the key and configuration stay, and you can restore it any time',
      'hide.catalogConfirm': 'Hide {route}? It leaves both the model picker and the settings page. The key and configuration are stashed, and one click in the footer restores them.',
      'hidden.title': 'Hidden providers ({n}) - click a name to restore:',
      'show': 'Show',
      'show.busy': 'Restoring…',
      'show.rowHint': 'Put this route back into the model picker; its configuration is written back as it was',
      'show.hint': 'Restore this route: its key and configuration are written back as they were',
    }

    const format = (template, vars) =>
      String(template).replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] !== undefined ? String(vars[key]) : ''))

    // --- host calls -----------------------------------------------------------

    async function call(path, init) {
      const response = await fetch(`${ROUTE_PREFIX}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...(init || {}),
      })
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
      controls: { display: 'inline-flex', alignItems: 'center', gap: 8 },
      hubMark: { display: 'inline-block', fontSize: 11, lineHeight: 1.4, padding: '1px 7px', borderRadius: 999, border: '1px solid currentColor', color: 'var(--dsw-alias-link, #2f6fec)', whiteSpace: 'nowrap', opacity: 0.9, cursor: 'help' },
      linkButton: { background: 'none', border: 'none', color: 'var(--dsw-alias-link, #2f6fec)', cursor: 'pointer', fontSize: 12, padding: 0 },
      error: { color: 'var(--dsw-alias-state-error-primary, #c0392b)', fontSize: 12 },
      hiddenBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-l3, #f0f0f0)', fontSize: 12 },
      hiddenLabel: { opacity: 0.7 },
      chipButton: { padding: '2px 9px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
    }

    // --- shared state ---------------------------------------------------------

    // Both seats read one snapshot, so hiding a route in its row updates the
    // footer list without a page reload.
    const store = { value: null, listeners: new Set(), pending: null }

    function publish(value) {
      store.value = value
      for (const listener of store.listeners) listener(value)
    }

    function refresh() {
      if (store.pending !== null) return store.pending
      store.pending = call('/state')
        .then((state) => {
          publish(state)
          return state
        })
        .catch(() => {
          publish(null)
          return null
        })
        .finally(() => {
          store.pending = null
        })
      return store.pending
    }

    function useHubState() {
      const [value, setValue] = react.useState(store.value)
      react.useEffect(() => {
        store.listeners.add(setValue)
        if (store.value === null) refresh()
        return () => {
          store.listeners.delete(setValue)
        }
      }, [])
      return value
    }

    // --- provider row: chip + hide --------------------------------------------

    /** The `Hub` chip and the 隐藏 control for one pi-ai provider row. */
    function RouteControls({ t, provider }) {
      const route = provider && provider.provider
      const state = useHubState()
      const [busy, setBusy] = react.useState(false)
      const [error, setError] = react.useState(null)
      const anchor = react.useRef(null)
      const tr = (key, vars) => format(t(key), vars)

      // The catalog claims a row when its display name is the preset's: the
      // official editor prefills that name from the directory entry this plugin
      // declares, while a key-only override of a native route keeps the route id.
      const preset = state ? (state.presets || []).find((entry) => entry.id === route) : undefined
      const row = state ? (state.routes || {})[route] : undefined
      const owned = Boolean(preset && row && row.displayName === preset.name)
      // The host reports which lever hiding this row pulls: a `catalog` route
      // keeps its card (the official plugin registers the route itself), so the
      // copy must not promise that the card goes too.
      const catalog = (state?.hideModes?.[route] ?? row?.hideMode) === 'catalog'
      // A `catalog` row stays on the page after hiding, so it must offer the way
      // back itself instead of a second, pointless 隐藏.
      const hidden = Boolean(route && state?.hidden && state.hidden[route])

      const hide = async () => {
        const question = tr(catalog ? 'hide.catalogConfirm' : 'hide.confirm', { route })
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(question)) return
        setBusy(true)
        setError(null)
        try {
          await call('/hide', { method: 'POST', body: JSON.stringify({ route }) })
          await refresh()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(false)
        }
      }

      const show = async () => {
        setBusy(true)
        setError(null)
        try {
          await call('/show', { method: 'POST', body: JSON.stringify({ route }) })
          await refresh()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(false)
        }
      }

      // A `catalog` route keeps its card: its own plugin declares the row, so no
      // settings value can take it away - only disabling that plugin could, and
      // that is not this plugin's call to make. Hiding the row element is the
      // lever that is left. It is deliberately modest: the slot renders inside
      // the row's own <li> (keyed by provider, so the node is stable), the
      // footer's 显示 writes the catalog back and restores it, and if the
      // official markup ever moves the slot out of the row this simply stops
      // hiding anything instead of breaking the page.
      react.useLayoutEffect(() => {
        if (!catalog) return undefined
        const node = anchor.current
        const card = node && typeof node.closest === 'function' ? node.closest('li') : null
        if (!card) return undefined
        card.style.display = hidden ? 'none' : ''
        return () => {
          card.style.display = ''
        }
      })

      if (!route) return null
      const label = busy ? tr(hidden ? 'show.busy' : 'hide.busy') : tr(hidden ? 'show' : 'hide')
      const tip = hidden ? t('show.rowHint') : t(catalog ? 'hide.catalogHint' : 'hide.hint')
      return h('span', { ref: anchor, style: S.controls },
        owned ? h('span', { style: S.hubMark, title: t('badge.hubHint') }, t('badge.hub')) : null,
        h('button', { type: 'button', style: S.linkButton, disabled: busy, title: tip, onClick: hidden ? show : hide }, label),
        error !== null ? h('span', { style: S.error }, error) : null,
      )
    }

    // --- footer: the hidden routes --------------------------------------------

    /** One line naming every hidden route, each name restoring it. */
    function HiddenRoutes({ t }) {
      const state = useHubState()
      const [busy, setBusy] = react.useState(null)
      const [error, setError] = react.useState(null)
      const tr = (key, vars) => format(t(key), vars)

      const hidden = state ? state.hidden || {} : {}
      const routes = Object.keys(hidden)
      if (routes.length === 0) return null

      const show = async (route) => {
        setBusy(route)
        setError(null)
        try {
          await call('/show', { method: 'POST', body: JSON.stringify({ route }) })
          await refresh()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }

      return h('div', { style: S.hiddenBar },
        h('span', { style: S.hiddenLabel }, tr('hidden.title', { n: routes.length })),
        ...routes.map((route) =>
          h('button', {
            key: route,
            type: 'button',
            style: S.chipButton,
            disabled: busy === route,
            title: t('show.hint'),
            onClick: () => show(route),
          }, `${hidden[route].displayName || route} ↺`),
        ),
        error !== null ? h('span', { style: S.error }, error) : null,
      )
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
          RouteControls,
        ),
      )
      // DeepSeek's API-key card is declared by its own plugin in its own
      // namespace, so the same row seat needs a second occupant for it. Only the
      // picker group can be hidden there (see the host's routeTarget).
      ctx.slots.inject('settings.models.provider-card', () =>
        ctx.slots.register(
          {
            name: 'settings.models.provider-card',
            key: 'llm-deepseek',
            locale: NS,
          },
          RouteControls,
        ),
      )
      ctx.slots.inject('settings.models.footer', () =>
        ctx.slots.register(
          {
            name: 'settings.models.footer',
            id: 'provider-hub-hidden',
            order: 20,
            locale: NS,
          },
          HiddenRoutes,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
