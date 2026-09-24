// dsh-provider-hub - browser half.
//
// One entry point: a card on the official Models settings page footer
// (`settings.models.footer`) that turns the curated catalog served by the host
// half into a one-field form per provider - paste the key, press 启用. All
// writes ride the host's loopback routes; this module only renders and calls
// fetch, so it needs no build step and no client-module dependencies beyond
// react and the official primitives.
//
// The module is a classic client bundle (client-modules protocol): it
// registers a factory with window.__ModuleLoader__ and returns apply().
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
      'title': '服务商预设',
      'hint': '选一个服务商，粘贴 API Key 即可启用。写入官方 llm-pi-ai 设置与凭据服务，立即生效、无需重启。',
      'refresh': '刷新',
      'loading': '读取中…',
      'error.keyRequired': '请先填写 API Key',
      'notice.enabled': '已启用 {name}',
      'notice.removed': '已移除 {route}',
      'configured.title': '已配置的服务商',
      'configured.empty': '还没有通过本面板添加的服务商。',
      'presets.title': '未内置的服务商（{visible} 个）',
      'presets.showCovered': '显示 DSH 已内置的 {covered} 个',
      'presets.hideCovered': '收起 DSH 已内置的 {covered} 个',
      'badge.native': 'DSH 已内置',
      'models.count': '{n} 个默认模型',
      'status.live': '运行中',
      'status.stored': '已写入',
      'status.noKey': '缺 Key',
      'key.placeholder': '粘贴 {env}',
      'key.savedHint': '凭据里已有 Key',
      'key.placeholderKeep': '留空则用已有 Key',
      'action.enable': '启用',
      'action.remove': '移除',
      'remove.confirm': '移除 {route}？已保存的 Key 会保留在凭据服务里。',
      'custom.title': '自定义服务商（任何 OpenAI 兼容端点）',
      'custom.route': '路由 ID（小写字母/数字/连字符）',
      'custom.name': '显示名称（可空）',
      'custom.baseURL': 'Base URL（到 /v1 为止）',
      'custom.api': '协议',
      'custom.models': '模型 ID（逗号或换行分隔）',
      'custom.add': '添加',
      'docs': '模型列表',
      'getKey': '获取 Key',
    }
    const en = {
      'title': 'Provider presets',
      'hint': 'Pick a provider, paste the API key, press Enable. Writes the official llm-pi-ai settings and credentials service - effective immediately, no restart.',
      'refresh': 'Refresh',
      'loading': 'Loading…',
      'error.keyRequired': 'Enter an API key first',
      'notice.enabled': 'Enabled {name}',
      'notice.removed': 'Removed {route}',
      'configured.title': 'Configured providers',
      'configured.empty': 'No provider has been added through this panel yet.',
      'presets.title': 'Providers not built into DSH ({visible})',
      'presets.showCovered': 'Show {covered} built into DSH',
      'presets.hideCovered': 'Hide {covered} built into DSH',
      'badge.native': 'built into DSH',
      'models.count': '{n} default models',
      'status.live': 'live',
      'status.stored': 'written',
      'status.noKey': 'no key',
      'key.placeholder': 'Paste {env}',
      'key.savedHint': 'key already stored',
      'key.placeholderKeep': 'Leave empty for the stored key',
      'action.enable': 'Enable',
      'action.remove': 'Remove',
      'remove.confirm': 'Remove {route}? The stored key stays in the credentials service.',
      'custom.title': 'Custom provider (any OpenAI-compatible endpoint)',
      'custom.route': 'Route id (lowercase letters/digits/hyphens)',
      'custom.name': 'Display name (optional)',
      'custom.baseURL': 'Base URL (up to /v1)',
      'custom.api': 'Protocol',
      'custom.models': 'Model ids (comma or newline separated)',
      'custom.add': 'Add',
      'docs': 'Models',
      'getKey': 'Get a key',
    }

    const format = (template, vars) =>
      String(template).replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] !== undefined ? String(vars[key]) : ''))

    // --- host calls -----------------------------------------------------------

    async function call(path, init) {
      const response = await fetch(`${ROUTE_PREFIX}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!payload || payload.ok !== true) {
        throw new Error((payload && (payload.error || payload.code)) || `HTTP ${response.status}`)
      }
      return payload
    }

    // --- styles ---------------------------------------------------------------

    const S = {
      card: { border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)', borderRadius: 12, padding: '14px 16px', marginTop: 16, fontSize: 13 },
      header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
      title: { fontWeight: 600, fontSize: 14 },
      hint: { opacity: 0.7, lineHeight: 1.5, marginBottom: 10 },
      section: { margin: '12px 0 6px', fontWeight: 600, opacity: 0.85 },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l3, #f0f0f0)' },
      name: { minWidth: 150, fontWeight: 500 },
      sub: { opacity: 0.6, fontSize: 12 },
      grow: { flex: 1, minWidth: 0 },
      input: { flex: 1, minWidth: 160, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'inherit', fontSize: 13 },
      button: { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
      primary: { padding: '7px 16px', borderRadius: 8, border: '1px solid transparent', background: 'var(--dsw-alias-interactive-bg-hover, #2f6fec)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
      danger: { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary, #c0392b)', cursor: 'pointer', fontSize: 12 },
      badge: { fontSize: 11, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2, #d7dbe0)', opacity: 0.85 },
      linkButton: { background: 'none', border: 'none', color: 'var(--dsw-alias-link, #2f6fec)', cursor: 'pointer', fontSize: 12, padding: 0 },
      link: { color: 'var(--dsw-alias-link, #2f6fec)', textDecoration: 'none', fontSize: 12 },
      error: { color: 'var(--dsw-alias-state-error-primary, #c0392b)', margin: '6px 0' },
      notice: { color: 'var(--dsw-alias-state-success-primary, #1d9a4a)', margin: '6px 0' },
      form: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 },
      field: { display: 'flex', flexDirection: 'column', gap: 4 },
    }

    // --- component ------------------------------------------------------------

    function PresetsCard({ t }) {
      const tr = (key, vars) => format(t(key), vars)
      const [state, setState] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [notice, setNotice] = react.useState(null)
      const [busy, setBusy] = react.useState(null)
      const [keys, setKeys] = react.useState({})
      const [customOpen, setCustomOpen] = react.useState(false)
      const [showCovered, setShowCovered] = react.useState(false)
      const [custom, setCustom] = react.useState({
        route: '',
        displayName: '',
        baseURL: '',
        api: 'openai-completions',
        modelIds: '',
        key: '',
      })

      const load = react.useCallback(async () => {
        setBusy('__load')
        try {
          const next = await call('/state')
          setState(next)
          setError(null)
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }, [])

      react.useEffect(() => {
        load()
      }, [load])

      const enablePreset = async (preset) => {
        const key = String(keys[preset.id] || '').trim()
        if (key === '' && preset.envConfigured !== true) {
          setError(tr('error.keyRequired'))
          return
        }
        setBusy(preset.id)
        setError(null)
        setNotice(null)
        try {
          await call('/enable', { method: 'POST', body: JSON.stringify({ presetId: preset.id, key }) })
          setKeys((current) => ({ ...current, [preset.id]: '' }))
          setNotice(tr('notice.enabled', { name: preset.name }))
          await load()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }

      const removeRoute = async (route) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(tr('remove.confirm', { route }))) {
          return
        }
        setBusy(route)
        setError(null)
        setNotice(null)
        try {
          await call('/remove', { method: 'POST', body: JSON.stringify({ route }) })
          setNotice(tr('notice.removed', { route }))
          await load()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }

      const addCustom = async () => {
        const key = String(custom.key || '').trim()
        if (key === '') {
          setError(tr('error.keyRequired'))
          return
        }
        setBusy('__custom')
        setError(null)
        setNotice(null)
        try {
          await call('/enable', {
            method: 'POST',
            body: JSON.stringify({
              route: custom.route,
              displayName: custom.displayName,
              baseURL: custom.baseURL,
              api: custom.api,
              modelIds: custom.modelIds,
              key,
            }),
          })
          setCustom({ route: '', displayName: '', baseURL: '', api: 'openai-completions', modelIds: '', key: '' })
          setNotice(tr('notice.enabled', { name: custom.route }))
          await load()
        } catch (reason) {
          setError(String((reason && reason.message) || reason))
        } finally {
          setBusy(null)
        }
      }

      const configured = state ? Object.entries(state.routes || {}) : []
      const presets = state ? state.presets || [] : []
      const visiblePresets = presets.filter((preset) => preset.covered !== true)
      const coveredPresets = presets.filter((preset) => preset.covered === true)

      const statusBadge = (route) => {
        const info = state && state.routes ? state.routes[route] : undefined
        if (!info) return null
        const parts = []
        if (info.live) parts.push(tr('status.live'))
        else parts.push(tr('status.stored'))
        if (!info.keyConfigured) parts.push(tr('status.noKey'))
        return h('span', { style: S.badge }, parts.join(' · '))
      }

      const rowStyleBusy = (id) => (busy === id ? { opacity: 0.55, pointerEvents: 'none' } : {})

      const renderPresetRow = (preset) =>
        h('div', { style: { ...S.row, ...rowStyleBusy(preset.id) }, key: `preset-${preset.id}` },
          h('span', { style: { ...S.name, display: 'flex', flexDirection: 'column' } },
            h('span', null,
              preset.name,
              preset.covered === true ? ' ' : null,
              preset.covered === true
                ? h('span', { style: S.badge, title: preset.coveredBy ? `${tr('badge.native')}: ${preset.coveredBy}` : tr('badge.native') }, tr('badge.native'))
                : null,
              ' ',
              h('a', { style: S.link, href: preset.docs, target: '_blank', rel: 'noreferrer' }, `[${tr('docs')}]`),
              ' ',
              h('a', { style: S.link, href: preset.keyUrl, target: '_blank', rel: 'noreferrer' }, `[${tr('getKey')}]`),
            ),
            h('span', { style: S.sub }, `${preset.env} · ${tr('models.count', { n: preset.models.length })} · ${preset.models.join(', ')}${preset.envConfigured === true ? ' · ' + tr('key.savedHint') : ''}`),
          ),
          preset.configured ? statusBadge(preset.id) : null,
          preset.configured
            ? h('span', { style: S.grow })
            : h('input', {
                style: S.input,
                type: 'password',
                autoComplete: 'off',
                placeholder: preset.envConfigured === true ? tr('key.placeholderKeep') : tr('key.placeholder', { env: preset.env }),
                value: keys[preset.id] || '',
                onChange: (event) => setKeys((current) => ({ ...current, [preset.id]: event.target.value })),
              }),
          preset.configured
            ? h('button', { type: 'button', style: S.danger, onClick: () => removeRoute(preset.id) }, tr('action.remove'))
            : h('button', { type: 'button', style: S.primary, onClick: () => enablePreset(preset) }, tr('action.enable')),
        )

      return h(
        'section',
        { style: S.card, 'data-dsh-part': 'provider-hub' },
        h('div', { style: S.header },
          h('span', { style: S.title }, tr('title')),
          h('span', { style: S.grow }),
          busy === '__load'
            ? h('span', { style: S.sub }, tr('loading'))
            : h('button', { type: 'button', style: S.button, onClick: load }, tr('refresh')),
        ),
        h('div', { style: S.hint }, tr('hint')),
        error ? h('div', { style: S.error }, error) : null,
        notice ? h('div', { style: S.notice }, notice) : null,

        h('div', { style: S.section }, tr('configured.title')),
        configured.length === 0
          ? h('div', { style: S.sub }, tr('configured.empty'))
          : configured.map(([route, info]) =>
              h('div', { style: { ...S.row, ...rowStyleBusy(route) }, key: `cfg-${route}` },
                h('span', { style: S.name }, info.displayName || route),
                h('span', { style: S.sub }, `${route} · ${info.env || '-'} · ${info.modelCount} models`),
                statusBadge(route),
                h('span', { style: S.grow }),
                h('button', { type: 'button', style: S.danger, onClick: () => removeRoute(route) }, tr('action.remove')),
              ),
            ),

        h('div', { style: { ...S.section, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', null, tr('presets.title', { visible: visiblePresets.length })),
          coveredPresets.length > 0
            ? h('button', { type: 'button', style: S.linkButton, onClick: () => setShowCovered((open) => !open) },
                showCovered
                  ? tr('presets.hideCovered', { covered: coveredPresets.length })
                  : tr('presets.showCovered', { covered: coveredPresets.length }))
            : null,
        ),
        visiblePresets.map(renderPresetRow),
        showCovered ? coveredPresets.map(renderPresetRow) : null,

        h('div', { style: S.section },
          h('button', { type: 'button', style: S.button, onClick: () => setCustomOpen((open) => !open) }, tr('custom.title')),
        ),
        customOpen
          ? h('div', null,
              h('div', { style: S.form },
                h('label', { style: S.field }, h('span', { style: S.sub }, tr('custom.route')), h('input', { style: S.input, value: custom.route, placeholder: 'my-gateway', onChange: (e) => setCustom((c) => ({ ...c, route: e.target.value })) })),
                h('label', { style: S.field }, h('span', { style: S.sub }, tr('custom.name')), h('input', { style: S.input, value: custom.displayName, placeholder: 'My Gateway', onChange: (e) => setCustom((c) => ({ ...c, displayName: e.target.value })) })),
                h('label', { style: S.field }, h('span', { style: S.sub }, tr('custom.baseURL')), h('input', { style: S.input, value: custom.baseURL, placeholder: 'https://api.example.com/v1', onChange: (e) => setCustom((c) => ({ ...c, baseURL: e.target.value })) })),
                h('label', { style: S.field }, h('span', { style: S.sub }, tr('custom.api')), h('select', { style: S.input, value: custom.api, onChange: (e) => setCustom((c) => ({ ...c, api: e.target.value })) }, h('option', { value: 'openai-completions' }, 'openai-completions'), h('option', { value: 'anthropic-messages' }, 'anthropic-messages'))),
                h('label', { style: S.field }, h('span', { style: S.sub }, tr('custom.models')), h('input', { style: S.input, value: custom.modelIds, placeholder: 'model-a, model-b', onChange: (e) => setCustom((c) => ({ ...c, modelIds: e.target.value })) })),
                h('label', { style: S.field }, h('span', { style: S.sub }, 'API Key'), h('input', { style: S.input, type: 'password', autoComplete: 'off', value: custom.key, onChange: (e) => setCustom((c) => ({ ...c, key: e.target.value })) })),
              ),
              h('div', { style: { marginTop: 10 } },
                h('button', { type: 'button', style: S.primary, onClick: addCustom }, tr('custom.add')),
              ),
            )
          : null,
      )
    }

    // --- plugin ---------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-provider-hub: dictionaries')
      ctx.slots.inject('settings.models.footer', () =>
        ctx.slots.register(
          {
            name: 'settings.models.footer',
            id: 'provider-hub',
            order: 20,
            locale: NS,
          },
          PresetsCard,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
