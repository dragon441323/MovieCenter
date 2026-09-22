import { Router } from 'express'
import { db } from '../db.js'
import { similarMovies, tasteProfile, scoreUnwatchedByTaste } from '../recommend.js'
import { serializeMovie } from './movies.js'

export const recommendRouter = Router()

function parseId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 与某部影片相似的作品
recommendRouter.get('/similar/:id', (req, res) => {
  const id = parseId(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的 ID' })
  const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 8))
  const items = similarMovies(id, limit)
  res.json({ items })
})

// 口味画像
recommendRouter.get('/taste', (req, res) => {
  res.json(tasteProfile())
})

/**
 * 按口味随机挑一部未看影片（盲盒口味模式）。
 * 权重 = 口味匹配分 + 评分加成；库太小或无口味数据时退化为纯随机。
 */
recommendRouter.post('/pick-by-taste', (req, res) => {
  const profile = tasteProfile()
  const candidates = db.prepare(
    'SELECT * FROM movie WHERE missing = 0 AND watched = 0'
  ).all()
  if (!candidates.length) return res.status(404).json({ error: '没有未看过的电影' })

  let picked = null
  if (profile.samples >= 3 && candidates.length > 2) {
    const weighted = candidates.map(m => ({
      movie: m,
      w: 1 + scoreUnwatchedByTaste(profile, m)
    }))
    const total = weighted.reduce((s, x) => s + Math.max(0.01, x.w), 0)
    let roll = Math.random() * total
    for (const x of weighted) {
      roll -= Math.max(0.01, x.w)
      if (roll <= 0) {
        picked = x.movie
        break
      }
    }
  }
  if (!picked) picked = candidates[Math.floor(Math.random() * candidates.length)]

  const row = db.prepare('SELECT * FROM movie WHERE id = ?').get(picked.id)
  res.json({ movie: serializeMovie(row), taste_mode: profile.samples >= 3 })
})
