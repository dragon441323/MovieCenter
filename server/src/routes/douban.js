import { Router } from 'express'
import { db } from '../db.js'
import { ensureTop250, getRatingSyncState, getTop250, getTop250UpdatedAt, refreshTop250, startRatingSync } from '../douban.js'

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

doubanRouter.get('/ratings', (req, res) => {
  res.json(getRatingSyncState())
})
