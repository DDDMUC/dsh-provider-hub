# Changelog

本文件记录对外可见的变更。更早的历史看 git tag（`v0.4.0`、`v0.4.1` …）。

## [0.4.4] - 2026-11-03

### Fixed

- **APIGOTO 的 `claude-opus-5` 让整条路由加载失败**：这条预设给该模型写了 `compat: { supportsTemperature: false }`，但 APIGOTO 走的是 `openai-completions`，而 `supportsTemperature` 是 `anthropic-messages` 的开关。pi-ai 在解析时直接抛 `PiAiCatalogError`——`provider "apigoto" model "claude-opus-5" sets compat "supportsTemperature", but its api is "openai-completions", which does not take it`——整条路由（不只这个模型）都进不来。Anthropic 官方那两家仍是 `anthropic-messages`，开关照旧保留。

### Added

- **按协议过滤 compat 的写入闸**（`core/profile.js` 的 `OFFERED_COMPAT` / `filterCompat`）：路由级和模型级都只写该协议真正接受的开关。模型级的多余开关在 pi-ai 里是**致命**的（整条路由失败），路由级的多余开关则是**静默跳过**（看着配了其实没生效），两种都不再写出去。以后从 models.dev 同步、手改预设或手改已采纳的路由，都不会再把这类开关带回来。
- `test/core.test.js` 新增 4 条不变量：每个模型的开关必须属于其协议、每个路由级开关必须是某个协议声明过的名字、`buildProfile` 出来的档案只带合法开关、`filterCompat` 的丢弃行为。`tools/verify-presets.mjs` 也补了同样的检查（`new Config()` 只验 schema，管不到这个语义）。

## [0.4.3] - 2026-11-02

### Added

- **页脚「从预设目录添加」**：Models 页页脚列出所有**还没配置**的预设（已配置的、以及本 app 已原生覆盖的都不出现）。点「添加」直接写入完整档案——`baseURL` + 模型清单 + 上下文/输出限额 + 思考档 + 逐模型兼容开关 + `apiKeyEnv`；Key 已在环境变量或凭据服务里时**不再问**，否则就地弹输入框。
- 添加出来的就是**普通的提供商卡片**，和官方加的一模一样，模型可以随意增删改。

### Fixed

- **pi-ai 目录里没有的提供商，无法通过官方「第三方模型提供商」下拉添加。** 目录条目按 DSH 的契约不携带模型清单（运行时只读 `provider / displayName / settingsNs / settingsPath / defaultBaseURL / baseURLEnv / nativeAuth`），于是选中后建出的路由是「有地址、没模型」；pi-ai 对既没有配置模型、自己目录里也没有的路由直接抛 `PiAiCatalogError`，保存不落地，插件的 `enrich`（补模型那步）只处理已配置成功的路由，永远轮不到它。而这类提供商正是本目录存在的理由。

## [0.4.2] - 2026-10-31

### Fixed

- **命名空间晚注册导致的首次同步失败**：pi-ai 的 settings 命名空间比服务晚一拍才声明，首次目录同步总是落得太早，之后也不会再有事件触发。改成退避重试（200ms 起、每次 +200ms、封顶 2s，最多 10 次）。
- **目录以实际读到的为准**：不再信任注册句柄记住的那份。pi-ai 在每次 volatile update 时会重算自己的条目，可能把本插件注册的丢掉，症状是「第三方模型提供商」下拉里一个预设都没有。
- **新增 `~/.provider-hub/sync-trace.log`**：注册失败以前是完全静默的，现在会留下最后几行，方便定位。

## [0.4.1] - 2026-10-25

### Added

- 新增 APIGOTO 聚合路由预设。
