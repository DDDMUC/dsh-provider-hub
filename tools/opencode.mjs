#!/usr/bin/env node
// dsh-provider-hub - OpenCode installer.
//
// Writes provider presets into OpenCode's config
// (`~/.config/opencode/opencode.json` or `.jsonc`), so an OpenCode user can
// use the same curated catalog the DSH plugin and the WorkBuddy CLI serve.
//
// Definitions go to the config (npm SDK / base URL / model list / limits /
// vision). Keys NEVER go into the config by default: they land in OpenCode's
// own auth store (`~/.local/share/opencode/auth.json`) - the same file the
// in-app 连接提供商 / `/connect` flow writes - so every provider behaves like
// a natively supported one and its key stays manageable (and revocable) from
// the app. Without `--key` the tool just tells you which provider id to enter
// in 连接提供商 → 自定义 OpenAI 兼容提供商.
//
// Usage:
//   node tools/opencode.mjs list
//   node tools/opencode.mjs add <presetId> [--models a,b]
//   node tools/opencode.mjs add <presetId> --key <key>
//   node tools/opencode.mjs add <presetId> --key-env ARK_API_KEY
//   node tools/opencode.mjs add <presetId> --key-from-dsh COMMANDCODE_API_KEY
//   node tools/opencode.mjs add-all [--prune]
//   node tools/opencode.mjs migrate-key            # 把配置里残留的 Key 搬进 auth.json
//   node tools/opencode.mjs remove <presetId> [--purge-key]
//   node tools/opencode.mjs add-custom --model <id> --url <base> [--key <key>] [--name <display>]
//
// Global: --file <path> overrides the config location, --auth <path> the auth
// store (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  authEntryError,
  authRoutes,
  buildAuthEntry,
  buildOpencodeProvider,
  configKeys,
  installedPresets,
  mergeAuth,
  mergeOpencodeConfig,
  pruneOpencodeConfig,
  providerError,
  removeAuth,
  removeOpencodeProvider,
  stripConfigKeys,
} from '../core/adapters/opencode.js'

const HOME = os.homedir()
const CONFIG_DIR = path.join(HOME, '.config', 'opencode')
const CANDIDATES = [path.join(CONFIG_DIR, 'opencode.jsonc'), path.join(CONFIG_DIR, 'opencode.json')]
const MODELS_DEV_CACHE = path.join(HOME, '.cache', 'opencode', 'models.json')
const DSH_CREDENTIALS = path.join(HOME, '.dsh', '.credentials.yaml')
const DATA_DIR = process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode') : path.join(HOME, '.local', 'share', 'opencode')

const NPM_BY_PROTOCOL = {
  'openai-completions': '@ai-sdk/openai-compatible',
  'openai-responses': '@ai-sdk/openai',
  'anthropic-messages': '@ai-sdk/anthropic',
}

// --- args ---

function parseArgs(argv) {
  const args = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const name = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args.flags[name] = true
    else {
      args.flags[name] = next
      i += 1
    }
  }
  return args
}

// --- config io (JSONC tolerant) ---

function resolveConfigPath(override) {
  if (typeof override === 'string') return override
  for (const candidate of CANDIDATES) if (fs.existsSync(candidate)) return candidate
  return CANDIDATES[1]
}

