import { Router } from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { db } from '../db.js'
import * as tmdb from '../tmdb.js'
import { parseWishlistText, importWishlist, getWishlist, setWishlistStatus, removeWishlist, matchWishlistToLibrary } from '../wishlist.js'
import { applyDoubanWishlist, applyDoubanWatched } from '../wishlist.js'
import { startWishSync, getWishSyncState } from '../douban.js'

export const wishlistRouter = Router()

// 想看清单列表
wishlistRouter.get('/', (req, res) => {
  res.json({ items: getWishlist(req.query.status) })
})

// ---- 豆瓣账号同步 ----

// 同步状态
wishlistRouter.get('/sync-douban', (req, res) => {
  res.json(getWishSyncState())
})

// 豆瓣海报代理（图床要求 Referer 为 douban.com，浏览器直连会 403/418）
const posterCache = new Map() // url -> Buffer
wishlistRouter.get('/poster', async (req, res) => {
  const url = String(req.query.url || '')
  if (!/^https?:\/\/[\w.-]*\.doubanio\.com\//i.test(url)) {
    return res.status(400).json({ error: '仅允许豆瓣图床地址' })
  }
  if (posterCache.has(url)) {
    const buf = posterCache.get(url)
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=604800')
    return res.send(buf)
  }
  try {
    const { fetch: undiciFetch } = await import('undici')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const r = await undiciFetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        referer: 'https://movie.douban.com/'
      },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!r.ok) return res.status(502).json({ error: `图床返回 ${r.status}` })
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 5 * 1024 * 1024) return res.status(502).json({ error: '图片过大' })
    posterCache.set(url, buf)
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=604800')
    res.send(buf)
  } catch {
    res.status(502).json({ error: '海报获取失败' })
  }
})

// 发起同步（uid: 请求参数优先，否则用设置里存的）
wishlistRouter.post('/sync-douban', async (req, res) => {
  let uid = String(req.body?.uid || '').trim()
  if (!uid) {
    const row = db.prepare('SELECT value FROM settings WHERE "key" = ?').get('douban_uid')
    uid = row?.value || ''
  }
  if (!/^\d{1,20}$/.test(uid)) {
    return res.status(400).json({ error: '请提供豆瓣 UID（纯数字）' })
  }
  // 记住 UID 方便下次直接同步
  db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value').run('douban_uid', uid)
  try {
    // 先探测第一页验证 UID 有效（拉不到或为空都直接报错）
    const { fetchUserInterestsFirstPage } = await import('../douban.js')
    const probe = await fetchUserInterestsFirstPage(uid, 'mark')
    if (!probe.total) {
      return res.status(400).json({ error: '该用户没有电影想看记录（确认 UID 是否正确、片单是否公开）' })
    }
    startWishSync(uid, { applyWishlist: applyDoubanWishlist, applyWatched: applyDoubanWatched })
    res.json({ started: true, wish_total: probe.total, uid })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// 导入文本（豆瓣想看列表复制粘贴）
wishlistRouter.post('/import', (req, res) => {
  const text = String(req.body?.text || '')
  const items = parseWishlistText(text)
  if (!items.length) return res.status(400).json({ error: '没有解析出任何条目，请检查粘贴的内容' })
  const r = importWishlist(items)
  res.json({ parsed: items.length, ...r })
})

// 用库内影片手动匹配某条想看
wishlistRouter.post('/:id/match', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  const movieId = Number(req.body?.movie_id)
  if (!Number.isInteger(movieId) || movieId <= 0) return res.status(400).json({ error: '无效的 movie_id' })
  if (!db.prepare('SELECT id FROM movie WHERE id = ?').get(movieId)) {
    return res.status(404).json({ error: '电影不存在' })
  }
  const row = setWishlistStatus(id, 'obtained', movieId)
  res.json({ item: { ...row, poster_url: null, in_library: true } })
})

// 修改状态 / 删除
wishlistRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  try {
    const row = setWishlistStatus(id, String(req.body?.status || ''))
    res.json({ item: { ...row, poster_url: null, in_library: !!row.movie_id } })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

wishlistRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '无效的 ID' })
  try {
    removeWishlist(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// 立即执行一次“与库内匹配”
wishlistRouter.post('/match', (req, res) => {
  res.json({ matched: matchWishlistToLibrary() })
})

// TMDB 海报回填（wanted 且无海报的条目，逐条搜索取第一候选海报）
const POSTER_DIR = () => {
  const dir = path.join(process.env.MC_DATA_DIR || path.resolve(process.cwd(), '../data'), 'covers')
  fsSync.mkdirSync(dir, { recursive: true })
  return dir
}

wishlistRouter.post('/enrich', async (req, res) => {
  if (!tmdb.getTmdbConfig().apiKey) {
    return res.status(400).json({ error: '未配置 TMDB API Key' })
  }
  const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 20))
  const rows = db.prepare(
    "SELECT * FROM wishlist WHERE status = 'wanted' AND poster = '' ORDER BY id LIMIT ?"
  ).all(limit)
  const update = db.prepare(
    "UPDATE wishlist SET tmdb_id = ?, poster = ?, year = COALESCE(year, ?), updated_at = datetime('now') WHERE id = ?"
  )
  const savePoster = async posterPath => {
    if (!posterPath) return ''
    const buf = await tmdb.downloadImage(posterPath, 'w300')
    if (!buf) return ''
    const name = `wish_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`
    await fs.writeFile(path.join(POSTER_DIR(), name), buf)
    return name
  }
  let enriched = 0
  for (const w of rows) {
    try {
      const results = await tmdb.searchMovies(w.title, w.year || undefined)
      const best = (results || [])[0]
      if (!best) continue
      const poster = await savePoster(best.poster_path || '')
      update.run(best.id, poster, best.release_date ? Number(best.release_date.slice(0, 4)) : null, w.id)
      enriched++
      await new Promise(r => setTimeout(r, 250))
    } catch {}
  }
  res.json({ checked: rows.length, enriched })
})
