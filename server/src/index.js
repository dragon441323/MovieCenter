import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COVERS_DIR, PERSONS_DIR, db } from './db.js'
import { movieRouter } from './routes/movies.js'
import { tagRouter } from './routes/tags.js'
import { scanRouter } from './routes/scan.js'
import { metaRouter } from './routes/meta.js'
import { scrapeRouter } from './routes/scrape.js'
import { settingsRouter } from './routes/settings.js'
import { playerRouter } from './routes/player.js'
import { personRouter } from './routes/person.js'
import { doubanRouter } from './routes/douban.js'
import { systemRouter } from './routes/system.js'
import { newsRouter } from './routes/news.js'
import { statsRouter } from './routes/stats.js'
import { collectionRouter } from './routes/collections.js'
import { diaryRouter } from './routes/diary.js'
import { recommendRouter } from './routes/recommend.js'
import { wishlistRouter } from './routes/wishlist.js'
import { nfoRouter } from './routes/nfo.js'
import { searchRouter } from './routes/search.js'
import { playlistRouter } from './routes/playlists.js'
import { streamRouter } from './routes/stream.js'
import { killAllSessions } from './stream.js'
import { scanAll, addDefaultMoviePaths } from './scanner.js'
import { ffprobeAvailable } from './probe.js'
import { ensureWeeklyBackup } from './backup.js'
import { matchWishlistToLibrary } from './wishlist.js'
import { startWatcher } from './watcher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 9527

// ---------- 转码进程保底 ----------
// 优雅退出（Ctrl+C / 停止服务）时终止所有 ffmpeg 转码子进程；
// 强杀进程（taskkill /F、崩溃）不经过这里，由下方启动清扫兜底。
process.on('SIGINT', () => { killAllSessions(); process.exit(0) })
process.on('SIGTERM', () => { killAllSessions(); process.exit(0) })
process.on('exit', () => { try { killAllSessions() } catch {} })

// 启动时清扫上次异常退出遗留的孤儿 ffmpeg 与临时分段目录。
// 必须在 app.listen 之前 await 完成：清扫若晚于监听，迟到的进程查杀 / 目录删除
// 会误伤刚创建的转码会话（表现为启动后头几秒开播必失败）。
function sweepOrphanTranscoders() {
  return new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    // 保底：查杀若卡死不能拖死服务器启动
    setTimeout(finish, 10000).unref()
    const tmpHls = path.join(os.tmpdir(), 'moviecenter-hls')
    const rmLeftover = () => {
      try { fs.rmSync(tmpHls, { recursive: true, force: true }) } catch { /* 句柄未释放则留给下次启动清理 */ }
      finish()
    }
    if (process.platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like '*moviecenter-hls*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (_err, stdout) => {
        const pids = String(stdout || '').trim().split(/\s+/).filter(Boolean)
        if (pids.length) console.log(`[stream] 已清理上次遗留的转码进程: PID ${pids.join(', ')}`)
        setTimeout(rmLeftover, 500) // 等被杀进程的句柄释放后再删目录
      })
    } else {
      try { execFile('pkill', ['-f', 'moviecenter-hls'], () => {}) } catch {}
      setTimeout(rmLeftover, 300)
    }
  })
}

const app = express()
app.use(express.json({ limit: '2mb' }))

// 代码版本指纹：server/src 下所有 .js 文件的最新 mtime（Unix 秒）。
// start.bat 用它判断运行中的服务是否为最新代码，旧版本自动重启换新。
function computeCodeStamp() {
  let latest = 0
  const walk = dir => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.js')) {
        try {
          const m = fs.statSync(full).mtimeMs
          if (m > latest) latest = m
        } catch {}
      }
    }
  }
  walk(__dirname)
  return String(Math.floor(latest / 1000))
}
const CODE_STAMP = computeCodeStamp()
const STARTED_AT = new Date().toISOString()

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.get('/api/version', (req, res) => {
  if (req.query.plain !== undefined) return res.type('text/plain').send(CODE_STAMP)
  res.json({ code: CODE_STAMP, started_at: STARTED_AT, node: process.version })
})
app.use('/api/movies', movieRouter)
app.use('/api/tags', tagRouter)
app.use('/api/scan', scanRouter)
app.use('/api/meta', metaRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/player', playerRouter)
app.use('/api/person', personRouter)
app.use('/api/douban', doubanRouter)
app.use('/api/system', systemRouter)
app.use('/api/stats', statsRouter)
app.use('/api/collections', collectionRouter)
app.use('/api/diary', diaryRouter)
app.use('/api/recommend', recommendRouter)
app.use('/api/wishlist', wishlistRouter)
app.use('/api/nfo', nfoRouter)
app.use('/api/search', searchRouter)
app.use('/api/playlists', playlistRouter)
app.use('/api/stream', streamRouter)
app.use('/api/news', newsRouter)
app.use('/covers', express.static(COVERS_DIR))
app.use('/persons', express.static(PERSONS_DIR))

const distDir = path.resolve(__dirname, '../../web/dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/covers/') || req.path.startsWith('/persons/')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

app.use((err, req, res, next) => {
  console.error(err)
  if (res.headersSent) return next(err)
  if (err.status) return res.status(err.status).json({ error: err.message })
  if (err.code && String(err.code).startsWith('LIMIT_')) return res.status(400).json({ error: '上传的文件过大或无效' })
  res.status(500).json({ error: '服务器内部错误' })
})

// 端口监听前完成孤儿清扫：查杀/删除若晚于监听，会误伤刚创建的转码会话
await sweepOrphanTranscoders()

app.listen(PORT, async () => {
  console.log(`[moviecenter] server listening on http://localhost:${PORT}`)
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const i of nets || []) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`[moviecenter] LAN: http://${i.address}:${PORT}`)
      }
    }
  }
  if (process.env.MC_OPEN_BROWSER === '1') {
    const url = `http://localhost:${PORT}`
    if (process.platform === 'win32') exec(`start "" ${url}`)
    else if (process.platform === 'darwin') exec(`open ${url}`)
    else exec(`xdg-open ${url}`)
  }
  try {
    const pathCount = db.prepare('SELECT COUNT(*) AS c FROM scan_path').get().c
    if (pathCount === 0) {
      const { added } = await addDefaultMoviePaths()
      if (added.length) console.log(`[moviecenter] auto-detected movie dirs: ${added.join(' ; ')}`)
    }
  } catch (err) {
    console.error('[moviecenter] auto-detect failed:', err.message)
  }
  ensureWeeklyBackup()
  ffprobeAvailable().then(ok => {
    if (ok) console.log('[probe] ffprobe 已就绪，扫描时将读取视频真实分辨率识别画质')
    else console.log('[probe] 未检测到 ffprobe，画质仅按文件名识别；安装 FFmpeg 后重启即可自动启用深度识别')
  })
  startWatcher()
  scanAll()
    .then(r => {
      console.log('[scan] startup scan done:', JSON.stringify(r))
      // 扫描后把想看清单与新入库影片自动匹配
      try {
        const matched = matchWishlistToLibrary()
        if (matched) console.log(`[wishlist] matched ${matched} wanted items to library`)
      } catch (err) {
        console.error('[wishlist] match failed:', err.message)
      }
    })
    .catch(err => console.error('[scan] startup scan failed:', err.message))
})
