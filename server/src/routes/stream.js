import { Router } from 'express'
import { db } from '../db.js'
import {
  probeMovieCodecs, canDirectPlay, directStream,
  startTranscode, getSession, touchSession, stopSession, serveHlsPart, sessionProgress, transcodeStats
} from '../stream.js'

export const streamRouter = Router()

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 探测编码，判断走直连还是转码 */
streamRouter.get('/:id/probe', async (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const row = db.prepare('SELECT id, video_file, missing FROM movie WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '电影不存在' })
  if (row.missing) return res.status(400).json({ error: '文件已缺失' })

  const info = await probeMovieCodecs(id)
  if (!info) {
    // ffprobe 不可用或探测失败：给出保守建议（直连试试，不行再转码）
    return res.json({
      probe_ok: false,
      mode: 'direct',
      note: '编码探测不可用（未安装 FFmpeg?），默认直连播放'
    })
  }
  const direct = canDirectPlay(info)
  res.json({
    probe_ok: true,
    mode: direct ? 'direct' : 'transcode',
    video_codec: info.video_codec,
    audio_codec: info.audio_codec,
    profile: info.profile,
    width: info.width,
    height: info.height,
    pix_fmt: info.pix_fmt,
    hdr: !!info.hdr,
    duration: info.duration,
    // 可烧录字幕（内嵌 + 外挂），供播放方式弹窗选择
    subs: (info.subs || []).map(s => ({
      idx: s.idx,
      kind: s.kind,
      label: s.label,
      lang: s.lang || ''
    })),
    defaultSub: info.defaultSub ?? -1,
    note: direct
      ? '浏览器可直接播放，原画质直连'
      : `${info.video_codec}${info.audio_codec ? ' / ' + info.audio_codec : ''}${info.hdr ? ' HDR' : ''} 浏览器不支持，服务器转码为 1080p H.264${info.hdr ? '（HDR→SDR）' : ''}`
  })
})

/** 直连流（Range 请求） */
streamRouter.get('/:id/direct', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  directStream(req, res, id)
})

/** 开启转码会话 */
streamRouter.post('/:id/transcode', async (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  try {
    // subIdx：-1 关字幕；null/undefined 用默认（中文优先）；数字 = probe 返回的 subs[].idx
    // targetHeight：2160（4K 保画质）/ 1080（默认）
    const r = await startTranscode(id, req.body?.startAt, req.body?.subIdx, req.body?.targetHeight)
    res.json({ sid: r.sid, startAt: r.startAt, stats: transcodeStats() })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

/** 会话心跳 */
streamRouter.post('/session/:sid/heartbeat', (req, res) => {
  const s = touchSession(req.params.sid)
  if (!s) return res.status(404).json({ error: '会话已结束' })
  res.json({ ok: true, stats: transcodeStats() })
})

/** 会话转码进度（播放器进度条上的"已转码"区域）。注意要放在 /:file 通配路由之前 */
streamRouter.get('/session/:sid/progress', (req, res) => {
  const p = sessionProgress(req.params.sid)
  if (!p) return res.status(404).json({ error: '会话已结束' })
  res.json(p)
})

/** 主动结束会话 */
streamRouter.post('/session/:sid/stop', (req, res) => {
  const ok = stopSession(req.params.sid)
  res.json({ ok })
})

/** HLS：m3u8 与分段（:sid 为会话，:file 为文件名） */
streamRouter.get('/session/:sid/:file', async (req, res) => {
  await serveHlsPart(req, res, req.params.sid, req.params.file)
})

/** 转码负载状态 */
streamRouter.get('/stats', (req, res) => {
  res.json(transcodeStats())
})
