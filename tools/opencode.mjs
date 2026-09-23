#!/usr/bin/env node
// dsh-provider-hub - OpenCode installer.
//
// Writes provider presets into OpenCode's config
// (`~/.config/opencode/opencode.json` or `.jsonc`), so an OpenCode user can
// use the same curated catalog the DSH plugin and the WorkBuddy CLI serve.
//
// Keys go to the provider's `options.apiKey` (the same place the existing
// custom providers use); models carry the metadata OpenCode renders
// (name / limit / reasoning / tool_call / attachment). Routes OpenCode does
// not ship in its models.dev catalog get the right npm SDK automatically,
// decided from the local models.dev cache (`~/.cache/opencode/models.json`).
//
// Usage:
//   node tools/opencode.mjs list
//   node tools/opencode.mjs add <presetId> --key <key> [--models a,b]
//   node tools/opencode.mjs add <presetId> --key-from-dsh STEPFUN_API_KEY
//   node tools/opencode.mjs add-all [--prune]
//   node tools/opencode.mjs remove <presetId>
//   node tools/opencode.mjs add-custom --model <id> --url <base> --key <key> [--name <display>]
//
// Global: --file <path> overrides the config location (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  buildOpencodeProvider,
  installedPresets,
  mergeOpencodeConfig,
  pruneOpencodeConfig,
  providerError,
  removeOpencodeProvider,
} from '../core/adapters/opencode.js'

const HOME = os.homedir()
const CONFIG_DIR = path.join(HOME, '.config', 'opencode')
const CANDIDATES = [path.join(CONFIG_DIR, 'opencode.jsonc'), path.join(CONFIG_DIR, 'opencode.json')]
const MODELS_DEV_CACHE = path.join(HOME, '.cache', 'opencode', 'models.json')
const DSH_CREDENTIALS = path.join(HOME, '.dsh', '.credentials.yaml')

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

function resolveKey(flags) {
  if (typeof flags.key === 'string') return flags.key.trim()
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
  throw new Error('缺少 Key：用 --key <key>、--key-env <NAME> 或 --key-from-dsh <REF>')
}

function report(file, config, extra) {
  const providers = Object.keys(config.provider ?? {})
  console.log(JSON.stringify({ file, providers: providers.length, ...extra }, null, 2))
  console.log('\n注意：OpenCode 在启动时读取配置，改完重启应用（或重新运行 CLI）后生效。')
}

// --- commands ---

function commandList(file) {
  const { config } = readConfig(file)
  const installed = installedPresets(config, PRESETS)
  console.log(`OpenCode 配置: ${file}`)
  console.log(`现有 provider: ${Object.keys(config.provider ?? {}).length}\n`)
  for (const preset of PRESETS) {
    const count = installed.get(preset.id)
    console.log(`  ${count === undefined ? ' ' : '已装'} ${preset.id.padEnd(28)} ${preset.name}  (${preset.models.length} 个模型)`)
  }
  const foreign = Object.keys(config.provider ?? {}).filter((route) => !PRESETS.some((preset) => preset.id === route))
  if (foreign.length) console.log('\n其它 provider（不由本工具管理）:', foreign.join(', '))
}

function commandAdd(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}（用 list 查看可用项）`)
  const key = resolveKey(args.flags)
  const modelIds = typeof args.flags.models === 'string' ? args.flags.models.split(',').map((id) => id.trim()).filter(Boolean) : undefined
  const known = modelsDevKnown()
  const entry = buildOpencodeProvider(preset, { key, modelIds, npm: npmFor(preset, known) })
  const error = providerError(entry[preset.id])
  if (error) throw new Error(error)
  const { config } = readConfig(file)
  const next = mergeOpencodeConfig(config, entry)
  writeConfig(file, next)
  report(file, next, { preset: preset.id, models: Object.keys(entry[preset.id].models).length })
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
  const keyless = PRESETS.filter((preset) => {
    const provider = next.provider?.[preset.id]
    return provider && !(typeof provider.options?.apiKey === 'string' && provider.options.apiKey !== '')
  }).length
  report(file, next, { presets: PRESETS.length, models: total, pruned, providersWithoutKey: keyless })
  if (keyless > 0) console.log(`\n有 ${keyless} 个 provider 还没填 API Key：跑 add <presetId> --key <key> 单独补（已有 Key 的不受影响）。`)
}

function commandRemove(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}`)
  const { config } = readConfig(file)
  if (!config.provider?.[preset.id]) throw new Error(`配置里没有 ${preset.id}`)
  const next = removeOpencodeProvider(config, preset.id)
  writeConfig(file, next)
  report(file, next, { removed: preset.id })
}

function commandAddCustom(file, args) {
  const flags = args.flags
  const modelId = typeof flags.model === 'string' ? flags.model.trim() : ''
  if (modelId === '') throw new Error('缺少 --model <模型 ID>')
  const baseURL = typeof flags.url === 'string' ? flags.url.trim() : ''
  const route = typeof flags.route === 'string' && flags.route.trim() !== '' ? flags.route.trim() : modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 32)
  const protocol = typeof flags.protocol === 'string' ? flags.protocol : 'openai-completions'
  const key = resolveKey(flags)
  const preset = {
    id: route,
    name: typeof flags.name === 'string' && flags.name.trim() !== '' ? flags.name.trim() : route,
    baseURL,
    api: protocol,
    models: [{ id: modelId, name: typeof flags['model-name'] === 'string' && flags['model-name'].trim() !== '' ? flags['model-name'].trim() : modelId, input: flags['no-vision'] === true ? ['text'] : ['text', 'image'] }],
  }
  const entry = buildOpencodeProvider(preset, {
    key,
    npm: NPM_BY_PROTOCOL[protocol],
    reasoning: flags.reasoning === true ? true : flags['no-reasoning'] === true ? false : undefined,
  })
  const error = providerError(entry[route])
  if (error) throw new Error(error)
  const { config } = readConfig(file)
  const next = mergeOpencodeConfig(config, entry)
  writeConfig(file, next)
  report(file, next, { custom: route, model: modelId })
}

// --- main ---

function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = resolveConfigPath(args.flags.file)
  const command = args._[0]
  try {
    if (command === 'list' || command === undefined) commandList(file)
    else if (command === 'add') commandAdd(file, args)
    else if (command === 'add-all') commandAddAll(file, args)
    else if (command === 'remove') commandRemove(file, args)
    else if (command === 'add-custom') commandAddCustom(file, args)
    else throw new Error(`未知命令：${command}（list / add / add-all / remove / add-custom）`)
  } catch (error) {
    console.error(`错误：${String((error && error.message) || error)}`)
    process.exitCode = 1
  }
}

main()
