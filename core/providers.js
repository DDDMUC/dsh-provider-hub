// dsh-provider-hub - core provider catalog.
//
// Pure data + pure helpers. No Node built-ins, no DSH imports, no I/O: the
// host half, the browser half and (later) a desktop shell all consume this
// same module, so a preset fixed here is fixed everywhere.
//
// Every model entry is a STARTING DEFAULT: contextWindow / maxTokens / input /
// reasoningEfforts are editable afterwards in the official Models settings
// page (or by the dsh-client-ui-model-capabilities panel when it is mounted).
// Model ids drift faster than this file does; the docs link beside each preset
// is the source of truth.

/** Route-level OpenAI-completions switches shared by gateway presets. */
export const OPENAI_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  maxTokensField: 'max_tokens',
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
}

/** Wire protocols a preset may name (the pi-ai adapter's table). */
export const SUPPORTED_APIS = ['openai-completions', 'anthropic-messages']

const text = ['text']
const textImage = ['text', 'image']

/** Reasoning levels as `{ level: wireValue }`; wire values are what is sent. */
const efforts = (...levels) => Object.fromEntries(levels.map((level) => [level, level]))
const LOW_HIGH = efforts('low', 'high')
const LOW_MEDIUM_HIGH = efforts('low', 'medium', 'high')

/**
 * The curated catalog. `env` is the credential reference the profile writes as
 * `apiKeyEnv`; the key itself is stored by the consumer's secret store (DSH's
 * credentials service for the plugin, the OS keychain for a desktop shell).
 */
