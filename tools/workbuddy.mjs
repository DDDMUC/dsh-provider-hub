#!/usr/bin/env node
// dsh-provider-hub - WorkBuddy installer.
//
// Writes provider presets and custom OpenAI-compatible endpoints into Tencent
// WorkBuddy's local custom-model file (`~/.workbuddy/models.json`), so a
// WorkBuddy user can use the same curated catalog the DSH plugin serves.
// The file is plain JSON; entries are validated with the same rules the app
// applies, then the file is replaced atomically. WorkBuddy reads it at startup
// -- restart the app after a change.
//
// Usage:
//   node tools/workbuddy.mjs list
//   node tools/workbuddy.mjs add <presetId> --key <key> [--models a,b]
//   node tools/workbuddy.mjs add <presetId> --key-env STEPFUN_API_KEY
//   node tools/workbuddy.mjs add <presetId> --key-from-dsh STEPFUN_API_KEY
//   node tools/workbuddy.mjs add-all [--prune]            # 全部预设；--prune 同时清掉目录里已不存在的旧条目
//   node tools/workbuddy.mjs remove <presetId>
//   node tools/workbuddy.mjs add-custom --model <id> --url <base> --key <key> [--name <display>]
//                                      [--no-tools] [--no-vision] [--no-reasoning]
//
// Global: --file <path> overrides the models.json location (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { PRESETS, findPreset } from '../core/providers.js'
import {
  baseUrlError,
  buildWorkbuddyEntries,
  installedPresets,
  isValidWorkbuddyEntry,
  removeWorkbuddyModels,
  upsertWorkbuddyModels,
} from '../core/adapters/workbuddy.js'

const DEFAULT_FILE = path.join(os.homedir(), '.workbuddy', 'models.json')
const DSH_CREDENTIALS = path.join(os.homedir(), '.dsh', '.credentials.yaml')

// --- args --------------------------------------------------------------------

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
    if (next === undefined || next.startsWith('--')) {
      args.flags[name] = true
    } else {
      args.flags[name] = next
      i += 1
    }
  }
  return args
}

// --- file io -----------------------------------------------------------------

