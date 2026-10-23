# dsh-provider-hub

[English](#english) | 中文

为 DSH 扩大可用的服务商：**在官方 Models 页选一个服务商，粘贴 API Key，保存**——预设与 DSH 自带的 42 家并列在同一个下拉里，插件把官方 `llm-pi-ai` 路由与凭据一次性写好，立即生效、无需重启、无需手改 `settings.yaml`。

内置 **54 家服务商预设**（OpenAI 兼容 / Anthropic Messages / OpenAI Responses 三种协议），覆盖国际与国内的普通 API 与 **订阅渠道**（百炼 Token Plan、智谱 Coding、Kimi Coding、MiniMax Coding Plan、小米 MiMo、OpenCode Zen、**火山方舟 Agent Plan** 等）；DSH 已内置的服务商不会重复出现在下拉里。

## 安装

```sh
# 通过插件管理器（推荐）
dsh plugin --profile web add dsh-provider-hub

# 或本地开发挂载
dsh plugin --profile web add link:/path/to/dsh-provider-hub
```

重启 `dsh web`，打开 **设置 → Models**。

## 使用

1. 点 **添加模型提供商** → 方式选 **第三方模型提供商**
2. 在 **提供商** 下拉里选你要的渠道（DSH 自带的 42 家之外，本插件的预设也在里面），点 **获取 Key** 去对应控制台申请
3. 粘贴 API Key，**保存**
4. 回到聊天输入框的模型选择器，新服务商的模型已经可选

模型清单、上下文/输出限额、思考档与逐模型兼容开关由插件在保存后补齐，不需要你手填；**已保存的 Key 会保留在凭据服务里**，重新添加时不需要再粘贴。

> **行内 `Hub` 徽标**：来自本插件预设的路由，在官方 Models 页**各自的服务商行内**会带一个 `Hub` 标记（注入官方 `settings.models.provider-card` 逐行插槽）。官方那个「自定义」标签表达的是「这条路由不在 pi-ai 原生目录里」，与本插件没有对应关系，所以没有改它。
>
> 判定方式是**指纹而非标记**——DSH 不记录路由来源，因此要求：路由 ID 属于本目录的预设，且该路由的显示名等于预设名（官方编辑器会从本插件声明的目录条目预填这个显示名；只给原生路由填 Key 的情况保留路由 ID 作显示名，不会被误标）。代价：① 手动改过显示名的路由不再带标；② 若某预设日后从目录下线，其既有路由也不再带标，需自行核对 `cordis.patch.yml`。

## 隐藏 / 显示提供商（不丢 Key、不丢配置）

额度用完了、或者只是暂时不想看见，就**隐藏**它：路由会从**聊天输入框的模型选择器**里消失，Models 页的那张卡片也一起消失，但 **Key 与全部配置都留着**——随时点一下就能原样恢复，不用重填任何东西。

- **隐藏**：Models 页每条 pi-ai 服务商行内（`Hub` 徽标旁边）的「隐藏」。确认后插件把该路由**整份 profile** 存进 `~/.provider-hub/hidden.json`，再把它从用户层撤下。凭据服务里的 Key 完全没动。
- **恢复**：页脚那行「已隐藏 N 个提供商（点名字恢复）」，点名字即原样写回（含 `apiKeyEnv` / `baseURL` / `api` / `models` / `compat` / `headers`）。
- 隐藏后的预设还会以「休眠」状态回到 **添加模型提供商 → 第三方模型提供商** 的下拉里，这是第二条恢复路径（走官方编辑器）。

原理：模型选择器的数据源是 `llm.listProviders()` —— **只有用户层带着 profile 的路由才会注册**，所以撤下 profile 就等于同时离开选择器与设置页，而 Key 引用不需要跟着走。

### 两种「隐藏」的杠杆

插件按**提供商目录**里该路由的 `settingsPath` 自动选杠杆，所以卡片上的文案会告诉你这次会隐藏到什么程度：

| 路由类型 | 杠杆 | 效果 | 例子 |
|---|---|---|---|
| `profile`（`settingsPath = ['providers', <route>]`） | 撤下该 profile | **卡片 + 选择器一起消失**；恢复时原样写回 | `opencode`、`opencode-go`、`Command Code`、`ClinePass`、`Cline Free`、千帆… |
| `catalog`（`settingsPath = []`） | 清空该路由的 `models`，并在页面上把该行藏起来 | **卡片与选择器都消失**；恢复时把原目录写回 | **DeepSeek**（`deepseek-official`） |

`catalog` 模式为什么多一步：这类路由由**它自己的官方插件**在 apply 时无条件注册适配器与目录条目（`ctx.llm.registerAdapter([provider], adapter)`），配置层面注销不掉，所以插件做两件事——① 清空 `models` 让选择器那个分组因「零模型」被过滤；② 在自己的行内槽位里用 `closest('li')` 把整张卡隐藏（该 `<li>` 以 provider 为 key，节点稳定）。**这是页面级隐藏，不是注销**：配置仍在用户层，点页脚「显示」即原样写回并恢复整行。

`catalog` 模式恢复时：你原本改过模型目录就**写回原目录**；没改过就 unset，让它回到命名空间自带的默认目录。

> 想让 DeepSeek 那张卡**真正从配置层消失**（连路由都不注册）只有一条路：在 profile 组合里 `disabled: true` 掉 `llm-deepseek` 这个条目（它对应包 `@deepseek-ai/dsh-llm-deepseek-api-key`）。本插件不替你做这种跨插件的开关决定；`DeepSeek 账号`（`llm-deepseek-account`）是另一个条目，不受影响，Key 也留在凭据服务里。

> **DeepSeek 账号**（`deepseek-account`）不在支持范围：它的模型清单由账号联网 `/models` 拉取，插件明确拒绝 `models` 键（*"models is no longer configurable; the account /models listing supplies the catalog"*），配置层面没有可清空的目录。真要它别出现在选择器里，官方做法是**退出登录**。

## 自定义服务商

本插件不再自带自定义入口——DSH 官方就有：同一个「添加模型提供商」卡片里，方式选 **自定义模型 API** 即可接入任何 OpenAI / Anthropic 兼容端点（填 Provider ID、API 地址、协议、模型，还能点「获取可用模型」直接探测端点）。

## 工作原理

预设通过 **官方可配置服务商目录** 进入 DSH，写入则全部走官方服务，插件不直接碰配置文件：

- `llm.registerConfigurableProviders(entries)` —— 把预设声明成「休眠提供商」，于是它们出现在官方那个提供商下拉里（DSH 自带的那 42 家由 `dsh-llm-pi-ai` 用同一个接口声明）；已被别人声明的路由不会被重复声明，**同一家厂商换了个路由 ID 的也不重复**（预设 `gemini` → 原生 `google`、`opencode-zen` → 原生 `opencode`，按目录里的别名折叠）
- `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` —— 你保存之后，把预设的模型清单 / 协议 / `compat` / `headers`（例如 OpenCode Go 必需的 `x-opencode-session`）补进该路由的 profile，官方 schema 校验、适配器热注册
- `credentials.set(apiKeyEnv, key)` —— Key 由官方编辑器写进凭据服务（与手写 profile 用的是同一个引用）

两条边界值得知道：

- **目录条目带不了模型**：DSH 的目录条目只有 `provider / displayName / settingsNs / settingsPath / defaultBaseURL / baseURLEnv / nativeAuth`，没有 `models`，所以策展必须发生在「保存之后」这一步，而不是目录里。
- **策展只做一次**：每路由记一份指纹在 `~/.provider-hub/directory.json`，此后你对手上这条 profile 的任何编辑（比如裁短模型清单）都不会被插件改回去；预设自身形状变了才会重新策展。

`core/` 目录是纯 JS（无 Node 内建、无 DSH 依赖、无 I/O）：服务商目录、profile 构建与校验、目录计划。宿主半、浏览器半（本插件）、以及后续的桌面端外壳共用同一份核心代码。

## 预设清单

OpenAI、OpenRouter、Anthropic、Google Gemini、xAI Grok、Mistral、Groq、Together、Fireworks、DeepInfra、Novita、Cerebras、NVIDIA NIM、Baseten、HuggingFace Router、**Vercel AI Gateway**、**OpenCode Zen / Zen Go**、硅基流动、月之暗面 Kimi（国内/国际）、**Kimi Coding Plan**、智谱 GLM（国内）、**智谱 Coding Plan**、Z.ai GLM、**MiniMax Coding Plan（国际/国内）**、MiniMax（国内）、**阿里云百炼 Token Plan（国内/国际）**、阿里云百炼 Qwen、百度千帆、腾讯混元、火山方舟（豆包）、**小米 MiMo**、**Ant Ling**、**LongCat（美团）**、**StepFun Step Plan（国内/国际）**、**火山方舟 Agent Plan**、**ClinePass**、**Command Code**、**Kilo Gateway**、**Nous Portal**、**Cline Free**、**ZenMux**、**Poe**、**302.AI**、**七牛云 AI**、**腾讯云 Coding Plan**、**ClinePass**、**DeepSeek**、**小米 MiMo Token Plan（国内/新加坡/美国）**。

**火山方舟 Agent Plan** 预设写入 `https://ark.cn-beijing.volces.com/api/plan/v3`（**不是 `/api/v3`**——后者按量计费），协议走 Responses API（对应 OpenCode 的 `@ai-sdk/openai`；要更旧的 Chat API 就把协议改成 OpenAI 兼容）。收录 `ark-code-latest` 与 deepseek-v4.1-flash / glm-5.3 / kimi-k3 / deepseek-v4-pro / deepseek-v4-flash / kimi-k2.8-preview，后六者均标注 1M 上下文窗口。

**免费渠道（Step 5 Preview 限免那几家）**：

- **Kilo Gateway**：`stepfun/step-5-preview-free`（1M 上下文 / 64K 输出，思考档 low/medium/high，走 OpenRouter 式 `reasoning: {effort}` 线格式，因为 Step 5 在该端点**禁止关闭思考**，预设不提供 off 档）。网关对免费模型允许匿名调用（每 IP 200 次/小时），但 pi-ai 适配器没有凭据就不发请求，所以仍需到 app.kilo.ai → 个人资料底部复制免费 Key。
- **Nous Portal**：`stepfun/step-5-preview:free`、`stepfun/step-3.7-flash:free` 等 8 个免费模型，端点 `inference-api.nousresearch.com/v1`，Key 从 portal.nousresearch.com 免费领取（无 Key 返回 x402/402）。
- **OpenCode**：免费层级拿不到——`/zen/v1` 的 `*-free` 模型报 FreeTierError「只能在 OpenCode 应用内使用」，`/zen/go/v1` 网关则要求 **$10/月的 Go 订阅**（`step-5-preview-free` / `longcat-2.5-preview-free` 是 Go 内无限免费，而非无订阅可用）。已实测：Go 网关还会拒绝没有 `x-opencode-session` 头的请求，而 pi-ai 适配器不发这个头——`opencode-go` 预设已通过 profile 级 `headers` 自动注入，订阅用户直接启用即可。
- **Cline Free**：`cline-free/*` 的 Step 5 **只对 Cline 产品面开放**（API 调用返回 403），拿不到；但 `:free` 系列（Poolside / NVIDIA / Cohere / Gemma / DOTS…）走 API 可用，且**不计入 ClinePass 周额度**，复用已有的 `CLINE_API_KEY` 即可启用。
- **Puter**：未收录——其 OpenAI 兼容端点 `/puterai/openai/v1/*` 对免费账户返回 `402 subscription_required`，只有 puter.js 的 User-Pays 通道免费，DSH 用不上。

关于内置：DSH 自带 DeepSeek 官方适配器（`llm-deepseek`），其目录里的 `stepfun` 指向普通付费端点 `api.stepfun.com/v1`——**Step Plan 订阅端点（`step_plan/v1`）没有内置条目，因此本插件提供该预设**；其余与本插件重合的服务商由 DSH 原生目录覆盖的那些默认折叠在「显示 DSH 已内置」开关后。已配置过的 Key（包括来自环境变量的）会被识别，留空输入框即可直接启用。

## WorkBuddy（腾讯）适配

同一份预设目录也能写入 WorkBuddy 的本地自定义模型文件（`~/.workbuddy/models.json`，明文 JSON，应用启动时读取）。

**默认流程与应用官方面板对齐**：工具只写「定义」（接口地址 / 模型清单 / 上下文与输出限额 / 图片、推理、工具调用开关 / 思考档位），**不写 Key**——WorkBuddy 官方的「设置 → 模型 → 模型管理」面板本来就能编辑这同一些字段（含 API Key），Key 由你在应用里填：

```sh
node tools/workbuddy.mjs list                    # 查看预设与 WorkBuddy 里的已装状态
node tools/workbuddy.mjs add-all                 # 目录内全部预设：只写定义
node tools/workbuddy.mjs add volcengine-agent-plan      # 只写定义，Key 在应用里填
node tools/workbuddy.mjs add stepfun-step-plan --key-from-dsh STEPFUN_API_KEY   # 想一次到位也行
node tools/workbuddy.mjs unset-key volcengine-agent-plan  # 清掉某渠道 Key，改为应用内填（--all 清全部）
node tools/workbuddy.mjs remove stepfun-step-plan
node tools/workbuddy.mjs add-custom --model gpt-5.1 --url https://api.openai.com/v1 --name "GPT-5.1"
```

- 填 Key（应用内）：**设置 → 模型 → 模型管理 → 找到条目 → 编辑**，面板里直接填 API Key（也能改接口地址、限额、能力开关）
- 条目按 WorkBuddy 的校验规则（`isValidLocalCustomModel`）生成，写入前本地校验、临时文件+rename 原子替换
- **写入后需重启 WorkBuddy**（CLI 会在应用运行中时提示）
- 应用会把本地模型标记为 `custom-local:` 前缀 + `custom` tag，实际请求前还原原始模型 ID
- `useCustomProtocol: false`（默认）＝应用自动在 URL 后追加 `/chat/completions`；需要完整 URL 时加 `--full-url`
- Key 来源三选一：`--key`、`--key-env NAME`、`--key-from-dsh REF`（复用 DSH 凭据服务里的 Key）
- 无 Key 的写入**不会覆盖**已有的 Key；WorkBuddy 的模型按 ID 全局唯一，国内/国际预设共用模型 ID 时目录里靠前的一家生效。想换一家先 `remove <另一家>` 再 `add <目标家>`

## OpenCode 适配

同一份预设目录也能写入 OpenCode 的配置（`~/.config/opencode/opencode.json` 或 `.jsonc`，自动备份）。**只写“提供商定义”，绝不写 Key**——Key 由 OpenCode 自己的「连接提供商」流程存进 `~/.local/share/opencode/auth.json`，和官方原生服务商的待遇完全一致：

```sh
provider-hub-opencode list                                  # 预设、已装状态、Key 连接状态
provider-hub-opencode add volcengine-agent-plan             # 只写定义（npm/baseURL/模型/限额/视觉）
provider-hub-opencode add longcat --key sk-...              # 想命令补 Key 也行（写入 auth.json）
provider-hub-opencode add-all [--prune]
provider-hub-opencode migrate-key                           # 把配置里残留的 Key 搬进 auth.json
provider-hub-opencode remove volcengine-agent-plan [--purge-key]
provider-hub-opencode add-custom --model gpt-5.1 --url https://api.openai.com/v1 [--key sk-...] [--name "GPT-5.1"]
```

**用户侧填 Key（应用内完成，零命令）**：OpenCode → 管理模型 → **+ 连接提供商 → 自定义 OpenAI 兼容提供商** → Provider ID 输入预设 ID（如 `volcengine-agent-plan`）→ 粘贴 Key。存进 auth.json 后，该渠道就能在「连接提供商」里查看/断开，与 OpenCode Zen、DeepSeek 等官方渠道体验一致。

- 模型条目带 OpenCode 需要的全部元数据：`name` / `limit`（上下文/输出，含 1M 窗口）/ `reasoning` / `tool_call` / `attachment` + `modalities`（方舟文档要求的图片理解字段）
- OpenCode 的 models.dev 目录里没有的路由自动补正确的 npm SDK（依据本地 `~/.cache/opencode/models.json` 判定协议）
- Key 三选一：`--key`、`--key-env NAME`、`--key-from-dsh REF`（复用 DSH 凭据服务里的 Key），全部写入 auth.json；配置文件永远零明文 Key
- `list` 按 **coverage 分区**：OpenCode 原生已内置的（models.dev 目录里有同名 provider）自动折叠成一行，只把「OpenCode 没有的渠道」摆在上面——那才是本工具的价值；`add` 一个原生已覆盖的预设时会提示你它本可走 `/connect`
- `--key-in-config` 是旧模式（Key 写回 `options.apiKey`），仅供想要单文件自包含配置的用户

## 连接向导（provider-hub-connect）

不想记命令？一条交互式向导就是「第三方登录」入口：列出全部渠道（●=这些 App 原生没有、本工具独有；○=部分 App 原生已有）→ 选编号 → 贴一次 Key → **自动探测本机装了哪些 App 并分别写入**：

```sh
provider-hub-connect                                          # 或 npm run connect
echo -e "3\nsk-ant-xxx\ny" | provider-hub-connect            # 也可管道喂输入
```

- **WorkBuddy**：写入 models.json（之后在应用内也能改 Key）
- **OpenCode**：定义进配置、Key 进 auth.json（与官方 /connect 同一存储，应用内可查看/断开）
- **DSH**：打印应用内的添加路径（官方「添加模型提供商 → 第三方模型提供商」下拉里选该渠道，贴 Key 保存）
- `--yes` 跳过写入确认

## cc-switch 适配

[cc-switch](https://github.com/farion1231/cc-switch)（136k★ 的多 App 服务商切换器：Claude Code / Codex / Gemini CLI / OpenCode / OpenClaw / Claude Desktop / GrokBuild）的全部状态就是一个纯 JSON：`~/.cc-switch/config.json`（`{version:2, <app>:{providers:{<id>:…}, current}}`）。各段的 settingsConfig 形状照它 Rust 源码（src-tauri/src/provider.rs）逐段实现，我们的目录写进去后直接出现在 cc-switch 的 UI 里：

| 段 | settingsConfig 形状 | 哪些预设能进 |
|---|---|---|
| opencode | `{npm, name, options:{baseURL, apiKey}, models}` | 全部协议 |
| codex | `{auth:{OPENAI_API_KEY}, config:"<config.toml>"}` | OpenAI 兼容（wire_api 按协议填 responses/chat） |
| claude / claude-desktop | `{env:{ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN}, model}` | Anthropic Messages |
| gemini | `{env:{GOOGLE_GEMINI_BASE_URL, GEMINI_API_KEY}}` | Google 自家端点 |
| openclaw | `{baseUrl, apiKey}` | 全部协议 |

```sh
provider-hub-cc-switch list
provider-hub-cc-switch add volcengine-agent-plan --key-from-dsh ARK_API_KEY   # 自动写全部匹配段
provider-hub-cc-switch add minimax-coding-plan --app claude,claude-desktop    # 只写指定段
provider-hub-cc-switch add-all
provider-hub-cc-switch unset-key <presetId> [--app ...]   # Key 改为在 cc-switch UI 里填
provider-hub-cc-switch remove <presetId> [--app ...]
```

- Key 写进 cc-switch 自己的 config（它的设计如此：切换时才写入 App 的 live 配置），**不动** OpenCode 的 auth.json
- 合并保留其它 App 段与用户手编辑；**绝不改 `current`**，不抢用户当前选中的 provider
- GrokBuild / Hermes / Pi 段的形状还没扒全（配置文本是 TOML/YAML 内嵌），暂不写入
- 连接向导（provider-hub-connect）检测到 cc-switch 也会一并写入全部匹配段

## ChatGPT 桌面版「从第三方登录」按钮（实验）

把我们的渠道挑选器**种进 ChatGPT/Codex 桌面版的登录页**——右下角会出现「⚡ 从第三方登录」悬浮按钮，点开就是全部渠道的搜索/挑选/填 Key 面板：

```sh
npm run patch-chatgpt            # = node tools/patch-chatgpt.mjs --apply
node tools/patch-chatgpt.mjs --status
node tools/patch-chatgpt.mjs --restore
```

原理（`tools/patch-chatgpt.mjs`，全部可逆）：
1. 渠道挑选器写到 `~/.provider-hub/overlay.js`（改它不用重新打包）
2. 给 app.asar 的入口（package.json 的 `main`）加一段 4 行钩子：每个 webContents 加载完执行这个文件
3. 重打包 asar → 重算 SHA256 写回 Info.plist 的 `ElectronAsarIntegrity` → ad-hoc 重签名，应用照常启动
4. 原始 asar/Info.plist 备份在 `~/.provider-hub/`，`--restore` 一键还原

已知限制（不藏奸）：
- **每次 ChatGPT 更新都会冲掉补丁**，重跑 `--apply` 即可
- ad-hoc 签名丢失 notarization（本机运行无碍）
- macOS 会拦截别的进程改 `/Applications` 里的 App——在**你自己的终端**里运行 `npm run patch-chatgpt`（首次弹权限框点允许，或加 sudo）
- 按钮目前是**入口**：写 Key 进本机渠道库；把 ChatGPT 流量导向所选服务商还需要本地代理（下一步）

## 目录维护

- 模型清单与逐模型兼容开关可从任意权威目录刷新：`node tools/refresh-catalog.mjs --catalog <catalog.json>`（先 `--dry` 审阅）；路由级只保留全部模型一致的开关，不一致的由模型自己携带 `compat`
- WorkBuddy 端用 `node tools/workbuddy.mjs add-all --prune` 同步：装入全部预设并清掉目录里已不存在的旧条目

## 注意

- 预设里的模型规格（上下文/输出/档位）是**可编辑的起手默认值**；模型 ID 与限额以各服务商文档为准，可在官方 Models 页增删改
- 声明了 `reasoningEfforts` 的模型才会有思考档位选择器；未声明的模型按无档位处理
- 移除只下线路由，不删除 Key（见上）

---

## English

Expand the providers DSH can use: **pick a provider in the official Models page, paste the API key, save**. The presets sit in the same select as the 42 providers DSH ships, and the plugin writes the official `llm-pi-ai` route and its credential in one step - effective immediately, no restart, no hand-editing `settings.yaml`.

54 built-in presets (OpenAI-compatible, Anthropic Messages and OpenAI Responses protocols), covering plain APIs and **subscription channels** (Alibaba Token Plan, Zhipu Coding, Kimi Coding, MiniMax Coding Plan, Xiaomi MiMo, OpenCode Zen, Volcengine Agent Plan, Command Code, ...). Providers DSH already ships are never repeated in that select.

### Install

```sh
dsh plugin --profile web add dsh-provider-hub
```

Restart `dsh web`, open **Settings → Models**, and use **Add model provider**.

### Usage

Pick **Third-party model provider**, choose the channel in the **Provider** select (the plugin's presets are listed next to DSH's own), paste the API key, and save. The curated model list, context and output limits, reasoning levels and per-model compat switches are filled in for you; pick the provider's models in the composer's model selector. The stored key stays in the credentials service, so re-adding a route never needs it again.

### How it works

All writes go through official services - the plugin never touches config files directly: `llm.registerConfigurableProviders(entries)` declares the presets in the configurable-provider directory the page's own select reads (the same seam `dsh-llm-pi-ai` uses for its 42 providers), `settings.mutate('llm-pi-ai', [set providers.<route>], revision)` writes the curated profile into the user layer of the official pi-ai namespace once the row is saved (schema-validated, hot-registered), and `credentials.set(apiKeyEnv, key)` stores the key.

Two limits are worth knowing. A directory entry carries no model catalog - only `provider / displayName / settingsNs / settingsPath / defaultBaseURL / baseURLEnv / nativeAuth` - so curation happens after adoption, not in the directory. And curation is once per preset version, recorded per route in `~/.provider-hub/directory.json`, so an edit you make to that profile afterwards is never reverted.

`core/` is pure JS (no Node built-ins, no DSH imports, no I/O): the provider catalog plus profile building, validation and the directory plan, shared by the host half, this plugin's browser half, and any future desktop shell.

The same catalog ships two CLIs: `provider-hub-workbuddy` writes WorkBuddy's local `models.json`, `provider-hub-opencode` writes OpenCode's config. The OpenCode CLI writes provider **definitions only** - keys land in OpenCode's own `auth.json` (the file its in-app 连接提供商 flow uses), so custom providers behave like natively supported ones and stay manageable from the app. Both accept `--key-from-dsh <REF>` to reuse a key already stored in DSH.

### Notes

Preset model specs are editable starting defaults; model ids and limits follow each vendor's docs. Only models declaring `reasoningEfforts` get the thinking-level selector. Removing a route keeps its credential.
