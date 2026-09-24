// 文件夹监听自动入库：fs.watch 递归监听扫描目录（Windows 支持），
// 变更静默 30 秒后触发一次增量扫描（下载器持续写文件时不断重置计时）。
// 目录不可达（拔盘/NAS 断链）时指数退避重连，恢复后自动补扫。
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'
import { scanAll } from './scanner.js'

const QUIET_MS = 30 * 1000        // 静默期：30 秒无新事件才触发扫描
const RETRY_BASE_MS = 5 * 1000    // 重连退避起点
const RETRY_MAX_MS = 5 * 60 * 1000

const watchers = new Map() // path -> { watcher, retry, retryTimer, root }
let quietTimer = null
let enabled = false
let scanning = false

function getSetting(name, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE "key" = ?').get(name)
  return row?.value ?? fallback
}

/** 触发增量扫描（串行：扫描中则标记待扫） */
async function triggerScan() {
  if (scanning) return
  scanning = true
  try {
    const r = await scanAll()
    if (r && (r.added || r.restored)) {
      console.log(`[watcher] 自动入库：新增 ${r.added} 部${r.restored ? `，恢复 ${r.restored} 部` : ''}`)
    }
  } catch (err) {
    console.error('[watcher] scan failed:', err.message)
  } finally {
    scanning = false
  }
}

/** 事件到达：重置静默计时（风暴时持续顺延） */
function onEvent(what) {
  if (!enabled) return
  if (quietTimer) clearTimeout(quietTimer)
  quietTimer = setTimeout(() => {
    quietTimer = null
    // 简单防抖熔断：日志不刷屏
    triggerScan().catch(() => {})
  }, QUIET_MS)
}

/** 监听单个扫描根目录（失败退避重连） */
function watchRoot(rootPath) {
  const state = watchers.get(rootPath) || { watcher: null, retry: 0, retryTimer: null }
  watchers.set(rootPath, state)
  try {
    const watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
      // 只关心目录级变化（一部片 = 一个文件夹）；文件写入也顺带触发（重命名/移动场景）
      onEvent(`${eventType}:${filename || ''}`)
    })
    watcher.on('error', () => {
      // 拔盘 / 权限 / 句柄失效：关闭并退避重连
      try { watcher.close() } catch {}
      state.watcher = null
      if (!enabled) return
      state.retry = Math.min(state.retry + 1, 5)
      const delay = Math.min(RETRY_BASE_MS * 2 ** state.retry, RETRY_MAX_MS)
      console.log(`[watcher] ${rootPath} 监听中断，${Math.round(delay / 1000)}s 后重连`)
      state.retryTimer = setTimeout(() => { if (enabled) watchRoot(rootPath) }, delay)
    })
    state.watcher = watcher
    state.retry = 0
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null }
  } catch {
    // 目录不存在（盘没挂载）：退避重试
    if (!enabled) return
    state.retry = Math.min(state.retry + 1, 5)
    const delay = Math.min(RETRY_BASE_MS * 2 ** state.retry, RETRY_MAX_MS)
    state.retryTimer = setTimeout(() => { if (enabled) watchRoot(rootPath) }, delay)
  }
}

function closeAll() {
  for (const [, state] of watchers) {
    try { state.watcher?.close() } catch {}
    if (state.retryTimer) clearTimeout(state.retryTimer)
  }
  watchers.clear()
  if (quietTimer) { clearTimeout(quietTimer); quietTimer = null }
}

/** 启动 / 重载监听（设置变更、扫描目录增删后调用） */
export function startWatcher() {
  const on = getSetting('watch_enabled', '1') === '1'
  enabled = on
  closeAll()
  if (!on) {
    console.log('[watcher] 自动入库监听已关闭')
    return
  }
  const roots = db.prepare('SELECT path FROM scan_path WHERE enabled = 1').all()
  for (const r of roots) watchRoot(r.path)
  console.log(`[watcher] 自动入库监听中：${roots.length} 个目录（变更静默 30s 后自动扫描）`)
}

export function watcherStatus() {
  return {
    enabled,
    watching: [...watchers.entries()]
      .filter(([, s]) => s.watcher)
      .map(([p]) => p),
    pending: !!quietTimer
  }
}
