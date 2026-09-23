// 视频流服务：Range 直连流（H.264 等浏览器可解编码）+ ffprobe 探测 + HLS 实时转码会话
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { db } from './db.js'
import { ffprobeAvailable } from './probe.js'

const FFMPEG = process.env.MC_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.MC_FFPROBE || 'ffprobe'

// ---------- 编码探测 ----------

const probeCache = new Map() // movieId -> { codecs, containers, probedAt }

function runProbe(args, timeoutMs = 15000) {
  return new Promise(resolve => {
    const isJs = /\.(mjs|cjs|js)$/i.test(FFPROBE)
    const exe = isJs ? process.execPath : FFPROBE
    const fullArgs = isJs ? [FFPROBE, ...args] : args
    let child
    try {
      child = spawn(exe, fullArgs, { windowsHide: true })
    } catch {
      return resolve(null)
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
      finish(null)
    }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.on('error', () => finish(null))
    child.on('close', code => finish(code === 0 ? out : null))
  })
}

/**
 * 探测影片的编码信息（缓存于内存）。
 * 返回 { ok, video_codec, audio_codec, has_subs, profile, width, height, level } 或 null
 */
export async function probeMovieCodecs(movieId) {
  if (probeCache.has(movieId)) return probeCache.get(movieId)
  const row = db.prepare('SELECT video_file FROM movie WHERE id = ?').get(movieId)
  if (!row?.video_file) return null
  if (!(await ffprobeAvailable())) return null
  const out = await runProbe([
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,profile,width,height:format=format_name',
    '-of', 'json', row.video_file
  ])
  if (!out) return null
  let info
  try { info = JSON.parse(out) } catch { return null }
  const video = (info.streams || []).find(s => s.codec_type === 'video')
  const audio = (info.streams || []).find(s => s.codec_type === 'audio')
  const hasSubs = (info.streams || []).some(s => s.codec_type === 'subtitle')
  const result = {
    ok: true,
    video_codec: video?.codec_name || '',
    profile: video?.profile || '',
    width: video?.width || 0,
    height: video?.height || 0,
    audio_codec: audio?.codec_name || '',
    has_subs: hasSubs,
    probedAt: Date.now()
  }
  probeCache.set(movieId, result)
  return result
}

// 浏览器可直接解码的视频编码（H.264/VP8/VP9/AV1）；音频通吃的是 AAC/MP3/Opus/FLAC
const BROWSER_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis'])

/**
 * 判断影片能否浏览器直接播放：
 * - 容器须为 mp4/webm/mkv(mkv 中 h264+aac 大多浏览器也能解，但不保证)
 * - 视频编码在白名单，音频编码在白名单
 */
export function canDirectPlay(info) {
  if (!info?.ok) return false
  if (!BROWSER_VIDEO.has(info.video_codec)) return false
  if (info.audio_codec && !BROWSER_AUDIO.has(info.audio_codec)) return false
  // H.264 High@L5.1 以上部分移动设备解不动，但现代手机基本可以，保守放行
  return true
}

// ---------- Range 直连流 ----------

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.mov': 'video/quicktime'
}

export function directStream(req, res, movieId) {
  const row = db.prepare('SELECT video_file FROM movie WHERE id = ?').get(movieId)
  if (!row?.video_file) {
    res.status(404).json({ error: '电影不存在或无视频文件' })
    return
  }
  let stat
  try {
    stat = fs.statSync(row.video_file)
  } catch {
    res.status(404).json({ error: '视频文件已缺失' })
    return
  }
  const ext = path.extname(row.video_file).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  const total = stat.size
  const range = req.headers.range

  res.set('Accept-Ranges', 'bytes')
  res.set('Content-Type', mime)

  if (!range) {
    // 不带 Range：直接全量流（浏览器一般都会带 Range）
    res.status(200)
    fs.createReadStream(row.video_file).pipe(res)
    return
  }

  const m = range.match(/bytes=(\d*)-(\d*)/)
  if (!m) {
    res.status(416).set('Content-Range', `bytes */${total}`).end()
    return
  }
  let start = m[1] === '' ? 0 : parseInt(m[1], 10)
  let end = m[2] === '' ? total - 1 : parseInt(m[2], 10)
  if (Number.isNaN(start) || start >= total || end >= total) {
    res.status(416).set('Content-Range', `bytes */${total}`).end()
    return
  }
  if (end < start) end = total - 1
  res.status(206)
  res.set('Content-Range', `bytes ${start}-${end}/${total}`)
  res.set('Content-Length', String(end - start + 1))
  fs.createReadStream(row.video_file, { start, end }).pipe(res)
}

// ---------- HLS 转码会话 ----------

const SESSION_TTL_MS = 10 * 60 * 1000        // 停止心跳 10 分钟后自动清理
const HLS_SEG_SECONDS = 6
const MAX_CONCURRENT_TRANSCODES = 2

const sessions = new Map() // sid -> { sid, movieId, ffmpeg, dir, m3u8, startedAt, lastTouch, segments, timer }

export function transcodeStats() {
  return { active: [...sessions.values()].filter(s => s.ffmpeg).length, max: MAX_CONCURRENT_TRANSCODES }
}

function runningCount() {
  return [...sessions.values()].filter(s => s.ffmpeg).length
}

