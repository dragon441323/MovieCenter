import { Router } from 'express'
import { db } from '../db.js'
import { parseCategories } from './movies.js'

export const metaRouter = Router()

metaRouter.get('/', (req, res) => {
  const catSet = new Set()
  for (const r of db.prepare("SELECT category FROM movie WHERE missing = 0 AND category != ''").all()) {
    for (const c of parseCategories(r.category)) catSet.add(c)
  }
  res.json({
    categories: [...catSet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    years: db.prepare(
      'SELECT DISTINCT year FROM movie WHERE missing = 0 AND year IS NOT NULL ORDER BY year DESC'
    ).all().map(r => r.year),
    tags: db.prepare(`
      SELECT t.id, t.name, COUNT(mt.movie_id) AS movie_count
      FROM tag t LEFT JOIN movie_tag mt ON mt.tag_id = t.id
      GROUP BY t.id, t.name
      ORDER BY t.name COLLATE NOCASE
    `).all(),
    stats: {
      total: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0').get().c,
      missing: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 1').get().c,
      watched: db.prepare('SELECT COUNT(*) AS c FROM movie WHERE missing = 0 AND watched = 1').get().c,
      total_size: db.prepare('SELECT COALESCE(SUM(file_size), 0) AS c FROM movie WHERE missing = 0').get().c
    }
  })
})
