// 视频流服务：Range 直连流（H.264 等浏览器可解编码）+ ffprobe 探测 + HLS 实时转码会话
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { db } from './db.js'
import { getFFprobeCmd, getFFmpegCmd } from './probe.js'

// ---------- 编码探测 ----------

const probeCache = new Map() // movieId -> { codecs, containers, probedAt }

function runProbe(cmd, args, timeoutMs = 15000) {
  return new Promise(resolve => {
    const isJs = /\.(mjs|cjs|js)$/i.test(cmd)
    const exe = isJs ? process.execPath : cmd
    const fullArgs = isJs ? [cmd, ...args] : args
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

// 中文字幕识别：语言标记 / 文件名特征
const ZH_LANG = /^(zho|chi|zh|chinese)/i
const ZH_NAME = /(chs|cht|zh|gb|big5|简|繁|中)/i

/** 视频同目录下的外挂字幕文件（.srt/.ass/.ssa），每次现扫不缓存（用户可能随时放入） */
function findExternalSubs(videoFile) {
  try {
    const dir = path.dirname(videoFile)
    return fs.readdirSync(dir)
      .filter(f => /\.(srt|ass|ssa)$/i.test(f))
      .sort()
      .map(f => path.join(dir, f))
  } catch { return [] }
}

/** 默认字幕轨：中文优先（带中文标记的内嵌轨 → 文件名带中文特征的外挂 → 任意内嵌轨 → 任意外挂） */
function pickDefaultSub(subs) {
  return subs.find(s => s.kind !== 'file' && ZH_LANG.test(s.lang || ''))?.idx
    ?? subs.find(s => s.kind === 'file' && ZH_NAME.test(s.label || ''))?.idx
    ?? subs.find(s => s.kind !== 'file')?.idx
    ?? subs[0]?.idx
    ?? -1
}

/**
 * 探测影片的编码信息（ffprobe 部分缓存于内存）。
 * 返回 { ok, video_codec, audio_codec, has_subs, profile, width, height, pix_fmt, color_transfer, hdr,
 *        duration, subs, defaultSub } 或 null。
 * subs: 可烧录的字幕列表 [{ idx, kind: 'pgs'|'file', label, lang, rel?, file? }]
 *   - pgs  = 内嵌图形字幕（蓝光 PGS / DVB），filter_complex overlay 叠加
 *   - file = 同目录外挂字幕文件（.srt/.ass/.ssa，libass 渲染）
 *（内嵌文本轨不支持：subtitles 滤镜需按路径重新解封装源文件，大文件不可行）
 */
export async function probeMovieCodecs(movieId) {
  let cached = probeCache.get(movieId)
  if (!cached) {
    const row = db.prepare('SELECT video_file FROM movie WHERE id = ?').get(movieId)
    if (!row?.video_file) return null
    const probeCmd = await getFFprobeCmd()
    if (!probeCmd) return null
    const out = await runProbe(probeCmd, [
      '-v', 'error', '-show_entries',
      'stream=codec_type,codec_name,profile,width,height,pix_fmt,color_transfer:stream_tags=language:format=format_name,duration',
      '-of', 'json', row.video_file
    ])
    if (!out) return null
    let info
    try { info = JSON.parse(out) } catch { return null }
    const video = (info.streams || []).find(s => s.codec_type === 'video')
    const audio = (info.streams || []).find(s => s.codec_type === 'audio')
    const subStreams = (info.streams || []).filter(s => s.codec_type === 'subtitle')
    const transfer = video?.color_transfer || ''
    cached = {
      ok: true,
      video_codec: video?.codec_name || '',
      profile: video?.profile || '',
      width: video?.width || 0,
      height: video?.height || 0,
      pix_fmt: video?.pix_fmt || '',
      color_transfer: transfer,
      hdr: transfer === 'smpte2084' || transfer === 'arib-std-b67', // HDR10 / HLG
      audio_codec: audio?.codec_name || '',
      duration: parseFloat(info?.format?.duration) || 0,
      videoFile: row.video_file,
      // 内嵌字幕流：rel = 文件内第几条字幕流（[0:s:rel] 用），abs = 绝对流序号（subtitles=si= 用）
      embeddedSubs: subStreams.map((s, i) => ({
        rel: i,
        abs: s.index,
        codec: s.codec_name || '',
        lang: s.tags?.language || ''
      })),
      probedAt: Date.now()
    }
    probeCache.set(movieId, cached)
  }
  const subs = []
  for (const s of cached.embeddedSubs) {
    if (/pgs|dvb_subtitle|dvd_subtitle|xsub/.test(s.codec)) subs.push({ idx: subs.length, kind: 'pgs', label: `内嵌 ${s.rel + 1}`, lang: s.lang, rel: s.rel, abs: s.abs })
    // 内嵌文本轨（mkv 里的 ass/srt）不支持烧录：subtitles 滤镜要用源文件路径二次解封装，
    // 对几十 GB 的 remux 会从头顺序读整个文件（实测 10 分钟出不来 2 秒内容），完全不可用。
    // 用户可把字幕导出成 .ass/.srt 放到视频同目录（外挂路径即刻生效）。
  }
  for (const f of findExternalSubs(cached.videoFile)) {
    subs.push({ idx: subs.length, kind: 'file', label: path.basename(f), file: f })
  }
  return { ...cached, has_subs: subs.length > 0, subs, defaultSub: pickDefaultSub(subs) }
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
  // 10-bit H.264（High 10 profile）浏览器一律解不了，必须转码压到 8-bit
  if (info.video_codec === 'h264' && /10/.test(info.pix_fmt || '')) return false
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

/** 杀掉全部转码会话（服务退出 / 孤儿清理保底用） */
export function killAllSessions() {
  for (const s of [...sessions.values()]) {
    try {
      if (s.ffmpeg) { s.ffmpeg.kill('SIGKILL'); s.ffmpeg = null }
      if (s.timer) { clearTimeout(s.timer); s.timer = null }
      fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {})
    } catch {}
  }
  sessions.clear()
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

// 文件存在性检查（带重试）：机械盘休眠唤醒瞬间首次 stat 可能瞬时失败，重试即可
async function statWithRetry(file, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return fs.statSync(file) } catch (e) { lastErr = e }
    await new Promise(r => setTimeout(r, 400))
  }
  throw lastErr
}

/**
 * 启动转码会话：按优先级尝试转码后端（nvenc → nvdec → qsv → cpu），
 * 第一个 HLS 分段产出才算启动成功。返回 { sid, startAt }
 */
export async function startTranscode(movieId, startAt = 0, subIdx) {
  const row = db.prepare('SELECT video_file FROM movie WHERE id = ?').get(movieId)
  if (!row?.video_file) {
    const err = new Error('电影不存在或无视频文件')
    err.status = 404
    throw err
  }
  try { await statWithRetry(row.video_file) } catch {
    const err = new Error('视频文件已缺失或无法访问')
    err.status = 404
    throw err
  }
  // 探测编码信息（内存缓存）：决定是否缩放 / HDR 色调映射，并校验起点不超时长
  const info = await probeMovieCodecs(movieId)
  const pos = Math.max(0, Number(startAt) || 0)
  if (pos > 0 && info?.duration && pos >= info.duration - 0.5) {
    const err = new Error('进度超出影片时长')
    err.status = 400
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
    sid, movieId, startAt: pos, ffmpeg: null, dir, backend: '',
    m3u8: path.join(dir, 'index.m3u8'),
    startedAt: Date.now(), lastTouch: Date.now(), segments: 0, timer: null,
    transcodedUs: 0,   // ffmpeg -progress 管道上报的已转码时长（微秒）
    progressDone: false
  }
  sessions.set(sid, session)

  const srcWidth = info?.width || 0
  const hdr = info?.hdr || false
  const needScale = srcWidth > 1920
  // HDR10/HLG → SDR 色调映射（不映射直接压 8-bit 会发灰发白）
  const TONEMAP = 'zscale=transfer=linear:npl=100,tonemap=hable,zscale=transfer=bt709:primaries=bt709:matrix=bt709'

  // ---- 字幕烧录 ----
  // subIdx = -1 关闭；undefined/null → 探测结果的中文优先默认轨；数字 → 指定轨
  let sub = null
  if (subIdx !== -1) {
    const want = (subIdx === undefined || subIdx === null) ? (info?.defaultSub ?? -1) : subIdx
    sub = (info?.subs || []).find(s => s.idx === want) || null
  }
  if (sub) console.log(`[stream] 烧录字幕：${sub.label}${sub.lang ? '(' + sub.lang + ')' : ''}`)
  // 滤镜参数里写文件路径需要转义（冒号 / 反斜杠 / 单引号都是滤镜语法字符）
  const escFilterPath = p => "'" + p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'") + "'"

  // 组装某后端的视频参数（流映射 + 滤镜链 + 编码器）。
  // 基础链：按需缩放到 1080p 上限 + 按需 HDR→SDR；统一 8-bit（浏览器 H.264 只支持 8-bit，
  // 10-bit 源不强制转换会输出 High 10 profile，网页一律黑屏/无法播放）
  const buildVideo = (outFmt, enc) => {
    const chain = [
      ...(needScale ? ['scale=1920:-2:flags=bicubic'] : []),
      ...(hdr ? [TONEMAP] : [])
    ]
    if (!sub) return ['-map', '0:v:0', '-vf', [...chain, `format=${outFmt}`].join(','), ...enc]
    if (sub.kind === 'pgs') {
      // 图形字幕（蓝光 PGS / DVB）：解码成带 alpha 的帧后在 filter_complex 里叠加。
      // UHD 原盘的 PGS 本身是 2160p，视频缩到 1080p 时字幕同样要缩放
      return [
        '-filter_complex',
        `[0:v:0]${[...chain, 'format=yuv420p'].join(',')}[bg];[0:s:${sub.rel}]${needScale ? 'scale=1920:-2' : 'null'}[sb];[bg][sb]overlay,format=${outFmt}[v]`,
        '-map', '[v]', ...enc
      ]
    }
    // 文本字幕（外挂 srt/ass）：libass 渲染，样式特效全保留
    const subFilter = `subtitles=filename=${escFilterPath(sub.file)}`
    return ['-map', '0:v:0', '-vf', [...chain, subFilter, `format=${outFmt}`].join(','), ...enc]
  }

  // 转码后端，按优先级尝试（多 GPU 机器上 QSV/d3d11 会话初始化常失败，故只做这四种组合）
  const backends = [
    ...(sub ? [] : [{
      // NVIDIA 全 GPU 管线：硬解 + GPU 缩放 + NVENC 硬编（需较新显卡驱动，旧驱动秒退自动降级）。
      // 烧字幕需在 CPU 帧上叠加/渲染，此时跳过全 GPU 后端走 nvdec（实测代价仅 ~2%）
      name: 'nvenc',
      hwaccel: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      video: [
        '-map', '0:v:0',
        '-vf', (hdr
          ? [...(needScale ? ['scale_cuda=1920:-2'] : []), 'hwdownload', 'format=p010le', TONEMAP, 'format=nv12']
          : [needScale ? 'scale_cuda=1920:-2:format=nv12' : 'scale_cuda=format=nv12']
        ).join(','),
        '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '27', '-maxrate', '5M', '-bufsize', '10M', '-b:v', '0'
      ]
    }]),
    {
      // NVIDIA 硬解（帧拷回内存）+ CPU 滤镜 + x264 软编：驱动旧也能吃到 GPU 解码
      name: 'nvdec',
      hwaccel: ['-hwaccel', 'cuda'],
      video: buildVideo('yuv420p', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'])
    },
    {
      // Intel 核显硬编（CPU 解码）
      name: 'qsv',
      hwaccel: [],
      video: buildVideo('nv12', ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '25'])
    },
    {
      // 纯 CPU 兜底
      name: 'cpu',
      hwaccel: [],
      video: buildVideo('yuv420p', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'])
    }
  ]

  let proc = null
  for (let i = 0; i < backends.length; i++) {
    const backend = backends[i]
    session.backend = backend.name
    proc = await trySpawn(backend, session, pos, row.video_file, dir, i === backends.length - 1)
    if (proc) break
    console.log(`[stream] 转码后端 ${backend.name} 不可用${session.lastError ? `（${String(session.lastError).slice(0, 120)}）` : ''}，尝试下一个`)
  }
  if (!proc) {
    const reason = session.lastError || 'ffmpeg 不可用'
    killSession(session)
    const err = new Error(`无法启动转码：${reason}`)
    err.status = 500
    throw err
  }
  session.ffmpeg = proc
  console.log(`[stream] 转码启动 sid=${sid} backend=${session.backend}${needScale ? ' 缩放→1080p' : ''}${hdr ? ' HDR→SDR' : ''}${sub ? ` 烧录字幕(${sub.label})` : ''}`)
  scheduleCleanup(session)
  return { sid, startAt: pos }
}

/**
 * 校验会话目录里首个分段确实含视频流。
 * 防御"后端表面跑通、实际只吐音频"的坏输出（首段是纯音频时该后端必须被放弃）。
 * ffprobe 不可用时跳过校验（不因校验工具缺失而阻塞播放）。
 */
async function firstSegmentHasVideo(dir) {
  const probeCmd = await getFFprobeCmd()
  if (!probeCmd) return true
  let seg = null
  try {
    seg = fs.readdirSync(dir).filter(f => /^seg\d+\.ts$/.test(f)).sort()[0]
  } catch { return true }
  if (!seg) return true
  const out = await runProbe(probeCmd, [
    '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
    path.join(dir, seg)
  ], 8000)
  return out == null || /video/.test(out)
}

/**
 * 启动 ffmpeg 并等待第一个 HLS 分段写入 m3u8（= 该转码管线真正跑通）。
 * 进程报错退出 / 超时返回 null（原因记入 session.lastError）。
 * acceptOnTimeout：最后一个兜底后端超时但进程仍存活时，选择接受（慢转好过不能转）。
 */
async function trySpawn(backend, session, pos, videoFile, dir, acceptOnTimeout = false) {
  const ffmpegCmd = await getFFmpegCmd()
  if (!ffmpegCmd) { session.lastError = '未找到可用的 ffmpeg'; return null }
  // 清理上一个后端尝试的残留文件 + 复位进度状态：
  // 失败的尝试临终也会向 -progress 管道吐出 progress=end / out_time_us=0，
  // 不复位的话会污染本会话（误报"转码完成"）
  try {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  } catch { /* 目录不存在则忽略 */ }
  session.transcodedUs = 0
  session.progressDone = false
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-progress', 'pipe:1', // 转码进度从管道上报（读 m3u8 会与 ffmpeg 的原子重命名冲突）
    '-fflags', '+genpts',
    ...backend.hwaccel,
    ...(pos > 0 ? ['-ss', pos.toFixed(2)] : []), // 输入端快速定位到起点
    '-i', videoFile,
    // 视频流映射在 backend.video 里（烧 PGS 字幕时用 filter_complex 输出 [v]）
    '-map', '0:a:0?',
    ...backend.video,
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-f', 'hls',
    '-hls_time', String(HLS_SEG_SECONDS),
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments+append_list',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    path.join(dir, 'index.m3u8')
  ]
  const isJs = /\.(mjs|cjs|js)$/i.test(ffmpegCmd)
  const exe = isJs ? process.execPath : ffmpegCmd
  const fullArgs = isJs ? [ffmpegCmd, ...args] : args
  return new Promise(resolve => {
    let child
    try {
      child = spawn(exe, fullArgs, { windowsHide: true })
    } catch (e) {
      session.lastError = `ffmpeg 启动失败：${e?.message || e}`
      return resolve(null)
    }
    let stderr = ''
    let pbuf = '' // -progress 输出的滚动缓冲
    let settled = false
    let pollTimer = null
    let giveUpTimer = null
    const finish = ok => {
      if (settled) return
      settled = true
      clearInterval(pollTimer)
      clearTimeout(giveUpTimer)
      if (ok) return resolve(child)
      try { child.kill('SIGKILL') } catch {}
      resolve(null)
    }
    // -progress 管道：out_time_us=微秒；progress=end 表示全片转完
    child.stdout.on('data', d => {
      pbuf = (pbuf + d.toString()).slice(-4096)
      let m
      if ((m = pbuf.match(/out_time_us=(\d+)/))) session.transcodedUs = parseInt(m[1], 10)
      if (/progress=end/.test(pbuf)) session.progressDone = true
    })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', e => {
      session.lastError = e?.message ? `ffmpeg 启动失败：${e.message}` : 'ffmpeg 启动失败'
      finish(false)
    })
    child.on('close', code => {
      if (!settled) {
        // 等待首个分段期间退出 = 该后端启动失败，记录真实报错便于定位
        session.lastError = (code !== 0 && stderr)
          ? `ffmpeg 退出(code=${code})：${stderr.slice(-200).trim()}`
          : `ffmpeg 退出(code=${code})`
        finish(false)
        return
      }
      // 运行期退出（全片转完 / 出错 / 被停止），分段文件保留供继续 seek
      console.log(`[stream] ffmpeg(${session.backend}) exited code=${code}`)
      if (code !== 0 && stderr) console.error('[stream] ffmpeg stderr:', stderr.slice(-500))
      const s = sessions.get(session.sid)
      if (s) {
        s.ffmpeg = null
        if (code === 0) s.progressDone = true // 干净退出 = 全片转完（含 ENDLIST）
      }
    })
    // m3u8 文件出现 = 首个分段完成、播放列表已可播。
    // 用 statSync（不开文件句柄）判断：Node 读文件不带 FILE_SHARE_DELETE，
    // readFileSync 会挡住 ffmpeg 对 m3u8 的 tmp→正式名原子重命名，导致转码被杀。
    pollTimer = setInterval(() => {
      try {
        const st = fs.statSync(session.m3u8)
        if (st.size > 0) {
          clearInterval(pollTimer)
          // 再确认首段真的含视频流（防"只吐音频"的坏后端被误判为成功）
          firstSegmentHasVideo(dir).then(ok => {
            if (ok) finish(true)
            else {
              session.lastError = '首个分段不含视频流（后端输出异常）'
              finish(false)
            }
          })
        }
      } catch { /* m3u8 尚未生成 */ }
    }, 400)
    // 保底：20 秒未产出分段则放弃该后端
    giveUpTimer = setTimeout(() => {
      if (acceptOnTimeout && child.exitCode === null && !child.killed) {
        finish(true) // 兜底后端很慢但活着：接受
      } else {
        session.lastError = '20 秒内未产出第一个 HLS 分段'
        finish(false)
      }
    }, 20000)
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

/** 会话转码进度：来自 ffmpeg -progress 管道（不读 m3u8，避免与原子重命名冲突） */
export function sessionProgress(sid) {
  const s = sessions.get(sid)
  if (!s) return null
  return {
    sid: s.sid,
    movieId: s.movieId,
    startAt: s.startAt,
    transcodedTo: s.startAt + (s.transcodedUs || 0) / 1e6,
    done: !!s.progressDone, // 全片（从起点到结尾）转码完成
    running: !!s.ffmpeg
  }
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
    res.set('Cache-Control', 'no-store')
    if (file.endsWith('.m3u8')) {
      // 播放列表整读快放：createReadStream 会持有句柄到网络发送完毕，
      // 期间会挡住 ffmpeg 对 m3u8 的原子重命名（Windows 无 FILE_SHARE_DELETE）
      res.set('Content-Type', 'application/vnd.apple.mpegurl')
      res.end(fs.readFileSync(target))
    } else {
      res.set('Content-Type', 'video/mp2t')
      fs.createReadStream(target).pipe(res)
    }
  } catch {
    res.status(404).json({ error: '分段尚未生成' })
  }
}