function makeSid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function ensureSessionDir(sid) {
  const dir = path.join(os.tmpdir(), 'moviecenter-hls', sid)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

function killSession(session) {
  if (session.ffmpeg) {
    try { session.ffmpeg.kill('SIGKILL') } catch {}
    session.ffmpeg = null
  }
  if (session.timer) {
    clearTimeout(session.timer)
    session.timer = null
  }
  sessions.delete(session.sid)
  fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {})
}

function scheduleCleanup(session) {
  if (session.timer) clearTimeout(session.timer)
  session.timer = setTimeout(() => {
    console.log(`[stream] session ${session.sid} idle timeout, cleanup`)
    killSession(session)
  }, SESSION_TTL_MS)
}

/**
 * 启动转码会话：ffmpeg (QSV 优先，失败回退 CPU) → HLS 分段
 * 返回 { sid }
 */
export async function startTranscode(movieId) {
  const row = db.prepare('SELECT video_file FROM movie WHERE id = ?').get(movieId)
  if (!row?.video_file) {
    const err = new Error('电影不存在或无视频文件')
    err.status = 404
    throw err
  }
  if (runningCount() >= MAX_CONCURRENT_TRANSCODES) {
    const err = new Error(`转码会话已满（最多 ${MAX_CONCURRENT_TRANSCODES} 路），请稍后再试或用本地播放器`)
    err.status = 429
    throw err
  }

  const sid = makeSid()
  const dir = await ensureSessionDir(sid)
  const session = {
    sid, movieId, ffmpeg: null, dir,
    m3u8: path.join(dir, 'index.m3u8'),
    startedAt: Date.now(), lastTouch: Date.now(), segments: 0, timer: null
  }
  sessions.set(sid, session)

  // QSV 硬件转码（失败自动回退 CPU 软转码），输出 1080p H.264 + AAC 的 HLS
  const tryStart = useQsv => {
    const vf = useQsv
      ? 'scale_qsv=w=1920:h=-2' // 1080p 上限
      : 'scale=1920:-2:flags=bicubic'
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-fflags', '+genpts',
      '-i', row.video_file,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', vf,
      '-c:v', ...(useQsv ? ['h264_qsv', '-preset', 'veryfast', '-global_quality', '25'] : ['libx264', '-preset', 'veryfast', '-crf', '23']),
      '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
      '-f', 'hls',
      '-hls_time', String(HLS_SEG_SECONDS),
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments+append_list',
      '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
      path.join(dir, 'index.m3u8')
    ]
    return spawnFFmpeg(args, session, useQsv)
  }

  // 先试 QSV
  let proc = await tryStart(true)
  if (!proc) {
    console.log('[stream] QSV unavailable, fallback to CPU transcode')
    proc = await tryStart(false)
  }
  if (!proc) {
    killSession(session)
    const err = new Error('无法启动转码（ffmpeg 不可用？）')
    err.status = 500
    throw err
  }
  session.ffmpeg = proc
  scheduleCleanup(session)
  return { sid }
}

function spawnFFmpeg(args, session, isQsv) {
  return new Promise(resolve => {
    const isJs = /\.(mjs|cjs|js)$/i.test(FFMPEG)
    const exe = isJs ? process.execPath : FFMPEG
    const fullArgs = isJs ? [FFMPEG, ...args] : args
    let child
    try {
      child = spawn(exe, fullArgs, { windowsHide: true })
    } catch {
      return resolve(null)
    }
    let stderr = ''
    let settled = false
    // 3 秒内退出视为启动失败（QSV 初始化失败通常立刻退出）
    const failTimer = setTimeout(() => {
      if (!settled) { settled = true; resolve(child) }
    }, 3000)
    child.stderr.on('data', d => { stderr += d })
    child.on('error', () => {
      if (!settled) { settled = true; clearTimeout(failTimer); resolve(null) }
    })
    child.on('close', code => {
      if (!settled) {
        settled = true
        clearTimeout(failTimer)
        resolve(null) // 3 秒内就退出 = 启动失败
      } else {
        // 正常运行后退出（转码完成或出错）
        console.log(`[stream] ffmpeg(qsv=${isQsv}) exited code=${code}`)
        if (code !== 0 && stderr) console.error('[stream] ffmpeg stderr:', stderr.slice(-500))
        const s = sessions.get(session.sid)
        if (s) s.ffmpeg = null // 转码进程结束（可能是全片转完）
      }
    })
  })
}

/** 会话心跳/取播放信息 */
export function getSession(sid) {
  return sessions.get(sid) || null
}

export function touchSession(sid) {
  const s = sessions.get(sid)
  if (!s) return null
  s.lastTouch = Date.now()
  scheduleCleanup(s)
  return s
}

export function stopSession(sid) {
  const s = sessions.get(sid)
  if (!s) return false
  killSession(s)
  return true
}

/** 输出 m3u8 / 分段文件 */
export async function serveHlsPart(req, res, sid, file) {
  const s = touchSession(sid)
  if (!s) return res.status(404).json({ error: '转码会话已结束' })
  // 只允许访问本会话目录下的文件
  const target = path.join(s.dir, path.basename(file))
  if (!target.startsWith(s.dir)) return res.status(400).json({ error: '非法路径' })
  try {
    const stat = await fsp.stat(target)
    res.set('Content-Type', file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
    res.set('Cache-Control', 'no-store')
    fs.createReadStream(target).pipe(res)
  } catch {
    res.status(404).json({ error: '分段尚未生成' })
  }
}
