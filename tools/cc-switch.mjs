#!/usr/bin/env node
// dsh-provider-hub - cc-switch installer.
//
// Writes provider presets into cc-switch's own config
// (`~/.cc-switch/config.json`, plain JSON, `{version:2, <app>:{providers,current}}`),
// so the curated catalog shows up inside cc-switch's UI next to its own presets.
// cc-switch manages Claude Code / Codex / Gemini CLI / OpenCode / OpenClaw /
// Claude Desktop; we write every section whose protocol the preset speaks
// (opencode + codex + openclaw for OpenAI-compatible routes, claude for
// Anthropic routes, gemini for Google endpoints), or just the ones --app names.
//
// Keys go into cc-switch's config (its own store - it writes the live app
// config when the user switches), NOT into OpenCode's auth.json. `current` is
// never touched.
//
// Usage:
//   node tools/cc-switch.mjs list
//   node tools/cc-switch.mjs add <presetId> [--app opencode,codex] [--models a,b]
//   node tools/cc-switch.mjs add <presetId> --key <key>
//   node tools/cc-switch.mjs add <presetId> --key-env ARK_API_KEY
//   node tools/cc-switch.mjs add <presetId> --key-from-dsh COMMANDCODE_API_KEY
//   node tools/cc-switch.mjs add-all [--app ...] [--prune]
//   node tools/cc-switch.mjs unset-key <presetId> [--app ...]
//   node tools/cc-switch.mjs remove <presetId> [--app ...]
//
// Global: --file <path> overrides the config location (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PRESETS, findPreset } from '../core/providers.js'
import { CCSWITCH_RELATIVE_PATH, CCSWITCH_APPS, appsFor } from '../core/adapters/cc-switch.js'
import { buildCcSwitchEntry, installedCcSwitch, mergeCcSwitchConfig, removeCcSwitchProvider } from '../core/adapters/cc-switch.js'

const HOME = os.homedir()
const DEFAULT_FILE = path.join(HOME, ...CCSWITCH_RELATIVE_PATH)
const DSH_CREDENTIALS = path.join(HOME, '.dsh', '.credentials.yaml')

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

// --- config io ---

function readConfig(file) {
  try {
    return { config: JSON.parse(fs.readFileSync(file, 'utf8')), existed: true }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { config: {}, existed: false }
    throw new Error(`${file} 不是合法 JSON：${String((error && error.message) || error)}`)
  }
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file) && !fs.existsSync(`${file}.orig-backup`)) fs.copyFileSync(file, `${file}.orig-backup`)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

// --- helpers ---

function targetApps(preset, flags) {
  if (typeof flags.app === 'string') {
    const wanted = flags.app.split(',').map((a) => a.trim()).filter(Boolean)
    for (const app of wanted) if (!CCSWITCH_APPS[app]) throw new Error(`未知段: ${app}（可选 ${Object.keys(CCSWITCH_APPS).join(' / ')}）`)
    return wanted
  }
  return appsFor(preset)
}

