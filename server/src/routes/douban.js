import { Router } from 'express'
import { db } from '../db.js'
import { ensureTop250, getRatingSyncState, getTop250, getTop250UpdatedAt, refreshTop250, startRatingSync, searchDoubanPage, searchDoubanForMovie, fetchSubjectRating } from '../douban.js'

export const doubanRouter = Router()

function buildPayload() {
  const items = db.prepare(`
    SELECT d.rank, d.douban_id, d.title, d.original_title, d.year, d.rating,
           m.id AS movie_id, m.title AS movie_title
    FROM douban_top250 d
    LEFT JOIN movie m ON m.douban_id = d.douban_id
    ORDER BY d.rank
  `).all()
  const matched = db.prepare('SELECT COUNT(*) AS c FROM movie WHERE douban_rank IS NOT NULL').get().c
  const rated = db.prepare('SELECT COUNT(*) AS c FROM movie WHERE douban_rating IS NOT NULL').get().c
  return { updated_at: getTop250UpdatedAt(), total: items.length, matched, rated, items }
}

doubanRouter.get('/top250', async (req, res) => {
  try {
    await ensureTop250()
  } catch (e) {
    if (!getTop250().length) return res.status(e.status || 502).json({ error: e.message })
  }
  res.json(buildPayload())
})

doubanRouter.post('/refresh', async (req, res) => {
  try {
    await refreshTop250()
    res.json(buildPayload())
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

doubanRouter.post('/ratings', (req, res) => {
  try {
    res.json(startRatingSync())
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

/** 豆瓣候选搜索：按片名搜，返回全部候选（不做自动匹配，供前端手动挑） */
doubanRouter.post('/search', async (req, res) => {
  try {
    const movieId = Number(req.body?.movieId)
    if (!Number.isInteger(movieId) || movieId <= 0) return res.status(400).json({ error: '无效的影片 ID' })
    const movie = db.prepare('SELECT id, title, original_title, year FROM movie WHERE id = ?').get(movieId)
    if (!movie) return res.status(404).json({ error: '电影不存在' })
    const query = String(req.body?.query || '').trim() || movie.title
    const list = await searchDoubanPage(query)
    res.json({ candidates: list.slice(0, 20) })
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

/** 单片豆瓣评分同步：有 ID 按 ID 取，无 ID 搜索自动匹配；都不行返回 matched:false 由前端转手动 */
doubanRouter.post('/sync-movie', async (req, res) => {
  try {
    const movieId = Number(req.body?.movieId)
    if (!Number.isInteger(movieId) || movieId <= 0) return res.status(400).json({ error: '无效的影片 ID' })
    const movie = db.prepare('SELECT id, title, original_title, year, douban_id, douban_rating FROM movie WHERE id = ?').get(movieId)
    if (!movie) return res.status(404).json({ error: '电影不存在' })

    let doubanId = movie.douban_id || null
    let rating = null
    if (doubanId) {
      // 已绑定：直接按 ID 刷新评分
      rating = await fetchSubjectRating(doubanId)
    } else {
      // 未绑定：搜索自动匹配（标题归一化 + 年份 ±1）
      const cand = await searchDoubanForMovie(movie)
      if (cand) {
        doubanId = cand.doubanId
        rating = cand.rating
        if (rating == null) rating = await fetchSubjectRating(doubanId)
      }
    }
    if (doubanId) {
      db.prepare('UPDATE movie SET douban_id = ?, douban_rating = ? WHERE id = ?').run(doubanId, rating, movieId)
    }
    res.json({ matched: !!doubanId, douban_id: doubanId, douban_rating: rating })
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

/** 手动绑定豆瓣条目：按 ID 取评分写入（无评分也存 ID，方便日后补） */
doubanRouter.post('/bind', async (req, res) => {
  try {
    const movieId = Number(req.body?.movieId)
    const doubanId = String(req.body?.doubanId || '').trim()
    if (!Number.isInteger(movieId) || movieId <= 0) return res.status(400).json({ error: '无效的影片 ID' })
    if (!doubanId) return res.status(400).json({ error: '缺少豆瓣条目 ID' })
    const movie = db.prepare('SELECT id FROM movie WHERE id = ?').get(movieId)
    if (!movie) return res.status(404).json({ error: '电影不存在' })
    const rating = await fetchSubjectRating(doubanId)
    db.prepare('UPDATE movie SET douban_id = ?, douban_rating = ? WHERE id = ?').run(doubanId, rating, movieId)
    res.json({ ok: true, douban_id: doubanId, douban_rating: rating })
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
})

doubanRouter.get('/ratings', (req, res) => {
  res.json(getRatingSyncState())
})
