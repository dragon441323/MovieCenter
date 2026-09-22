// ffprobe 深度画质识别：读取视频文件真实分辨率
import { spawn } from 'node:child_process'

const FFPROBE = process.env.MC_FFPROBE || 'ffprobe'

let available = null // null = 未检测，true/false = 缓存结果

function spawnProbe(args, timeoutMs) {
  return new Promise(resolve => {
    // 支持 MC_FFPROBE 指向 .mjs/.js 脚本（node shim），便于自定义与测试
    const isJs = /\.(mjs|cjs|js)$/i.test(FFPROBE)
    const exe = isJs ? process.execPath : FFPROBE
    const fullArgs = isJs ? [FFPROBE, ...args] : args
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

export async function ffprobeAvailable() {
  if (available !== null) return available
  if (!FFPROBE) {
    available = false
    return available
  }
  const r = await spawnProbe(['-version'], 8000)
  available = r.ok
  return available
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
  const r = await spawnProbe(
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
