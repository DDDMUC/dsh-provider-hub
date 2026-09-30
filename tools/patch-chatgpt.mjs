#!/usr/bin/env node
// dsh-provider-hub - ChatGPT desktop (Codex) third-party login patcher.
//
// Adds a floating "从第三方登录" pill to the ChatGPT / Codex desktop app that
// opens our provider picker. This is the live demo of the "grow a third-party
// login button in another app's login screen" idea, plus the shippable patcher
// behind it.
//
// How it works:
//   1. overlay JS is written to ~/.provider-hub/overlay.js (editable, no re-patch)
//   2. the app's asar entry (.vite/build/early-bootstrap.js, per package.json
//      "main") gets a 4-line hook that executes that file in every webContents
//   3. the asar is repacked, its SHA256 recomputed into Info.plist's
//      ElectronAsarIntegrity, and the bundle is ad-hoc re-signed - the app
//      keeps launching locally.
//
// Caveats (documented, not hidden): every ChatGPT update replaces the app and
// wipes the patch - re-run this script. Ad-hoc signing drops notarization.
// Restore with --restore puts the original asar/Info.plist back.
//
// Usage:
//   node tools/patch-chatgpt.mjs --apply
//   node tools/patch-chatgpt.mjs --restore
//   node tools/patch-chatgpt.mjs --status
// Global: --app <path> overrides the app bundle (tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const HOME = os.homedir()
const HUB_DIR = path.join(HOME, '.provider-hub')
const OVERLAY_FILE = path.join(HUB_DIR, 'overlay.js')
const PROVIDERS_FILE = path.join(HUB_DIR, 'providers.json')

const DEFAULT_APP = '/Applications/ChatGPT.app'
const APP = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : DEFAULT_APP
const ASAR = path.join(APP, 'Contents', 'Resources', 'app.asar')
const PLIST = path.join(APP, 'Contents', 'Info.plist')
const BACKUP_ASAR = path.join(HUB_DIR, 'chatgpt-app.asar.backup')
const BACKUP_PLIST = path.join(HUB_DIR, 'chatgpt-Info.plist.backup')

// --- overlay (vanilla JS + shadow DOM; runs inside the app's renderer) ---