function stripJsonc(text) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (char === '\n') {
        inLine = false
        out += char
      }
      continue
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false
        i += 1
      }
      continue
    }
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      inLine = true
      i += 1
      continue
    }
    if (char === '/' && next === '*') {
      inBlock = true
      i += 1
      continue
    }
    out += char
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function readConfig(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { config: {}, existed: false, comments: false }
    throw error
  }
  const comments = /^\s*\/\//m.test(raw) || /\/\*/.test(raw)
  const text = stripJsonc(raw)
  let parsed
  try {
    parsed = text.trim() === '' ? {} : JSON.parse(text)
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON(C)：${String((error && error.message) || error)}`)
  }
  return { config: parsed, existed: true, comments }
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file) && !fs.existsSync(`${file}.orig-backup`)) fs.copyFileSync(file, `${file}.orig-backup`)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

// --- auth store io (same file the in-app /connect flow writes) ---

function readAuth(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    if (error && error.code === 'ENOENT') return {}
    throw error
  }
}

function writeAuth(file, auth) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file) && !fs.existsSync(`${file}.orig-backup`)) fs.copyFileSync(file, `${file}.orig-backup`)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(auth, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

// --- helpers ---

function modelsDevKnown() {
  try {
    const cache = JSON.parse(fs.readFileSync(MODELS_DEV_CACHE, 'utf8'))
    return new Set(Object.keys(cache))
  } catch {
    return new Set()
  }
}

function npmFor(preset, known) {
  if (known.has(preset.id)) return undefined
  return NPM_BY_PROTOCOL[preset.api]
}

function optionalKey(flags) {
  if (typeof flags.key === 'string' && flags.key.trim() !== '') return flags.key.trim()
  if (typeof flags['key-env'] === 'string') {
    const value = process.env[flags['key-env']]
    if (!value) throw new Error(`环境变量 ${flags['key-env']} 为空`)
    return value.trim()
  }
  if (typeof flags['key-from-dsh'] === 'string') {
    const raw = fs.readFileSync(DSH_CREDENTIALS, 'utf8')
    const match = raw.match(new RegExp(`^\\s+${flags['key-from-dsh'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\S+)\\s*$`, 'm'))
    if (!match) throw new Error(`DSH 凭据里没有 ${flags['key-from-dsh']}`)
    return match[1]
  }
  return undefined
}

/** How the user connects a key from inside the app (no terminal needed). */
function printConnectHint(route) {
  console.log(`\n在 OpenCode 里填 Key（应用内完成，无需命令）：
  管理模型 → + 连接提供商 → 自定义 OpenAI 兼容提供商
  Provider ID 输入: ${route}
  然后粘贴 Key —— 存进 OpenCode 自己的 auth.json，之后可在连接提供商里查看/断开`)
}

function report(file, config, extra) {
  const providers = Object.keys(config.provider ?? {})
  console.log(JSON.stringify({ file, providers: providers.length, ...extra }, null, 2))
  console.log('\n注意：OpenCode 在启动时读取配置，改完重启应用（或重新运行 CLI）后生效。')
}

// --- commands ---

function commandList(file, args) {
  const { config } = readConfig(file)
  const installed = installedPresets(config, PRESETS)
  const connected = authRoutes(readAuth(authFile(args)))
  console.log(`OpenCode 配置: ${file}`)
  console.log(`现有 provider: ${Object.keys(config.provider ?? {}).length}\n`)
  for (const preset of PRESETS) {
    const count = installed.get(preset.id)
    const mark = count === undefined ? ' ' : '已装'
    const key = count === undefined ? '' : connected.has(preset.id) ? 'Key: 已连接' : inlineKey(config, preset.id) ? 'Key: 配置文件残留（跑 migrate-key）' : 'Key: 未连接'
    console.log(`  ${mark} ${preset.id.padEnd(28)} ${preset.name}  (${preset.models.length} 个模型)  ${key}`)
  }
  const foreign = Object.keys(config.provider ?? {}).filter((route) => !PRESETS.some((preset) => preset.id === route))
  if (foreign.length) console.log('\n其它 provider（不由本工具管理）:', foreign.join(', '))
}

function inlineKey(config, route) {
  const key = config?.provider?.[route]?.options?.apiKey
  return typeof key === 'string' && key.trim() !== ''
}

function authFile(args) {
  return typeof args.flags.auth === 'string' ? args.flags.auth : path.join(DATA_DIR, 'auth.json')
}

function commandAdd(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}（用 list 查看可用项）`)
  const key = optionalKey(args.flags)
  const legacy = args.flags['key-in-config'] === true
  if (legacy && key === undefined) throw new Error('--key-in-config 需要同时给 --key')
  const modelIds = typeof args.flags.models === 'string' ? args.flags.models.split(',').map((id) => id.trim()).filter(Boolean) : undefined
  const known = modelsDevKnown()
  const entry = buildOpencodeProvider(preset, { key, modelIds, npm: npmFor(preset, known), keyInConfig: legacy })
  const error = providerError(entry[preset.id])
  if (error) throw new Error(error)
  const { config } = readConfig(file)
  const next = mergeOpencodeConfig(config, entry)
  writeConfig(file, next)
  const authPath = authFile(args)
  let keyWhere = null
  if (key !== undefined) {
    const merged = mergeAuth(readAuth(authPath), buildAuthEntry(preset.id, key))
    const error2 = authEntryError(preset.id, merged[preset.id])
    if (error2) throw new Error(error2)
    writeAuth(authPath, merged)
    keyWhere = legacy ? '配置文件（--key-in-config 旧模式）' : `auth.json（${authPath}，可在 OpenCode 连接提供商里管理）`
  }
  report(file, next, { preset: preset.id, models: Object.keys(entry[preset.id].models).length, key: keyWhere ?? '未提供（在应用里填）' })
  if (keyWhere === null) printConnectHint(preset.id)
}

function commandAddAll(file, args) {
  const known = modelsDevKnown()
  const { config } = readConfig(file)
  let next = config
  let total = 0
  for (const preset of PRESETS) {
    const entry = buildOpencodeProvider(preset, { npm: npmFor(preset, known) })
    next = mergeOpencodeConfig(next, entry)
    total += Object.keys(entry[preset.id].models).length
  }
  let pruned = 0
  if (args.flags.prune === true) {
    const result = pruneOpencodeConfig(next, PRESETS)
    next = result.config
    pruned = result.pruned
  }
  writeConfig(file, next)
  const connected = authRoutes(readAuth(authFile(args)))
  const unconnected = PRESETS.filter((preset) => next.provider?.[preset.id] && !connected.has(preset.id) && !inlineKey(next, preset.id)).length
  report(file, next, { presets: PRESETS.length, models: total, pruned, providersWithoutKey: unconnected })
  if (unconnected > 0) {
    console.log(`\n有 ${unconnected} 个 provider 还没连 Key。两种补法：
  1. 应用内（推荐）：连接提供商 → 自定义 OpenAI 兼容提供商 → 输入 provider ID（见 list 输出）
  2. 命令行：provider-hub-opencode add <presetId> --key <key>`)
  }
}

