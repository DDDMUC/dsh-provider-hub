# dsh-provider-hub

[English](#english) | 中文

为 DSH 扩大可用的服务商：**选一个服务商，粘贴 API Key，点启用**——插件把官方 `llm-pi-ai` 路由与凭据一次性写好，立即生效、无需重启、无需手改 `settings.yaml`。

内置 **40 家服务商预设**（OpenAI 兼容 / Anthropic Messages / OpenAI Responses 三种协议），覆盖国际与国内的普通 API 与 **订阅渠道**（百炼 Token Plan、智谱 Coding、Kimi Coding、MiniMax Coding Plan、小米 MiMo、OpenCode Zen、**Command Code GOAT** 等），另有「自定义服务商」入口可接入任意兼容端点；DSH 已内置的服务商默认折叠、不重复展示。

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

OpenAI、OpenRouter、Anthropic、Google Gemini、xAI Grok、Mistral、Groq、Together、Fireworks、DeepInfra、Novita、Cerebras、NVIDIA NIM、Baseten、HuggingFace Router、**Vercel AI Gateway**、**OpenCode Zen / Zen Go**、硅基流动、月之暗面 Kimi（国内/国际）、**Kimi Coding Plan**、智谱 GLM（国内）、**智谱 Coding Plan**、Z.ai GLM、**MiniMax Coding Plan（国际/国内）**、MiniMax（国内）、**阿里云百炼 Token Plan（国内/国际）**、阿里云百炼 Qwen、百度千帆、腾讯混元、火山方舟（豆包）、**小米 MiMo**、**Ant Ling**、**LongCat（美团）**、**StepFun Step Plan（国内/国际）**。

关于内置：DSH 自带 DeepSeek 官方适配器（`llm-deepseek`），其目录里的 `stepfun` 指向普通付费端点 `api.stepfun.com/v1`——**Step Plan 订阅端点（`step_plan/v1`）没有内置条目，因此本插件提供该预设**；其余与本插件重合的服务商由 DSH 原生目录覆盖的那些默认折叠在「显示 DSH 已内置」开关后。已配置过的 Key（包括来自环境变量的）会被识别，留空输入框即可直接启用。

**Command Code GOAT** 预设收录了 GOAT 计划的 58 个模型（GPT-6 Luna、MiMo V2.6 全系、Kimi K3、Grok 4.7、Qwen 3.8、GLM-5.3、DeepSeek V4 系列、Gemini 3.8 Flash 等，含 `poolside/laguna-s-2.1-free`、`inclusionai/ling-3.0-flash-sante:free` 两个免费模型）；需 Pro/Max 计划的高级模型（GPT-6 Astra/Sol、Claude 系列等）不在其中。

## WorkBuddy（腾讯）适配

同一份预设目录也能写入 WorkBuddy 的本地自定义模型文件（`~/.workbuddy/models.json`，明文 JSON，应用启动时读取）：

```sh
node tools/workbuddy.mjs list                    # 查看预设与 WorkBuddy 里的已装状态
node tools/workbuddy.mjs add-all                 # 目录内全部预设：无 Key 的先装上，用时在 WorkBuddy 里补
node tools/workbuddy.mjs add stepfun-step-plan --key-from-dsh STEPFUN_API_KEY
node tools/workbuddy.mjs add openrouter --key <key> --models deepseek/deepseek-chat
node tools/workbuddy.mjs remove stepfun-step-plan
node tools/workbuddy.mjs add-custom --model gpt-5.1 --url https://api.openai.com/v1 --key sk-...
```

- 条目按 WorkBuddy 的校验规则（`isValidLocalCustomModel`）生成，写入前本地校验、临时文件+rename 原子替换
- **写入后需重启 WorkBuddy**（CLI 会在应用运行中时提示）
- 应用会把本地模型标记为 `custom-local:` 前缀 + `custom` tag，实际请求前还原原始模型 ID
- `useCustomProtocol: false`（默认）＝应用自动在 URL 后追加 `/chat/completions`；需要完整 URL 时加 `--full-url`
- Key 来源三选一：`--key`、`--key-env NAME`、`--key-from-dsh REF`（复用 DSH 凭据服务里的 Key）
- WorkBuddy 的模型按 ID 全局唯一：国内/国际预设共用模型 ID 时，**目录里靠前的一家生效**；带 Key 的 `add` 是显式安装、必定覆盖；`add-all` 不会覆盖已配置 Key 的条目。想换另一家先 `remove <另一家>` 再 `add <目标家> --key ...`

## OpenCode 适配

同一份预设目录也能写入 OpenCode 的配置（`~/.config/opencode/opencode.json` 或 `.jsonc`，自动备份）：

```sh
node tools/opencode.mjs list                          # 查看预设与 OpenCode 里的已装状态
node tools/opencode.mjs add commandcode --key-from-dsh COMMANDCODE_API_KEY
node tools/opencode.mjs add openrouter --key <key> --models deepseek/deepseek-chat
node tools/opencode.mjs add-all [--prune]             # 全部预设（无 Key 的先用占位）
node tools/opencode.mjs remove commandcode
node tools/opencode.mjs add-custom --route myapi --model gpt-5.1 --url https://api.openai.com/v1 --key sk-... [--reasoning] [--model-name "GPT-5.1"]
```

- Key 存进 provider 的 `options.apiKey`；模型带 OpenCode 需要的元数据（`name` / `limit` / `reasoning` / `tool_call` / `attachment`）
- OpenCode 的 models.dev 目录里没有的路由自动补上正确的 npm SDK（依据本地 `~/.cache/opencode/models.json` 判定协议）
- 改完配置**重启 OpenCode 应用**（命令行 `opencode run` 每次启动即读）
- Key 来源三选一：`--key`、`--key-env NAME`、`--key-from-dsh REF`

## 目录维护

- 模型清单与逐模型兼容开关可从任意权威目录刷新：`node tools/refresh-catalog.mjs --catalog <catalog.json>`（先 `--dry` 审阅）；路由级只保留全部模型一致的开关，不一致的由模型自己携带 `compat`
- WorkBuddy 端用 `node tools/workbuddy.mjs add-all --prune` 同步：装入全部预设并清掉目录里已不存在的旧条目

## 注意

- 预设里的模型规格（上下文/输出/档位）是**可编辑的起手默认值**；模型 ID 与限额以各服务商文档为准，可在官方 Models 页增删改
- 声明了 `reasoningEfforts` 的模型才会有思考档位选择器；未声明的模型按无档位处理
- 移除只下线路由，不删除 Key（见上）

---

## English

Expand the providers DSH can use: **pick a provider, paste the API key, press Enable**. The plugin writes the official `llm-pi-ai` route and its credential in one step - effective immediately, no restart, no hand-editing `settings.yaml`.

40 built-in presets (OpenAI-compatible, Anthropic Messages and OpenAI Responses protocols) plus a custom-endpoint form for any compatible gateway. Presets your target app already ships natively are collapsed by default, never deleted.

The **Command Code GOAT** preset carries all 58 models of the GOAT plan (GPT-6 Luna, the MiMo V2.6 family, Kimi K3, Grok 4.7, Qwen 3.8, GLM-5.3, DeepSeek V4 series, Gemini 3.8 Flash, plus the free `poolside/laguna-s-2.1-free` and `inclusionai/ling-3.0-flash-sante:free`). Pro/Max-only models (GPT-6 Astra/Sol, the Claude family) are excluded.

The same catalog ships two CLIs: `provider-hub-workbuddy` writes WorkBuddy's local `models.json`, `provider-hub-opencode` writes OpenCode's config; both accept `--key-from-dsh <REF>` to reuse a key already stored in DSH.

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
