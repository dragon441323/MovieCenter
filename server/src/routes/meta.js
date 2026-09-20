import { Router } from 'express'
import { db } from '../db.js'
import { parseCategories } from './movies.js'

export const metaRouter = Router()

metaRouter.get('/directors', (req, res) => {
  const map = new Map()
  for (const r of db.prepare("SELECT director FROM movie WHERE missing = 0 AND director != ''").all()) {
    for (const name of String(r.director).split(/[\/、,，;；|]/).map(s => s.trim()).filter(Boolean)) {
      map.set(name, (map.get(name) || 0) + 1)
    }
  }
  const items = [...map.entries()].map(([name, count]) => ({ name, count }))
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  res.json({ items })
})

metaRouter.get('/actors', (req, res) => {
  const map = new Map()
  for (const r of db.prepare("SELECT actors FROM movie WHERE missing = 0 AND actors != ''").all()) {
    let arr = []
    try { arr = JSON.parse(r.actors) } catch { continue }
    if (!Array.isArray(arr)) continue
    for (const name of arr) {
      if (typeof name === 'string' && name.trim()) {
        const n = name.trim()
        map.set(n, (map.get(n) || 0) + 1)
      }
    }
  }
  const items = [...map.entries()].map(([name, count]) => ({ name, count }))
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
  res.json({ items })
})

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
