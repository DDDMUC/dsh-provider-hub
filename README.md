# dsh-provider-hub

[English](#english) | 中文

为 DSH 扩大可用的服务商：**选一个服务商，粘贴 API Key，点启用**——插件把官方 `llm-pi-ai` 路由与凭据一次性写好，立即生效、无需重启、无需手改 `settings.yaml`。

内置 23 家预设（OpenAI 兼容协议 + Anthropic Messages 协议），另有「自定义服务商」入口可接入任意 OpenAI 兼容端点；DSH 已内置的服务商默认折叠、不重复展示。

## 安装

```sh
# 通过插件管理器（推荐）
dsh plugin --profile web add dsh-provider-hub

# 或本地开发挂载
dsh plugin --profile web add link:/path/to/dsh-provider-hub
```

重启 `dsh web`，打开 **设置 → Models**，页面底部出现「服务商预设」卡片。

## 使用

1. 点预设行右侧的「获取 Key」去对应控制台申请 Key（模型列表链接在其旁边）
2. 把 Key 粘贴进输入框，点「启用」
3. 状态徽标会显示 `运行中`（宿主已注册该路由）/ `已写入` / `缺 Key`
4. 回到聊天输入框的模型选择器，新服务商的模型已经可选

移除：点行内「移除」。**已保存的 Key 会保留在凭据服务里**，重新启用时不需要再粘贴；如需彻底清除，在官方 Models 页删除该路由后用凭据接口清除对应引用。

## 自定义服务商

「自定义服务商」支持任何 OpenAI 兼容端点（`openai-completions`）或 Anthropic Messages 端点（`anthropic-messages`）：填路由 ID、Base URL（到 `/v1` 为止）、协议、模型 ID（逗号/换行分隔）与 Key 即可。

## 工作原理

写入全部走 DSH 官方服务，插件不直接碰配置文件：

- `credentials.set(apiKeyEnv, key)` —— Key 存进凭据服务（与手写 profile 用的是同一个引用）
- `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` —— 写入官方 pi-ai 命名空间的用户层，官方 schema 校验、适配器热注册

`core/` 目录是纯 JS（无 Node 内建、无 DSH 依赖、无 I/O）：服务商目录、profile 构建与校验。宿主半、浏览器半（本插件）、以及后续的桌面端外壳共用同一份核心代码。

## 预设清单

OpenAI、OpenRouter、Anthropic、Google Gemini（OpenAI 兼容）、xAI Grok、Mistral、Groq、Together、Fireworks、DeepInfra、Novita、硅基流动、月之暗面 Kimi（国内/国际）、智谱 GLM（国内）、Z.ai GLM（国际）、MiniMax、阿里云百炼 Qwen、百度千帆、腾讯混元、火山方舟（豆包）、**StepFun Step Plan（国内/国际）**。

关于内置：DSH 自带 DeepSeek 官方适配器（`llm-deepseek`），其目录里的 `stepfun` 指向普通付费端点 `api.stepfun.com/v1`——**Step Plan 订阅端点（`step_plan/v1`）没有内置条目，因此本插件提供该预设**；其余与本插件重合的服务商（openai、openrouter 等 13 个）由 DSH 原生目录覆盖，默认折叠在「显示 DSH 已内置」开关后。已配置过的 Key（包括来自环境变量的）会被识别，留空输入框即可直接启用。

## 注意

- 预设里的模型规格（上下文/输出/档位）是**可编辑的起手默认值**；模型 ID 与限额以各服务商文档为准，可在官方 Models 页增删改
- 声明了 `reasoningEfforts` 的模型才会有思考档位选择器；未声明的模型按无档位处理
- 移除只下线路由，不删除 Key（见上）

---

## English

Expand the providers DSH can use: **pick a provider, paste the API key, press Enable**. The plugin writes the official `llm-pi-ai` route and its credential in one step - effective immediately, no restart, no hand-editing `settings.yaml`.

23 built-in presets (OpenAI-compatible and Anthropic Messages protocols) plus a custom-endpoint form for any OpenAI-compatible gateway. Presets your target app already ships natively are collapsed by default, never deleted.

### Install

```sh
dsh plugin --profile web add dsh-provider-hub
```

Restart `dsh web`, open **Settings → Models**; the "Provider presets" card is at the bottom.

### Usage

Paste the key (each row links to the console and the model list), press **Enable**, then pick the provider's models in the composer's model selector. **Remove** takes the route offline but keeps the stored key, so re-enabling never needs the key again.

### How it works

All writes go through official services - the plugin never touches config files directly: `credentials.set(apiKeyEnv, key)` stores the key, and `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` writes the user layer of the official pi-ai namespace (schema-validated, hot-registered).

`core/` is pure JS (no Node built-ins, no DSH imports, no I/O): the provider catalog plus profile building and validation, shared by the host half, this plugin's browser half, and any future desktop shell.

### Notes

Preset model specs are editable starting defaults; model ids and limits follow each vendor's docs. Only models declaring `reasoningEfforts` get the thinking-level selector. Removing a route keeps its credential.