function commandMigrateKey(file, args) {
  const { config } = readConfig(file)
  const routes = Object.keys(config.provider ?? {}).filter((route) => inlineKey(config, route))
  if (routes.length === 0) {
    console.log('配置里没有残留的 Key，无需迁移。')
    return
  }
  const keys = configKeys(config, routes)
  const authPath = authFile(args)
  let auth = readAuth(authPath)
  for (const [route, key] of Object.entries(keys)) {
    auth = mergeAuth(auth, buildAuthEntry(route, key))
    const error = authEntryError(route, auth[route])
    if (error) throw new Error(error)
  }
  const next = stripConfigKeys(config, routes)
  writeAuth(authPath, auth)
  writeConfig(file, next)
  console.log(JSON.stringify({ file, auth: authPath, migrated: Object.keys(keys), remainingInline: Object.keys(configKeys(next, Object.keys(next.provider ?? {}))).length }, null, 2))
  console.log('\n这些 Key 现在存在 OpenCode 自己的 auth.json 里，配置文件中不再有明文 Key。')
}

function commandRemove(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}`)
  const { config } = readConfig(file)
  if (!config.provider?.[preset.id]) throw new Error(`配置里没有 ${preset.id}`)
  let next = removeOpencodeProvider(config, preset.id)
  const authPath = authFile(args)
  if (args.flags['purge-key'] === true) {
    const auth = removeAuth(readAuth(authPath), preset.id)
    writeAuth(authPath, auth)
  }
  writeConfig(file, next)
  report(file, next, { removed: preset.id, keyPurged: args.flags['purge-key'] === true })
  if (args.flags['purge-key'] !== true) console.log(`\nauth.json 里的 Key 保留着；要一并删掉加 --purge-key。`)
}

function commandAddCustom(file, args) {
  const flags = args.flags
  const modelId = typeof flags.model === 'string' ? flags.model.trim() : ''
  if (modelId === '') throw new Error('缺少 --model <模型 ID>')
  const baseURL = typeof flags.url === 'string' ? flags.url.trim() : ''
  const route = typeof flags.route === 'string' && flags.route.trim() !== '' ? flags.route.trim() : modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 32)
  const protocol = typeof flags.protocol === 'string' ? flags.protocol : 'openai-completions'
  const key = optionalKey(flags)
  const legacy = flags['key-in-config'] === true
  const preset = {
    id: route,
    name: typeof flags.name === 'string' && flags.name.trim() !== '' ? flags.name.trim() : route,
    baseURL,
    api: protocol,
    models: [{ id: modelId, name: typeof flags['model-name'] === 'string' && flags['model-name'].trim() !== '' ? flags['model-name'].trim() : modelId, input: flags['no-vision'] === true ? ['text'] : ['text', 'image'] }],
  }
  const entry = buildOpencodeProvider(preset, {
    key,
    keyInConfig: legacy,
    npm: NPM_BY_PROTOCOL[protocol],
    reasoning: flags.reasoning === true ? true : flags['no-reasoning'] === true ? false : undefined,
  })
  const error = providerError(entry[route])
  if (error) throw new Error(error)
  const { config } = readConfig(file)
  const next = mergeOpencodeConfig(config, entry)
  writeConfig(file, next)
  const authPath = authFile(args)
  let keyWhere = null
  if (key !== undefined) {
    const merged = mergeAuth(readAuth(authPath), buildAuthEntry(route, key))
    writeAuth(authPath, merged)
    keyWhere = legacy ? '配置文件（--key-in-config 旧模式）' : `auth.json（${authPath}）`
  }
  report(file, next, { custom: route, model: modelId, key: keyWhere ?? '未提供（在应用里填）' })
  if (keyWhere === null) printConnectHint(route)
}

// --- main ---

function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = resolveConfigPath(args.flags.file)
  const command = args._[0]
  try {
    if (command === 'list' || command === undefined) commandList(file, args)
    else if (command === 'add') commandAdd(file, args)
    else if (command === 'add-all') commandAddAll(file, args)
    else if (command === 'migrate-key') commandMigrateKey(file, args)
    else if (command === 'remove') commandRemove(file, args)
    else if (command === 'add-custom') commandAddCustom(file, args)
    else throw new Error(`未知命令：${command}（list / add / add-all / migrate-key / remove / add-custom）`)
  } catch (error) {
    console.error(`错误：${String((error && error.message) || error)}`)
    process.exitCode = 1
  }
}

main()
