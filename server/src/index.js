import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec } from 'node:child_process'
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
import { scanAll, addDefaultMoviePaths } from './scanner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000

const app = express()
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.use('/api/movies', movieRouter)
app.use('/api/tags', tagRouter)
app.use('/api/scan', scanRouter)
app.use('/api/meta', metaRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/player', playerRouter)
app.use('/api/person', personRouter)
app.use('/api/douban', doubanRouter)
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
  scanAll()
    .then(r => console.log('[scan] startup scan done:', JSON.stringify(r)))
    .catch(err => console.error('[scan] startup scan failed:', err.message))
})