function resolveKey(flags) {
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

function report(file, config, extra) {
  const summary = { file, ...extra }
  for (const app of Object.keys(CCSWITCH_APPS)) {
    const providers = config[app]?.providers ?? {}
    if (Object.keys(providers).length > 0) summary[app] = Object.keys(providers).length
  }
  console.log(JSON.stringify(summary, null, 2))
  console.log('\n注意：cc-switch 在启动时读取配置，改完重启应用（或重新运行 CLI）后生效。')
}

// --- commands ---

function commandList(file) {
  const { config } = readConfig(file)
  console.log(`cc-switch 配置: ${file}`)
  for (const app of Object.keys(CCSWITCH_APPS)) {
    const providers = config[app]?.providers ?? {}
    console.log(`  ${app.padEnd(16)} ${Object.keys(providers).length} 个 provider`)
  }
  console.log('')
  for (const preset of PRESETS) {
    const installed = installedCcSwitch(config, preset.id)
    if (installed.size === 0) continue
    const parts = [...installed].map(([app, n]) => `${app}${n > 1 ? `(${n})` : ''}`)
    const keyed = [...installed].some(([app]) => {
      const p = config[app]?.providers?.[preset.id]?.settingsConfig
      return p?.options?.apiKey || p?.env?.ANTHROPIC_AUTH_TOKEN || p?.auth?.OPENAI_API_KEY || p?.apiKey || p?.env?.GEMINI_API_KEY
    })
    console.log(`  已装 ${preset.id.padEnd(28)} ${preset.name}  → ${parts.join(', ')}  ${keyed ? '✓Key' : ''}`)
  }
}

function commandAdd(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}（用 list 查看可用项）`)
  const key = resolveKey(args.flags)
  const modelIds = typeof args.flags.models === 'string' ? args.flags.models.split(',').map((id) => id.trim()).filter(Boolean) : undefined
  const apps = targetApps(preset, args.flags)
  const { config } = readConfig(file)
  let next = config
  for (const app of apps) {
    const entry = buildCcSwitchEntry(preset, app, { key, modelIds })
    next = mergeCcSwitchConfig(next, app, { [preset.id]: entry })
  }
  writeConfig(file, next)
  report(file, next, { preset: preset.id, apps })
  if (key === undefined) console.log(`\nKey 未写。在 cc-switch 里编辑该 provider 即可填 Key（它会把 Key 写进这个 config）。`)
}

function commandAddAll(file, args) {
  const { config } = readConfig(file)
  let next = config
  let total = 0
  let apps = 0
  for (const preset of PRESETS) {
    for (const app of targetApps(preset, args.flags)) {
      next = mergeCcSwitchConfig(next, app, { [preset.id]: buildCcSwitchEntry(preset, app, {}) })
      apps += 1
      total += preset.models.length
    }
  }
  writeConfig(file, next)
  report(file, next, { presets: PRESETS.length, writes: apps })
}

function commandUnsetKey(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}`)
  const { config } = readConfig(file)
  let next = config
  let cleared = 0
  for (const app of targetApps(preset, args.flags)) {
    const provider = next[app]?.providers?.[preset.id]
    if (!provider?.settingsConfig) continue
    const sc = { ...provider.settingsConfig }
    const options = { ...(sc.options ?? {}) }
    if (options.apiKey !== undefined) {
      delete options.apiKey
      cleared += 1
    }
    const env = { ...(sc.env ?? {}) }
    for (const k of ['ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) if (env[k] !== undefined) { delete env[k]; cleared += 1 }
    if (sc.apiKey !== undefined) {
      delete sc.apiKey
      cleared += 1
    }
    if (sc.auth?.OPENAI_API_KEY !== undefined) {
      delete sc.auth.OPENAI_API_KEY
      cleared += 1
    }
    if (Object.keys(options).length > 0) sc.options = options
    else delete sc.options
    if (Object.keys(env).length > 0) sc.env = env
    else delete sc.env
    next = mergeCcSwitchConfig(next, app, { [preset.id]: { ...provider, settingsConfig: sc } })
  }
  if (cleared === 0) {
    console.log('没有找到带 Key 的条目。')
    return
  }
  writeConfig(file, next)
  console.log(JSON.stringify({ file, cleared }, null, 2))
}

function commandRemove(file, args) {
  const preset = findPreset(args._[1])
  if (!preset) throw new Error(`未知预设：${args._[1]}`)
  const { config } = readConfig(file)
  const apps = args.flags.app === true ? Object.keys(installedCcSwitch(config, preset.id)) : targetApps(preset, args.flags)
  let next = config
  for (const app of apps) next = removeCcSwitchProvider(next, app, preset.id)
  writeConfig(file, next)
  report(file, next, { removed: preset.id, apps })
}

// --- main ---

function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = typeof args.flags.file === 'string' ? args.flags.file : DEFAULT_FILE
  const command = args._[0]
  try {
    if (command === 'list' || command === undefined) commandList(file)
    else if (command === 'add') commandAdd(file, args)
    else if (command === 'add-all') commandAddAll(file, args)
    else if (command === 'unset-key') commandUnsetKey(file, args)
    else if (command === 'remove') commandRemove(file, args)
    else throw new Error(`未知命令：${command}（list / add / add-all / unset-key / remove）`)
  } catch (error) {
    console.error(`错误：${String((error && error.message) || error)}`)
    process.exitCode = 1
  }
}

main()