function overlaySource(providers) {
  return `// provider-hub overlay - injected by tools/patch-chatgpt.mjs
(() => {
  if (window.__providerHubOverlay) return
  window.__providerHubOverlay = true
  const PROVIDERS = ${JSON.stringify(providers)}
  const STORE_KEY = 'provider-hub/connected'
  const host = document.createElement('div')
  host.id = 'provider-hub-host'
  const shadow = host.attachShadow({ mode: 'open' })
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;right:20px;font-family:-apple-system,"SF Pro Text","PingFang SC",sans-serif'
  document.documentElement.appendChild(host)
  shadow.innerHTML = \`
  <style>
    .pill{all:unset;display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:#10a37f;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28)}
    .pill:hover{background:#0e906f}
    .mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center}
    .mask.open{display:flex}
    .card{width:440px;max-height:76vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3)}
    .hd{padding:18px 20px 12px;border-bottom:1px solid #eee}
    .hd h3{margin:0 0 2px;font-size:16px;color:#0d0d0d}
    .hd p{margin:0;font-size:12px;color:#666}
    .search{margin:12px 20px 8px;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none}
    .list{overflow-y:auto;padding:0 8px 8px}
    .row{padding:10px 12px;border-radius:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px}
    .row:hover{background:#f5f5f5}
    .row .nm{font-size:13px;color:#0d0d0d;font-weight:500}
    .row .mt{font-size:11px;color:#888;margin-top:2px}
    .tag{font-size:10px;padding:2px 6px;border-radius:4px;background:#eef7f3;color:#0e906f;white-space:nowrap}
    .tag.gap{background:#fff4e5;color:#b25e09}
    .expand{display:none;padding:4px 12px 12px}
    .expand.open{display:block}
    .keyrow{display:flex;gap:8px}
    .keyrow input{flex:1;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:12px;outline:none}
    .keyrow button{all:unset;padding:8px 14px;border-radius:8px;background:#10a37f;color:#fff;font-size:12px;font-weight:600;cursor:pointer;text-align:center}
    .ft{padding:10px 20px 16px;font-size:11px;color:#999;border-top:1px solid #eee;line-height:1.6}
    .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0d0d0d;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;display:none;z-index:1}
    .toast.show{display:block}
  </style>
  <button class="pill">⚡ 从第三方登录</button>
  <div class="mask"><div class="card">
    <div class="hd"><h3>挑选服务商</h3><p>provider-hub · ${providers.length} 家渠道 · Key 只存在本机</p></div>
    <input class="search" placeholder="搜索渠道…">
    <div class="list"></div>
    <div class="ft">● 橙色 = 各 App 原生没有、本工具独有<br>连接后可在任意终端运行 <b>provider-hub-connect</b> 同步到全部应用</div>
  </div></div>
  <div class="toast"></div>\`
  const [pill, mask, list, search, toast] = [shadow.querySelector('.pill'), shadow.querySelector('.mask'), shadow.querySelector('.list'), shadow.querySelector('.search'), shadow.querySelector('.toast')]
  const say = (t) => { toast.textContent = t; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600) }
  let connected = {}
  try { connected = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch {}
  let open = null
  const render = (q = '') => {
    const hits = PROVIDERS.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q))
    list.innerHTML = ''
    for (const p of hits) {
      const row = document.createElement('div')
      row.className = 'row'
      row.innerHTML = \`<div><div class="nm">\${p.name}</div><div class="mt">\${p.models} 模型 · \${p.env}</div></div><span class="tag \${p.unique ? 'gap' : ''}">\${connected[p.id] ? '✓ 已连接' : p.unique ? '● 独有' : '○'}</span>\`
      const expand = document.createElement('div')
      expand.className = 'expand' + (open === p.id ? ' open' : '')
      expand.innerHTML = \`<div class="keyrow"><input type="password" placeholder="粘贴 \${p.env}"><button>连接</button></div>\`
      const [input, btn] = [expand.querySelector('input'), expand.querySelector('button')]
      const connect = () => {
        const key = input.value.trim()
        if (!key) { say('Key 不能为空'); return }
        connected[p.id] = key
        localStorage.setItem(STORE_KEY, JSON.stringify(connected))
        say('✓ 已写入本机渠道库')
        render(search.value)
      }
      btn.onclick = connect
      input.onkeydown = (e) => { if (e.key === 'Enter') connect() }
      row.onclick = () => { open = open === p.id ? null : p.id; render(search.value) }
      list.appendChild(row)
      list.appendChild(expand)
    }
  }
  pill.onclick = () => { mask.classList.add('open'); render(search.value) }
  mask.onclick = (e) => { if (e.target === mask) mask.classList.remove('open') }
  search.oninput = () => render(search.value)
  render()
})()
`
}

// --- providers.json for the overlay ---

async function loadProviders() {
  const { PRESETS } = await import(path.join(import.meta.dirname, '..', 'core', 'providers.js'))
  return PRESETS.map((p) => ({ id: p.id, name: p.name, env: p.env, models: p.models.length, api: p.api, unique: false }))
}

// --- main ---

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function patchFile(file, marker, code) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes(marker)) return false
  fs.writeFileSync(file, `${source}\n${code}\n`)
  return true
}

