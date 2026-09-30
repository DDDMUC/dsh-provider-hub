#!/usr/bin/env node
// dsh-provider-hub - interactive onboarding wizard.
//
// Our own "login" surface: pick a provider from the curated catalog, paste the
// key once, and the wizard writes it into every app it can detect on this
// machine (WorkBuddy's models.json, OpenCode's config + auth.json). DSH gets
// the in-app step spelled out because its route write needs the running
// server's session (the plugin card does it in one click anyway).
//
// Usage:
//   node tools/connect.mjs [--yes]     # --yes skips the write confirmation
// Global: --file / --auth override the target files (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { PRESETS } from '../core/providers.js'
import { coverageOf } from '../core/coverage.js'
import { WORKBUDDY_NATIVE_IDS } from '../core/native-ids.js'

const HOME = os.homedir()
const WB_FILE = path.join(HOME, '.workbuddy', 'models.json')
const OC_CONFIG = [path.join(HOME, '.config', 'opencode', 'opencode.jsonc'), path.join(HOME, '.config', 'opencode', 'opencode.json')]
const OC_AUTH = process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json') : path.join(HOME, '.local', 'share', 'opencode', 'auth.json')

function parseArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return flags
}

// 行缓冲队列：既要支持真人交互（TTY 逐行键入），也要支持管道喂输入
// （echo -e "1\\nsk-x\\ny" | connect.mjs）。裸 readline.question 在管道下会丢行，
// 所以自己缓存 'line' 事件。
const pendingLines = []
const pendingWaiters = []
function wireReadline(rl) {
  rl.on('line', (line) => {
    const waiter = pendingWaiters.shift()
    if (waiter) waiter(line)
    else pendingLines.push(line)
  })
}
const ask = (question) =>
  new Promise((resolve) => {
    process.stdout.write(question)
    if (pendingLines.length > 0) resolve(pendingLines.shift())
    else pendingWaiters.push(resolve)
  })
const pick = (list, question) => ask(question).then((raw) => list[Number(raw.trim()) - 1])

// --- app detection ---

function detectedApps(flags) {
  const apps = []
  // --file only overrides the primary target (WorkBuddy); OpenCode keeps its
  // own path so a test run can't cross-write between the two config files.
  const wbFile = typeof flags.file === 'string' ? flags.file : WB_FILE
  if (fs.existsSync(wbFile)) apps.push({ id: 'workbuddy', label: 'WorkBuddy', file: wbFile })
  const ocFile = typeof flags['oc-file'] === 'string' ? flags['oc-file'] : OC_CONFIG.find((f) => fs.existsSync(f))
  if (ocFile) apps.push({ id: 'opencode', label: 'OpenCode', file: ocFile })
  const ccFile = path.join(HOME, '.cc-switch', 'config.json')
  if (fs.existsSync(ccFile)) apps.push({ id: 'cc-switch', label: 'cc-switch', file: ccFile })
  if (fs.existsSync(path.join(HOME, '.dsh'))) apps.push({ id: 'dsh', label: 'DSH', file: null })
  return apps
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  wireReadline(rl)
  const coverage = coverageOf(PRESETS, WORKBUDDY_NATIVE_IDS)

  console.log('dsh-provider-hub · 连接服务商\n')
  console.log('挑选一个渠道（输入编号）：\n')
  PRESETS.forEach((preset, index) => {
    const mark = coverage.covered.some((c) => c.id === preset.id) ? '○' : '●'
    console.log(`  ${String(index + 1).padStart(3)}. ${mark} ${preset.name.padEnd(34)} ${String(preset.models.length).padStart(2)} 模型  ${preset.env}`)
  })
  console.log('\n  ● = 这些 App 原生没有、本工具独有    ○ = 部分 App 原生已有（本工具用自家端点/元数据覆盖）\n')

  const preset = await pick(
    PRESETS,
    '编号: ',
  )
  if (!preset) {
    console.log('无效编号。')
    rl.close()
    return
  }
  const key = (await ask(`粘贴 ${preset.name} 的 API Key: `)).trim()
  if (key === '') {
    console.log('Key 为空，退出。')
    rl.close()
    return
  }

  const apps = detectedApps(flags)
  console.log(`\n检测到本机应用: ${apps.map((a) => a.label).join(' / ') || '（无）'}`)
  if (apps.length === 0) {
    console.log('没有检测到可写入的应用。')
    rl.close()
    return
  }
  if (flags.yes !== true) {
    const go = (await ask(`写入以上应用？[Y/n] `)).trim().toLowerCase()
    if (go === 'n' || go === 'no') {
      console.log('已取消。')
      rl.close()
      return
    }
  }

  for (const app of apps) {
    if (app.id === 'workbuddy') {
      const { execFileSync } = await import('node:child_process')
      try {
        const out = execFileSync(process.execPath, [path.join(import.meta.dirname, 'workbuddy.mjs'), 'add', preset.id, '--key', key, '--file', app.file], { encoding: 'utf8' })
        console.log(`\n[WorkBuddy] ✓ 写入 ${preset.models.length} 个模型`)
        console.log(out.split('\n').filter((l) => l.includes('Key') || l.includes('注意')).join('\n'))
      } catch (error) {
        console.log(`[WorkBuddy] ✗ ${String(error.stderr || error.message).split('\n')[0]}`)
      }
    } else if (app.id === 'opencode') {
      const { execFileSync } = await import('node:child_process')
      try {
        const out = execFileSync(process.execPath, [path.join(import.meta.dirname, 'opencode.mjs'), 'add', preset.id, '--key', key, '--file', app.file, '--auth', OC_AUTH], { encoding: 'utf8' })
        console.log(`[OpenCode] ✓ 定义+Key 已写入（Key 进 auth.json，可在连接提供商里管理）`)
        const native = PRESETS.find((p) => p.id === preset.id)
        if (native) console.log(out.split('\n').filter((l) => l.includes('注意') || l.includes('在 OpenCode')).join('\n'))
      } catch (error) {
        console.log(`[OpenCode] ✗ ${String(error.stderr || error.message).split('\n')[0]}`)
      }
    } else if (app.id === 'dsh') {
      console.log(`[DSH] 请在应用内完成（一步）：设置 → Models →「服务商预设」卡片 → 找到 ${preset.name} → 粘贴 Key → 启用`)
    } else if (app.id === 'cc-switch') {
      const { execFileSync } = await import('node:child_process')
      try {
        execFileSync(process.execPath, [path.join(import.meta.dirname, 'cc-switch.mjs'), 'add', preset.id, '--key', key, '--file', app.file], { encoding: 'utf8', stdio: 'pipe' })
        console.log(`[cc-switch] ✓ 写入 ${appsFor(preset).join(" / ")} 段 ${preset.models.length} 个模型（Key 进 cc-switch 自己的 config，抢不了你当前的 provider）`)
      } catch (error) {
        console.log(`[cc-switch] ✗ ${String(error.stderr || error.message).split('\n')[0]}`)
      }
    }
  }

  console.log('\n完成。')
  rl.close()
}

main()