export const PRESETS = [
  {
    id: 'openai',
    name: 'OpenAI',
    docs: 'https://platform.openai.com/docs/models',
    keyUrl: 'https://platform.openai.com/api-keys',
    env: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'gpt-5.1', name: 'GPT-5.1', contextWindow: 400000, maxTokens: 128000, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'gpt-5.1-mini', name: 'GPT-5.1 mini', contextWindow: 400000, maxTokens: 128000, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576, maxTokens: 32768, input: textImage },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    docs: 'https://openrouter.ai/models',
    keyUrl: 'https://openrouter.ai/keys',
    env: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 64000, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextWindow: 163840, maxTokens: 65536, input: text },
      { id: 'qwen/qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 32768, input: text },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxTokens: 65536, input: textImage },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Messages API)',
    docs: 'https://docs.anthropic.com/en/docs/about-claude/models',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    env: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 64000, input: textImage },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', contextWindow: 200000, maxTokens: 32000, input: textImage },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 64000, input: textImage },
    ],
  },
  {
    id: 'gemini',
    nativeIds: ['google'],
    name: 'Google Gemini (OpenAI 兼容)',
    docs: 'https://ai.google.dev/gemini-api/docs/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    env: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api: 'openai-completions',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxTokens: 65536, input: textImage },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576, maxTokens: 65536, input: textImage },
    ],
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    docs: 'https://docs.x.ai/docs/models',
    keyUrl: 'https://console.x.ai',
    env: 'XAI_API_KEY',
    baseURL: 'https://api.x.ai/v1',
    api: 'openai-completions',
    models: [
      { id: 'grok-4', name: 'Grok 4', contextWindow: 262144, maxTokens: 32768, input: textImage, reasoningEfforts: LOW_HIGH },
      { id: 'grok-4-fast', name: 'Grok 4 Fast', contextWindow: 2097152, maxTokens: 32768, input: textImage, reasoningEfforts: LOW_HIGH },
      { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', contextWindow: 262144, maxTokens: 32768, input: text },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    docs: 'https://docs.mistral.ai/getting-started/models/models_overview/',
    keyUrl: 'https://console.mistral.ai/api-keys',
    env: 'MISTRAL_API_KEY',
    baseURL: 'https://api.mistral.ai/v1',
    api: 'openai-completions',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 131072, maxTokens: 32768, input: textImage },
      { id: 'mistral-medium-latest', name: 'Mistral Medium', contextWindow: 131072, maxTokens: 32768, input: textImage },
      { id: 'devstral-medium-latest', name: 'Devstral Medium', contextWindow: 131072, maxTokens: 32768, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    docs: 'https://console.groq.com/docs/models',
    keyUrl: 'https://console.groq.com/keys',
    env: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 131072, maxTokens: 32768, input: text },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 131072, maxTokens: 32768, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    docs: 'https://docs.together.ai/docs/serverless-models',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    env: 'TOGETHER_API_KEY',
    baseURL: 'https://api.together.xyz/v1',
    api: 'openai-completions',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.1', name: 'DeepSeek V3.1', contextWindow: 131072, maxTokens: 32768, input: text },
      { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', name: 'Qwen3 Coder 480B', contextWindow: 262144, maxTokens: 32768, input: text },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    docs: 'https://fireworks.ai/models',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    env: 'FIREWORKS_API_KEY',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    api: 'openai-completions',
    models: [
      { id: 'accounts/fireworks/models/deepseek-v3p1', name: 'DeepSeek V3.1', contextWindow: 163840, maxTokens: 32768, input: text },
      { id: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct', name: 'Qwen3 Coder 480B', contextWindow: 262144, maxTokens: 16384, input: text },
    ],
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    docs: 'https://deepinfra.com/models',
    keyUrl: 'https://deepinfra.com/dash/api_keys',
    env: 'DEEPINFRA_API_KEY',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    api: 'openai-completions',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.1', name: 'DeepSeek V3.1', contextWindow: 163840, maxTokens: 32768, input: text },
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', name: 'Llama 4 Maverick', contextWindow: 1048576, maxTokens: 32768, input: textImage },
    ],
  },
  {
    id: 'novita',
    name: 'Novita AI',
    docs: 'https://novita.ai/model-api/product/llm-api',
    keyUrl: 'https://novita.ai/settings/key-management',
    env: 'NOVITA_API_KEY',
    baseURL: 'https://api.novita.ai/v3/openai',
    api: 'openai-completions',
    models: [
      { id: 'deepseek/deepseek-v3.1', name: 'DeepSeek V3.1', contextWindow: 131072, maxTokens: 32768, input: text },
      { id: 'qwen/qwen3-coder-480b-a35b-instruct', name: 'Qwen3 Coder 480B', contextWindow: 262144, maxTokens: 32768, input: text },
    ],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    docs: 'https://docs.siliconflow.cn/cn/userguide/introduction',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    env: 'SILICONFLOW_API_KEY',
    baseURL: 'https://api.siliconflow.cn/v1',
    api: 'openai-completions',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.2-Exp', name: 'DeepSeek V3.2', contextWindow: 163840, maxTokens: 65536, input: text, reasoningEfforts: LOW_HIGH },
      { id: 'Qwen/Qwen3-235B-A22B-Thinking-2507', name: 'Qwen3 235B Thinking', contextWindow: 262144, maxTokens: 65536, input: text },
      { id: 'zai-org/GLM-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 128000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'moonshot',
    nativeIds: ['moonshotai-cn'],
    name: '月之暗面 Kimi（国内）',
    docs: 'https://platform.moonshot.cn/docs',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    env: 'MOONSHOT_API_KEY',
    baseURL: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    models: [
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', contextWindow: 262144, maxTokens: 65536, input: text, reasoningEfforts: LOW_HIGH },
      { id: 'kimi-latest', name: 'Kimi Latest', contextWindow: 262144, maxTokens: 32768, input: textImage },
    ],
  },
  {
    id: 'moonshot-global',
    nativeIds: ['moonshotai'],
    name: 'Moonshot Kimi（国际）',
    docs: 'https://platform.moonshot.ai/docs',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    env: 'MOONSHOT_GLOBAL_API_KEY',
    baseURL: 'https://api.moonshot.ai/v1',
    api: 'openai-completions',
    models: [
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', contextWindow: 262144, maxTokens: 65536, input: text, reasoningEfforts: LOW_HIGH },
      { id: 'kimi-latest', name: 'Kimi Latest', contextWindow: 262144, maxTokens: 32768, input: textImage },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM（国内）',
    docs: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-4.6',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    env: 'ZHIPU_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 128000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextWindow: 131072, maxTokens: 98304, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'zai',
    name: 'Z.ai GLM（国际）',
    docs: 'https://docs.z.ai/guides/llm/glm-4.6',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    env: 'ZAI_API_KEY',
    baseURL: 'https://api.z.ai/api/paas/v4',
    api: 'openai-completions',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 128000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextWindow: 131072, maxTokens: 98304, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    docs: 'https://platform.minimaxi.com/document/guides/chat-model/V2',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    env: 'MINIMAX_API_KEY',
    baseURL: 'https://api.minimaxi.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'MiniMax-M2', name: 'MiniMax M2', contextWindow: 204800, maxTokens: 131072, input: text },
      { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 1000192, maxTokens: 131072, input: text },
    ],
  },
  {
    id: 'dashscope',
    name: '阿里云百炼 Qwen',
    docs: 'https://help.aliyun.com/zh/model-studio/models',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    env: 'DASHSCOPE_API_KEY',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 65536, input: text },
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: 1048576, maxTokens: 65536, input: text },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 1000000, maxTokens: 32768, input: text },
    ],
  },
  {
    id: 'qianfan',
    name: '百度千帆（文心）',
    docs: 'https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb',
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    env: 'QIANFAN_API_KEY',
    baseURL: 'https://qianfan.baidubce.com/v2',
    api: 'openai-completions',
    models: [
      { id: 'ernie-5.0', name: '文心 5.0', contextWindow: 131072, maxTokens: 32768, input: text },
      { id: 'ernie-x1.1', name: '文心 X1.1', contextWindow: 65536, maxTokens: 16384, input: text },
    ],
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    docs: 'https://cloud.tencent.com/document/product/1729/111007',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    env: 'HUNYUAN_API_KEY',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'hunyuan-turbos-latest', name: '混元 TurboS', contextWindow: 131072, maxTokens: 16384, input: text },
      { id: 'hunyuan-t1-latest', name: '混元 T1', contextWindow: 65536, maxTokens: 16384, input: text },
    ],
  },
  {
    id: 'ark',
    name: '火山方舟（豆包）',
    docs: 'https://www.volcengine.com/docs/82379/1330310',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    env: 'ARK_API_KEY',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    api: 'openai-completions',
    models: [
      { id: 'doubao-seed-1-6-250615', name: '豆包 Seed 1.6', contextWindow: 262144, maxTokens: 32768, input: textImage },
      { id: 'doubao-seed-1-6-thinking-250715', name: '豆包 Seed 1.6 Thinking', contextWindow: 262144, maxTokens: 32768, input: textImage },
    ],
  },
  {
    // DSH's built-in catalog ships `stepfun` pointed at the pay-as-you-go
    // endpoint (api.stepfun.com/v1); Step Plan subscribers need the step_plan
    // route instead, which no native entry provides.
    id: 'stepfun-step-plan',
    name: 'StepFun Step Plan（国内）',
    docs: 'https://platform.stepfun.com/docs/zh/step-plan/quick-start',
    keyUrl: 'https://platform.stepfun.com/account-overview',
    env: 'STEPFUN_API_KEY',
    baseURL: 'https://api.stepfun.com/step_plan/v1',
    api: 'openai-completions',
    models: [
      { id: 'step-5-preview', name: 'Step 5 Preview', contextWindow: 1024000, maxTokens: 65536, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 256000, maxTokens: 256000, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 256000, maxTokens: 256000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 256000, maxTokens: 256000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
  {
    id: 'stepfun-step-plan-global',
    name: 'StepFun Step Plan（国际）',
    docs: 'https://platform.stepfun.ai/docs/en/step-plan/quick-start',
    keyUrl: 'https://platform.stepfun.ai/account-overview',
    env: 'STEPFUN_GLOBAL_API_KEY',
    baseURL: 'https://api.stepfun.ai/step_plan/v1',
    api: 'openai-completions',
    models: [
      { id: 'step-5-preview', name: 'Step 5 Preview', contextWindow: 1024000, maxTokens: 65536, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextWindow: 256000, maxTokens: 256000, input: textImage, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 256000, maxTokens: 256000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
      { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 256000, maxTokens: 256000, input: text, reasoningEfforts: LOW_MEDIUM_HIGH },
    ],
  },
]

/** Look one preset up by id. */
export function findPreset(id) {
  return PRESETS.find((preset) => preset.id === id)
}

/** The credential reference for a custom (preset-less) route. */
export function customEnvName(route) {
  const slug = String(route ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${slug || 'CUSTOM'}_API_KEY`
}