async function apply() {
  if (!fs.existsSync(ASAR)) throw new Error(`找不到 app.asar: ${ASAR}`)
  // macOS 会拦截别的进程改 /Applications 里的 App bundle（TCC App 管理）
  const writeProbe = path.join(path.dirname(ASAR), '.hub-write-probe')
  try {
    fs.closeSync(fs.openSync(writeProbe, 'w'))
    fs.unlinkSync(writeProbe)
  } catch {
    throw new Error(
      '没有写权限：macOS 只允许用户授权的进程修改 /Applications 里的 App。\n' +
        '请在你自己的「终端」里运行（首次会弹系统权限框，点允许）：\n' +
        `  cd ${process.cwd()} && node tools/patch-chatgpt.mjs --apply\n` +
        '或：sudo node tools/patch-chatgpt.mjs --apply',
    )
  }
  if (!fs.existsSync(BACKUP_ASAR)) {
    fs.copyFileSync(ASAR, BACKUP_ASAR)
    fs.copyFileSync(PLIST, BACKUP_PLIST)
    console.log(`✓ 已备份 app.asar / Info.plist（${(fs.statSync(BACKUP_ASAR).size / 1e6).toFixed(0)}MB）`)
  } else {
    console.log('· 备份已存在，跳过（不会覆盖原始备份）')
  }
  const providers = await loadProviders()
  fs.mkdirSync(HUB_DIR, { recursive: true })
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 1))
  fs.writeFileSync(OVERLAY_FILE, overlaySource(providers))
  console.log(`✓ overlay 已写入 ${OVERLAY_FILE}（${providers.length} 家渠道，可手改无需重打包）`)

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-asar-'))
  console.log('· 解包 asar…')
  run('npx', ['--yes', '@electron/asar', 'extract', ASAR, work])
  const main = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).main
  const entry = path.join(work, main)
  if (!fs.existsSync(entry)) throw new Error(`入口文件不存在: ${main}`)
  const hook = `try{const __e=require("electron"),__f=require("fs"),__p=require("path"),__o=require("os");__e.app.on("web-contents-created",(_e,__wc)=>{__wc.on("did-finish-load",()=>{try{__wc.executeJavaScript(__f.readFileSync(__p.join(__o.homedir(),".provider-hub","overlay.js"),"utf8")).catch(()=>{})}catch{}})})}catch{}`
  const changed = patchFile(entry, '__providerHubOverlay', hook)
  if (!changed) console.log('· 入口已打过补丁，跳过')
  else console.log(`✓ 注入钩子 → ${main}`)
  console.log('· 重新打包 asar…')
  const tmpAsar = `${ASAR}.tmp`
  run('npx', ['--yes', '@electron/asar', 'pack', work, tmpAsar])
  fs.renameSync(tmpAsar, ASAR)
  // 更新完整性哈希
  const hash = sha256(ASAR)
  run('plutil', ['-replace', 'ElectronAsarIntegrity', '-xml', `<dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>${hash}</string></dict></dict>`, PLIST])
  console.log(`✓ asar SHA256 已更新: ${hash.slice(0, 16)}…`)
  fs.rmSync(work, { recursive: true, force: true })
  // ad-hoc 重签
  console.log('· ad-hoc 重签名…')
  run('codesign', ['--force', '--deep', '--sign', '-', APP])
  console.log('\n✅ 完成。重启 ChatGPT/Codex 应用，右下角会出现「⚡ 从第三方登录」。')
  console.log('   想撤销：node tools/patch-chatgpt.mjs --restore')
}

function restore() {
  if (!fs.existsSync(BACKUP_ASAR)) throw new Error('没有找到备份（.hub-backup），无法恢复')
  fs.copyFileSync(BACKUP_ASAR, ASAR)
  fs.copyFileSync(BACKUP_PLIST, PLIST)
  run('codesign', ['--force', '--deep', '--sign', '-', APP])
  fs.rmSync(BACKUP_ASAR, { force: true })
  fs.rmSync(BACKUP_PLIST, { force: true })
  console.log('✅ 已还原原始 app.asar / Info.plist 并重签。重启应用即恢复原样。')
}

function status() {
  const backed = fs.existsSync(BACKUP_ASAR)
  const plist = run('plutil', ['-extract', 'ElectronAsarIntegrity', 'xml1', '-o', '-', PLIST])
  const want = /<string>([a-f0-9]{64})<\/string>/.exec(plist)?.[1] ?? ''
  const have = sha256(ASAR)
  console.log(`app:     ${APP}`)
  console.log(`overlay: ${fs.existsSync(OVERLAY_FILE) ? OVERLAY_FILE : '（未写入）'}`)
  console.log(`备份:    ${backed ? '有（可 --restore）' : '无'}`)
  console.log(`完整性:  ${want === have ? '✓ 一致（plist 与 asar 匹配）' : `✗ 不一致\n  plist: ${want}\n  asar:  ${have}`}`)
  if (want === have && !backed) console.log('（app 未被打过补丁，或补丁已被应用更新覆盖）')
}

(async () => {
  const mode = process.argv.includes('--restore') ? 'restore' : process.argv.includes('--status') ? 'status' : 'apply'
  try {
    if (mode === 'apply') await apply()
    else if (mode === 'restore') restore()
    else status()
  } catch (error) {
    console.error(`✗ ${String((error && error.message) || error).slice(0, 300)}`)
    process.exitCode = 1
  }
})()
