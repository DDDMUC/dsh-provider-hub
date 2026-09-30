// dsh-provider-hub - per-app native provider id lists.
//
// Coverage inputs for the CLIs: the OpenCode adapter reads ids from the local
// models.dev cache at runtime (they drift weekly), while the WorkBuddy list is
// bundled because it was transcribed from the app's own catalog
// (app.asar, v5.6.2) and the app is the only source of truth for it.
// Keep in sync with tools/refresh-catalog.mjs when the app ships new plans.

/** Provider ids Tencent WorkBuddy offers natively in its model catalog. */
export const WORKBUDDY_NATIVE_IDS = [
 "amazon-bedrock",
 "ant-ling",
 "anthropic",
 "azure-openai-responses",
 "baseten",
 "cerebras",
 "cloudflare-ai-gateway",
 "cloudflare-workers-ai",
 "deepseek",
 "fireworks",
 "github-copilot",
 "google",
 "google-vertex",
 "groq",
 "huggingface",
 "kimi-coding",
 "minimax",
 "minimax-cn",
 "mistral",
 "moonshotai",
 "moonshotai-cn",
 "nvidia",
 "openai",
 "openai-codex",
 "opencode",
 "opencode-go",
 "openrouter",
 "qwen-token-plan",
 "qwen-token-plan-cn",
 "qwen-token-plan-individual",
 "together",
 "vercel-ai-gateway",
 "xai",
 "xiaomi",
 "xiaomi-token-plan-ams",
 "xiaomi-token-plan-cn",
 "xiaomi-token-plan-sgp",
 "zai",
 "zai-coding-cn"
]