function readModels(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  if (raw.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON：${String((error && error.message) || error)}`)
  }
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.models)) return parsed.models
  throw new Error(`${file} 既不是数组也没有 models 数组`)
}

function writeModels(file, models) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(models, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function dshCredential(ref) {
  let raw
  try {
    raw = fs.readFileSync(DSH_CREDENTIALS, 'utf8')
  } catch {
    return undefined
  }
  const match = raw.match(new RegExp(`^\\s+${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\S+)\\s*$`, 'm'))
  return match ? match[1] : undefined
}

// --- helpers -----------------------------------------------------------------

function workbuddyRunning() {
  try {
    execFileSync('pgrep', ['-x', 'Electron'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function resolveKey(flags, envName) {
  if (typeof flags.key === 'string') return flags.key.trim()
  if (typeof flags['key-env'] === 'string') {
    const value = process.env[flags['key-env']]
    if (!value) throw new Error(`环境变量 ${flags['key-env']} 为空`)
    return value.trim()
  }
  if (typeof flags['key-from-dsh'] === 'string') {
    const value = dshCredential(flags['key-from-dsh'])
    if (!value) throw new Error(`DSH 凭据里没有 ${flags['key-from-dsh']}`)
    return value.trim()
  }
  throw new Error('缺少 Key：用 --key <key>、--key-env <NAME> 或 --key-from-dsh <REF>')
}

function report(file, models, extra) {
  const summary = { file, entries: models.length, ...extra }
  console.log(JSON.stringify(summary, null, 2))
  if (workbuddyRunning()) {
    console.log('\n注意：WorkBuddy 正在运行，重启应用后才会读取新的 models.json。')
  }
}

// --- commands ----------------------------------------------------------------

function commandList(file) {
  const models = readModels(file)
  const installed = installedPresets(models, PRESETS)
  console.log(`WorkBuddy models.json: ${file}`)
  console.log(`现有条目：${models.length}\n`)
  console.log('预设（"已装" 表示 models.json 里已有该端点的条目）：')
  for (const preset of PRESETS) {
    const count = installed.get(preset.id)
    const mark = count === undefined ? ' ' : '已装'
    console.log(`  ${mark} ${preset.id.padEnd(28)} ${preset.name}  (${preset.models.length} 个模型)`)
  }
  const foreign = models.filter((entry) => !PRESETS.some((preset) => preset.baseURL === entry.url))
  if (foreign.length > 0) {
    console.log('\n其它条目（不由任何预设管理）：')
    for (const entry of foreign) console.log(`  ${entry.id}  ${entry.url ?? ''}`)
  }
}

function commandAdd(file, args) {
  const presetId = args._[1]
  const preset = findPreset(presetId)
  if (!preset) throw new Error(`未知预设：${presetId}（用 list 查看可用项）`)
  const key = resolveKey(args.flags, preset.env)
  const modelIds = typeof args.flags.models === 'string' ? args.flags.models.split(',').map((id) => id.trim()).filter(Boolean) : undefined
  const entries = buildWorkbuddyEntries(preset, { key, modelIds })
  if (entries.length === 0) throw new Error('没有匹配的模型')
  const { models, added, updated } = upsertWorkbuddyModels(readModels(file), entries)
  writeModels(file, models)
  report(file, models, { preset: preset.id, added, updated })
}

/** Drop preset-owned entries whose model id left the catalog (stale ids). */
function pruneStaleModels(models) {
  let current = models
  let pruned = 0
  for (const preset of PRESETS) {
    const ids = new Set(preset.models.map((model) => model.id))
    const before = current.length
    current = current.filter((entry) => entry?.url !== preset.baseURL || ids.has(entry.id))
    pruned += before - current.length
  }
  return { models: current, pruned }
}

function commandAddAll(file, args) {
  const models = readModels(file)
  let current = models
  let added = 0
  let updated = 0
  for (const preset of PRESETS) {
    const entries = buildWorkbuddyEntries(preset, {})
    const result = upsertWorkbuddyModels(current, entries)
    current = result.models
    added += result.added
    updated += result.updated
  }
  let pruned = 0
  if (args.flags.prune === true) {
    const result = pruneStaleModels(current)
    current = result.models
    pruned = result.pruned
  }
  writeModels(file, current)
  const keyless = current.filter((entry) => !entry.apiKey).length
  report(file, current, { presets: PRESETS.length, added, updated, pruned, keyless })
  if (keyless > 0) {
    console.log(`\n有 ${keyless} 个模型还没填 API Key：在 WorkBuddy 的模型管理里编辑，或跑 add <presetId> --key <key> 单独补。`)
    console.log('已有 Key 的条目不会被覆盖（合并时保留原 apiKey）。')
  }
}

function commandRemove(file, args) {
  const presetId = args._[1]
  const preset = findPreset(presetId)
  if (!preset) throw new Error(`未知预设：${presetId}（用 list 查看可用项）`)
  const { models, removed } = removeWorkbuddyModels(readModels(file), preset)
  if (removed === 0) throw new Error(`models.json 里没有 ${preset.baseURL} 的条目`)
  writeModels(file, models)
  report(file, models, { preset: preset.id, removed })
}

function commandAddCustom(file, args) {
  const flags = args.flags
  const modelId = typeof flags.model === 'string' ? flags.model.trim() : ''
  if (modelId === '') throw new Error('缺少 --model <模型 ID>')
  const url = typeof flags.url === 'string' ? flags.url.trim() : ''
  const urlError = baseUrlError(url)
  if (urlError) throw new Error(urlError)
  const key = resolveKey(flags, undefined)
  const entry = {
    id: modelId,
    name: typeof flags.name === 'string' && flags.name.trim() !== '' ? flags.name.trim() : modelId,
    url,
    apiKey: key,
    supportsToolCall: flags['no-tools'] !== true,
    supportsImages: flags['no-vision'] !== true,
    supportsReasoning: flags['no-reasoning'] !== true,
    useCustomProtocol: flags['full-url'] === true,
  }
  if (!isValidWorkbuddyEntry(entry)) throw new Error('生成的条目未通过 WorkBuddy 校验')
  const { models, added, updated } = upsertWorkbuddyModels(readModels(file), [entry])
  writeModels(file, models)
  report(file, models, { custom: modelId, added, updated })
}

// --- main --------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const file = typeof args.flags.file === 'string' ? args.flags.file : DEFAULT_FILE
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
