// ffprobe 深度画质识别：读取视频文件真实分辨率
// 解析顺序：MC_FFPROBE 环境变量 → PATH → 常见安装位置（winget/scoop/choco 等）。
// 检测失败后 30 秒自动重试：期间安装 FFmpeg 无需重启服务。
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const FFPROBE_ENV = process.env.MC_FFPROBE || ''
const FFMPEG_ENV = process.env.MC_FFMPEG || ''

let resolvedProbe = null   // 已确认可用的 ffprobe 命令/完整路径
let resolvedFfmpeg = null  // 已确认可用的 ffmpeg
let probeFailedAt = 0      // 上次探测失败时间：冷却 30 秒，避免每次请求都重复探测
const RETRY_MS = 30_000

function isJsShim(cmd) { return /\.(mjs|cjs|js)$/i.test(cmd) }

function spawnOnce(cmd, args, timeoutMs) {
  return new Promise(resolve => {
    // 支持命令指向 .mjs/.js 脚本（node shim），便于自定义与测试
    const js = isJsShim(cmd)
    const exe = js ? process.execPath : cmd
    const fullArgs = js ? [cmd, ...args] : args
    let child
    try {
      child = spawn(exe, fullArgs, { windowsHide: true })
    } catch {
      resolve({ ok: false })
      return
    }
    let out = ''
    let done = false
    const finish = payload => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish({ ok: false })
    }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.on('error', () => finish({ ok: false }))
    child.on('close', code => finish({ ok: code === 0, out }))
  })
}

// 扫描 FFmpeg 常见安装位置（弥补 winget 等安装后 PATH 未生效的情况），返回存在的完整路径
function scanInstalledDir(exeName) {
  if (process.platform !== 'win32') return []
  const local = join(homedir(), 'AppData', 'Local')
  const found = []
  const add = p => { try { if (existsSync(p)) found.push(p) } catch {} }
  // winget portable 包（Gyan.FFmpeg / BtbN.FFmpeg 等）：<包目录>/<版本目录>/bin/<exe>
  try {
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages')
    for (const pkg of readdirSync(pkgs)) {
      if (!/ffmpeg/i.test(pkg)) continue
      const base = join(pkgs, pkg)
      for (const sub of readdirSync(base)) {
        add(join(base, sub, 'bin', exeName))
      }
      add(join(base, 'bin', exeName))
    }
  } catch {}
  add(join(local, 'Microsoft', 'WinGet', 'Links', exeName))  // winget links
  add(join(homedir(), 'scoop', 'shims', exeName))            // scoop
  add(join('C:\\ProgramData\\chocolatey', 'bin', exeName))   // chocolatey
  add(join('C:\\ffmpeg', 'bin', exeName))                    // 手动安装的常见位置
  add(join(local, 'ffmpeg', 'bin', exeName))
  add(join('C:\\Program Files', 'ffmpeg', 'bin', exeName))
  return found
}

async function tryResolve(cmd) {
  const r = await spawnOnce(cmd, ['-version'], 8000)
  return r.ok ? cmd : null
}

export async function ffprobeAvailable() {
  if (resolvedProbe) return true
  if (probeFailedAt && Date.now() - probeFailedAt < RETRY_MS) return false
  const candidates = [
    ...(FFPROBE_ENV ? [FFPROBE_ENV] : []),
    'ffprobe', 'ffprobe.exe',
    ...scanInstalledDir('ffprobe.exe')
  ]
  for (const cmd of candidates) {
    const hit = await tryResolve(cmd)
    if (hit) {
      resolvedProbe = hit
      probeFailedAt = 0
      return true
    }
  }
  probeFailedAt = Date.now()
  return false
}

/** 已解析的 ffprobe 命令（未检测到时返回 null） */
export async function getFFprobeCmd() {
  return (await ffprobeAvailable()) ? resolvedProbe : null
}

/** 解析 ffmpeg 命令：MC_FFMPEG → PATH → 与 ffprobe 同目录 → 常见安装位置 */
export async function getFFmpegCmd() {
  if (resolvedFfmpeg) return resolvedFfmpeg
  const candidates = [
    ...(FFMPEG_ENV ? [FFMPEG_ENV] : []),
    'ffmpeg', 'ffmpeg.exe'
  ]
  // ffprobe 已解析且不是脚本 shim 时，优先用同目录的 ffmpeg
  if (resolvedProbe && !isJsShim(resolvedProbe)) {
    candidates.splice(FFMPEG_ENV ? 1 : 0, 0, join(dirname(resolvedProbe), 'ffmpeg.exe'))
  }
  candidates.push(...scanInstalledDir('ffmpeg.exe'))
  for (const cmd of candidates) {
    const hit = await tryResolve(cmd)
    if (hit) { resolvedFfmpeg = hit; return hit }
  }
  return null
}

// 宽高 → 画质标签（含 2.39:1 裁切宽幅：以较可靠的一边判断）
export function mapResolution(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w && !h) return ''
  if (h >= 4200 || w >= 7600) return '8K'
  if (h >= 1900 || w >= 3700) return '4K'
  if (h >= 900 || w >= 1880) return '1080p'
  if (h >= 660 || w >= 1200) return '720p'
  return '480p'
}

export function parseProbeOutput(out) {
  try {
    const data = JSON.parse(out)
    const s = (data.streams || [])[0]
    if (!s) return ''
    return mapResolution(s.width, s.height)
  } catch {
    return ''
  }
}

export async function probeVideoQuality(file) {
  if (!file || !(await ffprobeAvailable())) return ''
  const r = await spawnOnce(
    resolvedProbe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file],
    15000
  )
  if (!r.ok) return ''
  return parseProbeOutput(r.out)
}

// 批量探测（并发 3），返回 [{ id, quality }]
export async function probeQualityBatch(rows) {
  if (!rows.length) return []
  if (!(await ffprobeAvailable())) return []
  const updates = []
  let i = 0
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++]
      const q = await probeVideoQuality(row.video_file)
      if (q) updates.push({ id: row.id, quality: q })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, () => worker()))
  return updates
}
